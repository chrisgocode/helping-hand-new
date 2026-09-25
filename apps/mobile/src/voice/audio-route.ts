import type { AudioPort, AudioRouteDescription } from '../../modules/audio-route'

/**
 * `AVAudioSession.Port` raw values this app cares about. Hands-free is the only
 * Bluetooth profile that carries a microphone, and it is the one the glasses use
 * — along with every other hands-free headset, which is the whole difficulty
 * below.
 */
const BLUETOOTH_HFP = 'BluetoothHFP'
const BLUETOOTH_A2DP = 'BluetoothA2DPOutput'
const BLUETOOTH_LE = 'BluetoothLE'

/**
 * What the app can tell the recipient about where their audio is going.
 *
 * Deliberately about Bluetooth profiles rather than about the glasses. A port
 * type names a profile and a port name is a user-renameable label, so neither
 * identifies Meta hardware: a car system or any hands-free headset presents
 * exactly as the glasses do here. Nothing reachable from this app supplies a
 * verified device identity — `AudioRoute` exposes only the port list, and the
 * Wearables Device Access Toolkit is excluded from the build — so this module
 * does not claim one.
 */
export type RouteAssessment =
  | { kind: 'bluetooth'; profile: 'hfp' | 'a2dp'; name: string }
  | { kind: 'otherBluetooth'; name: string }
  | { kind: 'phone' }

/**
 * Describes where audio is actually going, so a recipient can be told their
 * glasses are not connected instead of being spoken to through a phone speaker
 * they cannot hear.
 *
 * A capture route is judged by its input: Meta documents that starting capture
 * before hands-free has settled fails silently, and a session that believes it
 * is listening through the glasses while recording the phone produces audio that
 * looks fine and proves nothing.
 */
export function assessRoute(route: AudioRouteDescription): RouteAssessment {
  const hfp = route.inputs.find((port) => port.portType === BLUETOOTH_HFP)
  if (hfp) return { kind: 'bluetooth', profile: 'hfp', name: hfp.portName }

  const a2dp = route.outputs.find((port) => port.portType === BLUETOOTH_A2DP)
  if (a2dp) return { kind: 'bluetooth', profile: 'a2dp', name: a2dp.portName }

  const otherBluetooth = [...route.outputs, ...route.inputs].find(isBluetooth)
  if (otherBluetooth) return { kind: 'otherBluetooth', name: otherBluetooth.portName }

  return { kind: 'phone' }
}

/**
 * Whether the microphone in use is a Bluetooth hands-free one.
 *
 * This is what the route can actually establish, and it is the check to run
 * before trusting captured audio: a take recorded through the phone microphone
 * proves nothing about a wearable and everything else about the recording looks
 * identical either way. It does not establish *which* headset is connected, so
 * nothing downstream should read it as "the glasses".
 */
export function isCapturingThroughBluetoothMic(route: AudioRouteDescription): boolean {
  return route.inputs.some((port) => port.portType === BLUETOOTH_HFP)
}

function isBluetooth(port: AudioPort): boolean {
  return [BLUETOOTH_HFP, BLUETOOTH_A2DP, BLUETOOTH_LE].includes(port.portType)
}

/** A short line naming where audio is going, for a screen or a capture manifest. */
export function describeRoute(route: AudioRouteDescription): string {
  const assessment = assessRoute(route)

  switch (assessment.kind) {
    case 'bluetooth':
      return assessment.profile === 'hfp'
        ? `${assessment.name} — Bluetooth microphone and speakers (8 kHz)`
        : `${assessment.name} — Bluetooth speakers only, no microphone`
    case 'otherBluetooth':
      return `${assessment.name} — a Bluetooth device with no usable microphone`
    case 'phone':
      return 'This phone'
  }
}

/** How a route should be read to someone about to record, or already recording. */
export type RouteReadiness =
  | { kind: 'ready'; message: string }
  | { kind: 'waiting'; message: string }
  | { kind: 'wrong'; message: string }

/**
 * Explains a route in terms of what the tester should do about it.
 *
 * Output-only over the glasses is the normal resting state, not a fault: the
 * hands-free route carries the microphone and is mutually exclusive with high
 * quality output, so it only opens once a take starts. Saying otherwise before
 * anything has been recorded tells a tester to fix something that is not broken.
 * The same route part-way through a run does mean something went wrong.
 */
export function assessReadiness(
  route: AudioRouteDescription,
  { takesRecorded }: { takesRecorded: number },
): RouteReadiness {
  const assessment = assessRoute(route)

  if (assessment.kind === 'bluetooth' && assessment.profile === 'hfp') {
    return {
      kind: 'ready',
      message: `A Bluetooth microphone is the input (${assessment.name}). Recordings are usable — check the name is the glasses, which the app cannot tell on its own.`,
    }
  }

  if (assessment.kind === 'bluetooth') {
    return takesRecorded === 0
      ? {
          kind: 'waiting',
          message:
            'Connected for sound. The microphone opens by itself when you start a take — this is the normal state before then.',
        }
      : {
          kind: 'wrong',
          message:
            'The microphone has dropped back to sound only. Stop, reconnect the glasses, and redo the last take.',
        }
  }

  return {
    kind: 'wrong',
    message:
      'No Bluetooth microphone is connected. Connect the glasses in Settings before recording, or the takes will capture this phone.',
  }
}
