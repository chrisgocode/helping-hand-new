import type { AudioPort, AudioRouteDescription } from '../../modules/audio-route'

/**
 * `AVAudioSession.Port` raw values this app cares about. Hands-free is the only
 * Bluetooth profile that carries a microphone, and it is the one the glasses use.
 */
const BLUETOOTH_HFP = 'BluetoothHFP'
const BLUETOOTH_A2DP = 'BluetoothA2DPOutput'
const BLUETOOTH_LE = 'BluetoothLE'

/** What the app can tell the recipient about where their audio is going. */
export type RouteAssessment =
  | { kind: 'glasses'; profile: 'hfp' | 'a2dp'; name: string }
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
  if (hfp) return { kind: 'glasses', profile: 'hfp', name: hfp.portName }

  const a2dp = route.outputs.find((port) => port.portType === BLUETOOTH_A2DP)
  if (a2dp) return { kind: 'glasses', profile: 'a2dp', name: a2dp.portName }

  const otherBluetooth = [...route.outputs, ...route.inputs].find(isBluetooth)
  if (otherBluetooth) return { kind: 'otherBluetooth', name: otherBluetooth.portName }

  return { kind: 'phone' }
}

/**
 * Whether the microphone in use is the one on the glasses. This is the check to
 * run before trusting captured audio, because everything else about a recording
 * looks identical either way.
 */
export function isCapturingThroughGlasses(route: AudioRouteDescription): boolean {
  return route.inputs.some((port) => port.portType === BLUETOOTH_HFP)
}

function isBluetooth(port: AudioPort): boolean {
  return [BLUETOOTH_HFP, BLUETOOTH_A2DP, BLUETOOTH_LE].includes(port.portType)
}

/** A short line naming where audio is going, for a screen or a capture manifest. */
export function describeRoute(route: AudioRouteDescription): string {
  const assessment = assessRoute(route)

  switch (assessment.kind) {
    case 'glasses':
      return assessment.profile === 'hfp'
        ? `${assessment.name} — microphone and speakers (8 kHz)`
        : `${assessment.name} — speakers only, no microphone`
    case 'otherBluetooth':
      return `${assessment.name} — a Bluetooth device that is not the glasses`
    case 'phone':
      return 'This phone'
  }
}
