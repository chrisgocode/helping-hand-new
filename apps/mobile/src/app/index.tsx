import { CameraView, useCameraPermissions } from 'expo-camera'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { enrollmentRuntime } from '@/enrollment/enrollment-runtime'
import { useEnrollment } from '@/enrollment/use-enrollment'

function Button({
  children,
  onPress,
  secondary = false,
  disabled = false,
}: {
  children: string
  onPress: () => void
  secondary?: boolean
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        (pressed || disabled) && styles.buttonMuted,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{children}</Text>
    </Pressable>
  )
}

export default function HomeScreen() {
  const enrollment = useEnrollment(enrollmentRuntime)
  const [permission, requestPermission, refreshPermission] = useCameraPermissions()
  const { state } = enrollment

  const confirmRemoval = () =>
    Alert.alert(
      'Remove Helping Hand?',
      'This device will need a new enrollment code before it can be used again.',
      [
        { text: 'Keep enrollment', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void enrollment.removeEnrollment(),
        },
      ],
    )

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <Text style={styles.eyebrow}>RECIPIENT APP</Text>

        {state.status === 'loading' && (
          <View style={styles.centered} accessibilityLabel="Opening Helping Hand">
            <ActivityIndicator color="#9b4d24" size="large" />
          </View>
        )}

        {state.status === 'welcome' && (
          <View style={styles.stack}>
            <Text style={styles.title}>Helping Hand</Text>
            <Text style={styles.body}>
              {state.pending
                ? 'Your enrollment is still waiting for caretaker approval.'
                : 'Scan the enrollment code shown by your caretaker to get started.'}
            </Text>
            {state.pending ? (
              <>
                <Button onPress={enrollment.resumeSetup}>Resume enrollment</Button>
                <Button secondary onPress={enrollment.startScanning}>
                  Scan a different code
                </Button>
              </>
            ) : (
              <Button onPress={enrollment.startScanning}>Scan enrollment code</Button>
            )}
          </View>
        )}

        {state.status === 'scanning' && (
          <View style={styles.scannerScreen}>
            <Text style={styles.heading}>Scan enrollment code</Text>
            {!permission ? (
              <ActivityIndicator color="#9b4d24" />
            ) : !permission.granted ? (
              <View style={styles.stack}>
                <Text style={styles.body}>
                  Helping Hand needs camera access to scan the QR code shown by your caretaker.
                </Text>
                {permission.canAskAgain ? (
                  <Button onPress={() => void requestPermission()}>Allow camera</Button>
                ) : (
                  <Button onPress={() => void Linking.openSettings()}>Open Settings</Button>
                )}
                <Button secondary onPress={() => void refreshPermission()}>
                  Try again
                </Button>
                <Button secondary onPress={enrollment.stopScanning}>
                  Back
                </Button>
              </View>
            ) : (
              <>
                <CameraView
                  accessibilityLabel="QR code scanner"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={({ data }) => void enrollment.scan(data)}
                  style={styles.camera}
                />
                <Text style={styles.helper}>Place the entire QR code inside the frame.</Text>
                {state.error && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>
                    {state.error}
                  </Text>
                )}
                <Button secondary onPress={enrollment.stopScanning}>
                  Back
                </Button>
              </>
            )}
          </View>
        )}

        {state.status === 'claiming' && (
          <View style={styles.centered}>
            <ActivityIndicator color="#9b4d24" size="large" />
            <Text style={styles.body}>Checking the enrollment code…</Text>
          </View>
        )}

        {state.status === 'pending' && (
          <View style={styles.stack}>
            <Text style={styles.heading}>
              {state.pending.matchingCode ? 'Compare these codes' : 'Couldn’t check the code'}
            </Text>
            {state.pending.matchingCode && (
              <Text
                accessibilityLabel={`Matching code ${state.pending.matchingCode.split('').join(' ')}`}
                style={styles.matchingCode}
              >
                {state.pending.matchingCode}
              </Text>
            )}
            <Text style={styles.body}>
              {state.pending.matchingCode
                ? 'Ask your caretaker to confirm that this code matches the one on their screen.'
                : 'Your enrollment is safely saved. Try the request again.'}
            </Text>
            {state.error && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {state.error}
              </Text>
            )}
            {state.polling ? (
              <ActivityIndicator accessibilityLabel="Checking for approval" color="#9b4d24" />
            ) : (
              state.error && <Button onPress={enrollment.retryPending}>Try again</Button>
            )}
            <Button secondary disabled={state.polling} onPress={enrollment.leaveSetup}>
              Leave setup
            </Button>
          </View>
        )}

        {state.status === 'validating' && (
          <View style={styles.centered}>
            <ActivityIndicator color="#9b4d24" size="large" />
            <Text style={styles.body}>Finishing enrollment…</Text>
          </View>
        )}

        {state.status === 'validation-failed' && (
          <View style={styles.stack}>
            <Text style={styles.heading}>Couldn’t finish enrollment</Text>
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {state.error}
            </Text>
            <Button onPress={enrollment.retryValidation}>Try again</Button>
          </View>
        )}

        {state.status === 'terminal' && (
          <View style={styles.stack}>
            <Text style={styles.heading}>This code can’t be used</Text>
            <Text accessibilityLiveRegion="polite" style={styles.body}>
              {state.message}
            </Text>
            <Button onPress={enrollment.scanAgain}>Scan a new code</Button>
          </View>
        )}

        {state.status === 'authenticated' && (
          <View style={styles.stack}>
            <Text style={styles.title}>Hello, {state.session.recipient.displayName}</Text>
            <Text style={styles.body}>Helping Hand is enrolled on this device.</Text>
            {state.error && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {state.error}
              </Text>
            )}
            <Button secondary disabled={state.removing} onPress={confirmRemoval}>
              {state.removing ? 'Removing…' : 'Remove Helping Hand from this device'}
            </Button>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f0e6' },
  content: { flex: 1, padding: 28, gap: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  stack: { flex: 1, justifyContent: 'center', gap: 18 },
  scannerScreen: { flex: 1, gap: 16 },
  eyebrow: { color: '#9b4d24', fontSize: 13, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: '#18251d', fontSize: 42, fontWeight: '700', letterSpacing: -1.5 },
  heading: { color: '#18251d', fontSize: 30, fontWeight: '700', letterSpacing: -0.8 },
  body: { maxWidth: 480, color: '#405047', fontSize: 18, lineHeight: 27 },
  helper: { color: '#405047', fontSize: 16, textAlign: 'center' },
  error: { color: '#9b2c2c', fontSize: 16, lineHeight: 23 },
  matchingCode: {
    color: '#18251d',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: 7,
    textAlign: 'center',
  },
  camera: { flex: 1, minHeight: 280, borderRadius: 24, overflow: 'hidden' },
  button: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#18251d',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  secondaryButton: { borderColor: '#18251d', borderWidth: 1, backgroundColor: 'transparent' },
  buttonMuted: { opacity: 0.55 },
  buttonText: { color: '#fffdf8', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  secondaryButtonText: { color: '#18251d' },
})
