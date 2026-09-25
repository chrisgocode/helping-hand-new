import { useKeepAwake } from 'expo-keep-awake'
import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { assignedTasksRuntime, sessionVoice } from '@/session/session-runtime'
import { useAssignedTasks } from '@/session/use-assigned-tasks'
import { useVoiceNavigation } from '@/session/use-voice-navigation'
import { Button } from '@/ui/button'

const NO_TREES: never[] = []

export default function SessionScreen() {
  // A spoken session outlives the screen timeout, and a recipient with their
  // hands busy cannot wake the device to hear the next task.
  useKeepAwake()

  const { state, reload } = useAssignedTasks(assignedTasksRuntime)
  const navigation = useVoiceNavigation(
    sessionVoice,
    state.status === 'ready' ? state.trees : NO_TREES,
  )
  const { session, position } = navigation

  const leave = async () => {
    await navigation.stopListening()
    await session.end()
    router.back()
  }

  const goBack = async () => {
    await navigation.stopListening()
    router.back()
  }

  if (navigation.isRunning) {
    const task = session.task
    return (
      <Screen>
        <View style={styles.stack}>
          <VoiceControls navigation={navigation} />
          {task && (
            <>
              <Text style={styles.eyebrow}>{task.path.join(' · ').toUpperCase()}</Text>
              <Text accessibilityLiveRegion="polite" style={styles.task}>
                {task.title}
              </Text>
              <View style={styles.controls}>
                <Button disabled={session.isSpeaking} onPress={() => session.submit('next')}>
                  Done
                </Button>
                <Button
                  secondary
                  disabled={session.isSpeaking}
                  onPress={() => session.submit('repeat')}
                >
                  Say it again
                </Button>
                <Button
                  secondary
                  disabled={session.isSpeaking}
                  onPress={() => session.submit('back')}
                >
                  Go back
                </Button>
              </View>
            </>
          )}
          <Button secondary onPress={leave}>
            Stop for now
          </Button>
        </View>
      </Screen>
    )
  }

  return (
    <Screen>
      {state.status === 'loading' && (
        <View style={styles.centered}>
          <ActivityIndicator color="#9b4d24" size="large" />
          <Text style={styles.body}>Loading your routines…</Text>
        </View>
      )}

      {state.status === 'unenrolled' && (
        <Message heading="This device isn’t set up">
          Ask your caretaker to set up Helping Hand again.
        </Message>
      )}

      {state.status === 'revoked' && (
        <Message heading="Access has been removed">
          Your caretaker removed this device. Ask them to set it up again.
        </Message>
      )}

      {state.status === 'error' && (
        <View style={styles.stack}>
          <Text style={styles.heading}>Couldn’t load your routines</Text>
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {state.message}
          </Text>
          <Button onPress={reload}>Try again</Button>
          <Button secondary onPress={() => router.back()}>
            Go back
          </Button>
        </View>
      )}

      {state.status === 'ready' && navigation.catalog.length === 0 && (
        <Message heading="Nothing assigned yet">
          Your caretaker hasn’t assigned a routine to this device. It will appear here when they do.
        </Message>
      )}

      {state.status === 'ready' && navigation.catalog.length > 0 && (
        <ScrollView contentContainerStyle={styles.stack}>
          <VoiceControls navigation={navigation} />
          {position.kind === 'catalog' ? (
            <>
              <Text style={styles.eyebrow}>CHOOSE A CATEGORY</Text>
              <Button secondary onPress={() => navigation.request({ kind: 'listCategories' })}>
                Hear my options
              </Button>
              {navigation.catalog.map((category) => (
                <Button
                  key={category.id}
                  onPress={() =>
                    navigation.request({ kind: 'openCategory', categoryId: category.id })
                  }
                >
                  {`${category.name} · ${category.routines.length}`}
                </Button>
              ))}
            </>
          ) : (
            <>
              <Text style={styles.eyebrow}>{position.category.name.toUpperCase()}</Text>
              {position.category.routines.map((routine) => (
                <Button
                  key={routine.id}
                  onPress={() =>
                    navigation.request({ kind: 'startRoutine', routineId: routine.id })
                  }
                >
                  {routine.title}
                </Button>
              ))}
              <Button secondary onPress={() => navigation.request({ kind: 'back' })}>
                Other categories
              </Button>
            </>
          )}
          <Button secondary onPress={goBack}>
            Go back
          </Button>
        </ScrollView>
      )}
    </Screen>
  )
}

function VoiceControls({ navigation }: { navigation: ReturnType<typeof useVoiceNavigation> }) {
  const status = navigation.voiceError
    ? navigation.voiceError
    : navigation.voiceEnabled
      ? navigation.isListening
        ? 'Listening…'
        : 'Responding…'
      : 'Say “list my categories,” “start” and a routine name, or a task command.'

  return (
    <View style={styles.voiceControls}>
      <Text
        accessibilityLiveRegion={navigation.voiceError ? 'assertive' : 'polite'}
        style={navigation.voiceError ? styles.error : styles.body}
      >
        {status}
      </Text>
      <Button
        secondary={navigation.voiceEnabled}
        onPress={navigation.voiceEnabled ? navigation.stopListening : navigation.startListening}
      >
        {navigation.voiceEnabled ? 'Turn off voice controls' : 'Start voice controls'}
      </Button>
    </View>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  )
}

function Message({ heading, children }: { heading: string; children: string }) {
  return (
    <View style={styles.stack}>
      <Text style={styles.heading}>{heading}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.body}>
        {children}
      </Text>
      <Button onPress={() => router.back()}>Go back</Button>
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f0e6' },
  content: { flex: 1, padding: 28, gap: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  stack: { flexGrow: 1, justifyContent: 'center', gap: 18 },
  controls: { gap: 12 },
  voiceControls: { gap: 12 },
  eyebrow: { color: '#9b4d24', fontSize: 13, fontWeight: '700', letterSpacing: 1.5 },
  heading: { color: '#18251d', fontSize: 30, fontWeight: '700', letterSpacing: -0.8 },
  // The current task is the whole screen's purpose, so it is sized to be read
  // from across a room rather than held close.
  task: { color: '#18251d', fontSize: 44, fontWeight: '700', letterSpacing: -1.5, lineHeight: 50 },
  body: { maxWidth: 480, color: '#405047', fontSize: 18, lineHeight: 27 },
  error: { color: '#9b2c2c', fontSize: 16, lineHeight: 23 },
})
