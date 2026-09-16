import { reactive } from 'vue'
import { v4 as uuid } from 'uuid'
import { getAuthGeneration, getAuthToken } from './auth-session'

export interface FileInfo {
  name: string
  isDir: boolean
  isLink?: boolean
  size: number
  modTime: number
  permissions: string
}
export type SftpState = 'idle' | 'initializing' | 'ready' | 'error' | 'closed'
export interface TransferProgress {
  transferredBytes: number
  totalBytes: number
  speedBps: number
  phase: 'running' | 'finalizing'
}
export interface DownloadSink {
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}
export interface TransferOptions {
  signal?: AbortSignal
  onProgress?: (progress: TransferProgress) => void
}
export class SftpError extends Error {
  temporaryPath?: string
  uncertain = false
}
export const asError = (error: unknown): Error => {
  if (error instanceof SftpError) return error
  if (error instanceof Error && 'temporaryPath' in error) {
    const detail = error as Error & { temporaryPath: string; uncertain?: boolean }
    const result = new SftpError(detail.message)
    result.temporaryPath = detail.temporaryPath
    result.uncertain = !!detail.uncertain
    return result
  }
  return error instanceof Error ? error : new Error(String(error))
}
const CHUNK = 256 * 1024
const WINDOW = 4
type Bridge = Record<string, (...args: any[]) => any>

class Operation {
  readonly controller = new AbortController()
  private idleTimer: ReturnType<typeof setTimeout>
  private cancelTimer?: ReturnType<typeof setTimeout>
  private removers: Array<() => void> = []
  readonly pending = new Set<Promise<any>>()
  readonly bridge: Bridge
  readonly client: SftpClient
  constructor(client: SftpClient, bridge: Bridge, signals: AbortSignal[]) {
    this.client = client
    this.bridge = bridge
    this.idleTimer = setTimeout(() => this.timeout(), 30_000)
    for (const signal of signals) {
      const listener = () => this.cancel(asError(signal.reason || new Error('SFTP_CANCELLED')))
      if (signal.aborted) listener()
      else {
        signal.addEventListener('abort', listener, { once: true })
        this.removers.push(() => signal.removeEventListener('abort', listener))
      }
    }
  }
  check() { if (this.controller.signal.aborted) throw asError(this.controller.signal.reason) }
  touch() {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.timeout(), 30_000)
  }
  private timeout() {
    this.cancel(new Error('SFTP_TIMEOUT'))
    if (this.pending.size) this.client.interrupt(this.bridge, 'SFTP_TIMEOUT')
  }
  cancel(error: Error) {
    if (this.controller.signal.aborted) return
    this.controller.abort(error)
    // Normal cancellation allows in-flight packets to settle, a stalled subsystem is closed
    this.cancelTimer = setTimeout(() => {
      if (this.pending.size) this.client.interrupt(this.bridge, 'SFTP_INTERRUPTED')
    }, 2_000)
  }
  wait<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const signal = this.controller.signal
      const cancelled = () => reject(asError(signal.reason))
      const cleanup = () => signal.removeEventListener('abort', cancelled)
      promise.then(value => { cleanup(); if (signal.aborted) cancelled(); else resolve(value) }, error => { cleanup(); reject(error) })
      if (signal.aborted) cancelled()
      else signal.addEventListener('abort', cancelled, { once: true })
    })
  }
  async call<T = any>(name: string, args: unknown[] = [], cleanup = false): Promise<T> {
    if (!cleanup) this.check()
    if (!this.client.owns(this.bridge)) throw new Error('SFTP_CLOSED')
    const fn = this.bridge[name]
    if (!fn) throw new Error('SFTP_NOT_READY')
    const promise = Promise.resolve().then(() => {
      if (!this.client.owns(this.bridge)) throw new Error('SFTP_CLOSED')
      if (!cleanup) this.check()
      return fn(...args)
    })
    this.pending.add(promise)
    try { return await promise } catch (error) {
      if (!cleanup && this.controller.signal.aborted) {
        const detail = asError(error)
        if (detail instanceof SftpError) {
          detail.message = asError(this.controller.signal.reason).message
          throw detail
        }
        throw asError(this.controller.signal.reason)
      }
      throw asError(error)
    }
    finally { this.pending.delete(promise) }
  }
  async settle() { await Promise.allSettled([...this.pending]) }
  onFinish(cleanup: () => void) { this.removers.push(cleanup) }
  finish() {
    clearTimeout(this.idleTimer)
    clearTimeout(this.cancelTimer)
    this.removers.forEach(remove => remove())
  }
}

