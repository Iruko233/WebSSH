package handler

import (
	"database/sql"
	"net/http"
	"time"

	"webssh-backend/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type ServerHandler struct {
	db *sql.DB
}

func NewServerHandler(db *sql.DB) *ServerHandler {
	return &ServerHandler{db: db}
}

func (h *ServerHandler) List(c *gin.Context) {
	rows, err := h.db.Query("SELECT id, encrypted_data, iv, created_at, updated_at FROM servers ORDER BY created_at DESC")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询服务器列表失败"})
		return
	}
	defer rows.Close()

	servers := make([]model.Server, 0)
	for rows.Next() {
		var s model.Server
		if err := rows.Scan(&s.ID, &s.EncryptedData, &s.IV, &s.CreatedAt, &s.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "读取服务器数据失败"})
			return
		}
		servers = append(servers, s)
	}

	c.JSON(http.StatusOK, servers)
}

func (h *ServerHandler) Create(c *gin.Context) {
	var req model.CreateServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	id := uuid.New().String()
	now := time.Now().Format(time.RFC3339)

	_, err := h.db.Exec(
		"INSERT INTO servers (id, encrypted_data, iv, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		id, req.EncryptedData, req.IV, now, now,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "添加服务器失败"})
		return
	}

	c.JSON(http.StatusOK, model.Server{
		ID:            id,
		EncryptedData: req.EncryptedData,
		IV:            req.IV,
		CreatedAt:     now,
		UpdatedAt:     now,
	})
}

func (h *ServerHandler) Update(c *gin.Context) {
	id := c.Param("id")

	var req model.UpdateServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	// Build dynamic update
	now := time.Now().Format(time.RFC3339)
	if req.EncryptedData != "" && req.IV != "" {
		_, err := h.db.Exec(
			"UPDATE servers SET encrypted_data = ?, iv = ?, updated_at = ? WHERE id = ?",
			req.EncryptedData, req.IV, now, id,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "更新服务器失败"})
			return
		}
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "没有提供要更新的字段"})
		return
	}

	// Return updated server
	var s model.Server
	err := h.db.QueryRow("SELECT id, encrypted_data, iv, created_at, updated_at FROM servers WHERE id = ?", id).
		Scan(&s.ID, &s.EncryptedData, &s.IV, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务器不存在"})
		return
	}

	c.JSON(http.StatusOK, s)
}

func (h *ServerHandler) Delete(c *gin.Context) {
	id := c.Param("id")

	result, err := h.db.Exec("DELETE FROM servers WHERE id = ?", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除服务器失败"})
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务器不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
