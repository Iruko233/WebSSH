import type { SettingsState, VaultPayload, VaultServer } from '../types'
import { THEMES } from './themes'

export const MAX_VAULT_JSON_BYTES = 8 * 1024 * 1024
export const VAULT_PADDING_BYTES = 4096

export const DEFAULT_SETTINGS: Readonly<SettingsState> = Object.freeze({
  fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
  fontSize: 15, theme: 'dracula', keywordHighlight: true,
  kwError: true, kwWarning: true, kwOk: true, kwInfo: true, kwDebug: true, kwIpMac: true,
  appTheme: 'auto', primaryColor: '#64748b', sftpLayout: 'right',
  autoOpenMonitor: false, autoOpenCommandBar: false, monitorInterval: 1, encryptHandshake: true,
})

function invalid(): never { throw new Error('vault.invalidData') }

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalid()
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required = allowed) {
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid()
}

function string(value: unknown, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && !value.trim()) || value.length > MAX_VAULT_JSON_BYTES) invalid()
  return value
}

export function validateSettings(value: unknown): SettingsState {
  const input = object(value)
  exactKeys(input, Object.keys(DEFAULT_SETTINGS))
  const settings = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SettingsState)[]) {
    const item = input[key]
    if (typeof item !== typeof DEFAULT_SETTINGS[key]) invalid()
    Object.assign(settings, { [key]: item })
  }
  if (!Number.isInteger(settings.fontSize) || settings.fontSize < 10 || settings.fontSize > 24) invalid()
  if (![0.5, 1, 2, 5].includes(settings.monitorInterval)) invalid()
  if (!['auto', 'light', 'dark'].includes(settings.appTheme) || !['right', 'bottom'].includes(settings.sftpLayout)) invalid()
  if (!/^#[0-9a-f]{6}$/i.test(settings.primaryColor) || !Object.hasOwn(THEMES, settings.theme)) invalid()
  if (!settings.fontFamily.trim() || settings.fontFamily.length > 512) invalid()
  return settings
}

const SERVER_KEYS = ['id', 'host', 'port', 'username', 'password', 'name', 'group', 'tags', 'os', 'expectedHostKey', 'createdAt', 'updatedAt'] as const
const REQUIRED_SERVER_KEYS = ['id', 'host', 'port', 'username', 'password'] as const

export function validateVaultServer(value: unknown): VaultServer {
  const input = object(value)
  exactKeys(input, SERVER_KEYS, REQUIRED_SERVER_KEYS)
  const server: VaultServer = {
    id: string(input.id, true), host: string(input.host, true),
    port: input.port as number, username: string(input.username, true), password: string(input.password),
  }
  if (server.id.length > 256 || !Number.isInteger(server.port) || server.port < 1 || server.port > 65535) invalid()
  for (const key of ['name', 'group', 'os', 'expectedHostKey', 'createdAt', 'updatedAt'] as const) {
    if (input[key] !== undefined) server[key] = string(input[key])
  }
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) invalid()
    server.tags = input.tags.map(tag => string(tag))
  }
  for (const key of ['createdAt', 'updatedAt'] as const) {
    if (server[key] !== undefined && !Number.isFinite(Date.parse(server[key]!))) invalid()
  }
  return server
}

/** Reject unknown fields instead of retaining plaintext-era or future settings accidentally */
export function validateVaultPayload(value: unknown): VaultPayload {
  const input = object(value)
  exactKeys(input, ['payloadVersion', 'servers', 'settings'])
  if (input.payloadVersion !== 1 || !Array.isArray(input.servers)) invalid()
  const servers = input.servers.map(validateVaultServer)
  if (new Set(servers.map(server => server.id)).size !== servers.length) invalid()
  return { payloadVersion: 1, servers, settings: validateSettings(input.settings) }
}

export function createEmptyVaultPayload(): VaultPayload {
  return { payloadVersion: 1, servers: [], settings: { ...DEFAULT_SETTINGS } }
}

export function cloneVaultPayload(payload: VaultPayload): VaultPayload {
  return validateVaultPayload(payload)
}
