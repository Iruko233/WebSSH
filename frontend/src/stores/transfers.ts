import { reactive, shallowReactive } from 'vue'
import { v4 as uuid } from 'uuid'
import { SftpClient, SftpError, asError, type FileInfo, type TransferProgress } from '../lib/sftp-client'
import { createDownloadTarget, type DownloadArtifact } from '../lib/download-target'
import { getAuthGeneration, getAuthToken } from '../lib/auth-session'

export type TransferState = 'queued' | 'running' | 'finalizing' | 'ready-to-save' | 'completed' | 'failed' | 'cancelled' | 'uncertain'
export interface Transfer {
  id: string
  tabId: string
  connectionKey: string
  name: string
  path: string
  type: 'upload' | 'download'
  state: TransferState
  transferredBytes: number
  totalBytes: number
  speedBps: number
  error: string
  temporaryPath?: string
  saved: boolean
  orphaned?: boolean
}
interface Job {
  generation: number
  task: Transfer
  client: SftpClient
  controller: AbortController
  run(): Promise<void>
  detach(): void
  finished: Promise<void>
  finish(): void
  removeWhenDone?: boolean
}
export const transfers = shallowReactive<Transfer[]>([])
const jobs = new Map<string, Job>()
const artifacts = new Map<string, DownloadArtifact>()
const queue: Job[] = []
let running = 0
const directoryListeners = new Set<(connectionKey: string, directory: string) => void>()
export function onTransferDirectoryChange(listener: (connectionKey: string, directory: string) => void) {
  directoryListeners.add(listener)
  return () => directoryListeners.delete(listener)
}
function directoryChanged(task: Transfer) {
  const directory = task.path.slice(0, task.path.lastIndexOf('/')) || '/'
  for (const listener of directoryListeners) listener(task.connectionKey, directory)
}
export function isTransferActive(task: Transfer) { return ['queued', 'running', 'finalizing'].includes(task.state) }
export function transferPercentage(task: Transfer) {
  if (['ready-to-save', 'completed'].includes(task.state)) return 100
  return task.totalBytes > 0 ? Math.min(99, Math.floor(task.transferredBytes / task.totalBytes * 100)) : 0
}

function enqueue(tabId: string, client: SftpClient, path: string, type: Transfer['type'], execute: (job: Job, progress: (value: TransferProgress) => void) => Promise<void>) {
  if (!getAuthToken() || client.authGeneration !== getAuthGeneration()) throw new Error('SFTP_CLOSED')
  const generation = getAuthGeneration()
  if (client.state.phase !== 'ready') throw new Error(client.state.error || 'SFTP_NOT_READY')
  if (transfers.some(task => isTransferActive(task) && task.connectionKey === client.key && task.path === path && task.type === type)) throw new Error('SFTP_DUPLICATE_TRANSFER')
  const task = reactive<Transfer>({ id: uuid(), tabId, connectionKey: client.key, name: path.split('/').pop() || path,
    path, type, state: 'queued', transferredBytes: 0, totalBytes: 0, speedBps: 0, error: '', saved: false })
  const lifetime = client.signal
  let finish: () => void = () => {}
  const finished = new Promise<void>(resolve => { finish = resolve })
  const onDisconnected = () => {
    const job = jobs.get(task.id)
    job?.controller.abort(new Error(client.state.error || 'SFTP_CLOSED'))
    pump()
  }
  const job: Job = {
    task, client, generation, controller: new AbortController(), finished, finish,
    detach: () => lifetime.removeEventListener('abort', onDisconnected),
    run: async () => execute(job, value => {
      if (job.controller.signal.aborted || job.client.key !== task.connectionKey || generation !== getAuthGeneration()) return
      Object.assign(task, value, { state: value.phase })
    })
  }
  jobs.set(task.id, job)
  transfers.push(task)
  lifetime.addEventListener('abort', onDisconnected, { once: true })
  queue.push(job)
  pump()
  return task
}

