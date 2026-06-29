import { defineStore } from 'pinia'
import { api } from '../lib/api'
import { encryptServerData, decryptServerData } from '../lib/crypto'
import type { ServerEntry, ServerCredentials } from '../types'
import { useAuthStore } from './auth'

export interface DecryptedServer extends ServerEntry {
  name: string;
  credentials: ServerCredentials;
}

interface ServerState {
  servers: DecryptedServer[];
  isLoading: boolean;
  error: string | null;
}

export const useServerStore = defineStore('server', {
  state: (): ServerState => ({
    servers: [],
    isLoading: false,
    error: null,
  }),
  getters: {
    availableGroups(state): string[] {
      const groups = new Set<string>()
      for (const srv of state.servers) {
        if (srv.credentials.group) {
          groups.add(srv.credentials.group)
        }
      }
      return Array.from(groups).sort()
    },
    groupedServers(state): Record<string, DecryptedServer[]> {
      const groups: Record<string, DecryptedServer[]> = {}
      for (const srv of state.servers) {
        const groupName = srv.credentials.group || ''
        if (!groups[groupName]) {
          groups[groupName] = []
        }
        groups[groupName].push(srv)
      }
      return groups
    }
  },
  actions: {
    async fetchServers() {
      const authStore = useAuthStore()
      if (!authStore.encKey) throw new Error('Encryption key not loaded')
      
      this.isLoading = true
      this.error = null
      
      try {
        const encryptedServers = await api.getServers()
        const decrypted: DecryptedServer[] = []
        
        for (const srv of encryptedServers) {
          try {
            const credentials = await decryptServerData(srv.encryptedData, srv.iv, authStore.encKey)
            decrypted.push({ 
              ...srv, 
              name: credentials.name || 'Unnamed Server',
              credentials 
            })
          } catch (err) {
            console.error(`Failed to decrypt server ${srv.id}`, err)
            // Still push it so user can delete it, but with dummy credentials
            decrypted.push({
              ...srv,
              name: 'Decryption Failed',
              credentials: { name: 'Decryption Failed', host: 'Decryption Failed', port: 22, username: 'unknown', password: '' }
            })
          }
        }
        
        this.servers = decrypted
      } catch (err: any) {
        this.error = err.message || 'Failed to fetch servers'
      } finally {
        this.isLoading = false
      }
    },

    async addServer(name: string, credentials: ServerCredentials) {
      const authStore = useAuthStore()
      if (!authStore.encKey) throw new Error('Encryption key not loaded')
      
      const credentialsWithname = { ...credentials, name }
      const { encryptedData, iv } = await encryptServerData(credentialsWithname, authStore.encKey)
      
      await api.createServer({ encryptedData, iv })
      await this.fetchServers()
    },

    async updateServer(id: string, name: string, credentials: ServerCredentials) {
      const authStore = useAuthStore()
      if (!authStore.encKey) throw new Error('Encryption key not loaded')
      
      const credentialsWithname = { ...credentials, name }
      const { encryptedData, iv } = await encryptServerData(credentialsWithname, authStore.encKey)
      
      await api.updateServer(id, { encryptedData, iv })
      await this.fetchServers()
    },

    async deleteServer(id: string) {
      await api.deleteServer(id)
      await this.fetchServers()
    },

    async reEncryptAll(newKey: CryptoKey): Promise<import('../types').RekeyServerEntry[]> {
      if (this.servers.length === 0 && !this.isLoading && !this.error) {
        // Might be truly empty, but let's ensure it's loaded
        await this.fetchServers()
      }
      
      const rekeyedServers: import('../types').RekeyServerEntry[] = []
      for (const srv of this.servers) {
        if (srv.credentials.host === 'Decryption Failed') {
          throw new Error(`Cannot re-key because server ${srv.name} failed to decrypt previously.`)
        }
        const credentialsWithname = { ...srv.credentials, name: srv.name }
        const { encryptedData, iv } = await encryptServerData(credentialsWithname, newKey)
        rekeyedServers.push({ id: srv.id, encryptedData, iv })
      }
      return rekeyedServers
    }
  }
})
