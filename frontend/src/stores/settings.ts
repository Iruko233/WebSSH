import { defineStore } from 'pinia'
import { reactive, watch, toRefs } from 'vue'
import { applyAppTheme } from '../lib/themeManager'

export interface SettingsState {
  fontFamily: string;
  fontSize: number;
  theme: string;
  keywordHighlight: boolean;
  kwError: boolean;
  kwWarning: boolean;
  kwOk: boolean;
  kwInfo: boolean;
  kwDebug: boolean;
  kwIpMac: boolean;
  padding: number;
  appTheme: 'auto' | 'light' | 'dark';
  primaryColor: string;
  sftpLayout: 'right' | 'bottom';
  autoOpenMonitor: boolean;
  monitorInterval: number;
  encryptHandshake: boolean;
}

const DEFAULT_SETTINGS: SettingsState = {
  fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
  fontSize: 15,
  theme: 'dracula',
  keywordHighlight: true,
  kwError: true,
  kwWarning: true,
  kwOk: true,
  kwInfo: true,
  kwDebug: true,
  kwIpMac: true,
  padding: 10,
  appTheme: 'auto',
  primaryColor: '#64748b',
  sftpLayout: 'right',
  autoOpenMonitor: false,
  monitorInterval: 1,
  encryptHandshake: true
}

export const useSettingsStore = defineStore('settings', () => {
  const state = reactive<SettingsState>({ ...DEFAULT_SETTINGS })
  
  // Debounce timer
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  // Load from local storage immediately as fallback
  const saved = localStorage.getItem('webssh_settings')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      Object.assign(state, parsed)
    } catch (e) {
      console.error('Failed to parse settings', e)
    }
  }
  
  // Apply visual themes immediately on boot
  applyAppTheme(state.appTheme, state.primaryColor)

  const fetchCloudSettings = async () => {
    try {
      const token = sessionStorage.getItem('jwt')
      if (!token) return

      const res = await fetch('/api/settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        if (data.settings) {
          Object.assign(state, data.settings)
          localStorage.setItem('webssh_settings', JSON.stringify(state))
        }
      }
    } catch (e) {
      console.error('Failed to fetch cloud settings', e)
    }
  }

  const syncToCloud = async (settingsToSync: SettingsState) => {
    try {
      const token = sessionStorage.getItem('jwt')
      if (!token) return

      await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settingsToSync)
      })
    } catch (e) {
      console.error('Failed to sync settings to cloud', e)
    }
  }

  watch(state, (newVal) => {
    // Apply visual themes immediately
    applyAppTheme(newVal.appTheme, newVal.primaryColor)

    // 1. Save to localStorage immediately
    localStorage.setItem('webssh_settings', JSON.stringify(newVal))
    
    // 2. Debounce cloud sync (1 second)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      syncToCloud(newVal)
    }, 1000)
  }, { deep: true })

  function updateSettings(partial: Partial<SettingsState>) {
    Object.assign(state, partial)
  }

  return { 
    ...toRefs(state), 
    state, 
    fetchCloudSettings, 
    updateSettings 
  }
})
