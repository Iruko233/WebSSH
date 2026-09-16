import { reactive } from 'vue'
import { api } from './api'
import { decryptVaultData, encryptVaultData } from './crypto'
import { cloneVaultPayload, validateSettings, validateVaultPayload } from './vault-schema'
import type { SettingsState, VaultEnvelope, VaultPayload } from '../types'

export interface VaultConflictChange {
  kind: 'server-added' | 'server-deleted' | 'server-updated' | 'settings'
  id?: string
  serverLabel?: string
  fields: string[]
  remoteFields: string[]
  remoteChanged: boolean
  localAction: 'added' | 'deleted' | 'updated' | 'unchanged'
  remoteAction: 'added' | 'deleted' | 'updated' | 'unchanged'
}

type Phase = 'locked' | 'ready' | 'saving' | 'conflict' | 'error' | 'rekeying'
type Listener = (payload: VaultPayload | null) => void
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const changedFields = (left: object | undefined, right: object | undefined) => {
  const before = (left || {}) as Record<string, unknown>
  const after = (right || {}) as Record<string, unknown>
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => key !== 'id' && !equal(before[key], after[key]))
}
const changeAction = (before: object | undefined, after: object | undefined): VaultConflictChange['localAction'] =>
  equal(before, after) ? 'unchanged' : !before ? 'added' : !after ? 'deleted' : 'updated'
const envelopeEqual = (left: VaultEnvelope, right: VaultEnvelope) =>
  left.vaultId === right.vaultId && left.keyEpoch === right.keyEpoch && left.formatVersion === right.formatVersion &&
  left.revision === right.revision && left.iv === right.iv && left.encryptedData === right.encryptedData

/** One owner for the complete plaintext vault, every writer participates in the same CAS queue */
class VaultRepository {
  readonly status = reactive<{ phase: Phase; error: string | null; hasUnsavedChanges: boolean; resolving: boolean }>({
    phase: 'locked', error: null, hasUnsavedChanges: false, resolving: false,
  })
  private generation = 0
  private key: CryptoKey | null = null
  private payload: VaultPayload | null = null
  private base: VaultPayload | null = null
  private envelope: VaultEnvelope | null = null
  private remote: { payload: VaultPayload; envelope: VaultEnvelope } | null = null
  private lastAttempt: { payload: VaultPayload; envelope: VaultEnvelope } | null = null
  private queue: Promise<void> = Promise.resolve()
  private settingsTimer: ReturnType<typeof setTimeout> | null = null
  private rekeyRequested = false
  private listeners = new Set<Listener>()

