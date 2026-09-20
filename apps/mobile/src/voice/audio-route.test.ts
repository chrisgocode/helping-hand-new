import { describe, expect, it } from 'vitest'
import type { AudioRouteDescription } from '../../modules/audio-route'
import { assessRoute, describeRoute, isCapturingThroughGlasses } from './audio-route'

const port = (portType: string, portName: string) => ({ portType, portName })

const route = (
  inputs: AudioRouteDescription['inputs'],
  outputs: AudioRouteDescription['outputs'],
): AudioRouteDescription => ({ inputs, outputs })

const hfp = route([port('BluetoothHFP', 'Vanguard')], [port('BluetoothHFP', 'Vanguard')])
const a2dp = route(
  [port('BuiltInMic', 'iPhone Microphone')],
  [port('BluetoothA2DPOutput', 'Vanguard')],
)
const phone = route([port('BuiltInMic', 'iPhone Microphone')], [port('Speaker', 'Speaker')])

describe('assessRoute', () => {
  it('recognises the glasses on hands-free, which is the only route with a microphone', () => {
    expect(assessRoute(hfp)).toEqual({ kind: 'glasses', profile: 'hfp', name: 'Vanguard' })
  })

  it('recognises the glasses on high quality output, which has no microphone', () => {
    expect(assessRoute(a2dp)).toEqual({ kind: 'glasses', profile: 'a2dp', name: 'Vanguard' })
  })

  it('separates other Bluetooth devices from the glasses and the phone', () => {
    const earbuds = route(
      [port('BuiltInMic', 'iPhone Microphone')],
      [port('BluetoothLE', 'Earbuds')],
    )

    expect(assessRoute(earbuds)).toEqual({ kind: 'otherBluetooth', name: 'Earbuds' })
  })

  it('falls back to the phone', () => {
    expect(assessRoute(phone)).toEqual({ kind: 'phone' })
  })
})

describe('isCapturingThroughGlasses', () => {
  it('is true only when the input is the hands-free port', () => {
    expect(isCapturingThroughGlasses(hfp)).toBe(true)
    // Output over the glasses while the phone holds the microphone is the case
    // that would otherwise pass unnoticed and produce a worthless recording.
    expect(isCapturingThroughGlasses(a2dp)).toBe(false)
    expect(isCapturingThroughGlasses(phone)).toBe(false)
  })
})

describe('describeRoute', () => {
  it('says what the recipient can expect from each route', () => {
    expect(describeRoute(hfp)).toContain('microphone and speakers')
    expect(describeRoute(a2dp)).toContain('no microphone')
    expect(describeRoute(phone)).toBe('This phone')
  })
})