function pump() {
  // Remove cancelled queued jobs even when all running slots are occupied
  for (let i = queue.length - 1; i >= 0; i--) {
    const job = queue[i]!
    if (!job.controller.signal.aborted) continue
    queue.splice(i, 1)
    const error = asError(job.controller.signal.reason)
    job.task.state = error.message === 'SFTP_CANCELLED' ? 'cancelled' : 'failed'
    job.task.error = error.message
    job.detach()
    jobs.delete(job.task.id)
    if (job.removeWhenDone) void clearTransfer(job.task.id)
    job.finish()
  }
  while (running < 2 && queue.length) {
    const job = queue.shift()!
    running++
    job.task.state = 'running'
    void (async () => {
      try {
        if (job.client.key !== job.task.connectionKey) throw new Error('SFTP_CLOSED')
        await job.run()
        job.task.state = artifacts.has(job.task.id) ? 'ready-to-save' : 'completed'
      } catch (error) {
        const e = asError(error)
        job.task.state = e instanceof SftpError && e.uncertain ? 'uncertain' :
          job.controller.signal.reason?.message === 'SFTP_CANCELLED' ? 'cancelled' : 'failed'
        job.task.error = e.message
        if (e instanceof SftpError) job.task.temporaryPath = e.temporaryPath
      } finally {
        job.task.speedBps = 0
        job.detach()
        jobs.delete(job.task.id)
        if (job.task.type === 'upload' && job.generation === getAuthGeneration()) directoryChanged(job.task)
        running--
        if (job.removeWhenDone) {
          if (job.task.temporaryPath) job.task.orphaned = true
          else await clearTransfer(job.task.id)
        }
        job.finish()
        pump()
      }
    })()
  }
}

export function queueUpload(tabId: string, client: SftpClient, path: string, file: Blob, overwrite: boolean, expected?: FileInfo) {
  return enqueue(tabId, client, path, 'upload', async (job, onProgress) => {
    job.task.totalBytes = file.size
    await client.upload(file, path, overwrite, { signal: job.controller.signal, onProgress }, expected)
  })
}
export function queueDownload(tabId: string, client: SftpClient, path: string, nativeHandle?: FileSystemFileHandle) {
  return enqueue(tabId, client, path, 'download', async (job, onProgress) => {
    let target: Awaited<ReturnType<typeof createDownloadTarget>> | undefined
    await client.download(path, async info => {
      job.task.totalBytes = info.size
      target = await createDownloadTarget(job.task.id, info.size, nativeHandle)
      return target.sink
    }, { signal: job.controller.signal, onProgress })
    if (target?.artifact) {
      if (job.generation === getAuthGeneration()) artifacts.set(job.task.id, target.artifact)
      else await target.artifact.dispose()
    }
  })
}
export function cancelTransfer(id: string) {
  jobs.get(id)?.controller.abort(new Error('SFTP_CANCELLED'))
  pump()
}
export function saveTransfer(id: string) {
  const artifact = artifacts.get(id)
  const task = transfers.find(task => task.id === id)
  if (!artifact || !task) return
  const anchor = document.createElement('a')
  anchor.href = artifact.url
  anchor.download = task.name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  task.saved = true
  // The browser does not expose download completion, retain the source until explicitly cleared
}
export async function clearTransfer(id: string) {
  if (jobs.has(id)) return
  const artifact = artifacts.get(id)
  try { await artifact?.dispose() }
  catch (error) {
    const task = transfers.find(task => task.id === id)
    if (task) { task.error = asError(error).message; task.orphaned = true }
    return
  }
  artifacts.delete(id)
  const index = transfers.findIndex(task => task.id === id)
  if (index >= 0) transfers.splice(index, 1)
}
export function closeTabTransfers(tabId: string) {
  const pending: Promise<void>[] = []
  for (const task of transfers.filter(task => task.tabId === tabId)) {
    const job = jobs.get(task.id)
    if (job) {
      pending.push(job.finished)
      job.removeWhenDone = true
      job.controller.abort(new Error('SFTP_CANCELLED'))
    }
    else if (task.temporaryPath) task.orphaned = true
    else pending.push(clearTransfer(task.id))
  }
  pump()
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 3_000)
    void Promise.allSettled(pending).then(() => { clearTimeout(timer); resolve() })
  })
}

export async function closeAllTransfers() {
  const pending: Promise<unknown>[] = []
  for (const job of jobs.values()) {
    job.removeWhenDone = true
    job.controller.abort(new Error('SFTP_CANCELLED'))
    pending.push(job.finished)
  }
  for (const artifact of artifacts.values()) pending.push(artifact.dispose())
  artifacts.clear()
  transfers.splice(0)
  pump()
  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 3_000)
    void Promise.allSettled(pending).then(() => { clearTimeout(timer); resolve() })
  })
}
