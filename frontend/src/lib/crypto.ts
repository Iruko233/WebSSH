import { argon2id } from 'hash-wasm'
import type { KdfParams, VaultEnvelope, VaultPayload } from '../types'
import { MAX_VAULT_JSON_BYTES, VAULT_PADDING_BYTES, validateVaultPayload } from './vault-schema'

/** First 32 derived bytes authenticate, the independent last 32 bytes encrypt */
export async function deriveKeys(password: string, salt: Uint8Array, params: KdfParams): Promise<{ authKey: Uint8Array; encKey: Uint8Array }> {
  const allowed = ['algorithm', 'iterations', 'memory', 'parallelism', 'cipher', 'keyLength']
  if (!params || Object.keys(params).some(key => !allowed.includes(key)) || salt.length !== 32 ||
    params.cipher !== 'AES-256-GCM' || params.keyLength !== 256 || !Number.isSafeInteger(params.iterations) || params.iterations < 1) {
    throw new Error('vault.invalidData')
  }
  let masterKey: Uint8Array
  if (params.algorithm === 'argon2id') {
    if (params.iterations > 100 || !Number.isSafeInteger(params.memory) || params.memory! < 1024 || params.memory! > 1048576 ||
      !Number.isSafeInteger(params.parallelism) || params.parallelism! < 1 || params.parallelism! > 16 || params.memory! < 8 * params.parallelism!) throw new Error('vault.invalidData')
    masterKey = await argon2id({
      password, salt, parallelism: params.parallelism!, iterations: params.iterations,
      memorySize: params.memory!, hashLength: 64, outputType: 'binary',
    })
  } else if (params.algorithm === 'pbkdf2-sha512') {
    if (params.iterations > 10000000 || params.memory !== undefined || params.parallelism !== undefined) throw new Error('vault.invalidData')
    const passwordBytes = new TextEncoder().encode(password)
    try {
      const material = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits'])
      masterKey = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: params.iterations, hash: 'SHA-512' }, material, 512,
      ))
    } finally { passwordBytes.fill(0) }
  } else throw new Error('vault.invalidData')
  try { return { authKey: masterKey.slice(0, 32), encKey: masterKey.slice(32, 64) } }
  finally { masterKey.fill(0) }
}

export function generateSalt(): Uint8Array { return crypto.getRandomValues(new Uint8Array(32)) }
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))
}

export function toBase64(data: Uint8Array): string {
  const parts: string[] = []
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    parts.push(String.fromCharCode(...data.subarray(offset, offset + 0x8000)))
  }
  return btoa(parts.join(''))
}

export function fromBase64(value: string): Uint8Array {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('vault.invalidData')
  let binary: string
  try { binary = atob(value) } catch { throw new Error('vault.invalidData') }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

type EnvelopeMetadata = Pick<VaultEnvelope, 'vaultId' | 'formatVersion' | 'keyEpoch' | 'revision'>

function additionalData(metadata: EnvelopeMetadata): Uint8Array {
  if (!metadata || typeof metadata.vaultId !== 'string' || !metadata.vaultId || metadata.vaultId.length > 256 || metadata.formatVersion !== 1 ||
    !Number.isSafeInteger(metadata.keyEpoch) || metadata.keyEpoch < 1 || !Number.isSafeInteger(metadata.revision) || metadata.revision < 1) {
    throw new Error('vault.invalidData')
  }
  return new TextEncoder().encode(JSON.stringify(['webssh-vault', 1, metadata.vaultId, metadata.keyEpoch, metadata.revision]))
}

export async function encryptVaultData(payload: VaultPayload, encKey: CryptoKey, metadata: EnvelopeMetadata): Promise<VaultEnvelope> {
  const aad = additionalData(metadata)
  const json = new TextEncoder().encode(JSON.stringify(validateVaultPayload(payload)))
  if (json.byteLength > MAX_VAULT_JSON_BYTES) { json.fill(0); throw new Error('vault.tooLarge') }
  const paddedLength = Math.max(VAULT_PADDING_BYTES, Math.ceil((4 + json.byteLength) / VAULT_PADDING_BYTES) * VAULT_PADDING_BYTES)
  const plaintext = new Uint8Array(paddedLength)
  new DataView(plaintext.buffer).setUint32(0, json.byteLength, false)
  plaintext.set(json, 4)
  const padding = plaintext.subarray(4 + json.byteLength)
  // getRandomValues has a 65,536-byte per-call limit, padding is at most 4,095 bytes
  crypto.getRandomValues(padding)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  try {
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad as BufferSource, tagLength: 128 }, encKey, plaintext)
    return { ...metadata, iv: toBase64(iv), encryptedData: toBase64(new Uint8Array(encrypted)) }
  } finally { json.fill(0); plaintext.fill(0) }
}

export async function decryptVaultData(envelope: VaultEnvelope, encKey: CryptoKey): Promise<VaultPayload> {
  const aad = additionalData(envelope)
  const maxCipherBytes = MAX_VAULT_JSON_BYTES + VAULT_PADDING_BYTES + 16
  if (typeof envelope.iv !== 'string' || envelope.iv.length !== 16 || typeof envelope.encryptedData !== 'string' ||
    envelope.encryptedData.length > Math.ceil(maxCipherBytes / 3) * 4) throw new Error('vault.invalidData')
  const iv = fromBase64(envelope.iv)
  const encrypted = fromBase64(envelope.encryptedData)
  if (iv.length !== 12 || encrypted.length < VAULT_PADDING_BYTES + 16 || (encrypted.length - 16) % VAULT_PADDING_BYTES !== 0) throw new Error('vault.invalidData')
  let plaintext: Uint8Array
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource, tagLength: 128 }, encKey, encrypted as BufferSource))
  } catch { throw new Error('vault.invalidData') }
  try {
    const jsonLength = new DataView(plaintext.buffer).getUint32(0, false)
    if (!jsonLength || jsonLength > MAX_VAULT_JSON_BYTES || jsonLength > plaintext.length - 4 || plaintext.length - 4 - jsonLength >= VAULT_PADDING_BYTES) throw new Error('vault.invalidData')
    return validateVaultPayload(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext.subarray(4, 4 + jsonLength))))
  } catch { throw new Error('vault.invalidData') }
  finally { plaintext.fill(0) }
}
