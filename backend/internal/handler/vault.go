package handler

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"webssh-backend/internal/auth"
	"webssh-backend/internal/database"
	"webssh-backend/internal/middleware"
	"webssh-backend/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const maxVaultBody = 12 * 1024 * 1024
const maxSafeInteger int64 = 9007199254740991

var errCredentials = errors.New("invalid credentials")

type VaultHandler struct {
	db   *database.Store
	auth *auth.Manager
}

func NewVaultHandler(db *database.Store, manager *auth.Manager) *VaultHandler {
	return &VaultHandler{db: db, auth: manager}
}

func vaultError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, auth.ErrUnauthorized):
		c.JSON(http.StatusUnauthorized, gin.H{"code": "unauthorized", "error": "Session is invalid or expired"})
	case errors.Is(err, errCredentials):
		c.JSON(http.StatusUnauthorized, gin.H{"code": "invalid_credentials", "error": "Incorrect master password"})
	case errors.Is(err, auth.ErrConflict):
		c.JSON(http.StatusConflict, gin.H{"code": "vault_conflict", "error": "Vault has changed, reload and confirm your changes"})
	case errors.Is(err, auth.ErrExists):
		c.JSON(http.StatusConflict, gin.H{"code": "vault_exists", "error": "Vault already exists"})
	case errors.Is(err, sql.ErrNoRows):
		c.JSON(http.StatusNotFound, gin.H{"code": "vault_not_found", "error": "Vault has not been created"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"code": "internal_error", "error": "Vault operation failed"})
	}
}
func invalid(c *gin.Context, code string) {
	c.JSON(http.StatusBadRequest, gin.H{"code": code, "error": "Invalid vault request"})
}
func readRequest(c *gin.Context, target any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxVaultBody)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		invalid(c, "invalid_request")
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		invalid(c, "invalid_request")
		return false
	}
	return true
}
func decodeDigest(value string) ([]byte, error) {
	decoded, err := base64.StdEncoding.Strict().DecodeString(value)
	if err != nil || len(decoded) != 32 {
		return nil, errCredentials
	}
	return decoded, nil
}

func validEnvelope(e model.VaultEnvelope) bool {
	id, err := uuid.Parse(e.VaultID)
	if err != nil || id.String() != e.VaultID || e.FormatVersion != 1 || e.KeyEpoch < 1 || e.Revision < 1 || e.KeyEpoch > maxSafeInteger || e.Revision > maxSafeInteger {
		return false
	}
	iv, err := base64.StdEncoding.Strict().DecodeString(e.IV)
	if err != nil || len(iv) != 12 {
		return false
	}
	data, err := base64.StdEncoding.Strict().DecodeString(e.EncryptedData)
	return err == nil && len(data) >= 4096+16 && len(data) <= 8*1024*1024+4096+16 && (len(data)-16)%4096 == 0
}

func validConfig(req model.CreateVaultRequest) bool {
	salt, err := base64.StdEncoding.Strict().DecodeString(req.Salt)
	if err != nil || len(salt) != 32 || len(req.KdfParams) > 2048 {
		return false
	}
	var params struct {
		Algorithm   string `json:"algorithm"`
		Iterations  int    `json:"iterations"`
		Memory      int    `json:"memory,omitempty"`
		Parallelism int    `json:"parallelism,omitempty"`
		Cipher      string `json:"cipher"`
		KeyLength   int    `json:"keyLength"`
	}
	decoder := json.NewDecoder(bytes.NewReader(req.KdfParams))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&params) != nil || params.Algorithm != req.KdfAlgo || params.Cipher != "AES-256-GCM" || params.KeyLength != 256 {
		return false
	}
	switch params.Algorithm {
	case "argon2id":
		return params.Iterations >= 1 && params.Iterations <= 100 && params.Memory >= 1024 && params.Memory <= 1048576 && params.Parallelism >= 1 && params.Parallelism <= 16 && params.Memory >= 8*params.Parallelism
	case "pbkdf2-sha512":
		return params.Iterations >= 1 && params.Iterations <= 10000000 && params.Memory == 0 && params.Parallelism == 0
	default:
		return false
	}
}

func (h *VaultHandler) Status(c *gin.Context) {
	var result model.VaultStatusResponse
	var params string
	err := h.db.QueryRowContext(c.Request.Context(), `SELECT vault_id,format_version,key_epoch,salt,kdf_algo,kdf_params FROM vault WHERE id=1`).Scan(&result.VaultID, &result.FormatVersion, &result.KeyEpoch, &result.Salt, &result.KdfAlgo, &params)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, model.VaultStatusResponse{Exists: false})
		return
	}
	if err != nil {
		vaultError(c, err)
		return
	}
	result.Exists = true
	result.KdfParams = json.RawMessage(params)
	c.JSON(http.StatusOK, result)
}