  getGeneration() { return this.generation }
  isReady() { return this.key !== null && this.payload !== null && this.envelope !== null }
  getSnapshot() { return this.payload ? cloneVaultPayload(this.payload) : null }
  getEnvelope() { return this.envelope ? { ...this.envelope } : null }
  getConflictSnapshot() { return this.remote ? cloneVaultPayload(this.remote.payload) : null }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => { this.listeners.delete(listener) }
  }

  private publish() {
    for (const listener of this.listeners) {
      try { listener(this.getSnapshot()) }
      catch { console.error('Vault projection failed') }
    }
  }

  private assertGeneration(generation: number) {
    if (generation !== this.generation || !this.key) throw new Error('vault.changedDuringOperation')
  }

  private assertWritable() {
    if (!this.isReady()) throw new Error('vault.locked')
    if (this.rekeyRequested || this.status.phase === 'rekeying') throw new Error('vault.rekeyInProgress')
    if (this.status.resolving || this.status.phase === 'conflict' || this.status.phase === 'error') throw new Error(this.status.error || 'vault.conflict')
  }

  private cancelSettingsTimer() {
    if (this.settingsTimer) clearTimeout(this.settingsTimer)
    this.settingsTimer = null
  }

  reset() {
    this.generation++
    this.cancelSettingsTimer()
    this.key = null
    this.payload = null
    this.base = null
    this.envelope = null
    this.remote = null
    this.lastAttempt = null
    this.queue = Promise.resolve()
    this.rekeyRequested = false
    Object.assign(this.status, { phase: 'locked', error: null, hasUnsavedChanges: false, resolving: false })
    this.publish()
  }

  async initialize(key: CryptoKey, envelope: VaultEnvelope) {
    this.reset()
    const generation = this.generation
    const payload = await decryptVaultData(envelope, key)
    if (generation !== this.generation) throw new Error('vault.changedDuringOperation')
    this.key = key
    this.envelope = { ...envelope }
    this.base = cloneVaultPayload(payload)
    this.payload = payload
    this.status.phase = 'ready'
    this.publish()
  }

  private updateDirty() { this.status.hasUnsavedChanges = !equal(this.payload, this.base) }

  private setDraft(payload: VaultPayload) {
    this.payload = validateVaultPayload(payload)
    this.updateDirty()
    this.publish()
  }

  mutate(mutation: (draft: VaultPayload) => void): Promise<void> {
    try {
      this.assertWritable()
      const draft = this.getSnapshot()!
      mutation(draft)
      this.setDraft(draft)
      return this.enqueueSave()
    } catch (error) { return Promise.reject(error) }
  }

  updateSettings(settings: SettingsState) {
    this.assertWritable()
    const draft = this.getSnapshot()!
    draft.settings = validateSettings(settings)
    this.setDraft(draft)
    this.cancelSettingsTimer()
    const generation = this.generation
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null
      if (generation === this.generation) void this.enqueueSave().catch(() => { /* observable status retains the draft */ })
    }, 1000)
  }

  private enqueueSave(): Promise<void> {
    const generation = this.generation
    const result = this.queue.then(() => this.saveCurrent(generation))
    this.queue = result.catch(() => { /* callers receive failure, the queue stays awaitable */ })
    return result
  }

  async flush() {
    this.cancelSettingsTimer()
    if (!this.isReady()) throw new Error('vault.locked')
    const generation = this.generation
    await this.queue
    this.assertGeneration(generation)
    if (this.status.phase === 'conflict' || this.status.phase === 'error') throw new Error(this.status.error || 'vault.conflict')
    if (this.status.hasUnsavedChanges) await this.enqueueSave()
  }

  private async readCurrent(generation: number) {
    this.assertGeneration(generation)
    const key = this.key!
    const expected = this.envelope!
    const envelope = await api.getVault()
    this.assertGeneration(generation)
    if (envelope.vaultId !== expected.vaultId || envelope.keyEpoch !== expected.keyEpoch || envelope.revision < expected.revision) {
      throw new Error('vault.changedDuringOperation')
    }
    const payload = await decryptVaultData(envelope, key)
    this.assertGeneration(generation)
    return { payload, envelope }
  }

  private acknowledge(snapshot: VaultPayload, envelope: VaultEnvelope) {
    this.base = cloneVaultPayload(snapshot)
    this.envelope = { ...envelope }
    this.remote = null
    this.lastAttempt = null
    this.status.phase = 'ready'
    this.status.error = null
    this.updateDirty()
  }

  private async saveCurrent(generation: number) {
    this.assertGeneration(generation)
    if (this.status.phase === 'conflict' || this.status.phase === 'error' || this.status.phase === 'rekeying') throw new Error(this.status.error || 'vault.conflict')
    if (!this.status.hasUnsavedChanges) return
    const snapshot = this.getSnapshot()!
    const expected = this.getEnvelope()!
    const key = this.key!
    this.status.phase = 'saving'
    this.status.error = null
    let attempted: VaultEnvelope | null = null
    try {
      attempted = await encryptVaultData(snapshot, key, { ...expected, revision: expected.revision + 1 })
      this.assertGeneration(generation)
      this.lastAttempt = { payload: snapshot, envelope: attempted }
      const committed = await api.saveVault({ ...attempted, expectedRevision: expected.revision, expectedKeyEpoch: expected.keyEpoch })
      this.assertGeneration(generation)
      if (!envelopeEqual(committed, attempted)) throw new Error('vault.invalidData')
      this.acknowledge(snapshot, committed)
    } catch (error) {
      this.assertGeneration(generation)
      // Never retry an uncertain write, a matching envelope proves this exact save committed
      try {
        const current = await this.readCurrent(generation)
        if (attempted && envelopeEqual(current.envelope, attempted)) {
          this.acknowledge(snapshot, current.envelope)
          return
        }
        this.remote = current
      } catch {
        this.assertGeneration(generation)
        this.remote = null
      }
      this.cancelSettingsTimer()
      const status = (error as { status?: number })?.status
      this.status.phase = this.remote && (status === 409 || this.remote.envelope.revision !== expected.revision) ? 'conflict' : 'error'
      this.status.error = this.status.phase === 'conflict' ? 'vault.conflict' :
        error instanceof Error && error.message.startsWith('vault.') ? error.message : 'vault.saveFailed'
      this.updateDirty()
      throw new Error(this.status.error)
    }
  }

  getConflictChanges(): VaultConflictChange[] {
    if (!this.base || !this.payload) return []
    const remote = this.remote?.payload
    const before = new Map(this.base.servers.map(server => [server.id, server]))
    const local = new Map(this.payload.servers.map(server => [server.id, server]))
    const latest = new Map((remote?.servers || this.base.servers).map(server => [server.id, server]))
    const changes: VaultConflictChange[] = []
    for (const id of new Set([...before.keys(), ...local.keys(), ...latest.keys()])) {
      const original = before.get(id), draft = local.get(id), current = latest.get(id)
      const fields = changedFields(original, draft)
      const remoteFields = changedFields(original, current)
      if (!fields.length && !remoteFields.length) continue
      changes.push({
        kind: !original ? 'server-added' : !draft || !current ? 'server-deleted' : 'server-updated', id,
        serverLabel: draft?.name || current?.name || original?.name || id,
        fields, remoteFields, remoteChanged: remoteFields.length > 0,
        localAction: changeAction(original, draft), remoteAction: changeAction(original, current),
      })
    }
    const fields = changedFields(this.base.settings, this.payload.settings)
    const remoteFields = changedFields(this.base.settings, remote?.settings || this.base.settings)
    if (fields.length || remoteFields.length) changes.push({
      kind: 'settings', fields, remoteFields, remoteChanged: remoteFields.length > 0,
      localAction: fields.length ? 'updated' : 'unchanged', remoteAction: remoteFields.length ? 'updated' : 'unchanged',
    })
    return changes
  }

  async refreshConflict() {
    if (!this.isReady()) throw new Error('vault.locked')
    if (this.status.resolving) return
    const generation = this.generation
    this.status.resolving = true
    try {
      await this.queue
      const current = await this.readCurrent(generation)
      if (this.lastAttempt && envelopeEqual(this.lastAttempt.envelope, current.envelope)) {
        this.acknowledge(this.lastAttempt.payload, current.envelope)
      }
      this.remote = current
      if (this.status.hasUnsavedChanges) {
        this.status.phase = 'conflict'
        this.status.error = 'vault.conflict'
      } else {
        this.payload = current.payload
        this.acknowledge(current.payload, current.envelope)
        this.publish()
      }
    } catch (error) {
      this.assertGeneration(generation)
      this.status.phase = 'error'
      this.status.error = error instanceof Error && error.message.startsWith('vault.') ? error.message : 'vault.saveFailed'
      throw new Error(this.status.error)
    } finally { if (generation === this.generation) this.status.resolving = false }
  }

  /** Apply only explicitly reviewed local field changes, never replay a stale whole-vault overwrite */
  async confirmDraft() {
    if (!this.remote || !this.base || !this.payload || !this.isReady()) throw new Error('vault.conflict')
    if (this.status.resolving) return
    const generation = this.generation
    const reviewed = this.remote
    this.status.resolving = true
    try {
      await this.queue
      this.assertGeneration(generation)
      const merged = cloneVaultPayload(reviewed.payload)
      const original = new Map(this.base.servers.map(server => [server.id, server]))
      const local = new Map(this.payload.servers.map(server => [server.id, server]))
      for (const [id, before] of original) {
        const draft = local.get(id)
        const index = merged.servers.findIndex(server => server.id === id)
        if (!draft) { if (index >= 0) merged.servers.splice(index, 1); continue }
        const fields = changedFields(before, draft)
        if (!fields.length) continue
        if (index < 0) throw new Error('vault.sourceDeleted')
        const target = merged.servers[index]! as unknown as Record<string, unknown>
        const source = draft as unknown as Record<string, unknown>
        for (const field of fields) {
          if (Object.hasOwn(source, field)) target[field] = source[field]
          else delete target[field]
        }
      }
      for (const [id, draft] of local) {
        if (!original.has(id)) {
          const existing = merged.servers.find(server => server.id === id)
          if (existing && !equal(existing, draft)) throw new Error('vault.conflict')
          if (!existing) merged.servers.push(draft)
        }
      }
      for (const field of changedFields(this.base.settings, this.payload.settings) as (keyof SettingsState)[]) {
        Object.assign(merged.settings, { [field]: this.payload.settings[field] })
      }
      this.base = cloneVaultPayload(reviewed.payload)
      this.envelope = { ...reviewed.envelope }
      this.remote = null
      this.lastAttempt = null
      this.status.phase = 'ready'
      this.status.error = null
      this.setDraft(merged)
      await this.enqueueSave()
    } catch (error) {
      this.assertGeneration(generation)
      if (this.status.phase === 'ready') this.status.phase = 'conflict'
      this.status.error = error instanceof Error && error.message.startsWith('vault.') ? error.message : 'vault.saveFailed'
      throw new Error(this.status.error)
    } finally { if (generation === this.generation) this.status.resolving = false }
  }

  async discardDraftAndReload() {
    if (!this.isReady()) throw new Error('vault.locked')
    if (this.status.resolving) return
    const generation = this.generation
    this.status.resolving = true
    this.cancelSettingsTimer()
    try {
      await this.queue
      const current = await this.readCurrent(generation)
      this.payload = current.payload
      this.acknowledge(current.payload, current.envelope)
      this.publish()
    } finally { if (generation === this.generation) this.status.resolving = false }
  }

  async prepareRekey(newKey: CryptoKey): Promise<{ envelope: VaultEnvelope; expectedRevision: number; expectedKeyEpoch: number }> {
    this.assertWritable()
    this.rekeyRequested = true
    const generation = this.generation
    await this.flush()
    this.assertGeneration(generation)
    this.status.phase = 'rekeying'
    const current = await this.readCurrent(generation)
    this.payload = current.payload
    this.base = cloneVaultPayload(current.payload)
    this.envelope = { ...current.envelope }
    this.publish()
    const envelope = await encryptVaultData(current.payload, newKey, {
      ...current.envelope, revision: current.envelope.revision + 1, keyEpoch: current.envelope.keyEpoch + 1,
    })
    this.assertGeneration(generation)
    return { envelope, expectedRevision: current.envelope.revision, expectedKeyEpoch: current.envelope.keyEpoch }
  }

  resumeAfterRekeyFailure() {
    this.rekeyRequested = false
    if (this.status.phase === 'rekeying') this.status.phase = 'ready'
  }

  async acceptRekey(key: CryptoKey, envelope: VaultEnvelope) { await this.initialize(key, envelope) }
}

export const vaultRepository = new VaultRepository()
