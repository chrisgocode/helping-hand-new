import type { ExpoConfig } from 'expo/config'

const scheme = 'helpinghand'

const config: ExpoConfig = {
  name: 'Helping Hand',
  slug: 'helping-hand',
  version: '1.0.0',
  orientation: 'portrait',
  owner: 'chrisgocode',
  icon: './assets/images/icon.png',
  scheme,
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'dev.chrisgo.helpinghand',
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: 'dev.chrisgo.helpinghand',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    edgeToEdgeEnabled: true,
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  extra: {
    eas: {
      projectId: 'bb55bab4-6c85-485f-a5f7-d0f566d848ba',
    },
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#f5f0e6',
      },
    ],
    'expo-secure-store',
    [
      'expo-camera',
      {
        cameraPermission: 'Allow Helping Hand to scan an enrollment QR code.',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-speech-recognition',
      {
        microphonePermission:
          'Allow Helping Hand to hear you so you can say Done, Repeat, or the name of a routine instead of touching your phone.',
        speechRecognitionPermission:
          'Allow Helping Hand to understand what you say so it can move through a routine hands free.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
    autolinkingModuleResolution: true,
  },
}

export default config
