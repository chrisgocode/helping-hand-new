import { enrollmentStorage } from '../enrollment/enrollment-runtime'
import { createExpoSpeechVoice } from '../voice/expo-speech-voice'
import type { VoiceInterface } from '../voice/voice-interface'
import { getAssignedTaskTrees } from './assigned-tasks-api'
import type { AssignedTasksDependencies } from './use-assigned-tasks'

/**
 * The concrete pieces a running session is built from. They are named here so a
 * screen never constructs them, and so the voice can be swapped for a Bluetooth
 * route without any screen knowing it changed.
 */
export const assignedTasksRuntime: AssignedTasksDependencies = {
  storage: enrollmentStorage,
  api: { getAssignedTaskTrees },
}

export const sessionVoice: VoiceInterface = createExpoSpeechVoice()
