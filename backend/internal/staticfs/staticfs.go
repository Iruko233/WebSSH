package staticfs

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

//go:embed static/*
var embedded embed.FS

// FS returns the filesystem for the SPA frontend.
// In production, returns embedded filesystem.
// In development, falls back to disk at the given dirs.
func FS(devDirs ...string) http.FileSystem {
	// Try embedded first (production build)
	sub, err := fs.Sub(embedded, "static")
	if err == nil {
		if f, err := sub.Open("index.html"); err == nil {
			f.Close()
			return http.FS(sub)
		}
	}

	// Fallback to disk (development)
	for _, dir := range devDirs {
		abs, err := filepath.Abs(dir)
		if err != nil {
			continue
		}
		if info, err := os.Stat(abs); err == nil && info.IsDir() {
			log.Printf("Serving frontend from disk: %s", abs)
			return http.Dir(abs)
		}
	}

	log.Println("WARNING: No frontend files found (build frontend first)")
	return nil
}

// ReadIndexHTML reads the index.html from the filesystem.
// Falls back to a minimal SPA shell if nothing found.
func ReadIndexHTML(fileSystem http.FileSystem) []byte {
	if fileSystem == nil {
		return fallbackHTML
	}

	f, err := fileSystem.Open("index.html")
	if err != nil {
		return fallbackHTML
	}
	defer f.Close()

	stat, _ := f.Stat()
	data := make([]byte, stat.Size())
	if _, err := f.Read(data); err != nil {
		return fallbackHTML
	}
	return data
}

var fallbackHTML = []byte(`<!doctype html>
<html><head><meta charset="UTF-8"><title>WebSSH</title></head>
<body><p>Frontend not built. Run: cd frontend && npm run build</p></body></html>`)
