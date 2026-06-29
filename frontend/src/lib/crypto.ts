import { argon2id } from 'hash-wasm';
import type { KdfParams, ServerCredentials } from '../types';

/**
 * Derive master key from password.
 * Supports Argon2id (via hash-wasm WASM) and PBKDF2-SHA512 (via Web Crypto).
 * Returns 64 bytes: first 32 = authKey, last 32 = encKey.
 */
export async function deriveKeys(
  password: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<{ authKey: Uint8Array; encKey: Uint8Array }> {
  let masterKey: Uint8Array;

  if (params.algorithm === 'argon2id') {
    // Argon2id via hash-wasm
    const result = await argon2id({
      password,
      salt,
      parallelism: params.parallelism || 1,
      iterations: params.iterations,
      memorySize: params.memory || 65536, // KB
      hashLength: 64, // 64 bytes output
      outputType: 'binary',
    });
    masterKey = result;
  } else {
    // PBKDF2-SHA512 via Web Crypto
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: params.iterations, hash: 'SHA-512' },
      keyMaterial, 512,
    );
    masterKey = new Uint8Array(bits);
  }

  return {
    authKey: masterKey.slice(0, 32),
    encKey: masterKey.slice(32, 64),
  };
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}


export async function encryptServerData(
  credentials: ServerCredentials, encKey: CryptoKey,
): Promise<{ encryptedData: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = JSON.stringify(credentials);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, encKey, new TextEncoder().encode(plaintext),
  );
  return {
    encryptedData: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

export async function decryptServerData(
  encryptedData: string, iv: string, encKey: CryptoKey,
): Promise<ServerCredentials> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(atob(iv), (c) => c.charCodeAt(0)) },
    encKey,
    Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0)),
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function toBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}
