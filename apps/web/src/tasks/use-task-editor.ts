import type { TaskDetail } from '@helping-hand/schemas'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addChildTask,
  applyTaskBreakdown,
  applyTaskDurations,
  applyTaskOrder,
  createTaskDraft,
  deleteTask,
  placeTask,
  type TaskBreakdownProposal,
  TaskDraftError,
  type TaskDurationProposal,
  type TaskOrderProposal,
  type TaskTreeDraft,
  updateTaskCategory,
  updateTaskDuration,
  updateTaskTitle,
  validateTaskDraft,
} from './task-draft'
import {
  proposeTaskBreakdown,
  proposeTaskDurations,
  proposeTaskOrder,
  saveTaskTree,
  TaskWorkspaceError,
} from './task-workspace'

type EditorStatus = 'idle' | 'saving' | 'saved' | 'error'
export type AiProposalOutcome = 'applied' | 'unchanged' | 'failed'
export type AiProposalAction =
  | { kind: 'breakdown'; taskId: string; detail: TaskDetail }
  | { kind: 'durations'; taskId: string }
  | { kind: 'order'; taskId: string }
export type AiProposalRecovery = 'retry' | 'reload' | 'sign-in' | 'none'
export type AiProposalState =
  | { status: 'idle' }
  | { status: 'running'; action: AiProposalAction['kind']; taskId: string }
  | {
      status: 'failed'
      action: AiProposalAction['kind']
      taskId: string
      message: string
      recovery: AiProposalRecovery
    }
  | { status: 'order-unchanged'; taskId: string }

type CompletedProposal =
  | { kind: 'breakdown'; proposal: TaskBreakdownProposal }
  | { kind: 'durations'; proposal: TaskDurationProposal }
  | { kind: 'order'; proposal: TaskOrderProposal }

const idleAiState: AiProposalState = { status: 'idle' }

type EditorState = {
  draft: TaskTreeDraft
  baseline: TaskTreeDraft
  status: EditorStatus
  error: TaskWorkspaceError | null
  ai: AiProposalState
}

async function requestProposal(
  action: AiProposalAction,
  draft: TaskTreeDraft,
): Promise<CompletedProposal> {
  switch (action.kind) {
    case 'breakdown':
      return {
        kind: action.kind,
        proposal: await proposeTaskBreakdown(draft, action.taskId, action.detail),
      }
    case 'durations':
      return {
        kind: action.kind,
        proposal: await proposeTaskDurations(draft, action.taskId),
      }
    case 'order':
      return { kind: action.kind, proposal: await proposeTaskOrder(draft, action.taskId) }
  }
}

function applyProposal(draft: TaskTreeDraft, completed: CompletedProposal) {
  switch (completed.kind) {
    case 'breakdown':
      return applyTaskBreakdown(draft, completed.proposal)
    case 'durations':
      return applyTaskDurations(draft, completed.proposal)
    case 'order':
      return applyTaskOrder(draft, completed.proposal)
  }
}

function normalizeAiFailure(cause: unknown) {
  if (cause instanceof TaskWorkspaceError) return cause
  if (cause instanceof TaskDraftError) {
    return new TaskWorkspaceError('ai_invalid_response', true, { cause })
  }
  return new TaskWorkspaceError('unexpected', false, { cause })
}

function recoveryFor(error: TaskWorkspaceError): AiProposalRecovery {
  if (error.kind === 'unauthenticated') return 'sign-in'
  if (error.kind === 'conflict') return 'reload'
  if (error.retryable) return 'retry'
  return 'none'
}

