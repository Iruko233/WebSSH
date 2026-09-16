// Disk writes live in a dedicated worker, never in the terminal's UI event loop
const channel = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage(message: unknown): void
}
let access: { write(data: Uint8Array, options: { at: number }): number; flush(): void; close(): void } | undefined
let handle: FileSystemFileHandle | undefined
let offset = 0
channel.onmessage = async ({ data }) => {
  try {
    let result: unknown
    if (data.action === 'open') {
      const root = await navigator.storage.getDirectory()
      const directory = await root.getDirectoryHandle('webssh-downloads', { create: true })
      handle = await directory.getFileHandle(data.name, { create: true })
      const candidate = handle as FileSystemFileHandle & { createSyncAccessHandle?: () => Promise<NonNullable<typeof access>> }
      if (!candidate.createSyncAccessHandle) throw new Error('SFTP_DISK_UNAVAILABLE')
      access = await candidate.createSyncAccessHandle()
    } else if (data.action === 'write') {
      if (!access) throw new Error('SFTP_DISK_UNAVAILABLE')
      const bytes = new Uint8Array(data.buffer)
      let written = 0
      while (written < bytes.length) {
        const count = access.write(bytes.subarray(written), { at: offset + written })
        if (count <= 0) throw new Error('SFTP_DISK_WRITE_FAILED')
        written += count
      }
      offset += written
    } else if (data.action === 'close') {
      access?.flush()
      access?.close()
      access = undefined
      result = await handle!.getFile()
    } else if (data.action === 'abort') {
      access?.close()
      access = undefined
    }
    channel.postMessage({ id: data.id, result })
  } catch (error) {
    const e = error as Error
    channel.postMessage({ id: data.id, error: e.message, name: e.name })
  }
}
export {}
