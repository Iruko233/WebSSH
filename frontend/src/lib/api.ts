import { getAuthToken, rejectAuthToken } from './auth-session'
import type { AuthResponse, CreateVaultRequest, RekeyVaultRequest, UnlockVaultRequest, VaultStatus, VaultEnvelope, SaveVaultRequest } from '../types'
import { i18n } from '../i18n'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}
export interface SessionStatus { vaultId: string; keyEpoch: number; expiresAt: number; cleanupPending: boolean }

async function request<T>(path: string, options: RequestInit = {}, overrideToken?: string | null): Promise<T> {
  const token = overrideToken === undefined ? getAuthToken() : overrideToken
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(`/api${path}`, { ...options, cache: 'no-store', headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const code = typeof body.code === 'string' ? body.code : 'REQUEST_FAILED'
    if (res.status === 401 && token && path !== '/vault/logout' && code !== 'invalid_credentials') rejectAuthToken(token)
    const key = `vault.api.${code}`
    const message = i18n.global.te(key) ? i18n.global.t(key) : (body.error || `HTTP ${res.status}`)
    throw new ApiError(res.status, code, message)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  getVaultStatus: () => request<VaultStatus>('/vault/status', {}, null),
  createVault: (data: CreateVaultRequest) => request<AuthResponse>('/vault/create', { method: 'POST', body: JSON.stringify(data) }, null),
  unlockVault: (data: UnlockVaultRequest) => request<AuthResponse>('/vault/unlock', { method: 'POST', body: JSON.stringify(data) }, null),
  getVault: (token?: string) => request<VaultEnvelope>('/vault', {}, token),
  saveVault: (data: SaveVaultRequest) => request<VaultEnvelope>('/vault', { method: 'PUT', body: JSON.stringify(data) }),
  rekeyVault: (data: RekeyVaultRequest) => request<AuthResponse>('/vault/rekey', { method: 'POST', body: JSON.stringify(data) }),
  getSession: (token?: string) => request<SessionStatus>('/vault/session', {}, token),
  logout: (token: string) => request<void>('/vault/logout', { method: 'POST' }, token),
}