function progressReporter(op: Operation, total: number, callback?: TransferOptions['onProgress']) {
  let transferred = 0
  let currentPhase: TransferProgress['phase'] = 'running'
  const samples: Array<{ time: number; bytes: number }> = [{ time: performance.now(), bytes: 0 }]
  const emit = () => {
    const now = performance.now()
    samples.push({ time: now, bytes: transferred })
    while (samples.length > 2 && samples[1]!.time < now - 2000) samples.shift()
    const first = samples[0]!
    callback?.({ transferredBytes: transferred, totalBytes: total, speedBps: (transferred - first.bytes) * 1000 / Math.max(1, now - first.time), phase: currentPhase })
  }
  const report = (bytes: number, phase: TransferProgress['phase'] = 'running') => {
    transferred += bytes
    currentPhase = phase
    if (bytes > 0) op.touch()
    if (phase === 'finalizing') emit()
  }
  const interval = setInterval(emit, 200)
  op.onFinish(() => clearInterval(interval))
  emit()
  return report
}

// At most four blocks exist, including completed blocks waiting for their ordered sink write
async function orderedWindow<T>(total: number, op: Operation, produce: (offset: number, length: number) => Promise<T>, consume: (value: T) => Promise<void>) {
  const queue: Array<Promise<{ value?: T; error?: Error }>> = []
  let next = 0
  const fill = () => {
    while (queue.length < WINDOW && next < total) {
      op.check()
      const offset = next
      next += Math.min(CHUNK, total - next)
      queue.push(produce(offset, Math.min(CHUNK, total - offset)).then(value => ({ value }), error => ({ error: asError(error) })))
    }
  }
  try {
    fill()
    while (queue.length) {
      const result = await queue[0]!
      if (result.error) throw result.error
      op.check()
      await consume(result.value!)
      queue.shift()
      fill()
    }
  } catch (error) {
    op.cancel(asError(error))
    await Promise.allSettled(queue)
    throw error
  }
}

export class SftpClient {
  readonly state = reactive<{ phase: SftpState; error: string }>({ phase: 'idle', error: '' })
  readonly id = uuid()
  generation = 0
  authGeneration = getAuthGeneration()
  private config: any
  private bridge?: Bridge
  private lifetime = new AbortController()
  private initializationTimer?: ReturnType<typeof setTimeout>
  get key() { return `${this.id}:${this.generation}` }
  get signal() { return this.lifetime.signal }
  attach(config: any, generation: number) {
    this.disconnect()
    this.config = config
    this.generation = generation
    this.authGeneration = getAuthGeneration()
    this.lifetime = new AbortController()
    this.state.phase = 'initializing'
    this.state.error = ''
  }
  update(phase: SftpState, message = '') {
    if (this.lifetime.signal.aborted) return
    this.state.phase = phase
    this.state.error = message
    clearTimeout(this.initializationTimer)
    if (phase === 'initializing') {
      this.initializationTimer = setTimeout(() => {
        this.update('error', 'SFTP_TIMEOUT')
        this.config?.sftpAbort?.()
      }, 30_000)
    }
    if (phase === 'ready') {
      this.bridge = Object.fromEntries(Object.entries(this.config).filter(([name, value]) => name.startsWith('sftp') && typeof value === 'function')) as Bridge
    } else if (phase === 'error' || phase === 'closed') {
      this.lifetime.abort(new Error(message || 'SFTP_CLOSED'))
    }
  }
  disconnect() {
    clearTimeout(this.initializationTimer)
    this.state.phase = 'closed'
    this.state.error = ''
    this.lifetime.abort(new Error('SFTP_CLOSED'))
    this.config = null
    this.bridge = undefined
  }
  owns(bridge: Bridge) { return this.bridge === bridge && !!this.config }
  interrupt(bridge: Bridge, message: string) {
    if (!this.owns(bridge)) return
    this.update('error', message)
    // Avoid re-entering a Go callback while handling a Go-originated state event
    queueMicrotask(() => { if (this.owns(bridge)) this.config?.sftpAbort?.() })
  }
  private async run<T>(fn: (op: Operation) => Promise<T>, options: TransferOptions = {}): Promise<T> {
    if (this.authGeneration !== getAuthGeneration() || !getAuthToken()) throw new Error('SFTP_CLOSED')
    if (this.state.phase !== 'ready' || !this.bridge) throw new Error(this.state.error || 'SFTP_NOT_READY')
    const op = new Operation(this, this.bridge, [this.signal, ...(options.signal ? [options.signal] : [])])
    try { return await fn(op) } catch (error) { throw asError(error) } finally { op.finish() }
  }
  list(path: string) { return this.run(op => op.call<FileInfo[]>('sftpList', [path])) }
  stat(path: string) { return this.run(op => op.call<FileInfo | null>('sftpStat', [path])) }
  mkdir(path: string) { return this.run(op => op.call<void>('sftpMkdir', [path])) }
  create(path: string) { return this.run(op => op.call<void>('sftpCreate', [path])) }
  remove(path: string) { return this.run(op => op.call<void>('sftpRemove', [path])) }
  rename(from: string, to: string) { return this.run(op => op.call<void>('sftpRename', [from, to])) }

