import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../lib/api'
import { deriveKeys, generateSalt, toBase64, sha256, encryptVaultData, decryptVaultData } from '../lib/crypto'
import { createEmptyVaultPayload } from '../lib/vault-schema'
import { vaultRepository } from '../lib/vault-repository'
import { getAuthToken, getAuthGeneration, setAuthToken, invalidateAuthSession, onUnauthorized } from '../lib/auth-session'
import { useTerminalStore } from './terminal'
import { closeAllTransfers } from './transfers'
import { captureSSHConnectionCleanup } from '../lib/ssh-client'
import type { KdfParams, VaultStatus, AuthResponse } from '../types'
import { i18n } from '../i18n'

const STORAGE_KEY = 'webssh_vault_session_v1'
interface SavedSession extends AuthResponse { version: 1; encKey: string }
interface AuthRuntime {
  initialization: Promise<void> | null
  statusRequest: Promise<void> | null
  metadataVersion: number
  busy: boolean
  expiryTimer: ReturnType<typeof setTimeout> | null
  channel: BroadcastChannel | null
}
const runtimes = new WeakMap<object, AuthRuntime>()
const runtimeFor = (store: object): AuthRuntime => {
  let runtime = runtimes.get(store)
  if (!runtime) {
    runtime = { initialization: null, statusRequest: null, metadataVersion: 0, busy: false, expiryTimer: null, channel: null }
    runtimes.set(store, runtime)
  }
  return runtime
}
const text = (key: string) => i18n.global.t('vault.' + key)
const assertCurrent = (generation: number) => {
  if (generation !== getAuthGeneration()) throw new Error(text('sessionChanged'))
}
function clearSavedSession(strict = false) {
  try { sessionStorage.removeItem(STORAGE_KEY); return true }
  catch { if (strict) throw new Error(text('storageClearFailed')); return false }
}
function clearLegacyStorage() {
  try { sessionStorage.removeItem('jwt'); sessionStorage.removeItem('enc_key') } catch { /* No storage access */ }
  try { localStorage.removeItem('webssh_settings') } catch { /* No storage access */ }
}
function decodeKey(value: string) {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0))
  if (bytes.length !== 32) throw new Error(text('invalidSession'))
  return bytes
}
async function importKey(bytes: Uint8Array) {
  return crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
function validResponse(value: AuthResponse, vaultId: string, keyEpoch: number) {
  if (!value.token || value.vaultId !== vaultId || value.keyEpoch !== keyEpoch ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt * 1000 <= Date.now()) throw new Error(text('invalidSession'))
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    isInitialized: false, isAuthenticated: false, encKey: null as CryptoKey | null,
    vaultExists: null as boolean | null, vaultSalt: null as string | null,
    vaultKdfAlgo: null as string | null, vaultKdfParams: null as KdfParams | null,
    vaultId: null as string | null, keyEpoch: 0, formatVersion: 1,
    checkingStatus: false, connectionError: null as string | null,
    rememberSession: false, expiresAt: 0, cleanupPending: false,
  }),
  actions: {
    async initialize(): Promise<void> {
      if (this.isInitialized) return
      const runtime = runtimeFor(this)
      if (runtime.initialization) return runtime.initialization
      clearLegacyStorage()
      onUnauthorized(() => { void this.logout(false) })
      if (typeof BroadcastChannel !== 'undefined' && !runtime.channel) {
        runtime.channel = new BroadcastChannel('webssh-vault-events')
        runtime.channel.onmessage = event => {
          if (event.data?.vaultId !== this.vaultId) return
          if (event.data.type === 'lock' || (event.data.type === 'rekey' && Number.isSafeInteger(event.data.keyEpoch) &&
              event.data.keyEpoch > (vaultRepository.getEnvelope()?.keyEpoch ?? this.keyEpoch))) void this.logout(false)
        }
      }
      runtime.initialization = (async () => {
        try {
          await this.checkStatus()
          if (!this.connectionError && this.vaultExists) await this.restoreSession()
          else if (!this.vaultExists && !this.connectionError) clearSavedSession()
        } finally { this.isInitialized = true; runtime.initialization = null }
      })()
      return runtime.initialization
    },

    async checkStatus(): Promise<void> {
      const runtime = runtimeFor(this)
      if (runtime.statusRequest) return runtime.statusRequest
      const version = runtime.metadataVersion
      const generation = getAuthGeneration()
      this.checkingStatus = true
      this.connectionError = null
      runtime.statusRequest = (async () => {
        try {
          const status = await api.getVaultStatus()
          if (version !== runtime.metadataVersion || generation !== getAuthGeneration()) return
          if (status.exists) {
            if (!status.salt || !status.kdfParams || !status.vaultId || !status.keyEpoch || status.formatVersion !== 1) {
              throw new Error(i18n.global.t('setup.metadataUnavailable'))
            }
            this.applyVaultMetadata(status)
          } else {
            this.$patch({ vaultExists: false, vaultSalt: null, vaultKdfAlgo: null, vaultKdfParams: null, vaultId: null, keyEpoch: 0 })
          }
        } catch (error) {
          if (version === runtime.metadataVersion && generation === getAuthGeneration()) {
            this.connectionError = error instanceof Error ? error.message : i18n.global.t('setup.connFailed')
          }
        } finally {
          this.checkingStatus = false
          runtime.statusRequest = null
        }
      })()
      return runtime.statusRequest
    },

    applyVaultMetadata(metadata: Partial<VaultStatus>) {
      runtimeFor(this).metadataVersion++
      this.$patch({
        vaultExists: true, vaultSalt: metadata.salt!, vaultKdfAlgo: metadata.kdfAlgo!,
        vaultKdfParams: { ...metadata.kdfParams! }, vaultId: metadata.vaultId!,
        keyEpoch: metadata.keyEpoch!, formatVersion: metadata.formatVersion!,
        connectionError: null,
      })
    },

    async ensureVaultMetadata() {
      await this.checkStatus()
      if (this.connectionError) throw new Error(this.connectionError)
      if (!this.vaultExists || !this.vaultSalt || !this.vaultKdfParams || !this.vaultId || !this.keyEpoch) {
        throw new Error(i18n.global.t('setup.metadataUnavailable'))
      }
      return { salt: this.vaultSalt, kdfAlgo: this.vaultKdfAlgo!, kdfParams: { ...this.vaultKdfParams },
        vaultId: this.vaultId, keyEpoch: this.keyEpoch, formatVersion: this.formatVersion }
    },

    acceptSession(response: AuthResponse, key: CryptoKey, raw: Uint8Array, remember: boolean, generation: number) {
      assertCurrent(generation)
      validResponse(response, this.vaultId!, this.keyEpoch)
      clearSavedSession()
      this.rememberSession = false
      if (remember) {
        try {
          const saved: SavedSession = { version: 1, ...response, encKey: toBase64(raw) }
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
          this.rememberSession = true
        } catch { ElMessage.warning(text('storageUnavailable')) }
      }
      this.encKey = markRaw(key)
      this.expiresAt = response.expiresAt
      setAuthToken(response.token)
      this.isAuthenticated = true
      const runtime = runtimeFor(this)
      if (runtime.expiryTimer) clearTimeout(runtime.expiryTimer)
      runtime.expiryTimer = setTimeout(() => {
        if (generation === getAuthGeneration()) void this.logout(false)
      }, Math.max(0, response.expiresAt * 1000 - Date.now()))
    },

    async createVault(password: string, kdfParams: KdfParams, remember = false) {
      const runtime = runtimeFor(this)
      if (runtime.busy) throw new Error(text('operationBusy'))
      runtime.busy = true
      const generation = getAuthGeneration()
      let keys: Awaited<ReturnType<typeof deriveKeys>> | undefined
      let issued: AuthResponse | undefined
      try {
        const params = { ...kdfParams, cipher: 'AES-256-GCM' as const, keyLength: 256 as const }
        const salt = generateSalt()
        keys = await deriveKeys(password, salt, params)
        assertCurrent(generation)
        const key = await importKey(keys.encKey)
        const envelope = await encryptVaultData(createEmptyVaultPayload(), key, {
          vaultId: crypto.randomUUID(), formatVersion: 1, keyEpoch: 1, revision: 1,
        })
        const req = { ...envelope, authHash: toBase64(await sha256(keys.authKey)),
          salt: toBase64(salt), kdfAlgo: params.algorithm, kdfParams: params }
        assertCurrent(generation)
        issued = await api.createVault(req)
        assertCurrent(generation)
        validResponse(issued, envelope.vaultId, envelope.keyEpoch)
        await vaultRepository.initialize(key, envelope)
        assertCurrent(generation)
        this.applyVaultMetadata(req)
        this.acceptSession(issued, key, keys.encKey, remember, generation)
      } catch (error) {
        if (issued) void api.logout(issued.token).catch(() => {})
        if (generation === getAuthGeneration()) {
          vaultRepository.reset()
          await this.checkStatus()
        }
        throw error
      } finally { keys?.authKey.fill(0); keys?.encKey.fill(0); runtime.busy = false }
    },

    async unlockVault(password: string, remember = false) {
      const runtime = runtimeFor(this)
      if (runtime.busy) throw new Error(text('operationBusy'))
      runtime.busy = true
      const generation = getAuthGeneration()
      let keys: Awaited<ReturnType<typeof deriveKeys>> | undefined
      let issued: AuthResponse | undefined
      try {
        const metadata = await this.ensureVaultMetadata()
        assertCurrent(generation)
        keys = await deriveKeys(password, Uint8Array.from(atob(metadata.salt), c => c.charCodeAt(0)), metadata.kdfParams)
        const proof = toBase64(await sha256(keys.authKey))
        assertCurrent(generation)
        issued = await api.unlockVault({ authKeyHash: proof, vaultId: metadata.vaultId, keyEpoch: metadata.keyEpoch })
        validResponse(issued, metadata.vaultId, metadata.keyEpoch)
        assertCurrent(generation)
        const envelope = await api.getVault(issued.token)
        assertCurrent(generation)
        if (envelope.vaultId !== metadata.vaultId || envelope.keyEpoch !== metadata.keyEpoch) throw new Error(text('sessionChanged'))
        const key = await importKey(keys.encKey)
        assertCurrent(generation)
        await vaultRepository.initialize(key, envelope)
        assertCurrent(generation)
        this.applyVaultMetadata(metadata)
        this.acceptSession(issued, key, keys.encKey, remember, generation)
      } catch (error) {
        if (issued) void api.logout(issued.token).catch(() => {})
        if (generation === getAuthGeneration()) vaultRepository.reset()
        throw error
      } finally { keys?.authKey.fill(0); keys?.encKey.fill(0); runtime.busy = false }
    },

    async restoreSession() {
      const generation = getAuthGeneration()
      let raw: Uint8Array | undefined
      let saved: SavedSession | undefined
      try {
        const stored = sessionStorage.getItem(STORAGE_KEY)
        if (!stored) return
        saved = JSON.parse(stored) as SavedSession
        if (saved.version !== 1 || typeof saved.encKey !== 'string') throw new Error(text('invalidSession'))
        validResponse(saved, this.vaultId!, this.keyEpoch)
        const session = await api.getSession(saved.token)
        assertCurrent(generation)
        if (session.vaultId !== saved.vaultId || session.keyEpoch !== saved.keyEpoch || session.expiresAt !== saved.expiresAt) throw new Error(text('invalidSession'))
        const envelope = await api.getVault(saved.token)
        assertCurrent(generation)
        if (envelope.vaultId !== saved.vaultId || envelope.keyEpoch !== saved.keyEpoch) throw new Error(text('sessionChanged'))
        raw = decodeKey(saved.encKey)
        const key = await importKey(raw)
        assertCurrent(generation)
        await vaultRepository.initialize(key, envelope)
        assertCurrent(generation)
        this.cleanupPending = session.cleanupPending
        this.acceptSession(saved, key, raw, true, generation)
      } catch {
        if (saved?.token) void api.logout(saved.token).catch(() => {})
        if (generation === getAuthGeneration()) {
          clearSavedSession()
          vaultRepository.reset()
          this.rememberSession = false
        }
      } finally { raw?.fill(0) }
    },

    async setRememberSession(enabled: boolean, password = '') {
      if (!enabled) { clearSavedSession(true); this.rememberSession = false; return }
      if (this.rememberSession) return
      const runtime = runtimeFor(this)
      if (runtime.busy) throw new Error(text('operationBusy'))
      runtime.busy = true
      const generation = getAuthGeneration()
      const token = getAuthToken()
      let keys: Awaited<ReturnType<typeof deriveKeys>> | undefined
      try {
        if (!token || !this.isAuthenticated || !password) throw new Error(text('passwordRequired'))
        const epoch = this.keyEpoch
        const id = this.vaultId
        const metadata = await this.ensureVaultMetadata()
        assertCurrent(generation)
        if (metadata.vaultId !== id || metadata.keyEpoch !== epoch) throw new Error(text('sessionChanged'))
        keys = await deriveKeys(password, Uint8Array.from(atob(metadata.salt), c => c.charCodeAt(0)), metadata.kdfParams)
        const key = await importKey(keys.encKey)
        assertCurrent(generation)
        const envelope = await api.getVault(token)
        if (envelope.vaultId !== id || envelope.keyEpoch !== epoch) throw new Error(text('sessionChanged'))
        await decryptVaultData(envelope, key)
        const session = await api.getSession(token)
        assertCurrent(generation)
        if (session.vaultId !== id || session.keyEpoch !== epoch) throw new Error(text('sessionChanged'))
        try {
          const saved: SavedSession = { version: 1, token, vaultId: id!, keyEpoch: epoch, expiresAt: session.expiresAt, encKey: toBase64(keys.encKey) }
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
        } catch { throw new Error(text('storageUnavailable')) }
        this.rememberSession = true
      } finally { keys?.authKey.fill(0); keys?.encKey.fill(0); runtime.busy = false }
    },

    async refreshSessionStatus() {
      const generation = getAuthGeneration()
      if (!getAuthToken()) return
      const session = await api.getSession()
      assertCurrent(generation)
      if (session.vaultId !== this.vaultId || session.keyEpoch !== this.keyEpoch) { await this.logout(false); return }
      this.cleanupPending = session.cleanupPending
    },

    async rekey(currentPassword: string, newPassword: string, kdfParams: KdfParams) {
      const runtime = runtimeFor(this)
      if (runtime.busy) throw new Error(text('operationBusy'))
      runtime.busy = true
      let generation = getAuthGeneration()
      const remember = this.rememberSession
      let oldKeys: Awaited<ReturnType<typeof deriveKeys>> | undefined
      let newKeys: Awaited<ReturnType<typeof deriveKeys>> | undefined
      let attempted = false
      let committed = false
      let issued: AuthResponse | undefined
      try {
        const epoch = this.keyEpoch
        const metadata = await this.ensureVaultMetadata()
        assertCurrent(generation)
        if (metadata.keyEpoch !== epoch) throw new Error(text('sessionChanged'))
        oldKeys = await deriveKeys(currentPassword, Uint8Array.from(atob(metadata.salt), c => c.charCodeAt(0)), metadata.kdfParams)
        const oldKey = await importKey(oldKeys.encKey)
        const currentEnvelope = vaultRepository.getEnvelope()
        if (!currentEnvelope) throw new Error(text('sessionChanged'))
        await decryptVaultData(currentEnvelope, oldKey)
        assertCurrent(generation)
        const params = { ...kdfParams, cipher: 'AES-256-GCM' as const, keyLength: 256 as const }
        const salt = generateSalt()
        newKeys = await deriveKeys(newPassword, salt, params)
        const key = await importKey(newKeys.encKey)
        assertCurrent(generation)
        const prepared = await vaultRepository.prepareRekey(key)
        const req = { ...prepared.envelope, expectedRevision: prepared.expectedRevision,
          expectedKeyEpoch: prepared.expectedKeyEpoch, currentAuthKeyHash: toBase64(await sha256(oldKeys.authKey)),
          authHash: toBase64(await sha256(newKeys.authKey)), salt: toBase64(salt), kdfAlgo: params.algorithm, kdfParams: params }
        assertCurrent(generation)
        attempted = true
        const response = await api.rekeyVault(req)
        issued = response
        committed = true
        if (generation !== getAuthGeneration()) { void api.logout(response.token).catch(() => {}); assertCurrent(generation) }
        validResponse(response, req.vaultId, req.keyEpoch)
        generation = invalidateAuthSession()
        clearSavedSession()
        this.rememberSession = false
        void closeAllTransfers()
        useTerminalStore().$reset()
        ElMessageBox.close()
        await vaultRepository.acceptRekey(key, prepared.envelope)
        assertCurrent(generation)
        this.applyVaultMetadata(req)
        this.acceptSession(response, key, newKeys.encKey, remember, generation)
        runtime.channel?.postMessage({ type: 'rekey', vaultId: req.vaultId, keyEpoch: req.keyEpoch })
      } catch (error) {
        if (issued) void api.logout(issued.token).catch(() => {})
        if (generation === getAuthGeneration()) {
          if (committed || (attempted && (!(error instanceof ApiError) || error.status >= 500))) {
            const cleanup = this.logout(false)
            const lockedGeneration = getAuthGeneration()
            await cleanup
            if (lockedGeneration === getAuthGeneration()) ElMessage.warning(text('rekeyUncertain'))
            throw new Error(text('rekeyUncertain'))
          }
          if (error instanceof ApiError && error.code === 'unauthorized') await this.logout(false)
          vaultRepository.resumeAfterRekeyFailure()
        }
        throw error
      } finally {
        oldKeys?.authKey.fill(0); oldKeys?.encKey.fill(0)
        newKeys?.authKey.fill(0); newKeys?.encKey.fill(0)
        runtime.busy = false
      }
    },

    async logout(broadcast = true) {
      const token = getAuthToken()
      const closeConnections = captureSSHConnectionCleanup()
      const id = this.vaultId
      const runtime = runtimeFor(this)
      invalidateAuthSession()
      runtime.metadataVersion++
      if (runtime.expiryTimer) clearTimeout(runtime.expiryTimer)
      runtime.expiryTimer = null
      if (!clearSavedSession()) ElMessage.warning(text('storageClearFailed'))
      clearLegacyStorage()
      this.$patch({ isAuthenticated: false, encKey: null, rememberSession: false, expiresAt: 0, cleanupPending: false })
      vaultRepository.reset()
      ElMessageBox.close()
      const cleanup = closeAllTransfers()
      useTerminalStore().$reset()
      if (broadcast && id) runtime.channel?.postMessage({ type: 'lock', vaultId: id })
      await cleanup
      closeConnections()
      if (token) await api.logout(token).catch(() => {})
    },
  },
})
