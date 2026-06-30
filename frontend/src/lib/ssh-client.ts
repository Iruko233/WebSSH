/**
 * True Zero-Knowledge Web SSH Client via WebAssembly
 */

declare const Go: any;

export interface FileInfo {
  name: string
  isDir: boolean
  size: number
  modTime: number
  permissions: string
}

export interface NetStats {
  rx_bps: number
  tx_bps: number
}

export interface SysStats {
  cpu_percent: number
  mem_used: number
  mem_total: number
  net_interfaces: Record<string, NetStats>
  tcp_conns: number
  udp_conns: number
}

export interface SSHConnectOptions {
  host: string
  port: number
  username: string
  password?: string
  jwt: string
  expectedHostKey?: string
  cols?: number
  rows?: number
  monitor_interval?: number
  encrypt_handshake?: boolean
  onConnected?: () => void
  onData?: (data: Uint8Array) => void
  onOsInfo?: (os: string) => void
  onSysStats?: (stats: SysStats) => void
  onHostKeyPrompt?: (rawKey: string, fingerprint: string, isMismatch: boolean) => void
  onError?: (err: Error) => void
  onClose?: () => void
}

let wasmInitialized = false;
let wasmInitializing: Promise<void> | null = null;

async function initWasm() {
  if (wasmInitialized) return;
  if (wasmInitializing) return wasmInitializing;

  wasmInitializing = (async () => {
    try {
      const go = new Go();
      const result = await WebAssembly.instantiateStreaming(fetch("/main.wasm"), go.importObject);
      go.run(result.instance);
      wasmInitialized = true;
    } catch (e) {
      console.error("Failed to load main.wasm", e);
      throw e;
    }
  })();
  return wasmInitializing;
}

export class SSHConnection {
  private config: any = null;

