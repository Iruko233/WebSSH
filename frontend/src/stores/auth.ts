import { defineStore } from 'pinia'
import { api } from '../lib/api'
import { deriveKeys, generateSalt, toBase64, sha256 } from '../lib/crypto'
import type { KdfParams, CreateVaultRequest, UnlockVaultRequest } from '../types'
import { i18n } from '../i18n'

interface AuthState {
  isInitialized: boolean;
  isAuthenticated: boolean;
  encKey: CryptoKey | null;
  vaultExists: boolean | null;
  vaultSalt: string | null;
  vaultKdfAlgo: string | null;
  vaultKdfParams: KdfParams | null;
  checkingStatus: boolean;
  connectionError: string | null;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    isInitialized: false,
    isAuthenticated: false,
    encKey: null,
    vaultExists: null,
    vaultSalt: null,
    vaultKdfAlgo: null,
    vaultKdfParams: null,
    checkingStatus: true,
    connectionError: null,
  }),
  actions: {
    async checkStatus() {
      this.checkingStatus = true
      this.connectionError = null
      try {
        const status = await api.getVaultStatus()
        this.vaultExists = status.exists
        if (status.exists) {
          this.vaultSalt = status.salt || null
          this.vaultKdfAlgo = status.kdfAlgo || null
          this.vaultKdfParams = status.kdfParams || null
        }
      } catch (err: any) {
        console.error('Failed to check vault status:', err)
        this.connectionError = err.message || (i18n.global.t ? i18n.global.t('setup.connFailed') : 'Failed to connect to backend server')
      } finally {
        this.checkingStatus = false
        this.isInitialized = true
      }
    },

    async createVault(password: string, kdfParams: KdfParams) {
      const saltBytes = generateSalt()
      const { authKey, encKey } = await deriveKeys(password, saltBytes, kdfParams)

      const req: CreateVaultRequest = {
        authHash: toBase64(await sha256(authKey)),
        salt: toBase64(saltBytes),
        kdfAlgo: kdfParams.algorithm,
        kdfParams,
      }

      const res = await api.createVault(req)
      sessionStorage.setItem('jwt', res.token)
      sessionStorage.setItem('enc_key', toBase64(encKey as Uint8Array))
      
      const importedEncKey = await crypto.subtle.importKey(
        'raw', encKey as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
      )
      
      this.encKey = importedEncKey
      this.isAuthenticated = true
      this.vaultExists = true
    },

    async unlockVault(password: string) {
      if (!this.vaultSalt || !this.vaultKdfParams) {
        throw new Error('Vault metadata missing, check status first')
      }

      const saltBytes = Uint8Array.from(atob(this.vaultSalt), c => c.charCodeAt(0))
      const { authKey, encKey } = await deriveKeys(password, saltBytes, this.vaultKdfParams)

      const req: UnlockVaultRequest = {
        authKeyHash: toBase64(await sha256(authKey)),
      }

      const res = await api.unlockVault(req)
      sessionStorage.setItem('jwt', res.token)
      sessionStorage.setItem('enc_key', toBase64(encKey as Uint8Array))
      
      const importedEncKey = await crypto.subtle.importKey(
        'raw', encKey as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
      )
      
      this.encKey = importedEncKey
      this.isAuthenticated = true
    },

    async rekey(currentPassword: string, newPassword: string, kdfParams: KdfParams) {
      // 1. Verify current password
      await this.unlockVault(currentPassword)

      // 2. Generate new salt and derive new keys
      const newSaltBytes = generateSalt()
      const { authKey: newAuthKey, encKey: newEncKeyBytes } = await deriveKeys(newPassword, newSaltBytes, kdfParams)

      // 3. Import new encKey
      const newImportedEncKey = await crypto.subtle.importKey(
        'raw', newEncKeyBytes as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
      )

      // 4. Ask serverStore to re-encrypt all servers with the NEW key
      // We must dynamically import serverStore to avoid circular dependency
      const { useServerStore } = await import('./server')
      const serverStore = useServerStore()
      const rekeyedServers = await serverStore.reEncryptAll(newImportedEncKey)

      // 5. Send rekey request to backend
      const req: import('../types').RekeyVaultRequest = {
        authHash: toBase64(await sha256(newAuthKey)),
        salt: toBase64(newSaltBytes),
        kdfAlgo: kdfParams.algorithm,
        kdfParams,
        servers: rekeyedServers
      }

      const res = await api.rekeyVault(req)

      // 6. Apply new session
      sessionStorage.setItem('jwt', res.token)
      sessionStorage.setItem('enc_key', toBase64(newEncKeyBytes as Uint8Array))
      this.encKey = newImportedEncKey
      
      // Update local vault config metadata
      this.vaultSalt = req.salt
      this.vaultKdfAlgo = req.kdfAlgo
      this.vaultKdfParams = req.kdfParams
    },

    async restoreSession() {
      const rawB64 = sessionStorage.getItem('enc_key')
      const jwt = sessionStorage.getItem('jwt')
      if (rawB64 && jwt) {
        try {
          const rawBytes = Uint8Array.from(atob(rawB64), c => c.charCodeAt(0))
          const importedEncKey = await crypto.subtle.importKey(
            'raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
          )
          this.encKey = importedEncKey
          this.isAuthenticated = true
        } catch (e) {
          console.error("Failed to restore session key", e)
          this.logout()
        }
      } else {
        this.logout()
      }
    },

    logout() {
      sessionStorage.removeItem('jwt')
      sessionStorage.removeItem('enc_key')
      this.encKey = null
      this.isAuthenticated = false
    }
  }
})
