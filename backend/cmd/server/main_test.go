package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

func TestStaticCachePolicy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	files := http.FS(fstest.MapFS{
		"index.html":                        {Data: []byte("<html>current</html>")},
		"main.wasm":                         {Data: []byte("wasm")},
		"wasm_exec.js":                      {Data: []byte("runtime")},
		"assets/main-0123456789abcdef.wasm": {Data: []byte("wasm")},
		"assets/index-AbCd1234.js":          {Data: []byte("app")},
	})
	for _, tc := range []struct{ path, cache string }{
		{"/", "no-store"},
		{"/index.html", "no-store"},
		{"/main.wasm", "no-store"},
		{"/wasm_exec.js", "no-store"},
		{"/assets/main-0123456789abcdef.wasm", "public, max-age=31536000, immutable"},
		{"/assets/index-AbCd1234.js", "public, max-age=31536000, immutable"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(response)
			ctx.Request = httptest.NewRequest(http.MethodGet, tc.path, nil)
			serveStatic(ctx, files, tc.path)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d", response.Code)
			}
			if got := response.Header().Get("Cache-Control"); got != tc.cache {
				t.Fatalf("Cache-Control = %q, want %q", got, tc.cache)
			}
		})
	}
}
