import { File } from 'expo-file-system'
import { router } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { StatusBar } from 'expo-status-bar'
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { buildManifest, manifestFileName } from '@/capture/capture-manifest'
import { CAPTURE_ENVIRONMENTS } from '@/capture/capture-script'
import { CAPTURE_DIRECTORY, currentPrompt, isComplete, useCapture } from '@/capture/use-capture'
import { Button } from '@/ui/button'
import { describeRoute, isCapturingThroughGlasses } from '@/voice/audio-route'

/**
 * A recording harness, not part of the recipient experience. It exists so one
 * session with borrowed hardware yields a set that can be scored again later
 * without asking for the hardware back.
 */
export default function CaptureScreen() {
  const capture = useCapture()
  const { run, route } = capture
  const prompt = run ? currentPrompt(run) : null

  const exportRun = async () => {
    if (!run) return

    const file = new File(CAPTURE_DIRECTORY, manifestFileName(run))
    file.create({ overwrite: true })
    file.write(
      JSON.stringify(
        buildManifest(run, { device: `${Platform.OS} ${Platform.Version}`, route }),
        null,
        2,
      ),
    )

    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri)
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>CAPTURE HARNESS</Text>

        <View style={styles.routeCard}>
          <Text style={styles.routeLabel}>Audio route</Text>
          <Text accessibilityLiveRegion="polite" style={styles.routeValue}>
            {route ? describeRoute(route) : 'Not checked yet'}
          </Text>
          {route && !isCapturingThroughGlasses(route) && (
            <Text style={styles.warning}>
              The glasses microphone is not the input. Recordings made now capture the phone and
              cannot be used. Connect the glasses, then start a take to open the hands-free route.
            </Text>
          )}
          <Button secondary onPress={capture.refreshRoute}>
            Check route
          </Button>
        </View>

        {!run && (
          <View style={styles.stack}>
            <Text style={styles.heading}>Where are you recording?</Text>
            <Text style={styles.body}>
              Read the same script in each place. What matters is how far accuracy falls with noise,
              not the quiet number on its own.
            </Text>
            {CAPTURE_ENVIRONMENTS.map((environment) => (
              <Button key={environment.id} onPress={() => capture.begin(environment.id)}>
                {environment.label}
              </Button>
            ))}
          </View>
        )}

        {run && prompt && (
          <View style={styles.stack}>
            <Text style={styles.progress}>
              {run.index + 1} of {run.prompts.length}
            </Text>
            <Text style={styles.sayLabel}>Say</Text>
            <Text accessibilityLiveRegion="polite" style={styles.say}>
              {prompt.say}
            </Text>

            {capture.listening ? (
              <Button onPress={capture.finishTake}>Stop and save</Button>
            ) : (
              <Button onPress={capture.listen}>Start take</Button>
            )}

            <Button secondary disabled={run.takes.length === 0} onPress={capture.redo}>
              Redo the last one
            </Button>
          </View>
        )}

        {run && isComplete(run) && capture.summary && (
          <View style={styles.stack}>
            <Text style={styles.heading}>Done</Text>
            <Text style={styles.body}>
              {capture.summary.correct} of {capture.summary.total} correct ·{' '}
              {capture.summary.missed} missed · {capture.summary.wrong} wrong ·{' '}
              {capture.summary.falseAccepts} false accepts
            </Text>
            <Text style={styles.body}>
              {capture.summary.throughGlasses} of {capture.summary.total} were captured through the
              glasses.
            </Text>
            <Button onPress={exportRun}>Send the results</Button>
            <Text style={styles.body}>
              The recordings stay on this phone, in Files under Helping Hand. Send that folder too
              so the same words can be tried against a different recogniser later.
            </Text>
          </View>
        )}

        <Button secondary onPress={() => router.back()}>
          Go back
        </Button>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f0e6' },
  content: { padding: 28, gap: 24 },
  stack: { gap: 16 },
  eyebrow: { color: '#9b4d24', fontSize: 13, fontWeight: '700', letterSpacing: 1.5 },
  heading: { color: '#18251d', fontSize: 28, fontWeight: '700', letterSpacing: -0.8 },
  body: { color: '#405047', fontSize: 17, lineHeight: 26 },
  progress: { color: '#405047', fontSize: 15, fontWeight: '600' },
  sayLabel: { color: '#9b4d24', fontSize: 13, fontWeight: '700', letterSpacing: 1.5 },
  say: { color: '#18251d', fontSize: 38, fontWeight: '700', letterSpacing: -1.2, lineHeight: 44 },
  routeCard: {
    gap: 10,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd3c0',
  },
  routeLabel: { color: '#9b4d24', fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  routeValue: { color: '#18251d', fontSize: 18, fontWeight: '600' },
  warning: { color: '#9b2c2c', fontSize: 15, lineHeight: 22 },
})
