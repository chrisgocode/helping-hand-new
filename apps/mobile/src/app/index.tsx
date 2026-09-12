import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <Text style={styles.eyebrow}>RECIPIENT APP</Text>
        <Text style={styles.title}>Helping Hand</Text>
        <Text style={styles.body}>The mobile foundation is ready for enrollment and glasses.</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  eyebrow: {
    color: '#9b4d24',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    color: '#18251d',
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1.5,
  },
  body: {
    maxWidth: 420,
    color: '#405047',
    fontSize: 18,
    lineHeight: 27,
  },
})
