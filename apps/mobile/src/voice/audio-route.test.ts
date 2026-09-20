import { describe, expect, it } from 'vitest'
import type { AudioRouteDescription } from '../../modules/audio-route'
import {
  assessReadiness,
  assessRoute,
  describeRoute,
  isCapturingThroughBluetoothMic,
} from './audio-route'

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
// A hands-free headset that is plainly not the glasses, and is indistinguishable
// from them through the route alone.
const carSystem = route([port('BluetoothHFP', "Dave's Car")], [port('BluetoothHFP', "Dave's Car")])

describe('assessRoute', () => {
  it('names a Bluetooth profile rather than claiming to identify the device', () => {
    // Port type is a profile and port name is a user-renameable label, so a car
    // system reaches the same branch as the glasses. Calling either of them the
    // glasses is what lets audio from the wrong device be filed as a valid
    // wearable capture.
    expect(assessRoute(carSystem)).toEqual({
      kind: 'bluetooth',
      profile: 'hfp',
      name: "Dave's Car",
    })
    expect(describeRoute(carSystem)).not.toContain('glasses')
    expect(describeRoute(hfp)).not.toContain('glasses')
  })

  it('recognises hands-free, which is the only route with a microphone', () => {
    expect(assessRoute(hfp)).toEqual({ kind: 'bluetooth', profile: 'hfp', name: 'Vanguard' })
  })

  it('recognises the glasses on high quality output, which has no microphone', () => {
    expect(assessRoute(a2dp)).toEqual({ kind: 'bluetooth', profile: 'a2dp', name: 'Vanguard' })
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

describe('isCapturingThroughBluetoothMic', () => {
  it('reports the profile, which is all the route establishes', () => {
    // True for any hands-free headset. Nothing downstream may read it as proof
    // the glasses were the input.
    expect(isCapturingThroughBluetoothMic(carSystem)).toBe(true)
  })

  it('is true only when the input is the hands-free port', () => {
    expect(isCapturingThroughBluetoothMic(hfp)).toBe(true)
    // Output over the glasses while the phone holds the microphone is the case
    // that would otherwise pass unnoticed and produce a worthless recording.
    expect(isCapturingThroughBluetoothMic(a2dp)).toBe(false)
    expect(isCapturingThroughBluetoothMic(phone)).toBe(false)
  })
})

describe('describeRoute', () => {
  it('says what the recipient can expect from each route', () => {
    expect(describeRoute(hfp)).toContain('microphone and speakers')
    expect(describeRoute(a2dp)).toContain('no microphone')
    expect(describeRoute(phone)).toBe('This phone')
  })
})

describe('assessReadiness', () => {
  it('calls output-only normal before anything has been recorded', () => {
    const readiness = assessReadiness(a2dp, { takesRecorded: 0 })

    expect(readiness.kind).toBe('waiting')
    expect(readiness.message).toContain('normal state')
  })

  it('calls the same route a fault once takes exist', () => {
    const readiness = assessReadiness(a2dp, { takesRecorded: 4 })

    expect(readiness.kind).toBe('wrong')
    expect(readiness.message).toContain('redo the last take')
  })

  it('confirms the hands-free route is usable', () => {
    expect(assessReadiness(hfp, { takesRecorded: 0 }).kind).toBe('ready')
    expect(assessReadiness(hfp, { takesRecorded: 9 }).kind).toBe('ready')
  })

  it('is always wrong when the glasses are not the audio device', () => {
    expect(assessReadiness(phone, { takesRecorded: 0 }).kind).toBe('wrong')
    expect(assessReadiness(phone, { takesRecorded: 9 }).kind).toBe('wrong')
  })
})
