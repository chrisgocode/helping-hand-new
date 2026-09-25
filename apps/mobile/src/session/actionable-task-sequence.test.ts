import type { TaskNode } from '@helping-hand/schemas'
import { describe, expect, it } from 'vitest'
import { sequenceActionableTasks } from './actionable-task-sequence'

function task(id: string, title: string, children: TaskNode[] = []): TaskNode {
  return { id, title, durationSeconds: null, children }
}

describe('sequenceActionableTasks', () => {
  it('treats a childless root as the only actionable task', () => {
    expect(sequenceActionableTasks(task('a', 'Brush teeth'))).toEqual([
      { id: 'a', title: 'Brush teeth', durationSeconds: null, path: [] },
    ])
  })

  it('walks depth-first and omits summary tasks', () => {
    const tree = task('root', 'Morning routine', [
      task('wash', 'Wash up', [task('teeth', 'Brush teeth'), task('face', 'Wash face')]),
      task('dress', 'Get dressed'),
    ])

    expect(sequenceActionableTasks(tree).map((entry) => entry.title)).toEqual([
      'Brush teeth',
      'Wash face',
      'Get dressed',
    ])
  })

  it('records the summary tasks an actionable task sits under, outermost first', () => {
    const tree = task('root', 'Morning routine', [
      task('wash', 'Wash up', [task('teeth', 'Brush teeth')]),
    ])

    expect(sequenceActionableTasks(tree)[0]?.path).toEqual(['Morning routine', 'Wash up'])
  })

  it('carries duration through', () => {
    const tree: TaskNode = { id: 'a', title: 'Rinse', durationSeconds: 30, children: [] }

    expect(sequenceActionableTasks(tree)[0]?.durationSeconds).toBe(30)
  })
})
