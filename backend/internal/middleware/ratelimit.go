package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type rateLimiter struct {
	mu      sync.Mutex
	clients map[string][]time.Time
}

var rl = &rateLimiter{
	clients: make(map[string][]time.Time),
}

func RateLimit(maxRequests int, perMinute int) gin.HandlerFunc {
	return func(c *gin.Context) {
		rl.mu.Lock()
		defer rl.mu.Unlock()

		ip := c.ClientIP()
		now := time.Now()
		windowStart := now.Add(-time.Duration(perMinute) * time.Minute)

		// Clean old entries
		var recent []time.Time
		for _, t := range rl.clients[ip] {
			if t.After(windowStart) {
				recent = append(recent, t)
			}
		}
		rl.clients[ip] = recent

		if len(recent) >= maxRequests {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "请求过于频繁，请稍后再试",
			})
			return
		}

		rl.clients[ip] = append(rl.clients[ip], now)
		c.Next()
	}
}
