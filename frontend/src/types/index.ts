// Vault types
export interface CreateVaultRequest {
  authHash: string;
  salt: string;
  kdfAlgo: string;
  kdfParams: KdfParams;
}

export interface UnlockVaultRequest {
  authKeyHash: string;
}

export interface VaultStatus {
  exists: boolean;
  salt?: string;
  kdfAlgo?: string;
  kdfParams?: KdfParams;
}

export interface KdfParams {
  algorithm: 'argon2id' | 'pbkdf2-sha512';
  iterations: number;
  memory?: number;      // KiB, Argon2id only
  parallelism?: number; // Argon2id only
  cipher: 'AES-128-GCM' | 'AES-256-GCM';
  keyLength: 128 | 256;
}

export type KdfAlgorithm = 'argon2id' | 'pbkdf2-sha512';

export interface KdfAlgorithmConfig {
  label: string;
  description: string;
  requiresWasm: boolean;
  presets: Record<EncryptionPreset, EncryptionPresetConfig>;
}

export type EncryptionPreset = 'standard' | 'high' | 'paranoid' | 'custom';

export interface EncryptionPresetConfig {
  label: string;
  description: string;
  params: KdfParams;
}

export const KDF_ALGORITHMS: Record<KdfAlgorithm, KdfAlgorithmConfig> = {
  argon2id: {
    label: 'kdf.argon2id.label',
    description: 'kdf.argon2id.desc',
    requiresWasm: true,
    presets: {
      standard: {
        label: 'kdf.preset.standard',
        description: 'kdf.argon2id.standard',
        params: { algorithm: 'argon2id', iterations: 3, memory: 65536, parallelism: 1, cipher: 'AES-128-GCM', keyLength: 128 },
      },
      high: {
        label: 'kdf.preset.high',
        description: 'kdf.argon2id.high',
        params: { algorithm: 'argon2id', iterations: 5, memory: 131072, parallelism: 1, cipher: 'AES-256-GCM', keyLength: 256 },
      },
      paranoid: {
        label: 'kdf.preset.paranoid',
        description: 'kdf.argon2id.paranoid',
        params: { algorithm: 'argon2id', iterations: 10, memory: 262144, parallelism: 1, cipher: 'AES-256-GCM', keyLength: 256 },
      },
      custom: {
        label: 'kdf.preset.custom',
        description: 'kdf.preset.customDesc',
        params: { algorithm: 'argon2id', iterations: 5, memory: 131072, parallelism: 1, cipher: 'AES-256-GCM', keyLength: 256 },
      },
    },
  },
  'pbkdf2-sha512': {
    label: 'kdf.pbkdf2.label',
    description: 'kdf.pbkdf2.desc',
    requiresWasm: false,
    presets: {
      standard: {
        label: 'kdf.preset.standard',
        description: 'kdf.pbkdf2.standard',
        params: { algorithm: 'pbkdf2-sha512', iterations: 600_000, cipher: 'AES-128-GCM', keyLength: 128 },
      },
      high: {
        label: 'kdf.preset.high',
        description: 'kdf.pbkdf2.high',
        params: { algorithm: 'pbkdf2-sha512', iterations: 1_000_000, cipher: 'AES-256-GCM', keyLength: 256 },
      },
      paranoid: {
        label: 'kdf.preset.paranoid',
        description: 'kdf.pbkdf2.paranoid',
        params: { algorithm: 'pbkdf2-sha512', iterations: 2_000_000, cipher: 'AES-256-GCM', keyLength: 256 },
      },
      custom: {
        label: 'kdf.preset.custom',
        description: 'kdf.preset.customDesc',
        params: { algorithm: 'pbkdf2-sha512', iterations: 1_000_000, cipher: 'AES-256-GCM', keyLength: 256 },
      },
    },
  },
};

// Server types
export interface ServerEntry {
  id: string;
  encryptedData: string;
  iv: string;
}

export interface ServerCredentials {
  name?: string;
  group?: string;
  tags?: string[];
  host: string;
  port: number;
  username: string;
  password: string;
  os?: string;
  expectedHostKey?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateServerRequest {
  encryptedData: string;
  iv: string;
}

export interface UpdateServerRequest {
  encryptedData?: string;
  iv?: string;
}

export interface AuthResponse {
  token: string;
}

export interface RekeyServerEntry {
  id: string;
  encryptedData: string;
  iv: string;
}

export interface RekeyVaultRequest {
  salt: string;
  authHash: string;
  kdfAlgo: string;
  kdfParams: KdfParams;
  servers: RekeyServerEntry[];
}
