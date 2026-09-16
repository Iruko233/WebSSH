import { defineStore } from 'pinia'
import { useServerStore } from './server'

export type ConnectionStatus = 'connecting' | 'awaiting-input' | 'connected' | 'disconnected' | 'error'

export interface TerminalTab {
  id: string;
  serverId: string;
  title: string;
  status: ConnectionStatus;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
}

export const useTerminalStore = defineStore('terminal', {
  state: (): TerminalState => ({
    tabs: [],
    activeTabId: null,
  }),
  actions: {
    addTab(serverId: string) {
      const serverStore = useServerStore()
      const server = serverStore.servers.find(s => s.id === serverId)
      if (!server) return

      const tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      this.tabs.push({
        id: tabId,
        serverId: serverId,
        title: server.name,
        status: 'connecting'
      })
      this.activeTabId = tabId
    },
    removeTab(tabId: string) {
      const index = this.tabs.findIndex(t => t.id === tabId)
      if (index === -1) return

      this.tabs.splice(index, 1)

      if (this.activeTabId === tabId) {
        // Prefer the next tab at the removed index, then the previous tab
        if (this.tabs.length > 0) {
          this.activeTabId = this.tabs[Math.min(index, this.tabs.length - 1)]!.id
        } else {
          this.activeTabId = null
        }
      }
    },
    setActiveTab(tabId: string) {
      if (this.tabs.some(tab => tab.id === tabId)) this.activeTabId = tabId
    },
    moveTab(tabId: string, beforeTabId: string | null) {
      const index = this.tabs.findIndex(tab => tab.id === tabId)
      if (index < 0 || tabId === beforeTabId) return
      if (beforeTabId !== null && !this.tabs.some(tab => tab.id === beforeTabId)) return
      const [tab] = this.tabs.splice(index, 1)
      const target = beforeTabId === null ? this.tabs.length : this.tabs.findIndex(tab => tab.id === beforeTabId)
      this.tabs.splice(target, 0, tab!)
    },
    setTabStatus(tabId: string, status: ConnectionStatus) {
      const tab = this.tabs.find(tab => tab.id === tabId)
      if (!tab || (tab.status === 'error' && status === 'disconnected')) return
      tab.status = status
    }
  }
})
