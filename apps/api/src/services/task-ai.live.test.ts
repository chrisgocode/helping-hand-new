import { expect, test } from 'bun:test'
import { TaskAi } from './task-ai'

const liveTest =
  process.env.RUN_LIVE_AI_TESTS === '1' && process.env.OPENROUTER_API_KEY ? test : test.skip

liveTest(
  'the configured OpenRouter model satisfies every task AI contract',
  async () => {
    const taskAi = new TaskAi({
      apiKey: process.env.OPENROUTER_API_KEY ?? '',
      model: process.env.OPENROUTER_MODEL,
    })
    const rootId = '00000000-0000-4000-8000-000000000001'
    const firstId = '00000000-0000-4000-8000-000000000002'
    const secondId = '00000000-0000-4000-8000-000000000003'

    const breakdown = await taskAi.breakDownTask({
      task: { id: rootId, title: 'Make a cup of tea', durationSeconds: null, children: [] },
      detail: 1,
    })
    expect(breakdown.taskId).toBe(rootId)
    expect(breakdown.children.length).toBeGreaterThan(0)

    const durations = await taskAi.estimateTaskDurations({
      task: {
        id: rootId,
        title: 'Make a cup of tea',
        durationSeconds: null,
        children: [
          { id: firstId, title: 'Boil water', durationSeconds: null, children: [] },
          { id: secondId, title: 'Steep tea', durationSeconds: null, children: [] },
        ],
      },
    })
    expect(new Set(durations.durations.map(({ taskId }) => taskId))).toEqual(
      new Set([firstId, secondId]),
    )

    const order = await taskAi.optimizeSubtaskOrder({
      task: {
        id: rootId,
        title: 'Make a cup of tea',
        durationSeconds: null,
        children: [
          { id: secondId, title: 'Steep tea', durationSeconds: null, children: [] },
          { id: firstId, title: 'Boil water', durationSeconds: null, children: [] },
        ],
      },
    })
    expect(new Set(order.orderedTaskIds)).toEqual(new Set([firstId, secondId]))
  },
  { timeout: 120_000 },
)
