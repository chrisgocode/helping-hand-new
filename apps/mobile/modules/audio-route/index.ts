import { NativeModule, requireNativeModule } from 'expo-modules-core'

export type AudioPort = {
  /** An `AVAudioSession.Port` raw value, such as `BluetoothHFP` or `BuiltInMic`. */
  portType: string
  portName: string
}

export type AudioRouteDescription = {
  inputs: AudioPort[]
  outputs: AudioPort[]
}

export type AudioRouteEvents = {
  onRouteChange(event: AudioRouteDescription & { reason: string }): void
  onInterruption(event: { began: boolean }): void
}

declare class AudioRouteNativeModule extends NativeModule<AudioRouteEvents> {
  getCurrentRoute(): AudioRouteDescription
}

export default requireNativeModule<AudioRouteNativeModule>('AudioRoute')
