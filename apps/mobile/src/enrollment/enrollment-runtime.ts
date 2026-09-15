import * as Crypto from 'expo-crypto'
import { File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import {
  claimEnrollment,
  collectEnrollmentSession,
  getRecipientIdentity,
  signOutRecipient,
} from './enrollment-api'
import { encodeBase64Url } from './enrollment-payload'
import {
  createEnrollmentStorage,
  type EnrollmentStorage,
  type SecureKeyValueAdapter,
} from './enrollment-storage'
import type { EnrollmentDependencies } from './use-enrollment'

const INSTALLATION_MARKER = '.helping-hand-installation'

/**
 * The keychain survives an uninstall and can be restored onto another device,
 * while app storage cannot, so a missing marker means any credential found
 * belongs to an installation that is gone.
 */
const nativeSecureStorage: SecureKeyValueAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
  isFreshInstallation: async () => !new File(Paths.document, INSTALLATION_MARKER).exists,
  async markInstallationHandled() {
    const marker = new File(Paths.document, INSTALLATION_MARKER)
    marker.create({ overwrite: true })
    marker.write('1')
  },
}

/** Expo web preview only. Session storage dies with the tab, so it is never stale. */
const webPreviewStorage: SecureKeyValueAdapter = {
  getItem: async (key) => globalThis.sessionStorage.getItem(key),
  setItem: async (key, value) => globalThis.sessionStorage.setItem(key, value),
  deleteItem: async (key) => globalThis.sessionStorage.removeItem(key),
  isFreshInstallation: async () => false,
  markInstallationHandled: async () => {},
}

export const enrollmentStorage: EnrollmentStorage = createEnrollmentStorage(
  Platform.OS === 'web' ? webPreviewStorage : nativeSecureStorage,
)

export const enrollmentRuntime: EnrollmentDependencies = {
  storage: enrollmentStorage,
  api: { claimEnrollment, collectEnrollmentSession, getRecipientIdentity, signOutRecipient },
  createClaimantSecret: async () => encodeBase64Url(await Crypto.getRandomBytesAsync(32)),
}
