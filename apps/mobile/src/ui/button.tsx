import { Pressable, StyleSheet, Text } from 'react-native'

/**
 * The app's one button. Sized for a recipient who may be reading it at arm's
 * length with wet hands, so the tap target stays large even when the label is
 * short.
 */
export function Button({
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
        (pressed || disabled) && styles.muted,
      ]}
    >
      <Text style={[styles.label, secondary && styles.secondaryLabel]}>{children}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
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
  muted: { opacity: 0.55 },
  label: { color: '#fffdf8', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  secondaryLabel: { color: '#18251d' },
})
