package model

import "encoding/json"

type VaultConfig struct {
	ID        int    `json:"id"`
	Salt      string `json:"salt"`
	AuthHash  string `json:"-"`
	JWTSecret string `json:"-"`
	KdfAlgo   string `json:"kdfAlgo"`
	KdfParams string `json:"-"` // stored as JSON string in DB
	CreatedAt string `json:"createdAt"`
}

// KdfParamsRaw returns the KDF params as raw JSON for API responses.
func (c *VaultConfig) KdfParamsRaw() json.RawMessage {
	if c.KdfParams == "" {
		return nil
	}
	return json.RawMessage(c.KdfParams)
}

type VaultStatusResponse struct {
	Exists    bool            `json:"exists"`
	Salt      string          `json:"salt,omitempty"`
	KdfAlgo   string          `json:"kdfAlgo,omitempty"`
	KdfParams json.RawMessage `json:"kdfParams,omitempty"`
}

type CreateVaultRequest struct {
	Salt      string          `json:"salt" binding:"required"`
	AuthHash  string          `json:"authHash" binding:"required"`
	KdfAlgo   string          `json:"kdfAlgo" binding:"required"`
	KdfParams json.RawMessage `json:"kdfParams" binding:"required"`
}

type UnlockVaultRequest struct {
	AuthKeyHash string `json:"authKeyHash" binding:"required"`
}

type AuthResponse struct {
	Token string `json:"token"`
}

type RekeyServerEntry struct {
	ID            string `json:"id" binding:"required"`
	EncryptedData string `json:"encryptedData" binding:"required"`
	IV            string `json:"iv" binding:"required"`
}

type RekeyVaultRequest struct {
	Salt      string             `json:"salt" binding:"required"`
	AuthHash  string             `json:"authHash" binding:"required"`
	KdfAlgo   string             `json:"kdfAlgo" binding:"required"`
	KdfParams json.RawMessage    `json:"kdfParams" binding:"required"`
	Servers   []RekeyServerEntry `json:"servers"`
}
