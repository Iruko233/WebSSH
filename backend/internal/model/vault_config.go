package model

import "encoding/json"

// VaultEnvelope is opaque to the server, all business data is encrypted by the browser
type VaultEnvelope struct {
	VaultID       string `json:"vaultId"`
	FormatVersion int    `json:"formatVersion"`
	KeyEpoch      int64  `json:"keyEpoch"`
	Revision      int64  `json:"revision"`
	IV            string `json:"iv"`
	EncryptedData string `json:"encryptedData"`
}
type VaultStatusResponse struct {
	Exists        bool            `json:"exists"`
	Salt          string          `json:"salt,omitempty"`
	KdfAlgo       string          `json:"kdfAlgo,omitempty"`
	KdfParams     json.RawMessage `json:"kdfParams,omitempty"`
	VaultID       string          `json:"vaultId,omitempty"`
	FormatVersion int             `json:"formatVersion,omitempty"`
	KeyEpoch      int64           `json:"keyEpoch,omitempty"`
}
type CreateVaultRequest struct {
	VaultEnvelope
	Salt      string          `json:"salt"`
	AuthHash  string          `json:"authHash"`
	KdfAlgo   string          `json:"kdfAlgo"`
	KdfParams json.RawMessage `json:"kdfParams"`
}
type UnlockVaultRequest struct {
	AuthKeyHash string `json:"authKeyHash"`
	VaultID     string `json:"vaultId"`
	KeyEpoch    int64  `json:"keyEpoch"`
}
type AuthResponse struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expiresAt"`
	VaultID   string `json:"vaultId"`
	KeyEpoch  int64  `json:"keyEpoch"`
}
type UpdateVaultRequest struct {
	VaultEnvelope
	ExpectedRevision int64 `json:"expectedRevision"`
	ExpectedKeyEpoch int64 `json:"expectedKeyEpoch"`
}
type RekeyVaultRequest struct {
	CreateVaultRequest
	CurrentAuthKeyHash string `json:"currentAuthKeyHash"`
	ExpectedRevision   int64  `json:"expectedRevision"`
	ExpectedKeyEpoch   int64  `json:"expectedKeyEpoch"`
}
