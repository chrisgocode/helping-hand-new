/**
 * How a guided session reaches the recipient's ears.
 *
 * The seam exists so the session never learns which device is speaking. A phone
 * speaker and non-display glasses differ in route, sample rate and battery cost,
 * and none of that belongs in traversal. Listening joins this interface once the
 * microphone route is proven; speaking is enough to run a session.
 *
 * Implementations must honour two rules the session relies on:
 *
 * - `speak` replaces whatever is already being said. A recipient who asks to
 *   repeat a task wants to hear it now, not queued behind the previous line.
 * - `speak` resolves when the words have finished, so callers can sequence
 *   speech against the silence window without polling.
 */
export type VoiceInterface = {
  speak(text: string): Promise<void>
  stop(): Promise<void>
}
