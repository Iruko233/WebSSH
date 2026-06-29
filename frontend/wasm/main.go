package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"syscall/js"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/hkdf"
	"golang.org/x/crypto/ssh"
)

var (
	openFiles   = make(map[int]*sftp.File)
	nextFileID  = 1
	fileIDMutex sync.Mutex
)

// WsConn implements net.Conn over a JavaScript WebSocket.
type WsConn struct {
	ws          js.Value
	readChan    chan []byte
	closeChan   chan struct{}
	readBuf     []byte
	closed      bool
	negotiating bool // true while waiting for ECDH negotiation response
	negoChan    chan []byte
}

// ECDH negotiation message
type helloMsg struct {
	V   int    `json:"v"`
	Enc bool   `json:"enc"`
	Pk  string `json:"pk"`
}

// --- ECDH + AES-256-GCM helpers (mirror backend) ---

func generateWasmKeyPair() (*ecdh.PrivateKey, string, error) {
	curve := ecdh.X25519()
	priv, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return nil, "", err
	}
	pubB64 := base64.StdEncoding.EncodeToString(priv.PublicKey().Bytes())
	return priv, pubB64, nil
}

func deriveWasmSharedSecret(priv *ecdh.PrivateKey, remotePubB64 string) ([]byte, error) {
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

func deriveWasmAESKey(sharedSecret []byte) ([]byte, error) {
	hkdfReader := hkdf.New(sha256.New, sharedSecret, nil, []byte("webssh-handshake-v1"))
	aesKey := make([]byte, 32) // AES-256
	if _, err := io.ReadFull(hkdfReader, aesKey); err != nil {
		return nil, fmt.Errorf("failed to derive AES key: %w", err)
	}
	return aesKey, nil
}

func encryptWasmMessage(aesKey, plaintext []byte) (string, error) {
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
	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func decryptWasmMessage(aesKey []byte, encoded string) ([]byte, error) {
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

func NewWsConn(wsURL, token, host string, port int, encryptHandshake bool) (*WsConn, error) {
	ws := js.Global().Get("WebSocket").New(wsURL)
	ws.Set("binaryType", "arraybuffer")

	conn := &WsConn{
		ws:        ws,
		readChan:  make(chan []byte, 100),
		closeChan: make(chan struct{}),
		negoChan:  make(chan []byte, 1),
	}

	openChan := make(chan struct{})
	errChan := make(chan error, 1)

	ws.Set("onopen", js.FuncOf(func(this js.Value, args []js.Value) any {
		close(openChan)
		return nil
	}))

	ws.Set("onerror", js.FuncOf(func(this js.Value, args []js.Value) any {
		select {
		case errChan <- errors.New("websocket error"):
		default:
		}
		return nil
	}))

	ws.Set("onclose", js.FuncOf(func(this js.Value, args []js.Value) any {
		if !conn.closed {
			conn.closed = true
			close(conn.closeChan)
		}
		return nil
	}))

	ws.Set("onmessage", js.FuncOf(func(this js.Value, args []js.Value) any {
		event := args[0]
		data := event.Get("data")

		if data.Type() == js.TypeString {
			str := data.String()

			// During ECDH negotiation, route TextMessages to negoChan
			if conn.negotiating {
				buf := []byte(str)
				select {
				case conn.negoChan <- buf:
				default:
				}
				return nil
			}

			// Normal mode: check for error messages
			var msg map[string]interface{}
			json.Unmarshal([]byte(str), &msg)
			if errStr, ok := msg["error"]; ok {
				fmt.Printf("WebSocket Proxy Error: %v\n", errStr)
				if !conn.closed {
					conn.closed = true
					close(conn.closeChan)
				}
			}
		} else {
			uint8Array := js.Global().Get("Uint8Array").New(data)
			length := uint8Array.Length()
			buf := make([]byte, length)
			js.CopyBytesToGo(buf, uint8Array)
			select {
			case conn.readChan <- buf:
			case <-conn.closeChan:
			}
		}
		return nil
	}))

	select {
	case <-openChan:
	case err := <-errChan:
		return nil, err
	case <-time.After(5 * time.Second):
		return nil, errors.New("websocket connect timeout")
	}

	if !encryptHandshake {
		// Plaintext path (existing logic)
		initMsg := map[string]interface{}{
			"token": token,
			"host":  host,
			"port":  port,
		}
		initBytes, _ := json.Marshal(initMsg)
		ws.Call("send", string(initBytes))
		return conn, nil
	}

	// --- Encrypted handshake path ---

	// Phase A: ECDH key negotiation
	clientPriv, clientPubB64, err := generateWasmKeyPair()
	if err != nil {
		ws.Call("close")
		return nil, fmt.Errorf("failed to generate ECDH key pair: %w", err)
	}

	helloBytes, _ := json.Marshal(map[string]interface{}{
		"v":   2,
		"enc": true,
		"pk":  clientPubB64,
	})
	ws.Call("send", string(helloBytes))

	// Wait for server public key
	conn.negotiating = true
	var serverResp []byte
	select {
	case serverResp = <-conn.negoChan:
	case <-conn.closeChan:
		return nil, errors.New("websocket closed during negotiation")
	case <-time.After(5 * time.Second):
		ws.Call("close")
		return nil, errors.New("ECDH negotiation timeout")
	}
	conn.negotiating = false

	// Parse server response
	var hello helloMsg
	if err := json.Unmarshal(serverResp, &hello); err != nil || hello.V != 2 || !hello.Enc || hello.Pk == "" {
		ws.Call("close")
		return nil, fmt.Errorf("invalid ECDH negotiation response: %s", string(serverResp))
	}

	sharedSecret, err := deriveWasmSharedSecret(clientPriv, hello.Pk)
	if err != nil {
		ws.Call("close")
		return nil, fmt.Errorf("failed to derive shared secret: %w", err)
	}

	aesKey, err := deriveWasmAESKey(sharedSecret)
	if err != nil {
		ws.Call("close")
		return nil, fmt.Errorf("failed to derive AES key: %w", err)
	}

	// Phase B: Send encrypted init
	initMsg := map[string]interface{}{
		"token": token,
		"host":  host,
		"port":  port,
	}
	initBytes, _ := json.Marshal(initMsg)
	encInit, err := encryptWasmMessage(aesKey, initBytes)
	if err != nil {
		ws.Call("close")
		return nil, fmt.Errorf("failed to encrypt init message: %w", err)
	}

	encPayload, _ := json.Marshal(map[string]string{"enc": encInit})
	ws.Call("send", string(encPayload))

	return conn, nil
}

func (c *WsConn) Read(b []byte) (int, error) {
	if len(c.readBuf) > 0 {
		n := copy(b, c.readBuf)
		c.readBuf = c.readBuf[n:]
		return n, nil
	}
	select {
	case data, ok := <-c.readChan:
		if !ok {
			return 0, io.EOF
		}
		n := copy(b, data)
		if n < len(data) {
			c.readBuf = data[n:]
		}
		return n, nil
	case <-c.closeChan:
		return 0, io.EOF
	}
}

func (c *WsConn) Write(b []byte) (int, error) {
	if c.closed {
		return 0, io.EOF
	}
	uint8Array := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(uint8Array, b)
	c.ws.Call("send", uint8Array)
	return len(b), nil
}

func (c *WsConn) Close() error {
	if !c.closed {
		c.closed = true
		c.ws.Call("close")
		close(c.closeChan)
	}
	return nil
}
func (c *WsConn) LocalAddr() net.Addr                { return &net.TCPAddr{} }
func (c *WsConn) RemoteAddr() net.Addr                { return &net.TCPAddr{} }
func (c *WsConn) SetDeadline(t time.Time) error      { return nil }
func (c *WsConn) SetReadDeadline(t time.Time) error  { return nil }
func (c *WsConn) SetWriteDeadline(t time.Time) error { return nil }

// Helper to wrap a Go function returning (any, error) into a JS Promise
func jsPromise(fn func() (any, error)) js.Value {
	promiseConstructor := js.Global().Get("Promise")
	return promiseConstructor.New(js.FuncOf(func(this js.Value, args []js.Value) any {
		resolve := args[0]
		reject := args[1]
		go func() {
			res, err := fn()
			if err != nil {
				reject.Invoke(err.Error())
			} else {
				resolve.Invoke(res)
			}
		}()
		return nil
	}))
}

func startMonitor(client *ssh.Client, config js.Value, interval float64) {
	if interval <= 0 {
		interval = 5 // default 5s
	}

	detectOS := func() string {
		session, err := client.NewSession()
		if err == nil {
			out, _ := session.Output("cat /etc/os-release 2>/dev/null | grep -E '^ID=' | cut -d'=' -f2 | tr -d '\"'")
			os := strings.TrimSpace(strings.ToLower(string(out)))
			session.Close()
			if os != "" {
				return os
			}
		}
		session2, err := client.NewSession()
		if err == nil {
			out, _ := session2.Output("uname -s")
			sys := strings.TrimSpace(strings.ToLower(string(out)))
			session2.Close()
			if sys == "darwin" {
				return "macos"
			}
		}
		session3, err := client.NewSession()
		if err == nil {
			out, _ := session3.Output("cmd.exe /c ver")
			session3.Close()
			if strings.Contains(strings.ToLower(string(out)), "windows") {
				return "windows"
			}
		}
		return "linux"
	}

	osInfo := detectOS()
	if onOsInfo := config.Get("onOsInfo"); onOsInfo.Type() == js.TypeFunction {
		onOsInfo.Invoke(osInfo)
	}

	if osInfo == "macos" || osInfo == "windows" {
		return
	}

	var lastIdle, lastTotal float64
	type netStat struct{ rx, tx float64 }
	lastNet := make(map[string]netStat)

	ticker := time.NewTicker(time.Duration(interval * float64(time.Second)))
	for range ticker.C {
		session, err := client.NewSession()
		if err != nil {
			return
		}

		cmd := `awk '/^cpu / {idle=$5; total=0; for(i=2;i<=NF;i++) total+=$i; print "CPU", idle, total}' /proc/stat && ` +
			`awk '/MemTotal:/ {t=$2} /MemAvailable:/ {a=$2} END {print "MEM", t, a}' /proc/meminfo && ` +
			`awk 'NR>2 {sub(/:/,"",$1); print "NET", $1, $2, $10}' /proc/net/dev && ` +
			`awk '$4 == "01" {c++} END {print "TCP", c+0}' /proc/net/tcp 2>/dev/null || echo "TCP 0"; ` +
			`awk 'END {print "UDP", NR>1?NR-1:0}' /proc/net/udp 2>/dev/null || echo "UDP 0"`

		out, err := session.Output(cmd)
		session.Close()

		if err == nil {
			lines := strings.Split(strings.TrimSpace(string(out)), "\n")

			cpuPercent := 0.0
			memTotal, memUsed := 0.0, 0.0
			tcpConns, udpConns := 0, 0
			currentNet := make(map[string]netStat)
			netInterfaces := make(map[string]interface{})

			for _, line := range lines {
				fields := strings.Fields(line)
				if len(fields) == 0 {
					continue
				}

				switch fields[0] {
				case "CPU":
					if len(fields) >= 3 {
						idle, _ := strconv.ParseFloat(fields[1], 64)
						total, _ := strconv.ParseFloat(fields[2], 64)
						if lastTotal > 0 && total > lastTotal {
							cpuPercent = (1.0 - ((idle - lastIdle) / (total - lastTotal))) * 100.0
						}
						lastIdle = idle
						lastTotal = total
					}
				case "MEM":
					if len(fields) >= 3 {
						t, _ := strconv.ParseFloat(fields[1], 64)
						a, _ := strconv.ParseFloat(fields[2], 64)
						memTotal = t * 1024
						memUsed = (t - a) * 1024
					}
				case "NET":
					if len(fields) >= 4 {
						iface := fields[1]
						rx, _ := strconv.ParseFloat(fields[2], 64)
						tx, _ := strconv.ParseFloat(fields[3], 64)
						currentNet[iface] = netStat{rx, tx}

						rxBps, txBps := 0.0, 0.0
						if last, ok := lastNet[iface]; ok {
							rxBps = (rx - last.rx) / interval
							txBps = (tx - last.tx) / interval
						}
						netInterfaces[iface] = map[string]interface{}{
							"rx_bps": rxBps,
							"tx_bps": txBps,
						}
					}
				case "TCP":
					if len(fields) >= 2 {
						tcpConns, _ = strconv.Atoi(fields[1])
					}
				case "UDP":
					if len(fields) >= 2 {
						udpConns, _ = strconv.Atoi(fields[1])
					}
				}
			}

			lastNet = currentNet

			stats := map[string]interface{}{
				"cpu_percent":    cpuPercent,
				"mem_total":      memTotal,
				"mem_used":       memUsed,
				"net_interfaces": netInterfaces,
				"tcp_conns":      tcpConns,
				"udp_conns":      udpConns,
			}
			if onSysStats := config.Get("onSysStats"); onSysStats.Type() == js.TypeFunction {
				onSysStats.Invoke(stats)
			}
		}
	}
}

func main() {
	c := make(chan struct{})

	js.Global().Set("startWasmSSH", js.FuncOf(func(this js.Value, args []js.Value) any {
		config := args[0]

		wsURL := config.Get("wsUrl").String()
		token := config.Get("token").String()
		host := config.Get("host").String()
		port := config.Get("port").Int()
		username := config.Get("username").String()
		password := config.Get("password").String()
		onData := config.Get("onData")
		onClose := config.Get("onClose")

		encryptHandshake := true // default on
		if v := config.Get("encrypt_handshake"); v.Type() == js.TypeBoolean {
			encryptHandshake = v.Bool()
		}

		go func() {
			wsConn, err := NewWsConn(wsURL, token, host, port, encryptHandshake)
			if err != nil {
				onClose.Invoke(fmt.Sprintf("Failed to connect websocket: %v", err))
				return
			}

			expectedHostKey := config.Get("expectedHostKey").String()
			sshConfig := &ssh.ClientConfig{
				User: username,
				Auth: []ssh.AuthMethod{ssh.Password(password)},
				HostKeyCallback: func(hostname string, remote net.Addr, key ssh.PublicKey) error {
					rawKey := base64.StdEncoding.EncodeToString(key.Marshal())
					if expectedHostKey != "" && expectedHostKey == rawKey {
						return nil
					}

					fingerprint := ssh.FingerprintSHA256(key)
					isMismatch := expectedHostKey != ""

					onHostKeyPrompt := config.Get("onHostKeyPrompt")
					if onHostKeyPrompt.Type() == js.TypeFunction {
						onHostKeyPrompt.Invoke(rawKey, fingerprint, isMismatch)
					}
					return errors.New("host key verification failed or prompt requested")
				},
				Timeout: 15 * time.Second,
			}

			connObj, chans, reqs, err := ssh.NewClientConn(wsConn, fmt.Sprintf("%s:%d", host, port), sshConfig)
			if err != nil {
				wsConn.Close()
				if !strings.Contains(err.Error(), "prompt requested") {
					onClose.Invoke(fmt.Sprintf("SSH handshake failed: %v", err))
				}
				return
			}

			client := ssh.NewClient(connObj, chans, reqs)
			session, err := client.NewSession()
			if err != nil {
				client.Close()
				onClose.Invoke(fmt.Sprintf("Failed to create SSH session: %v", err))
				return
			}

			modes := ssh.TerminalModes{
				ssh.ECHO:          1,
				ssh.TTY_OP_ISPEED: 14400,
				ssh.TTY_OP_OSPEED: 14400,
			}
			cols := 80
			rows := 24
			if v := config.Get("cols"); v.Type() == js.TypeNumber {
				cols = v.Int()
			}
			if v := config.Get("rows"); v.Type() == js.TypeNumber {
				rows = v.Int()
			}
			if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
				session.Close()
				onClose.Invoke(fmt.Sprintf("Failed to request PTY: %v", err))
				return
			}

			stdin, _ := session.StdinPipe()
			stdout, _ := session.StdoutPipe()

			// Notify JS ready BEFORE shell starts so 'Connected' message appears before MOTD
			if onReady := config.Get("onReady"); onReady.Type() == js.TypeFunction {
				onReady.Invoke()
			}

			if err := session.Shell(); err != nil {
				session.Close()
				onClose.Invoke(fmt.Sprintf("Failed to start shell: %v", err))
				return
			}

			// IO Loop
			go func() {
				buf := make([]byte, 32*1024)
				for {
					n, err := stdout.Read(buf)
					if n > 0 {
						b64 := base64.StdEncoding.EncodeToString(buf[:n])
						onData.Invoke(b64)
					}
					if err != nil {
						onClose.Invoke("SSH connection closed")
						session.Close()
						client.Close()
						return
					}
				}
			}()

			// JS Callbacks for PTY
			config.Set("write", js.FuncOf(func(this js.Value, args []js.Value) any {
				b64 := args[0].String()
				data, _ := base64.StdEncoding.DecodeString(b64)
				stdin.Write(data)
				return nil
			}))
			config.Set("resize", js.FuncOf(func(this js.Value, args []js.Value) any {
				session.WindowChange(args[0].Int(), args[1].Int())
				return nil
			}))
			// Apply any resize buffered before this callback was ready
			if r := config.Get("__pendingRows"); r.Type() == js.TypeNumber {
				if c := config.Get("__pendingCols"); c.Type() == js.TypeNumber {
					session.WindowChange(r.Int(), c.Int())
				}
			}
			config.Set("close", js.FuncOf(func(this js.Value, args []js.Value) any {
				session.Close()
				client.Close()
				return nil
			}))

			// SFTP Initialization
			sftpClient, err := sftp.NewClient(client)
			if err == nil {
				config.Set("sftpList", js.FuncOf(func(this js.Value, args []js.Value) any {
					path := args[0].String()
					return jsPromise(func() (any, error) {
						files, err := sftpClient.ReadDir(path)
						if err != nil {
							return nil, err
						}
						var res []interface{}
						for _, f := range files {
							res = append(res, map[string]interface{}{
								"name":    f.Name(),
								"isDir":   f.IsDir(),
								"size":    f.Size(),
								"modTime": f.ModTime().UnixMilli(),
							})
						}
						return res, nil
					})
				}))

				config.Set("sftpStat", js.FuncOf(func(this js.Value, args []js.Value) any {
					path := args[0].String()
					return jsPromise(func() (any, error) {
						stat, err := sftpClient.Stat(path)
						if err != nil {
							return nil, err
						}
						return map[string]interface{}{
							"name":    stat.Name(),
							"isDir":   stat.IsDir(),
							"size":    stat.Size(),
							"modTime": stat.ModTime().UnixMilli(),
						}, nil
					})
				}))

				config.Set("sftpMkdir", js.FuncOf(func(this js.Value, args []js.Value) any {
					path := args[0].String()
					return jsPromise(func() (any, error) {
						return nil, sftpClient.MkdirAll(path)
					})
				}))

				config.Set("sftpRemove", js.FuncOf(func(this js.Value, args []js.Value) any {
					path := args[0].String()
					return jsPromise(func() (any, error) {
						stat, err := sftpClient.Stat(path)
						if err == nil && stat.IsDir() {
							return nil, sftpClient.RemoveDirectory(path)
						}
						return nil, sftpClient.Remove(path)
					})
				}))

				config.Set("sftpRename", js.FuncOf(func(this js.Value, args []js.Value) any {
					return jsPromise(func() (any, error) {
						return nil, sftpClient.Rename(args[0].String(), args[1].String())
					})
				}))

				config.Set("sftpOpenFile", js.FuncOf(func(this js.Value, args []js.Value) any {
					path := args[0].String()
					flags := args[1].String()
					return jsPromise(func() (any, error) {
						var f *sftp.File
						var err error
						if flags == "r" {
							f, err = sftpClient.Open(path)
						} else if flags == "w" {
							f, err = sftpClient.Create(path)
						} else {
							return nil, errors.New("unsupported flags")
						}
						if err != nil {
							return nil, err
						}

						fileIDMutex.Lock()
						id := nextFileID
						nextFileID++
						openFiles[id] = f
						fileIDMutex.Unlock()
						return id, nil
					})
				}))

				config.Set("sftpCloseFile", js.FuncOf(func(this js.Value, args []js.Value) any {
					id := args[0].Int()
					return jsPromise(func() (any, error) {
						fileIDMutex.Lock()
						f, ok := openFiles[id]
						if ok {
							delete(openFiles, id)
						}
						fileIDMutex.Unlock()
						if !ok {
							return nil, errors.New("invalid file id")
						}
						return nil, f.Close()
					})
				}))

				config.Set("sftpReadFile", js.FuncOf(func(this js.Value, args []js.Value) any {
					id := args[0].Int()
					length := args[1].Int()
					return jsPromise(func() (any, error) {
						fileIDMutex.Lock()
						f, ok := openFiles[id]
						fileIDMutex.Unlock()
						if !ok {
							return nil, errors.New("invalid file id")
						}

						buf := make([]byte, length)
						n, err := f.Read(buf)
						if err != nil && err != io.EOF {
							return nil, err
						}
						if n == 0 && err == io.EOF {
							return nil, nil
						}

						uint8Array := js.Global().Get("Uint8Array").New(n)
						js.CopyBytesToJS(uint8Array, buf[:n])
						return uint8Array, nil
					})
				}))

				config.Set("sftpWriteFile", js.FuncOf(func(this js.Value, args []js.Value) any {
					id := args[0].Int()
					dataJS := args[1]
					length := dataJS.Length()
					buf := make([]byte, length)
					js.CopyBytesToGo(buf, dataJS)

					return jsPromise(func() (any, error) {
						fileIDMutex.Lock()
						f, ok := openFiles[id]
						fileIDMutex.Unlock()
						if !ok {
							return nil, errors.New("invalid file id")
						}
						_, err := f.Write(buf)
						return nil, err
					})
				}))
			} else {
				fmt.Println("Warning: Failed to create SFTP client:", err)
			}

			// Start Monitor asynchronously
			interval := 5.0
			if jsInterval := config.Get("monitor_interval"); jsInterval.Type() == js.TypeNumber {
				interval = jsInterval.Float()
			}
			go startMonitor(client, config, interval)

		}()
		return nil
	}))

	fmt.Println("WebSSH WASM initialized with SFTP & Monitor capabilities")
	<-c
}
