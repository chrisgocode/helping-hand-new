# Glasses capture session

A script for one recording session on Meta Vanguard glasses. It exists because the
hardware is borrowed: the aim is not to test the app but to collect a set of
recordings that can be scored again later, as many times as needed, without
asking for the glasses back.

Budget about 40 minutes.

## Before the session

- Send the tester the install link from `eas build --profile capture --platform ios`.
- Install the same build on your own phone and walk the harness once. With no
  glasses connected every take reads "This phone" and shows a red warning, which
  is the correct result and proves the flow works.
- Ask the tester's permission to record their voice, and tell them the recordings
  stay on their phone until they send them to you.
- Ask them to charge the glasses to full and note the percentage before starting.

## What the tester does

1. **Pair the glasses to the phone.** This happens in iOS Settings, not in the
   app. Helping Hand has no pairing step because for audio the glasses are an
   ordinary Bluetooth headset.
2. **Open Helping Hand and tap "Capture harness".** No enrollment is needed.
3. **Tap "Check route."** It should name the glasses. If it says "This phone",
   the glasses are not connected as an audio device — reconnect before going on.
4. **Choose the place they are recording in.** Start with the quiet room.
5. **For each prompt:** tap "Start take", say the words on screen once, normally,
   then tap "Stop and save".
   - The first take asks for microphone and speech permissions. Allow both.
   - The route line updates on every take. If it stops naming the glasses
     part-way through, stop and reconnect: recordings made after that point are
     of the phone and cannot be used.
   - A take spoiled by a cough or a misread prompt can be redone.
6. **At the end, tap "Send the results"** and share the file back.
7. **Repeat the whole script** in the other two places: with a tap running, and
   with a television or conversation nearby.
8. **Note the glasses battery percentage** at the end, and roughly how long the
   session took.

## What comes back

Everything lands in one folder on the tester's phone: three manifests, one per
place, and a recording per prompt named after the prompt it answers. Each
manifest holds what the recogniser heard, how each take scored, the path to its
audio, and whether the glasses microphone was really the input.

Two ways to get it back, and the second matters more:

- **"Send the results"** shares that place's manifest through the usual share
  sheet — AirDrop, Messages, Mail, Files. Nothing is uploaded anywhere; it goes
  wherever the tester picks and nowhere else.
- **The Files app** shows the folder under On My iPhone → Helping Hand →
  captures. Ask them to send that whole folder, because it holds the audio. The
  scores in a manifest only reflect the recogniser as configured on the day, and
  the recordings are what let a different one be tried later without borrowing
  the glasses again.

## Reading the results

The number that matters is not the overall score. Look at these separately:

- **False accepts.** A command taken from an utterance that was not one. This is
  the failure that skips a task a recipient has not done, and it is the one that
  decides whether voice can drive a session unsupervised.
- **Names against commands.** Fixed commands were always going to be easier.
  Whether "start morning routine" can be told from "start morning walk" over an
  8 kHz beamformed microphone is the real question, and it decides whether
  routines can be chosen by voice or have to be chosen another way.
- **How far accuracy falls with noise.** A kitchen tap is the normal case, not
  the edge case.
- **Takes not captured through the glasses.** Discard them rather than averaging
  them in. They describe the phone.

## If the glasses microphone never engages

Recordings through the phone still answer part of the question — they set an
upper bound, since phone audio is wideband and unbeamformed. If accuracy is poor
even there, the glasses will not rescue it, and the answer is already known.
