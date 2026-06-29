package handler

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"net/http"
	"time"

	"webssh-backend/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type VaultHandler struct {
	db *sql.DB
}

func NewVaultHandler(db *sql.DB) *VaultHandler {
	return &VaultHandler{db: db}
}

func (h *VaultHandler) Status(c *gin.Context) {
	var cfg model.VaultConfig
	err := h.db.QueryRow("SELECT id, salt, kdf_algo, kdf_params FROM vault_config WHERE id = 1").
		Scan(&cfg.ID, &cfg.Salt, &cfg.KdfAlgo, &cfg.KdfParams)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, model.VaultStatusResponse{Exists: false})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询 Vault 状态失败"})
		return
	}

	c.JSON(http.StatusOK, model.VaultStatusResponse{
		Exists:    true,
		Salt:      cfg.Salt,
		KdfAlgo:   cfg.KdfAlgo,
		KdfParams: cfg.KdfParamsRaw(),
	})
}

func (h *VaultHandler) Create(c *gin.Context) {
	// Check if vault already exists
	var count int
	h.db.QueryRow("SELECT COUNT(*) FROM vault_config").Scan(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Vault 已存在"})
		return
	}

	var req model.CreateVaultRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	// Decode authHash (base64 encoded SHA256(authKey))
	authHashBytes, err := base64.StdEncoding.DecodeString(req.AuthHash)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "authHash 格式无效"})
		return
	}

	// bcrypt the authHash
	hashedAuth, err := bcrypt.GenerateFromPassword(authHashBytes, bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加密失败"})
		return
	}

	// Generate JWT secret
	jwtSecret := make([]byte, 32)
	if _, err := rand.Read(jwtSecret); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成密钥失败"})
		return
	}

	_, err = h.db.Exec(
		"INSERT INTO vault_config (id, salt, auth_hash, jwt_secret, kdf_algo, kdf_params) VALUES (1, ?, ?, ?, ?, ?)",
		req.Salt, string(hashedAuth), base64.StdEncoding.EncodeToString(jwtSecret), req.KdfAlgo, string(req.KdfParams),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建 Vault 失败"})
		return
	}

	// Issue JWT
	token, err := h.issueJWT(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 token 失败"})
		return
	}

	c.JSON(http.StatusOK, model.AuthResponse{Token: token})
}

func (h *VaultHandler) Unlock(c *gin.Context) {
	var req model.UnlockVaultRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	// Get stored auth hash and JWT secret
	var authHashStr, jwtSecretStr string
	err := h.db.QueryRow("SELECT auth_hash, jwt_secret FROM vault_config WHERE id = 1").
		Scan(&authHashStr, &jwtSecretStr)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vault 尚未创建"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询 Vault 失败"})
		return
	}

	// Decode the received authKeyHash
	authKeyHash, err := base64.StdEncoding.DecodeString(req.AuthKeyHash)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "authKeyHash 格式无效"})
		return
	}

	// bcrypt compare
	if err := bcrypt.CompareHashAndPassword([]byte(authHashStr), authKeyHash); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "密码错误"})
		return
	}

	// Issue JWT
	jwtSecret, _ := base64.StdEncoding.DecodeString(jwtSecretStr)
	token, err := h.issueJWT(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 token 失败"})
		return
	}

	c.JSON(http.StatusOK, model.AuthResponse{Token: token})
}

func (h *VaultHandler) issueJWT(secret []byte) (string, error) {
	claims := jwt.MapClaims{
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}

func (h *VaultHandler) Rekey(c *gin.Context) {
	var req model.RekeyVaultRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	authHashBytes, err := base64.StdEncoding.DecodeString(req.AuthHash)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "authHash 格式无效"})
		return
	}

	hashedAuth, err := bcrypt.GenerateFromPassword(authHashBytes, bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加密失败"})
		return
	}

	jwtSecret := make([]byte, 32)
	if _, err := rand.Read(jwtSecret); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成密钥失败"})
		return
	}
	jwtSecretB64 := base64.StdEncoding.EncodeToString(jwtSecret)

	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "无法开启事务"})
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec(
		"UPDATE vault_config SET salt = ?, auth_hash = ?, jwt_secret = ?, kdf_algo = ?, kdf_params = ? WHERE id = 1",
		req.Salt, string(hashedAuth), jwtSecretB64, req.KdfAlgo, string(req.KdfParams),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新 Vault 配置失败"})
		return
	}

	now := time.Now().Format(time.RFC3339)
	for _, srv := range req.Servers {
		_, err = tx.Exec(
			"UPDATE servers SET encrypted_data = ?, iv = ?, updated_at = ? WHERE id = ?",
			srv.EncryptedData, srv.IV, now, srv.ID,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "批量更新服务器失败"})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "提交事务失败"})
		return
	}

	token, err := h.issueJWT(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 token 失败"})
		return
	}

	c.JSON(http.StatusOK, model.AuthResponse{Token: token})
}