func (h *VaultHandler) Create(c *gin.Context) {
	var req model.CreateVaultRequest
	if !readRequest(c, &req) {
		return
	}
	if !validEnvelope(req.VaultEnvelope) || req.KeyEpoch != 1 || req.Revision != 1 {
		invalid(c, "invalid_envelope")
		return
	}
	if !validConfig(req) {
		invalid(c, "invalid_kdf")
		return
	}
	digest, err := decodeDigest(req.AuthHash)
	if err != nil {
		invalid(c, "invalid_request")
		return
	}
	defer clear(digest)
	hash, err := bcrypt.GenerateFromPassword(digest, bcrypt.DefaultCost)
	if err != nil {
		vaultError(c, err)
		return
	}
	response, err := h.auth.Create(req.VaultID, func() error {
		_, err := h.db.ExecContext(c.Request.Context(), `INSERT INTO vault(id,vault_id,format_version,key_epoch,revision,salt,auth_hash,kdf_algo,kdf_params,iv,encrypted_data) VALUES(1,?,?,?,?,?,?,?,?,?,?)`, req.VaultID, req.FormatVersion, req.KeyEpoch, req.Revision, req.Salt, string(hash), req.KdfAlgo, string(req.KdfParams), req.IV, req.EncryptedData)
		if err == nil {
			h.db.Written()
		}
		return err
	})
	if err != nil {
		vaultError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}

func (h *VaultHandler) Unlock(c *gin.Context) {
	var req model.UnlockVaultRequest
	if !readRequest(c, &req) {
		return
	}
	digest, err := decodeDigest(req.AuthKeyHash)
	if err != nil {
		invalid(c, "invalid_request")
		return
	}
	defer clear(digest)
	var stored string
	var id string
	var epoch int64
	err = h.db.QueryRowContext(c.Request.Context(), `SELECT auth_hash,vault_id,key_epoch FROM vault WHERE id=1`).Scan(&stored, &id, &epoch)
	if err != nil {
		vaultError(c, err)
		return
	}
	if id != req.VaultID || epoch != req.KeyEpoch {
		vaultError(c, auth.ErrConflict)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(stored), digest) != nil {
		vaultError(c, errCredentials)
		return
	}
	response, err := h.auth.Unlock(req.VaultID, req.KeyEpoch, func() error {
		var current string
		var currentID string
		var currentEpoch int64
		if err := h.db.QueryRowContext(c.Request.Context(), `SELECT auth_hash,vault_id,key_epoch FROM vault WHERE id=1`).Scan(&current, &currentID, &currentEpoch); err != nil {
			return err
		}
		if current != stored || currentID != req.VaultID || currentEpoch != req.KeyEpoch {
			return auth.ErrConflict
		}
		return nil
	})
	if err != nil {
		vaultError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}

func scanEnvelope(row *sql.Row, envelope *model.VaultEnvelope) error {
	return row.Scan(&envelope.VaultID, &envelope.FormatVersion, &envelope.KeyEpoch, &envelope.Revision, &envelope.IV, &envelope.EncryptedData)
}

func (h *VaultHandler) Get(c *gin.Context) {
	var envelope model.VaultEnvelope
	err := h.auth.Do(middleware.Claims(c), func() error {
		return scanEnvelope(h.db.QueryRowContext(c.Request.Context(), `SELECT vault_id,format_version,key_epoch,revision,iv,encrypted_data FROM vault WHERE id=1`), &envelope)
	})
	if err != nil {
		vaultError(c, err)
		return
	}
	c.JSON(http.StatusOK, envelope)
}

// Acquire a database write lock before inspecting state, as well as the manager's authorization lock
func (h *VaultHandler) beginWrite(ctx context.Context) (*sql.Tx, error) {
	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE vault SET id=id WHERE id=1"); err != nil {
		tx.Rollback()
		return nil, err
	}
	return tx, nil
}

func (h *VaultHandler) Update(c *gin.Context) {
	var req model.UpdateVaultRequest
	if !readRequest(c, &req) {
		return
	}
	if !validEnvelope(req.VaultEnvelope) || req.ExpectedRevision < 1 || req.ExpectedRevision >= maxSafeInteger || req.Revision != req.ExpectedRevision+1 || req.KeyEpoch != req.ExpectedKeyEpoch {
		invalid(c, "invalid_envelope")
		return
	}
	claims := middleware.Claims(c)
	err := h.auth.Do(claims, func() error {
		tx, err := h.beginWrite(c.Request.Context())
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if !time.Now().Before(claims.ExpiresAt.Time) {
			return auth.ErrUnauthorized
		}
		var id string
		var epoch, revision int64
		if err := tx.QueryRowContext(c.Request.Context(), `SELECT vault_id,key_epoch,revision FROM vault WHERE id=1`).Scan(&id, &epoch, &revision); err != nil {
			return err
		}
		if id != req.VaultID || id != claims.VaultID || epoch != req.ExpectedKeyEpoch || epoch != claims.KeyEpoch || revision != req.ExpectedRevision {
			return auth.ErrConflict
		}
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE vault SET revision=?,iv=?,encrypted_data=? WHERE id=1`, req.Revision, req.IV, req.EncryptedData); err != nil {
			return err
		}
		if !time.Now().Before(claims.ExpiresAt.Time) {
			return auth.ErrUnauthorized
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		h.db.Written()
		return nil
	})
	if err != nil {
		vaultError(c, err)
		return
	}
	c.JSON(http.StatusOK, req.VaultEnvelope)
}

func (h *VaultHandler) Rekey(c *gin.Context) {
	var req model.RekeyVaultRequest
	if !readRequest(c, &req) {
		return
	}
	if !validEnvelope(req.VaultEnvelope) || req.ExpectedRevision < 1 || req.ExpectedRevision >= maxSafeInteger || req.ExpectedKeyEpoch < 1 || req.ExpectedKeyEpoch >= maxSafeInteger || req.Revision != req.ExpectedRevision+1 || req.KeyEpoch != req.ExpectedKeyEpoch+1 {
		invalid(c, "invalid_envelope")
		return
	}
	if !validConfig(req.CreateVaultRequest) {
		invalid(c, "invalid_kdf")
		return
	}
	current, err := decodeDigest(req.CurrentAuthKeyHash)
	if err != nil {
		invalid(c, "invalid_request")
		return
	}
	defer clear(current)
	next, err := decodeDigest(req.AuthHash)
	if err != nil {
		invalid(c, "invalid_request")
		return
	}
	defer clear(next)
	hash, err := bcrypt.GenerateFromPassword(next, bcrypt.DefaultCost)
	if err != nil {
		vaultError(c, err)
		return
	}
	claims := middleware.Claims(c)
	response, err := h.auth.Rekey(claims, req.KeyEpoch, func() error {
		tx, err := h.beginWrite(c.Request.Context())
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if !time.Now().Before(claims.ExpiresAt.Time) {
			return auth.ErrUnauthorized
		}
		var stored, id string
		var epoch, revision int64
		if err := tx.QueryRowContext(c.Request.Context(), `SELECT auth_hash,vault_id,key_epoch,revision FROM vault WHERE id=1`).Scan(&stored, &id, &epoch, &revision); err != nil {
			return err
		}
		if id != req.VaultID || id != claims.VaultID || epoch != req.ExpectedKeyEpoch || epoch != claims.KeyEpoch || revision != req.ExpectedRevision {
			return auth.ErrConflict
		}
		if bcrypt.CompareHashAndPassword([]byte(stored), current) != nil {
			return errCredentials
		}
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE vault SET key_epoch=?,revision=?,salt=?,auth_hash=?,kdf_algo=?,kdf_params=?,iv=?,encrypted_data=? WHERE id=1`, req.KeyEpoch, req.Revision, req.Salt, string(hash), req.KdfAlgo, string(req.KdfParams), req.IV, req.EncryptedData); err != nil {
			return err
		}
		if !time.Now().Before(claims.ExpiresAt.Time) {
			return auth.ErrUnauthorized
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		h.db.Written()
		return nil
	})
	if err != nil {
		vaultError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}

func (h *VaultHandler) Session(c *gin.Context) {
	claims := middleware.Claims(c)
	if err := h.auth.Do(claims, func() error { return nil }); err != nil {
		vaultError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"vaultId": claims.VaultID, "keyEpoch": claims.KeyEpoch, "expiresAt": claims.ExpiresAt.Unix(), "cleanupPending": h.db.CleanupPending()})
}
func (h *VaultHandler) Logout(c *gin.Context) {
	h.auth.Revoke(middleware.Claims(c))
	c.Status(http.StatusNoContent)
}
