package handler

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/hkdf"
)

var upgrader = websocket.Upgrader{
	CheckOrigin:      func(r *http.Request) bool { return true },
	HandshakeTimeout: 10 * time.Second,
}

type TCPProxyHandler struct {
	db              *sql.DB
	allowPrivateIPs bool
}

func NewTCPProxyHandler(db *sql.DB, allowPrivateIPs bool) *TCPProxyHandler {
	return &TCPProxyHandler{db: db, allowPrivateIPs: allowPrivateIPs}
}

type initProxyMsg struct {
	Token string `json:"token"`
	Host  string `json:"host"`
	Port  int    `json:"port"`
}

// ECDH negotiation message (Phase A)
type helloMsg struct {
	V   int    `json:"v"`
	Enc bool   `json:"enc"`
	Pk  string `json:"pk"`
}

// Encrypted payload wrapper (Phase B)
type encryptedMsg struct {
	Enc string `json:"enc"`
}

type wsWrapper struct {
	*websocket.Conn
	r io.Reader
}

func (w *wsWrapper) Read(p []byte) (int, error) {
	for {
		if w.r == nil {
			msgType, r, err := w.Conn.NextReader()
			if err != nil {
				return 0, err
			}
			if msgType != websocket.BinaryMessage {
				// Ignore non-binary messages or handle them as needed
				continue
			}
			w.r = r
		}
		n, err := w.r.Read(p)
		if err == io.EOF {
			w.r = nil
			if n > 0 {
				return n, nil
			}
			continue
		}
		return n, err
	}
}

func (w *wsWrapper) Write(p []byte) (int, error) {
	err := w.Conn.WriteMessage(websocket.BinaryMessage, p)
	if err != nil {
		return 0, err
	}
	return len(p), nil
}

func (h *TCPProxyHandler) Handle(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("TCP Proxy WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// 1. Read first message and detect encrypted vs plaintext
	_, msg, err := conn.ReadMessage()
	if err != nil {
		return
	}

	var aesKey []byte // nil means plaintext path

	// Helper to send error/status, encrypted if aesKey is set
	sendResponse := func(data []byte) {
		if aesKey != nil {
			enc, eErr := encryptMessage(aesKey, data)
			if eErr != nil {
				log.Printf("Failed to encrypt response: %v", eErr)
				return
			}
			resp, _ := json.Marshal(encryptedMsg{Enc: enc})
			conn.WriteMessage(websocket.TextMessage, resp)
		} else {
			conn.WriteMessage(websocket.TextMessage, data)
		}
	}

	var initMsg initProxyMsg

	// Try encrypted handshake first
	var hello helloMsg
	if json.Unmarshal(msg, &hello) == nil && hello.V == 2 && hello.Enc && hello.Pk != "" {
		// --- Encrypted path ---
		serverPriv, serverPubB64, err := generateKeyPair()
		if err != nil {
			log.Printf("Failed to generate ECDH key pair: %v", err)
			return
		}

		sharedSecret, err := deriveSharedSecret(serverPriv, hello.Pk)
		if err != nil {
			log.Printf("Failed to derive shared secret: %v", err)
			return
		}

		aesKey, err = deriveAESKey(sharedSecret)
		if err != nil {
			log.Printf("Failed to derive AES key: %v", err)
			return
		}

		// Send server public key
		resp, _ := json.Marshal(helloMsg{V: 2, Enc: true, Pk: serverPubB64})
		if err := conn.WriteMessage(websocket.TextMessage, resp); err != nil {
			return
		}

		// Read encrypted init
		_, encMsg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var encPayload encryptedMsg
		if err := json.Unmarshal(encMsg, &encPayload); err != nil {
			sendResponse([]byte(`{"error": "invalid encrypted format"}`))
			return
		}
		plaintext, err := decryptMessage(aesKey, encPayload.Enc)
		if err != nil {
			sendResponse([]byte(`{"error": "decryption failed"}`))
			return
		}
		if err := json.Unmarshal(plaintext, &initMsg); err != nil {
			sendResponse([]byte(`{"error": "invalid format"}`))
			return
		}
	} else {
		// --- Plaintext path (existing logic) ---
		if err := json.Unmarshal(msg, &initMsg); err != nil {
			conn.WriteMessage(websocket.TextMessage, []byte(`{"error": "invalid format"}`))
			return
		}
	}

	if initMsg.Token == "" || initMsg.Host == "" || initMsg.Port == 0 {
		sendResponse([]byte(`{"error": "missing parameters"}`))
		return
	}

	// 2. Validate JWT
	if !h.validateJWT(initMsg.Token) {
		sendResponse([]byte(`{"error": "auth failed"}`))
		return
	}

	// 3. Resolve and check SSRF
	ips, err := net.LookupIP(initMsg.Host)
	if err != nil {
		sendResponse([]byte(`{"error": "dns resolution failed"}`))
		return
	}

	var targetIP net.IP
	for _, ip := range ips {
		if !h.allowPrivateIPs && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsMulticast() || ip.IsUnspecified()) {
			sendResponse([]byte(`{"error": "ssrf protection: private ip blocked"}`))
			return
		}
		if targetIP == nil && ip.To4() != nil {
			targetIP = ip
		}
	}
	if targetIP == nil && len(ips) > 0 {
		targetIP = ips[0]
	}
	if targetIP == nil {
		sendResponse([]byte(`{"error": "no valid ip found"}`))
		return
	}

	addr := net.JoinHostPort(targetIP.String(), fmt.Sprintf("%d", initMsg.Port))

	// 4. Dial target TCP
	tcpConn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		sendResponse([]byte(`{"error": "tcp dial failed"}`))
		return
	}
	defer tcpConn.Close()

	// Tell client connection is successful
	sendResponse([]byte(`{"status": "connected"}`))

	// 5. Pipe data bidirectionally
	wsConn := &wsWrapper{Conn: conn}

	errc := make(chan error, 2)
	go func() {
		_, err := io.Copy(wsConn, tcpConn)
		errc <- err
	}()
	go func() {
		_, err := io.Copy(tcpConn, wsConn)
		errc <- err
	}()

	<-errc
}