export function useTaskEditor(initialDraft?: TaskTreeDraft) {
  const [state, setState] = useState<EditorState>(() => {
    const draft = initialDraft ?? createTaskDraft()
    return { draft, baseline: draft, status: 'idle', error: null, ai: idleAiState }
  })
  const draftRef = useRef(state.draft)
  const inFlight = useRef(false)
  const retryAction = useRef<AiProposalAction | null>(null)

  useEffect(() => {
    if (state.ai.status !== 'order-unchanged') return
    const timeout = window.setTimeout(() => {
      setState((current) =>
        current.ai.status === 'order-unchanged' ? { ...current, ai: idleAiState } : current,
      )
    }, 4000)
    return () => window.clearTimeout(timeout)
  }, [state.ai])

  const changeDraft = useCallback((change: (draft: TaskTreeDraft) => TaskTreeDraft) => {
    const draft = change(draftRef.current)
    draftRef.current = draft
    if (!inFlight.current) retryAction.current = null
    setState((current) => ({
      ...current,
      draft,
      status: 'idle',
      error: null,
      ai: inFlight.current ? current.ai : idleAiState,
    }))
  }, [])

  const updateTitle = useCallback(
    (taskId: string, title: string) =>
      changeDraft((draft) => updateTaskTitle(draft, taskId, title)),
    [changeDraft],
  )
  const updateCategory = useCallback(
    (categoryId: string | null) => changeDraft((draft) => updateTaskCategory(draft, categoryId)),
    [changeDraft],
  )
  const addChild = useCallback(
    (parentId: string) => changeDraft((draft) => addChildTask(draft, parentId)),
    [changeDraft],
  )
  const removeTask = useCallback(
    (taskId: string) => changeDraft((draft) => deleteTask(draft, taskId)),
    [changeDraft],
  )
  const placeTaskAt = useCallback(
    (taskId: string, targetId: string, placement: 'before' | 'after') =>
      changeDraft((draft) => placeTask(draft, taskId, targetId, placement)),
    [changeDraft],
  )
  const updateDuration = useCallback(
    (taskId: string, durationSeconds: number | null) =>
      changeDraft((draft) => updateTaskDuration(draft, taskId, durationSeconds)),
    [changeDraft],
  )

  const executeAiProposal = useCallback(
    async (action: AiProposalAction): Promise<AiProposalOutcome> => {
      if (inFlight.current) return 'failed'
      inFlight.current = true
      retryAction.current = action
      setState((current) => ({
        ...current,
        status: 'idle',
        error: null,
        ai: { status: 'running', action: action.kind, taskId: action.taskId },
      }))

      try {
        const completed = await requestProposal(action, draftRef.current)
        const currentDraft = draftRef.current
        const draft = applyProposal(currentDraft, completed)
        const unchanged = action.kind === 'order' && draft === currentDraft
        draftRef.current = draft
        retryAction.current = null
        setState((current) => ({
          ...current,
          draft,
          status: unchanged ? current.status : 'idle',
          error: null,
          ai: unchanged ? { status: 'order-unchanged', taskId: action.taskId } : idleAiState,
        }))
        return unchanged ? 'unchanged' : 'applied'
      } catch (cause) {
        const error = normalizeAiFailure(cause)
        const recovery = recoveryFor(error)
        if (recovery !== 'retry') retryAction.current = null
        setState((current) => ({
          ...current,
          ai: {
            status: 'failed',
            action: action.kind,
            taskId: action.taskId,
            message: error.message,
            recovery,
          },
        }))
        return 'failed'
      } finally {
        inFlight.current = false
      }
    },
    [],
  )

  const breakDown = useCallback(
    (taskId: string, detail: TaskDetail) =>
      executeAiProposal({ kind: 'breakdown', taskId, detail }),
    [executeAiProposal],
  )
  const generateDurations = useCallback(
    (taskId: string) => executeAiProposal({ kind: 'durations', taskId }),
    [executeAiProposal],
  )
  const optimizeOrder = useCallback(
    (taskId: string) => executeAiProposal({ kind: 'order', taskId }),
    [executeAiProposal],
  )
  const retry = useCallback(() => {
    const action = retryAction.current
    return action ? executeAiProposal(action) : Promise.resolve<AiProposalOutcome>('failed')
  }, [executeAiProposal])

  const validationIssue = useMemo(() => validateTaskDraft(state.draft), [state.draft])
  const isDirty = state.draft !== state.baseline

  const save = useCallback(async () => {
    const draft = draftRef.current
    if (validateTaskDraft(draft)) return false

    setState((current) => ({ ...current, status: 'saving', error: null }))
    try {
      const saved = await saveTaskTree(draft)
      draftRef.current = saved
      setState({
        draft: saved,
        baseline: saved,
        status: 'saved',
        error: null,
        ai: idleAiState,
      })
      return true
    } catch (cause) {
      const error =
        cause instanceof TaskWorkspaceError
          ? cause
          : new TaskWorkspaceError('unexpected', false, { cause })
      setState((current) => ({
        ...current,
        status: 'error',
        error,
      }))
      return false
    }
  }, [])

  return {
    draft: state.draft,
    status: state.status,
    error: state.error,
    isDirty,
    validationIssue,
    updateTitle,
    updateCategory,
    addChild,
    removeTask,
    placeTask: placeTaskAt,
    updateDuration,
    ai: {
      state: state.ai,
      breakDown,
      generateDurations,
      optimizeOrder,
      retry,
    },
    save,
  }
}
