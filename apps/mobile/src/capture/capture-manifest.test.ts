import { describe, expect, it } from 'vitest'
import type { AudioRouteDescription } from '../../modules/audio-route'
import { buildManifest, manifestFileName } from './capture-manifest'
import { recordTake, startRun } from './capture-run'

const glassesRoute: AudioRouteDescription = {
  inputs: [{ portType: 'BluetoothHFP', portName: 'Vanguard' }],
  outputs: [{ portType: 'BluetoothHFP', portName: 'Vanguard' }],
}

const run = recordTake(startRun('quiet'), {
  transcript: 'done',
  uri: 'file:///take.wav',
  route: glassesRoute,
})

describe('buildManifest', () => {
  it('carries the scored outcome next to what was heard', () => {
    const manifest = buildManifest(run, { device: 'iPhone 15', route: glassesRoute })

    expect(manifest.takes[0]).toMatchObject({
      promptId: 'cmd-done',
      transcript: 'done',
      uri: 'file:///take.wav',
      outcome: 'correct',
    })
    expect(manifest.summary.correct).toBe(1)
  })

  it('records the route so a set captured through the phone can be discarded', () => {
    const manifest = buildManifest(run, { device: 'iPhone 15', route: glassesRoute })

    expect(manifest.route.description).toContain('Vanguard')
    expect(manifest.route.raw).toEqual(glassesRoute)
    expect(buildManifest(run, { device: 'iPhone 15', route: null }).route.description).toBe(
      'Unknown',
    )
  })
})

describe('manifestFileName', () => {
  it('sorts by time and says what it holds', () => {
    expect(manifestFileName(run, new Date('2026-09-20T10:11:12.000Z'))).toBe(
      'helping-hand-capture-quiet-2026-09-20T10-11-12-000Z.json',
    )
  })
})