func (h *TCPProxyHandler) validateJWT(tokenStr string) bool {
	var secret string
	err := h.db.QueryRow("SELECT jwt_secret FROM vault_config WHERE id = 1").Scan(&secret)
	if err != nil {
		return false
	}

	jwtSecret, err := base64.StdEncoding.DecodeString(secret)
	if err != nil {
		return false
	}

	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return jwtSecret, nil
	})

	return err == nil && token.Valid
}

// --- ECDH + AES-256-GCM helpers ---

func generateKeyPair() (*ecdh.PrivateKey, string, error) {
	curve := ecdh.X25519()
	priv, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return nil, "", err
	}
	pubB64 := base64.StdEncoding.EncodeToString(priv.PublicKey().Bytes())
	return priv, pubB64, nil
}

func deriveSharedSecret(priv *ecdh.PrivateKey, remotePubB64 string) ([]byte, error) {
	remotePubBytes, err := base64.StdEncoding.DecodeString(remotePubB64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode remote public key: %w", err)
	}
	curve := ecdh.X25519()
	remotePub, err := curve.NewPublicKey(remotePubBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse remote public key: %w", err)
	}
	return priv.ECDH(remotePub)
}

func deriveAESKey(sharedSecret []byte) ([]byte, error) {
	hkdfReader := hkdf.New(sha256.New, sharedSecret, nil, []byte("webssh-handshake-v1"))
	aesKey := make([]byte, 32) // AES-256
	if _, err := io.ReadFull(hkdfReader, aesKey); err != nil {
		return nil, fmt.Errorf("failed to derive AES key: %w", err)
	}
	return aesKey, nil
}

func encryptMessage(aesKey, plaintext []byte) (string, error) {
	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	// Seal appends ciphertext to nonce, we prepend nonce to ciphertext
	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func decryptMessage(aesKey []byte, encoded string) ([]byte, error) {
	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("failed to decode encrypted message: %w", err)
	}
	nonceSize := gcm.NonceSize()
	if len(raw) < nonceSize {
		return nil, fmt.Errorf("encrypted message too short")
	}
	nonce, ciphertext := raw[:nonceSize], raw[nonceSize:]
	return gcm.Open(nil, nonce, ciphertext, nil)
}
