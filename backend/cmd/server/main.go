package main

import (
	"flag"
	"log"
	"net/http"
	"path"
	"strings"

	"webssh-backend/internal/database"
	"webssh-backend/internal/handler"
	"webssh-backend/internal/middleware"
	"webssh-backend/internal/staticfs"

	"github.com/gin-gonic/gin"
)

func main() {
	port := flag.String("port", "8022", "Port to listen on")
	allowPrivateIPs := flag.Bool("allow-private-ips", false, "Disable SSRF protection and allow connections to private IP addresses")
	flag.Parse()

	// Initialize database
	db, err := database.Init("data/webssh.db")
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Setup frontend filesystem (embedded or disk)
	spaFS := staticfs.FS(
		"static",                // same directory as binary
		"../frontend/dist",      // dev: from backend/
		"../../frontend/dist",   // dev: from backend/cmd/server/
	)
	indexHTML := staticfs.ReadIndexHTML(spaFS)

	// Setup Gin
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// CORS
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", c.GetHeader("Origin"))
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Header("Access-Control-Allow-Credentials", "true")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// CSP
	r.Use(func(c *gin.Context) {
		c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' ws: wss: https://api.iconify.design https://api.unisvg.com https://api.simplesvg.com https://api.github.com")
		c.Next()
	})

	// Initialize handlers
	vaultHandler := handler.NewVaultHandler(db)
	serverHandler := handler.NewServerHandler(db)
	tcpProxyHandler := handler.NewTCPProxyHandler(db, *allowPrivateIPs)
	settingsHandler := handler.NewSettingsHandler(db)

	// API routes
	api := r.Group("/api")
	{
		api.GET("/vault/status", vaultHandler.Status)
		api.POST("/vault/create", vaultHandler.Create)
		api.POST("/vault/unlock", middleware.RateLimit(5, 1), vaultHandler.Unlock)

		protected := api.Group("")
		protected.Use(middleware.JWTAuth(db))
		{
			protected.GET("/servers", serverHandler.List)
			protected.POST("/servers", serverHandler.Create)
			protected.PUT("/servers/:id", serverHandler.Update)
			protected.DELETE("/servers/:id", serverHandler.Delete)

			protected.GET("/settings", settingsHandler.Get)
			protected.PUT("/settings", settingsHandler.Update)
			protected.POST("/vault/rekey", vaultHandler.Rekey)
		}
	}

	// WebSocket TCP Proxy (True Zero-Knowledge)
	r.GET("/ws/tcp-proxy", tcpProxyHandler.Handle)

	// SPA frontend
	if spaFS != nil {
		r.GET("/favicon.svg", func(c *gin.Context) {
			serveStatic(c, spaFS, "/favicon.svg")
		})
		r.NoRoute(func(c *gin.Context) {
			if c.Request.Method != "GET" || strings.HasPrefix(c.Request.URL.Path, "/api") {
				c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
				return
			}
			// Try to serve the requested file, fall back to index.html
			path := c.Request.URL.Path
			f, err := spaFS.Open(path)
			if err == nil {
				f.Close()
				serveStatic(c, spaFS, path)
				return
			}
			// SPA fallback
			c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
		})
	}

	log.Printf("WebSSH server starting on http://localhost:%s", *port)
	if err := r.Run(":" + *port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func serveStatic(c *gin.Context, fs http.FileSystem, pathStr string) {
	f, err := fs.Open(pathStr)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}

	if stat.IsDir() {
		// Try index.html in that directory
		serveStatic(c, fs, path.Join(pathStr, "index.html"))
		return
	}

	// Determine content type
	contentType := "application/octet-stream"
	switch {
	case strings.HasSuffix(pathStr, ".html"):
		contentType = "text/html; charset=utf-8"
	case strings.HasSuffix(pathStr, ".css"):
		contentType = "text/css"
	case strings.HasSuffix(pathStr, ".js"):
		contentType = "application/javascript"
	case strings.HasSuffix(pathStr, ".svg"):
		contentType = "image/svg+xml"
	case strings.HasSuffix(pathStr, ".png"):
		contentType = "image/png"
	case strings.HasSuffix(pathStr, ".json"):
		contentType = "application/json"
	case strings.HasSuffix(pathStr, ".woff2"):
		contentType = "font/woff2"
	case strings.HasSuffix(pathStr, ".ttf"):
		contentType = "font/ttf"
	case strings.HasSuffix(pathStr, ".wasm"):
		contentType = "application/wasm"
	}

	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.DataFromReader(http.StatusOK, stat.Size(), contentType, f, nil)
}
