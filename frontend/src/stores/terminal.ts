import { defineStore } from 'pinia'
import { useServerStore } from './server'

export interface TerminalTab {
  id: string;
  serverId: string;
  title: string;
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
        title: server.name
      })
      this.activeTabId = tabId
    },
    removeTab(tabId: string) {
      const index = this.tabs.findIndex(t => t.id === tabId)
      if (index === -1) return

      this.tabs.splice(index, 1)

      if (this.activeTabId === tabId) {
        // Switch to the previous tab or next tab
        if (this.tabs.length > 0) {
          this.activeTabId = this.tabs[Math.max(0, index - 1)].id
        } else {
          this.activeTabId = null
        }
      }
    },
    setActiveTab(tabId: string) {
      this.activeTabId = tabId
    }
  }
})
