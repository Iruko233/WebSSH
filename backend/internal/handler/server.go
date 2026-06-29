package handler

import (
	"database/sql"
	"net/http"

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
	rows, err := h.db.Query("SELECT id, encrypted_data, iv FROM servers")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询服务器列表失败"})
		return
	}
	defer rows.Close()

	servers := make([]model.Server, 0)
	for rows.Next() {
		var s model.Server
		if err := rows.Scan(&s.ID, &s.EncryptedData, &s.IV); err != nil {
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

	_, err := h.db.Exec(
		"INSERT INTO servers (id, encrypted_data, iv) VALUES (?, ?, ?)",
		id, req.EncryptedData, req.IV,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "添加服务器失败"})
		return
	}

	c.JSON(http.StatusOK, model.Server{
		ID:            id,
		EncryptedData: req.EncryptedData,
		IV:            req.IV,
	})
}

func (h *ServerHandler) Update(c *gin.Context) {
	id := c.Param("id")

	var req model.UpdateServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
		return
	}

	if req.EncryptedData != "" && req.IV != "" {
		_, err := h.db.Exec(
			"UPDATE servers SET encrypted_data = ?, iv = ? WHERE id = ?",
			req.EncryptedData, req.IV, id,
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
	err := h.db.QueryRow("SELECT id, encrypted_data, iv FROM servers WHERE id = ?", id).
		Scan(&s.ID, &s.EncryptedData, &s.IV)
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
