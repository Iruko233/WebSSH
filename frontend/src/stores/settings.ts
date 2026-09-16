import { defineStore } from 'pinia'
import { computed, onScopeDispose, reactive, watch, toRefs } from 'vue'
import { applyAppTheme } from '../lib/themeManager'
import { vaultRepository } from '../lib/vault-repository'
import { DEFAULT_SETTINGS, validateSettings } from '../lib/vault-schema'
import type { SettingsState } from '../types'
export type { SettingsState } from '../types'

export const useSettingsStore = defineStore('settings', () => {
  const state = reactive<SettingsState>({ ...DEFAULT_SETTINGS })
  let projecting = false
  // Remove only our legacy plaintext cache, never write decrypted preferences to browser storage
  try { localStorage.removeItem('webssh_settings') } catch { /* storage may be disabled */ }
  applyAppTheme(state.appTheme, state.primaryColor)

  const stop = watch(state, current => {
    applyAppTheme(current.appTheme, current.primaryColor)
    if (projecting || !vaultRepository.isReady()) return
    try { vaultRepository.updateSettings(validateSettings({ ...current })) }
    catch {
      // A paused vault cannot accept new edits, restore the existing draft instead of discarding it
      projecting = true
      try { Object.assign(state, vaultRepository.getSnapshot()?.settings || DEFAULT_SETTINGS) }
      finally { projecting = false }
    }
  }, { deep: true, flush: 'sync' })

  const unsubscribe = vaultRepository.subscribe(payload => {
    projecting = true
    try { Object.assign(state, payload?.settings || DEFAULT_SETTINGS) }
    finally { projecting = false }
    applyAppTheme(state.appTheme, state.primaryColor)
  })
  onScopeDispose(() => { stop(); unsubscribe() })

  async function fetchCloudSettings() {
    // Kept for existing callers, settings are decrypted with the complete vault during unlock
    projecting = true
    try { Object.assign(state, vaultRepository.getSnapshot()?.settings || DEFAULT_SETTINGS) }
    finally { projecting = false }
    applyAppTheme(state.appTheme, state.primaryColor)
  }

  function updateSettings(partial: Partial<SettingsState>) {
    const next = validateSettings({ ...state, ...partial })
    vaultRepository.updateSettings(next)
  }

  const saveError = computed(() => vaultRepository.status.error)
  return { ...toRefs(state), state, saveError, fetchCloudSettings, updateSettings }
})