  async connect(opts: SSHConnectOptions): Promise<void> {
    try {
      await initWasm();
    } catch (e: any) {
      opts.onError?.(new Error("WASM 加载失败: " + e.message));
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/tcp-proxy`;

    this.config = {
      wsUrl,
      token: opts.jwt,
      host: opts.host,
      port: opts.port || 22,
      username: opts.username,
      password: opts.password || "",
      expectedHostKey: opts.expectedHostKey || "",
      monitor_interval: opts.monitor_interval || 5,
      encrypt_handshake: opts.encrypt_handshake ?? true,
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      onData: (b64: string) => {
        const binaryStr = atob(b64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        opts.onData?.(bytes);
      },
      onClose: (msg: string) => {
        if (msg && msg !== "SSH connection closed") {
          opts.onError?.(new Error(msg));
        }
        opts.onClose?.();
      },
      onReady: () => {
        opts.onConnected?.();
      },
      onHostKeyPrompt: (rawKey: string, fingerprint: string, isMismatch: boolean) => {
        opts.onHostKeyPrompt?.(rawKey, fingerprint, isMismatch);
      },
      onOsInfo: (os: string) => {
        opts.onOsInfo?.(os);
      },
      onSysStats: (stats: any) => {
        opts.onSysStats?.(stats);
      }
    };

    // startWasmSSH is injected into the global scope by main.wasm
    (window as any).startWasmSSH(this.config);
  }

  sendInput(data: string): void {
    if (this.config && this.config.write) {
      this.config.write(btoa(data));
    }
  }

  resize(cols: number, rows: number): void {
    if (!this.config) return
    this.config.__pendingRows = rows
    this.config.__pendingCols = cols
    if (this.config.resize) {
      this.config.resize(rows, cols) // WASM expects rows, cols
    }
  }

  disconnect(): void {
    if (this.config && this.config.close) {
      this.config.close();
    }
  }

  // SFTP Methods (Proxy to WASM)
  public async sftpList(path: string): Promise<FileInfo[]> {
    return await this.config?.sftpList?.(path) || []
  }
  public async sftpStat(path: string): Promise<FileInfo> {
    return await this.config?.sftpStat?.(path)
  }
  public async sftpMkdir(path: string): Promise<void> {
    return await this.config?.sftpMkdir?.(path)
  }
  public async sftpCreate(path: string): Promise<void> {
    const handle = await this.config?.sftpOpenFile?.(path, "w")
    if (handle == null) throw new Error("SFTP not initialized")
    try {
      await this.config.sftpWriteFile(handle, new Uint8Array(0))
    } finally {
      await this.config.sftpCloseFile(handle)
    }
  }
  public async sftpRemove(path: string): Promise<void> {
    return await this.config?.sftpRemove?.(path)
  }
  public async sftpRename(oldPath: string, newPath: string): Promise<void> {
    return await this.config?.sftpRename?.(oldPath, newPath)
  }
  public async sftpReadFirstBytes(path: string, length: number): Promise<Uint8Array> {
    const handle = await this.config?.sftpOpenFile?.(path, "r")
    if (handle == null) throw new Error("SFTP not initialized")
    try {
      const chunk = await this.config.sftpReadFile(handle, length)
      return chunk || new Uint8Array(0)
    } finally {
      await this.config.sftpCloseFile(handle)
    }
  }
  public async sftpRead(path: string): Promise<string> {
    const handle = await this.config?.sftpOpenFile?.(path, "r")
    if (handle == null) throw new Error("SFTP not initialized")
    try {
      const chunks: Uint8Array[] = []
      let totalLength = 0
      while (true) {
        const chunk = await this.config.sftpReadFile(handle, 256 * 1024)
        if (!chunk) break
        chunks.push(chunk)
        totalLength += chunk.length
      }
      const allBytes = new Uint8Array(totalLength)
      let offset = 0
      for (const c of chunks) {
        allBytes.set(c, offset)
        offset += c.length
      }
      return new TextDecoder().decode(allBytes)
    } finally {
      await this.config.sftpCloseFile(handle)
    }
  }
  public async sftpWrite(path: string, content: string): Promise<void> {
    const handle = await this.config?.sftpOpenFile?.(path, "w")
    if (handle == null) throw new Error("SFTP not initialized")
    try {
      const bytes = new TextEncoder().encode(content)
      await this.config.sftpWriteFile(handle, bytes)
    } finally {
      await this.config.sftpCloseFile(handle)
    }
  }
  public async sftpDownload(path: string, onProgress?: (loaded: number, speed: string) => void): Promise<Blob> {
    const handle = await this.config?.sftpOpenFile?.(path, "r")
    if (handle == null) throw new Error("SFTP not initialized")
    try {
      let loaded = 0
      const chunks: BlobPart[] = []
      const chunkSize = 256 * 1024 // 256KB
      const startTime = Date.now()

      while (true) {
        const chunk = await this.config.sftpReadFile(handle, chunkSize)
        if (!chunk) break
        chunks.push(chunk)
        loaded += chunk.length

        if (onProgress) {
            const elapsed = (Date.now() - startTime) / 1000
            const speedBps = elapsed > 0 ? loaded / elapsed : 0
            let speedStr = ''
            if (speedBps > 1024 * 1024) speedStr = (speedBps / (1024 * 1024)).toFixed(2) + ' MB/s'
            else if (speedBps > 1024) speedStr = (speedBps / 1024).toFixed(2) + ' KB/s'
            else speedStr = speedBps.toFixed(2) + ' B/s'
            onProgress(loaded, speedStr)
        }
      }
      return new Blob(chunks)
    } finally {
      await this.config.sftpCloseFile(handle)
    }
  }
  public async sftpUpload(file: File, remotePath: string, onProgress?: (loaded: number, speed: string) => void): Promise<void> {
    const handle = await this.config?.sftpOpenFile?.(remotePath, "w")
    if (handle == null) throw new Error("SFTP not initialized")
    try {
      const chunkSize = 256 * 1024
      let offset = 0
      const total = file.size
      const startTime = Date.now()
      
      while (offset < total) {
        const slice = file.slice(offset, offset + chunkSize)
        const arrayBuffer = await slice.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        
        await this.config.sftpWriteFile(handle, bytes)
        offset += bytes.length
        
        if (onProgress) {
            const elapsed = (Date.now() - startTime) / 1000
            const speedBps = elapsed > 0 ? offset / elapsed : 0
            let speedStr = ''
            if (speedBps > 1024 * 1024) speedStr = (speedBps / (1024 * 1024)).toFixed(2) + ' MB/s'
            else if (speedBps > 1024) speedStr = (speedBps / 1024).toFixed(2) + ' KB/s'
            else speedStr = speedBps.toFixed(2) + ' B/s'
            onProgress(offset, speedStr)
        }
      }
    } finally {
      await this.config.sftpCloseFile(handle)
    }
  }
}
