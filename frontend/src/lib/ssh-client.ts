/**
 * True Zero-Knowledge Web SSH Client via WebAssembly
 */

declare const Go: any;

import { SftpClient, type SftpState } from './sftp-client'
import { getAuthGeneration, getAuthToken } from './auth-session'
export type { FileInfo } from './sftp-client'

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
const activeConnections = new Set<SSHConnection>();

// Capture only the old session, a new unlock may start connections during cleanup
export function captureSSHConnectionCleanup(): () => void {
  const connections = [...activeConnections];
  return () => { for (const connection of connections) connection.disconnect(); };
}

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
  try {
    await wasmInitializing;
  } catch (error) {
    wasmInitializing = null;
    throw error;
  }
}

export class SSHConnection {
  readonly sftp = new SftpClient();
  private config: any = null;
  private generation = 0;
  private pendingSize: { cols: number; rows: number } | null = null;
  private sentSize: { cols: number; rows: number } | null = null;
  private ready = false;

  async connect(opts: SSHConnectOptions): Promise<void> {
    this.disconnect();
    activeConnections.add(this);
    this.resize(opts.cols || 80, opts.rows || 24);
    const generation = this.generation;
    const authGeneration = getAuthGeneration();
    let finished = false;
    const isCurrent = () => generation === this.generation && authGeneration === getAuthGeneration() && !!getAuthToken() && !finished;
    try {
      await initWasm();
    } catch (e: any) {
      if (isCurrent()) opts.onError?.(new Error("WASM 加载失败: " + e.message));
      return;
    }
    if (!isCurrent()) return;

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
      cols: this.pendingSize?.cols ?? 80,
      rows: this.pendingSize?.rows ?? 24,
      onData: (b64: string) => {
        if (!isCurrent()) return;
        const binaryStr = atob(b64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        opts.onData?.(bytes);
      },
      onClose: (msg: string) => {
        if (!isCurrent()) return;
        finished = true;
        this.sftp.disconnect();
        this.ready = false;
        if (msg && msg !== "SSH connection closed") {
          opts.onError?.(new Error(msg));
        }
        opts.onClose?.();
      },
      onSftpState: (state: SftpState, message: string) => {
        if (isCurrent()) this.sftp.update(state, message);
      },
      onReady: () => {
        if (!isCurrent()) return;
        this.ready = true;
        opts.onConnected?.();
        // Return from the Go callback before invoking its resize callback
        queueMicrotask(() => { if (isCurrent()) this.flushResize(); });
      },
      onHostKeyPrompt: (rawKey: string, fingerprint: string, isMismatch: boolean) => {
        if (!isCurrent()) return;
        finished = true; // This attempt ends while the user decides whether to reconnect
        this.ready = false;
        opts.onHostKeyPrompt?.(rawKey, fingerprint, isMismatch);
      },
      onOsInfo: (os: string) => {
        if (isCurrent()) opts.onOsInfo?.(os);
      },
      onSysStats: (stats: any) => {
        if (isCurrent()) opts.onSysStats?.(stats);
      }
    };

    this.sftp.attach(this.config, generation);

    // startWasmSSH is injected into the global scope by main.wasm
    try {
      (window as any).startWasmSSH(this.config);
    } catch (error) {
      if (isCurrent()) opts.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.disconnect();
    }
  }

  sendInput(data: string): void {
    if (this.config && this.config.write) {
      const bytes = new TextEncoder().encode(data);
      const binaryStr = Array.from(bytes, (byte) =>
        String.fromCharCode(byte),
      ).join("");
      this.config.write(btoa(binaryStr));
    }
  }

  resize(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1) return
    // Keep the latest valid grid even before WASM has produced a config
    this.pendingSize = { cols, rows }
    if (!this.config) return
    this.config.cols = cols
    this.config.rows = rows
    this.config.__pendingRows = rows
    this.config.__pendingCols = cols
    this.flushResize()
  }

  private flushResize(): void {
    const size = this.pendingSize
    if (!this.ready || !size || !this.config?.resize) return
    if (this.sentSize?.cols === size.cols && this.sentSize.rows === size.rows) return
    this.config.resize(size.rows, size.cols) // WASM expects rows, cols
    this.sentSize = { ...size }
  }

  disconnect(): void {
    activeConnections.delete(this);
    this.sftp.disconnect();
    this.generation++;
    const config = this.config;
    this.config = null;
    this.ready = false;
    this.pendingSize = null;
    this.sentSize = null;
    if (config) {
      config.cancelled = true;
      config.close?.();
    }
  }

}
