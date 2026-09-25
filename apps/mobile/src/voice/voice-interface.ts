/**
 * How a guided session reaches the recipient's ears.
 *
 * The seam exists so the session never learns which device is speaking. A phone
 * speaker and non-display glasses differ in route, sample rate and battery cost,
 * and none of that belongs in traversal. Both directions live here so a session
 * can alternate between narration and listening without knowing which
 * microphone or speaker is in use.
 *
 * Implementations must honour two rules the session relies on:
 *
 * - `speak` replaces whatever is already being said. A recipient who asks to
 *   repeat a task wants to hear it now, not queued behind the previous line.
 * - `speak` resolves when the words have finished, so callers can sequence
 *   speech against the silence window without polling.
 * - `listen` resolves after one utterance, or with `null` when nothing useful
 *   was heard, so callers can keep listening without treating silence as an
 *   error.
 */
export type VoiceInterface = {
  speak(text: string): Promise<void>
  listen(contextualStrings: readonly string[]): Promise<string | null>
  stop(): Promise<void>
}
