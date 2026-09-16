// Runtime credentials deliberately live outside browser storage and reactive UI state
let token: string | null = null
let generation = 0
let unauthorized: (() => void) | null = null

export const getAuthToken = () => token
export const getAuthGeneration = () => generation
export function setAuthToken(value: string | null) { token = value }
export function invalidateAuthSession() { token = null; return ++generation }
export function onUnauthorized(callback: () => void) { unauthorized = callback }
export function rejectAuthToken(value: string) {
  if (token === value) unauthorized?.()
}
