import type { AudioRouteDescription } from '../../modules/audio-route'
import { isCapturingThroughGlasses } from './audio-route'

/**
 * What opening the route needs from the platform, named so it can be driven in
 * tests without an audio session.
 */
export type HandsFreeRouteDeps = {
  setCategory(): void
  activate(): void
  getRoute(): AudioRouteDescription
  wait(milliseconds: number): Promise<void>
}

export type HandsFreeRouteOptions = {
  timeoutMs?: number
  pollMs?: number
}

/**
 * Brings up the hands-free route and waits for it to settle before anything
 * tries to listen through it.
 *
 * Switching the glasses from high quality output to hands-free tears the audio
 * session down and rebuilds it, and anything already listening dies with it.
 * Starting recognition first and letting it open the session means the first
 * take of a session is always lost to its own route change. Meta documents the
 * same ordering: open the route, wait for it, confirm the microphone is the one
 * expected, and only then stream.
 *
 * Returns whether the glasses microphone is the input by the time it gives up.
 */
export async function openHandsFreeRoute(
  deps: HandsFreeRouteDeps,
  { timeoutMs = 3000, pollMs = 250 }: HandsFreeRouteOptions = {},
): Promise<boolean> {
  if (isCapturingThroughGlasses(deps.getRoute())) return true

  deps.setCategory()
  deps.activate()

  for (let waited = 0; waited < timeoutMs; waited += pollMs) {
    await deps.wait(pollMs)
    if (isCapturingThroughGlasses(deps.getRoute())) return true
  }

  return false
}
