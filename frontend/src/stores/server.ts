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
        // Sort by createdAt descending
        decrypted.sort((a, b) => {
          const tA = a.credentials.createdAt ? new Date(a.credentials.createdAt).getTime() : 0;
          const tB = b.credentials.createdAt ? new Date(b.credentials.createdAt).getTime() : 0;
          return tB - tA;
        })
        
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
      
      const now = new Date().toISOString()
      const credentialsWithname = { ...credentials, name, createdAt: now, updatedAt: now }
      const { encryptedData, iv } = await encryptServerData(credentialsWithname, authStore.encKey)
      
      await api.createServer({ encryptedData, iv })
      await this.fetchServers()
    },

    async updateServer(id: string, name: string, credentials: ServerCredentials) {
      const authStore = useAuthStore()
      if (!authStore.encKey) throw new Error('Encryption key not loaded')
      
      const existing = this.servers.find(s => s.id === id)
      const createdAt = existing?.credentials.createdAt || new Date().toISOString()
      const now = new Date().toISOString()
      
      const credentialsWithname = { ...credentials, name, createdAt, updatedAt: now }
      const { encryptedData, iv } = await encryptServerData(credentialsWithname, authStore.encKey)
      
      await api.updateServer(id, { encryptedData, iv })
      await this.fetchServers()
    },

    async deleteServer(id: string) {
      await api.deleteServer(id)
      await this.fetchServers()
    },

    async batchDeleteServers(ids: string[]) {
      await Promise.all(ids.map(id => api.deleteServer(id)))
      await this.fetchServers()
    },

    exportServersJSON(ids?: string[]) {
      const serversToExport = ids && ids.length > 0
        ? this.servers.filter(s => ids.includes(s.id))
        : this.servers

      const data = {
        version: 1,
        servers: serversToExport.map(s => ({
          name: s.name,
          group: s.credentials.group,
          host: s.credentials.host,
          port: s.credentials.port,
          username: s.credentials.username,
          password: s.credentials.password,
          os: s.credentials.os,
          expectedHostKey: s.credentials.expectedHostKey
        }))
      }
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const dateStr = new Date().toISOString().split('T')[0]
      const randomId = crypto.randomUUID().split('-')[0] // short 8 chars uuid
      a.download = `webssh_servers_${dateStr}_${randomId}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    },

    async importServersJSON(jsonStr: string, mode: 'dry-run' | 'overwrite' | 'skip') {
      try {
        const data = JSON.parse(jsonStr)
        let serversToImport: any[] = []
        if (data.version === 1 && Array.isArray(data.servers)) {
          serversToImport = data.servers
        } else if (Array.isArray(data)) {
          serversToImport = data // allow raw array import
        } else {
          throw new Error('Invalid backup file format')
        }
        
        const authStore = useAuthStore()
        if (!authStore.encKey) throw new Error('Encryption key not loaded')
        
        let importedCount = 0
        let conflictsCount = 0
        
        for (const srv of serversToImport) {
          if (!srv.host || !srv.username) continue
          
          const srvPort = Number(srv.port) || 22
          const existing = this.servers.find(
            s => s.credentials.host === srv.host && 
                 s.credentials.port === srvPort && 
                 s.credentials.username === srv.username
          )
          
          if (existing) {
            conflictsCount++
            if (mode === 'dry-run') continue
            if (mode === 'skip') continue
          } else {
            if (mode === 'dry-run') continue
          }
          
          const credentials = {
            group: srv.group || undefined,
            host: srv.host,
            port: srvPort,
            username: srv.username,
            password: srv.password || '',
            os: srv.os,
            expectedHostKey: srv.expectedHostKey
          }
          
          const now = new Date().toISOString()
          
          if (existing && mode === 'overwrite') {
            const createdAt = existing.credentials.createdAt || now
            const credentialsWithname = { ...credentials, name: srv.name || srv.host, createdAt, updatedAt: now }
            const { encryptedData, iv } = await encryptServerData(credentialsWithname, authStore.encKey)
            await api.updateServer(existing.id, { encryptedData, iv })
            importedCount++
          } else {
            const credentialsWithname = { ...credentials, name: srv.name || srv.host, createdAt: now, updatedAt: now }
            const { encryptedData, iv } = await encryptServerData(credentialsWithname, authStore.encKey)
            await api.createServer({ encryptedData, iv })
            importedCount++
          }
        }
        
        if (mode !== 'dry-run') {
          await this.fetchServers()
        }
        
        return { total: serversToImport.length, conflicts: conflictsCount, imported: importedCount }
      } catch (err: any) {
        throw new Error('Failed to import servers: ' + err.message)
      }
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