  async read(path: string, limit = 500 * 1024, prefixOnly = false): Promise<{ data: Uint8Array; info: FileInfo }> {
    return this.run(async op => {
      const handle = await op.call<number>('sftpOpenFile', [path])
      let failure: unknown
      try {
        const info = await op.call<FileInfo>('sftpFstat', [handle])
        if (!prefixOnly && info.size > limit) throw new Error('SFTP_EDITOR_TOO_LARGE')
        const size = Math.min(info.size, limit)
        const data = new Uint8Array(size)
        for (let offset = 0; offset < size; offset += CHUNK) {
          const length = Math.min(CHUNK, size - offset)
          const chunk = await op.call<{ data: Uint8Array }>('sftpReadAt', [handle, offset, length])
          if (chunk.data.length !== length) throw new Error('SFTP_INCOMPLETE')
          data.set(chunk.data, offset)
          op.touch()
        }
        const after = await op.call<FileInfo>('sftpFstat', [handle])
        if (!prefixOnly && (after.size !== info.size || after.modTime !== info.modTime)) throw new Error('SFTP_SOURCE_CHANGED')
        return { data, info }
      } catch (error) { failure = error; throw error }
      finally { try { await op.call('sftpCloseFile', [handle], true) } catch (error) { if (!failure) throw error } }
    })
  }

  async download(path: string, createSink: (info: FileInfo) => Promise<DownloadSink>, options: TransferOptions = {}): Promise<void> {
    return this.run(async op => {
      const handle = await op.call<number>('sftpOpenFile', [path])
      let sink: DownloadSink | undefined
      let closed = false
      let complete = false
      let failure: unknown
      try {
        const info = await op.call<FileInfo>('sftpFstat', [handle])
        if (info.isDir || !Number.isSafeInteger(info.size) || info.size < 0) throw new Error('SFTP_NOT_REGULAR')
        sink = await op.wait(createSink(info).then(async created => {
          if (op.controller.signal.aborted) {
            try { await created.abort() } catch { /* retain cancellation */ }
            op.check()
          }
          return created
        }))
        op.check()
        const report = progressReporter(op, info.size, options.onProgress)
        await orderedWindow(info.size, op, async (offset, length) => {
          const chunk = await op.call<{ data: Uint8Array; eof: boolean }>('sftpReadAt', [handle, offset, length])
          if (chunk.data.length !== length) throw new Error('SFTP_INCOMPLETE')
          return chunk.data
        }, async data => { const length = data.length; await op.wait(sink!.write(data)); report(length) })
        report(0, 'finalizing')
        const after = await op.call<FileInfo>('sftpFstat', [handle])
        if (after.size !== info.size || after.modTime !== info.modTime) throw new Error('SFTP_SOURCE_CHANGED')
        await op.call('sftpCloseFile', [handle]); closed = true
        op.check()
        await op.wait(sink!.close())
        complete = true
      } catch (error) { failure = error; throw error }
      finally {
        await op.settle()
        if (!closed) { try { await op.call('sftpCloseFile', [handle], true) } catch (error) { if (!failure) failure = error } }
        if (!complete && sink) { try { await sink.abort() } catch { /* retain the transfer error */ } }
        if (failure) throw failure
      }
    }, options)
  }

  async upload(file: Blob, path: string, overwrite: boolean, options: TransferOptions = {}, expected?: FileInfo): Promise<void> {
    return this.run(async op => {
      const prepared = await op.call<{ handle: number; temporaryPath: string }>('sftpPrepareUpload', [path, overwrite, expected ?? null])
      let committed = false
      let committing = false
      let failure: SftpError | undefined
      try {
        const report = progressReporter(op, file.size, options.onProgress)
        await orderedWindow(file.size, op, async (offset, length) => {
          const data = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
          op.check()
          const written = await op.call<number>('sftpWriteAt', [prepared.handle, offset, data])
          if (written !== length) throw new Error('SFTP_SIZE_MISMATCH')
          report(written)
          return written
        }, async () => {})
        op.check()
        report(0, 'finalizing')
        committing = true
        await op.call('sftpCommitUpload', [prepared.handle, file.size])
        committed = true
      } catch (error) {
        const cause = asError(error)
        failure = cause instanceof SftpError ? cause : new SftpError(cause.message)
        failure.uncertain = failure.message.includes('SFTP_COMMIT_UNCERTAIN') || (committing && op.controller.signal.aborted)
        if (failure.uncertain) { failure.message = 'SFTP_COMMIT_UNCERTAIN'; failure.temporaryPath = prepared.temporaryPath }
      } finally {
        await op.settle()
        if (!committed && !failure?.uncertain) {
          try { await op.call('sftpAbortUpload', [prepared.handle], true) }
          catch {
            failure ??= new SftpError('SFTP_CLEANUP_FAILED')
            failure.temporaryPath = prepared.temporaryPath
          }
        }
      }
      if (failure) throw failure
    }, options)
  }
}
