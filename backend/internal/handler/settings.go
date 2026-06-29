package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

type SettingsHandler struct {
	DB *sql.DB
}

func NewSettingsHandler(db *sql.DB) *SettingsHandler {
	return &SettingsHandler{DB: db}
}

func (h *SettingsHandler) Get(c *gin.Context) {
	var settingsJSON string
	err := h.DB.QueryRow("SELECT settings_json FROM user_settings WHERE id = 1").Scan(&settingsJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusOK, gin.H{"settings": nil})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取配置失败"})
		return
	}

	c.Data(http.StatusOK, "application/json", []byte(settingsJSON))
}

func (h *SettingsHandler) Update(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的数据"})
		return
	}

	bytes, err := json.Marshal(body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "序列化配置失败"})
		return
	}

	settingsJSON := string(bytes)
	_, err = h.DB.Exec(`
		INSERT INTO user_settings (id, settings_json)
		VALUES (1, ?)
		ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json
	`, settingsJSON)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
