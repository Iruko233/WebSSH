package middleware

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"webssh-backend/internal/auth"
)

func JWTAuth(manager *auth.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authentication required", "code": "unauthorized"})
			return
		}
		claims, err := manager.Validate(strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Session is invalid or expired", "code": "unauthorized"})
			return
		}
		c.Set("vaultClaims", claims)
		c.Next()
	}
}

func Claims(c *gin.Context) *auth.Claims {
	value, ok := c.Get("vaultClaims")
	if !ok {
		return nil
	}
	claims, _ := value.(*auth.Claims)
	return claims
}
