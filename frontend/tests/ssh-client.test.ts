import { beforeEach, describe, expect, it, vi } from 'vitest'

let configs: any[]
let start: ReturnType<typeof vi.fn>
let instantiate: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.resetModules()
  const { setAuthToken } = await import('../src/lib/auth-session')
  setAuthToken('test-session')
  configs = []
  start = vi.fn((config: any) => { config.close = vi.fn(); configs.push(config) })
  vi.stubGlobal('startWasmSSH', start)
  vi.stubGlobal('Go', class { importObject = {}; run() { return Promise.resolve() } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}))
  instantiate = vi.spyOn(WebAssembly, 'instantiateStreaming').mockResolvedValue({ instance: {} } as any)
})

function options() {
  return { host: 'localhost', port: 22, username: 'test', jwt: '', onConnected: vi.fn(), onError: vi.fn(), onClose: vi.fn(), onData: vi.fn(), onHostKeyPrompt: vi.fn() }
}

describe('SSH callback lifecycle', () => {
  it('loads the build-specific WASM URL and revalidates old cached responses', async () => {
    vi.stubGlobal('__SSH_WASM_URL__', '/assets/main-0123456789abcdef.wasm')
    const { SSHConnection } = await import('../src/lib/ssh-client')
    await new SSHConnection().connect(options())
    expect(fetch).toHaveBeenCalledWith('/assets/main-0123456789abcdef.wasm', { cache: 'no-cache' })
    expect(start).toHaveBeenCalledOnce()
  })
  it('uses readiness and normal remote closure callbacks', async () => {
    const { SSHConnection } = await import('../src/lib/ssh-client')
    const opts = options()
    await new SSHConnection().connect(opts)
    expect(opts.onConnected).not.toHaveBeenCalled()
    configs[0].onReady()
    configs[0].onClose('SSH connection closed')
    configs[0].onReady()
    configs[0].onClose('SSH connection closed')
    expect(opts.onConnected).toHaveBeenCalledTimes(1)
    expect(opts.onClose).toHaveBeenCalledTimes(1)
    expect(opts.onError).not.toHaveBeenCalled()
  })
  it.each(['SSH handshake failed: authentication failed', 'Failed to connect websocket: connection refused', 'Failed to start shell: rejected'])('reports %s as an error before close', async message => {
    const { SSHConnection } = await import('../src/lib/ssh-client')
    const opts = options()
    await new SSHConnection().connect(opts)
    configs[0].onClose(message)
    expect(opts.onError).toHaveBeenCalledWith(expect.objectContaining({ message }))
    expect(opts.onClose).toHaveBeenCalledOnce()
    expect(opts.onConnected).not.toHaveBeenCalled()
  })
  it('ignores stale callbacks after reconnect and closes pending transport', async () => {
    const { SSHConnection } = await import('../src/lib/ssh-client')
    const connection = new SSHConnection()
    const old = options(), current = options()
    await connection.connect(old)
    await connection.connect(current)
    expect(configs[0].cancelled).toBe(true)
    expect(configs[0].close).toHaveBeenCalledOnce()
    configs[0].onReady(); configs[0].onClose('late error'); configs[0].onData('YQ==')
    configs[1].onReady()
    expect(old.onConnected).not.toHaveBeenCalled()
    expect(old.onError).not.toHaveBeenCalled()
    expect(old.onData).not.toHaveBeenCalled()
    expect(current.onConnected).toHaveBeenCalledOnce()
    connection.disconnect()
    configs[1].onHostKeyPrompt('key', 'fingerprint', false)
    configs[1].onClose('late error')
    expect(current.onHostKeyPrompt).not.toHaveBeenCalled()
    expect(current.onError).not.toHaveBeenCalled()
  })
  it('does not create a connection when closed while WASM is loading', async () => {
    let resolve!: (value: any) => void
    instantiate.mockReturnValue(new Promise(r => { resolve = r }))
    const { SSHConnection } = await import('../src/lib/ssh-client')
    const connection = new SSHConnection()
    const pending = connection.connect(options())
    connection.disconnect()
    resolve({ instance: {} })
    await pending
    expect(start).not.toHaveBeenCalled()
  })
  it('ends the old attempt while awaiting host key confirmation', async () => {
    const { SSHConnection } = await import('../src/lib/ssh-client')
    const opts = options()
    await new SSHConnection().connect(opts)
    configs[0].onHostKeyPrompt('key', 'fingerprint', false)
    configs[0].onClose('late handshake failure')
    configs[0].onReady()
    expect(opts.onHostKeyPrompt).toHaveBeenCalledOnce()
    expect(opts.onError).not.toHaveBeenCalled()
    expect(opts.onConnected).not.toHaveBeenCalled()
  })
  it('reports WASM loading errors and permits retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    instantiate.mockRejectedValueOnce(new Error('load failed'))
    const { SSHConnection } = await import('../src/lib/ssh-client')
    const connection = new SSHConnection(), opts = options()
    await connection.connect(opts)
    expect(opts.onError).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
    await connection.connect(opts)
    expect(start).toHaveBeenCalledOnce()
  })
  it('isolates concurrent sessions sharing WASM initialization', async () => {
    const { SSHConnection } = await import('../src/lib/ssh-client')
    const a = new SSHConnection(), b = new SSHConnection()
    const aOpts = options(), bOpts = options()
    await Promise.all([a.connect(aOpts), b.connect(bOpts)])
    a.disconnect()
    configs[0].onReady(); configs[1].onReady()
    expect(aOpts.onConnected).not.toHaveBeenCalled()
    expect(bOpts.onConnected).toHaveBeenCalledOnce()
    expect(instantiate).toHaveBeenCalledOnce()
  })
})
