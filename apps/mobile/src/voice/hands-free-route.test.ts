import { describe, expect, it, vi } from 'vitest'
import type { AudioRouteDescription } from '../../modules/audio-route'
import { type HandsFreeRouteDeps, openHandsFreeRoute } from './hands-free-route'

const hfp: AudioRouteDescription = {
  inputs: [{ portType: 'BluetoothHFP', portName: 'Meta Glasses' }],
  outputs: [{ portType: 'BluetoothHFP', portName: 'Meta Glasses' }],
}

const a2dp: AudioRouteDescription = {
  inputs: [{ portType: 'BuiltInMic', portName: 'iPhone Microphone' }],
  outputs: [{ portType: 'BluetoothA2DPOutput', portName: 'Meta Glasses' }],
}

const phone: AudioRouteDescription = {
  inputs: [{ portType: 'BuiltInMic', portName: 'iPhone Microphone' }],
  outputs: [{ portType: 'Speaker', portName: 'Speaker' }],
}

/** A route that flips to hands-free after a given number of polls. */
function deps(settlesAfterPolls: number, start: AudioRouteDescription = a2dp) {
  let polls = 0
  const calls = { setCategory: 0, activate: 0 }

  const object: HandsFreeRouteDeps = {
    setCategory: () => {
      calls.setCategory += 1
    },
    activate: () => {
      calls.activate += 1
    },
    getRoute: () => {
      const route = polls >= settlesAfterPolls ? hfp : start
      polls += 1
      return route
    },
    wait: async () => {},
  }

  return { object, calls }
}

describe('openHandsFreeRoute', () => {
  it('does nothing when the route is already hands-free', async () => {
    const { object, calls } = deps(0, hfp)

    expect(await openHandsFreeRoute(object)).toBe(true)
    expect(calls.setCategory).toBe(0)
    expect(calls.activate).toBe(0)
  })

  it('opens the route and waits for it to settle', async () => {
    const { object, calls } = deps(3)

    expect(await openHandsFreeRoute(object)).toBe(true)
    expect(calls.setCategory).toBe(1)
    expect(calls.activate).toBe(1)
  })

  it('opens a phone route without waiting for Bluetooth', async () => {
    const wait = vi.fn(async () => {})
    const { object } = deps(Number.POSITIVE_INFINITY, phone)
    object.wait = wait

    expect(await openHandsFreeRoute(object)).toBe(false)
    expect(wait).not.toHaveBeenCalled()
  })

  it('gives up rather than reporting a route it never got', async () => {
    const { object } = deps(Number.POSITIVE_INFINITY)

    expect(await openHandsFreeRoute(object, { timeoutMs: 500, pollMs: 250 })).toBe(false)
  })

  it('polls until the deadline and no further', async () => {
    const wait = vi.fn(async () => {})
    const object: HandsFreeRouteDeps = {
      setCategory: () => {},
      activate: () => {},
      getRoute: () => a2dp,
      wait,
    }

    await openHandsFreeRoute(object, { timeoutMs: 1000, pollMs: 250 })

    expect(wait).toHaveBeenCalledTimes(4)
  })
})
