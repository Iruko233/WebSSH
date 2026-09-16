import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTerminalStore } from '../src/stores/terminal'
import { useServerStore } from '../src/stores/server'

beforeEach(() => {
  setActivePinia(createPinia())
  useServerStore().servers = [{ id: 'server', name: 'Server', encryptedData: '', iv: '', credentials: { host: 'localhost', port: 22, username: 'test', password: '' } }]
})

function tabs(count = 3) {
  const store = useTerminalStore()
  for (let i = 0; i < count; i++) store.addTab('server')
  return store
}

describe('terminal sessions', () => {
  it('creates separate sessions and states for the same server', () => {
    const store = tabs(2)
    const [a, b] = store.tabs
    expect(a!.id).not.toBe(b!.id)
    store.setTabStatus(a!.id, 'connected')
    store.setTabStatus(b!.id, 'error')
    expect(store.tabs.map(tab => tab.status)).toEqual(['connected', 'error'])
  })
  it('reorders the same objects without changing active session or status', () => {
    const store = tabs()
    const [a, b, c] = [...store.tabs]
    store.setTabStatus(a!.id, 'connected')
    store.moveTab(a!.id, null)
    expect(store.tabs.map(tab => tab.id)).toEqual([b!.id, c!.id, a!.id])
    expect(store.tabs[2]).toBe(a)
    expect(store.tabs[2]!.status).toBe('connected')
    expect(store.activeTabId).toBe(c!.id)
    store.moveTab(a!.id, b!.id)
    expect(store.tabs.map(tab => tab.id)).toEqual([a!.id, b!.id, c!.id])
  })
  it('selects right neighbor, then left, then empty on active close', () => {
    const store = tabs()
    const [a, b, c] = [...store.tabs]
    store.setActiveTab(b!.id)
    store.removeTab(b!.id)
    expect(store.activeTabId).toBe(c!.id)
    store.removeTab(c!.id)
    expect(store.activeTabId).toBe(a!.id)
    store.removeTab(a!.id)
    expect(store.activeTabId).toBeNull()
  })
  it('keeps active session when closing background tabs and ignores invalid actions', () => {
    const store = tabs()
    const active = store.activeTabId
    store.removeTab(store.tabs[0]!.id)
    store.setActiveTab('missing')
    store.moveTab(store.tabs[0]!.id, 'missing')
    store.removeTab('missing')
    expect(store.activeTabId).toBe(active)
    expect(store.tabs).toHaveLength(2)
  })
  it('retains errors on close, permits a fresh attempt, ignores deleted tabs', () => {
    const store = tabs(1)
    const id = store.tabs[0]!.id
    store.setTabStatus(id, 'error')
    store.setTabStatus(id, 'disconnected')
    expect(store.tabs[0]!.status).toBe('error')
    store.setTabStatus(id, 'connecting')
    store.setTabStatus(id, 'awaiting-input')
    store.setTabStatus(id, 'disconnected')
    expect(store.tabs[0]!.status).toBe('disconnected')
    store.removeTab(id)
    store.setTabStatus(id, 'connected')
    expect(store.tabs).toHaveLength(0)
  })
})
