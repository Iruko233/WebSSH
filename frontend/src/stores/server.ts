import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'
import { i18n } from '../i18n'
import { vaultRepository } from '../lib/vault-repository'
import { MAX_VAULT_JSON_BYTES, validateVaultServer } from '../lib/vault-schema'
import type { ServerEntry, ServerCredentials, VaultPayload, VaultServer } from '../types'

export interface DecryptedServer extends ServerEntry {
  name: string
  credentials: ServerCredentials
}

function userError(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'vault.saveFailed'
  return new Error(message.startsWith('vault.') ? i18n.global.t(message) : message)
}

export const useServerStore = defineStore('server', () => {
  const servers = ref<DecryptedServer[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const project = (payload: VaultPayload | null) => {
    servers.value = (payload?.servers || []).map(({ id, ...credentials }) => ({
      id, name: credentials.name || credentials.host, credentials,
    })).sort((a, b) => Date.parse(b.credentials.createdAt || '') - Date.parse(a.credentials.createdAt || '') || a.id.localeCompare(b.id))
    isLoading.value = false
    error.value = null
  }
  onScopeDispose(vaultRepository.subscribe(project))

  const availableGroups = computed(() => [...new Set(servers.value.map(server => server.credentials.group).filter((group): group is string => !!group))].sort())
  const groupedServers = computed(() => {
    const groups: Record<string, DecryptedServer[]> = Object.create(null)
    for (const server of servers.value) (groups[server.credentials.group || ''] ||= []).push(server)
    return groups
  })
  const availableTags = computed(() => [...new Set(servers.value.flatMap(server => server.credentials.tags || []).map(tag => tag.trim()).filter(Boolean))].sort())

  async function change(mutation: (draft: VaultPayload) => void) {
    const generation = vaultRepository.getGeneration()
    try { await vaultRepository.mutate(mutation) }
    catch (cause) {
      const failure = userError(cause)
      if (generation === vaultRepository.getGeneration()) error.value = failure.message
      throw failure
    }
  }

  async function fetchServers() {
    if (!vaultRepository.isReady()) throw userError(new Error('vault.locked'))
    // Authentication already loaded the complete vault, never issue a separate stale server read
    project(vaultRepository.getSnapshot())
  }

  async function addServer(name: string, credentials: ServerCredentials) {
    await change(draft => {
      const now = new Date().toISOString()
      draft.servers.push(validateVaultServer({ ...credentials, id: crypto.randomUUID(), name, createdAt: now, updatedAt: now }))
    })
  }

  async function updateServer(id: string, name: string, credentials: ServerCredentials) {
    await change(draft => {
      const index = draft.servers.findIndex(server => server.id === id)
      if (index < 0) throw new Error('vault.sourceDeleted')
      const now = new Date().toISOString()
      draft.servers[index] = validateVaultServer({ ...credentials, id, name, createdAt: draft.servers[index]!.createdAt || now, updatedAt: now })
    })
  }

  async function patchServer(id: string, partial: Partial<ServerCredentials>) {
    await change(draft => {
      const index = draft.servers.findIndex(server => server.id === id)
      if (index < 0) throw new Error('vault.sourceDeleted')
      draft.servers[index] = validateVaultServer({ ...draft.servers[index], ...partial, id, updatedAt: new Date().toISOString() })
    })
  }

  async function batchDeleteServers(ids: string[]) {
    const selected = new Set(ids)
    await change(draft => { draft.servers = draft.servers.filter(server => !selected.has(server.id)) })
  }
  async function deleteServer(id: string) { await batchDeleteServers([id]) }

  function exportServersJSON(ids?: string[]) {
    const selected = ids?.length ? servers.value.filter(server => ids.includes(server.id)) : servers.value
    const data = { version: 1, servers: selected.map(server => ({ ...server.credentials, name: server.name })) }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `webssh_servers_${new Date().toISOString().split('T')[0]}_${crypto.randomUUID().slice(0, 8)}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  async function importServersJSON(json: string, mode: 'dry-run' | 'overwrite' | 'skip') {
    try {
      if (new TextEncoder().encode(json).length > MAX_VAULT_JSON_BYTES) throw new Error('vault.tooLarge')
      const data: unknown = JSON.parse(json)
      const rows = Array.isArray(data) ? data : data && typeof data === 'object' && 'version' in data && data.version === 1 && 'servers' in data && Array.isArray(data.servers) ? data.servers : null
      if (!rows) throw new Error('vault.invalidData')
      if (!vaultRepository.isReady()) throw new Error('vault.locked')
      let conflicts = 0, imported = 0
      const apply = (draft: VaultPayload) => {
        for (const row of rows) {
          if (!row || typeof row !== 'object' || !row.host || !row.username) continue
          const candidate = validateVaultServer({
            id: crypto.randomUUID(), name: row.name || row.host, group: row.group, tags: row.tags,
            host: row.host, port: Number(row.port) || 22, username: row.username, password: row.password ?? '',
            os: row.os, expectedHostKey: row.expectedHostKey,
          })
          const existing = draft.servers.find(server => server.host === candidate.host && server.port === candidate.port && server.username === candidate.username)
          if (existing) conflicts++
          if (mode === 'dry-run' || existing && mode === 'skip') continue
          const now = new Date().toISOString()
          const next: VaultServer = { ...candidate, id: existing?.id || candidate.id, createdAt: existing?.createdAt || now, updatedAt: now }
          if (existing) draft.servers[draft.servers.indexOf(existing)] = next
          else draft.servers.push(next)
          imported++
        }
      }
      if (mode === 'dry-run') apply(vaultRepository.getSnapshot()!)
      else await change(apply)
      return { total: rows.length, conflicts, imported }
    } catch (cause) { throw userError(cause) }
  }

  return {
    servers, isLoading, error, availableGroups, groupedServers, availableTags,
    fetchServers, addServer, updateServer, patchServer, deleteServer, batchDeleteServers, exportServersJSON, importServersJSON,
  }
})
