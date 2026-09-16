import DiskWorker from './opfs-download.worker?worker'
import { v4 as uuid } from 'uuid'
import { asError, type DownloadSink } from './sftp-client'

export interface DownloadArtifact { url: string; dispose(): Promise<void> }
export interface DownloadTarget { sink: DownloadSink; artifact?: DownloadArtifact }
const MEMORY_FILE_LIMIT = 32 * 1024 * 1024
const MEMORY_TOTAL_LIMIT = 64 * 1024 * 1024
let memoryReserved = 0
let diskReserved = 0
const cacheSession = `${Date.now()}-${uuid()}`
let cacheReady: Promise<void> | undefined

function prepareCache(): Promise<void> {
  cacheReady ??= (async () => {
    if (!navigator.locks) return
    let releaseLease: () => void = () => {}
    const lease = new Promise<void>(resolve => { releaseLease = resolve })
    const acquired = await new Promise<boolean>(resolve => {
      void navigator.locks.request(`webssh-downloads:${cacheSession}`, async () => {
        resolve(true)
        await lease
      }).catch(() => resolve(false))
    })
    if (!acquired) return
    window.addEventListener('pagehide', event => { if (!event.persisted) releaseLease() })
    // Recover abandoned cache after a day, never touch a live page's files
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle('webssh-downloads', { create: true })
    const iterable = directory as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }
    for await (const [name, handle] of iterable.entries()) {
      const match = /^(\d{13}-[0-9a-f-]{36})--[0-9a-f-]{36}$/.exec(name)
      if (!match || handle.kind !== 'file' || Date.now() - Number(match[1]!.slice(0, 13)) < 86_400_000) continue
      await navigator.locks.request(`webssh-downloads:${match[1]}`, { ifAvailable: true }, async lock => {
        if (lock) { try { await directory.removeEntry(name) } catch { /* another page may already have cleaned it */ } }
      })
    }
  })()
  return cacheReady
}

export function chooseDownloadFile(name: string): Promise<FileSystemFileHandle> | undefined {
  const picker = (window as unknown as { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle> }).showSaveFilePicker
  // Must happen in the original click handler before any asynchronous stat request
  return picker?.call(window, { suggestedName: name })
}

async function removeTemporary(name: string) {
  try {
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle('webssh-downloads')
    await directory.removeEntry(name)
  }
  catch (error) { if ((error as Error).name !== 'NotFoundError') throw error }
}

async function diskTarget(id: string, size: number): Promise<DownloadTarget> {
  await prepareCache()
  const cacheName = `${cacheSession}--${id}`
  const estimate = await navigator.storage.estimate()
  if (estimate.quota !== undefined && estimate.usage !== undefined && size > estimate.quota - estimate.usage - diskReserved) throw new Error('SFTP_DISK_QUOTA')
  const worker = new DiskWorker()
  diskReserved += size
  let remaining = size
  let sequence = 0
  let terminated = false
  const requests = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const stop = () => {
    if (terminated) return
    terminated = true
    worker.terminate()
    diskReserved -= remaining
    remaining = 0
    for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error('SFTP_DISK_UNAVAILABLE')) }
    requests.clear()
  }
  worker.onmessage = ({ data }) => {
    const request = requests.get(data.id)
    if (!request) return
    requests.delete(data.id)
    clearTimeout(request.timer)
    if (data.error) {
      const error = new Error(data.name === 'QuotaExceededError' ? 'SFTP_DISK_QUOTA' : data.error)
      error.name = data.name
      request.reject(error)
    } else request.resolve(data.result)
  }
  worker.onerror = () => stop()
  const call = (action: string, buffer?: ArrayBuffer): Promise<any> => new Promise((resolve, reject) => {
    if (terminated) { reject(new Error('SFTP_DISK_UNAVAILABLE')); return }
    const requestID = ++sequence
    const timer = setTimeout(() => { stop(); reject(new Error('SFTP_DISK_UNAVAILABLE')) }, 15_000)
    requests.set(requestID, { resolve, reject, timer })
    worker.postMessage({ action, id: requestID, name: cacheName, buffer }, buffer ? [buffer] : [])
  })
  const target: DownloadTarget = {
    sink: {
      async write(data) {
        const length = data.byteLength
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + length) as ArrayBuffer
        await call('write', buffer)
        remaining -= length
        diskReserved -= length
      },
      async close() {
        const file: File = await call('close')
        stop()
        const url = URL.createObjectURL(file)
        let disposed = false
        target.artifact = { url, async dispose() {
          if (disposed) return
          await removeTemporary(cacheName)
          URL.revokeObjectURL(url)
          disposed = true
        } }
      },
      async abort() {
        if (target.artifact) { await target.artifact.dispose(); return }
        if (!terminated) { try { await call('abort') } catch { /* terminating releases the worker's file lock */ } finally { stop() } }
        await removeTemporary(cacheName)
      }
    }
  }
  try { await call('open'); return target }
  catch (error) {
    stop()
    try { await removeTemporary(cacheName) } catch { /* opening may have failed before creation */ }
    throw error
  }
}

function memoryTarget(size: number): DownloadTarget {
  if (size > MEMORY_FILE_LIMIT || memoryReserved + size > MEMORY_TOTAL_LIMIT) throw new Error('SFTP_MEMORY_LIMIT')
  memoryReserved += size
  let released = false
  let chunks: BlobPart[] = []
  const release = () => {
    chunks = []
    if (!released) { memoryReserved -= size; released = true }
  }
  const target: DownloadTarget = { sink: {
    async write(data) { chunks.push(data as Uint8Array<ArrayBuffer>) },
    async close() {
      const url = URL.createObjectURL(new Blob(chunks))
      chunks = []
      target.artifact = { url, async dispose() { URL.revokeObjectURL(url); release() } }
    },
    async abort() { if (target.artifact) URL.revokeObjectURL(target.artifact.url); release() }
  } }
  return target
}

export async function createDownloadTarget(id: string, size: number, nativeHandle?: FileSystemFileHandle): Promise<DownloadTarget> {
  if (nativeHandle) {
    const writer = await nativeHandle.createWritable()
    return { sink: {
      async write(data) { await writer.write(data as Uint8Array<ArrayBuffer>) },
      async close() { await writer.close() },
      async abort() { await writer.abort() }
    } }
  }
  if (typeof navigator.storage?.getDirectory === 'function' && typeof Worker !== 'undefined') {
    try { return await diskTarget(id, size) }
    catch (error) {
      const e = asError(error)
      if (e.message === 'SFTP_DISK_QUOTA') throw e
      if (!['SecurityError', 'NotSupportedError'].includes(e.name) && e.message !== 'SFTP_DISK_UNAVAILABLE') throw e
    }
  }
  return memoryTarget(size)
}
