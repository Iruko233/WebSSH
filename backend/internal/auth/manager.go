// Package auth owns process-local authentication and revocable proxy lifetimes
package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"sync"
	"time"
	"webssh-backend/internal/model"
)

var ErrUnauthorized = errors.New("session is invalid or expired")
var ErrConflict = errors.New("vault version changed")
var ErrExists = errors.New("vault already exists")

type Claims struct {
	VaultID  string `json:"vaultId"`
	KeyEpoch int64  `json:"keyEpoch"`
	jwt.RegisteredClaims
}
type session struct {
	claims      *Claims
	connections map[uint64]func()
}
type Manager struct {
	mu             sync.Mutex
	secret         []byte
	vaultID        string
	keyEpoch       int64
	sessions       map[string]*session
	nextConnection uint64
	stop           chan struct{}
	done           chan struct{}
	closed         bool
}

func New(db *sql.DB) (*Manager, error) {
	m := &Manager{secret: make([]byte, 32), sessions: make(map[string]*session), stop: make(chan struct{}), done: make(chan struct{})}
	if _, err := rand.Read(m.secret); err != nil {
		return nil, err
	}
	err := db.QueryRow("SELECT vault_id,key_epoch FROM vault WHERE id=1").Scan(&m.vaultID, &m.keyEpoch)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	go m.reap()
	return m, nil
}

func (m *Manager) validLocked(c *Claims) bool {
	if m.closed || c == nil || c.ExpiresAt == nil || c.ID == "" || c.VaultID != m.vaultID || c.KeyEpoch != m.keyEpoch || !time.Now().Before(c.ExpiresAt.Time) {
		return false
	}
	s, ok := m.sessions[c.ID]
	return ok && s.claims.VaultID == c.VaultID && s.claims.KeyEpoch == c.KeyEpoch && s.claims.ExpiresAt.Equal(c.ExpiresAt.Time)
}

func (m *Manager) Validate(raw string) (*Claims, error) {
	c := &Claims{}
	token, err := jwt.ParseWithClaims(raw, c, func(t *jwt.Token) (any, error) { return m.secret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("webssh"), jwt.WithAudience("webssh"), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || !token.Valid {
		return nil, ErrUnauthorized
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.validLocked(c) {
		return nil, ErrUnauthorized
	}
	return c, nil
}

// Do serializes authorization with the full transaction, so logout/rekey cannot cross a write
func (m *Manager) Do(c *Claims, work func() error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.validLocked(c) {
		return ErrUnauthorized
	}
	return work()
}

func (m *Manager) issueLocked() (model.AuthResponse, error) {
	id := make([]byte, 32)
	if _, err := rand.Read(id); err != nil {
		return model.AuthResponse{}, err
	}
	now := time.Now()
	c := &Claims{VaultID: m.vaultID, KeyEpoch: m.keyEpoch, RegisteredClaims: jwt.RegisteredClaims{
		Issuer: "webssh", Audience: jwt.ClaimStrings{"webssh"}, ID: base64.RawURLEncoding.EncodeToString(id),
		IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(24 * time.Hour)),
	}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(m.secret)
	if err != nil {
		return model.AuthResponse{}, err
	}
	m.sessions[c.ID] = &session{claims: c, connections: make(map[uint64]func())}
	return model.AuthResponse{Token: token, ExpiresAt: c.ExpiresAt.Unix(), VaultID: c.VaultID, KeyEpoch: c.KeyEpoch}, nil
}

func (m *Manager) Unlock(vaultID string, epoch int64, verify func() error) (model.AuthResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || vaultID != m.vaultID || epoch != m.keyEpoch {
		return model.AuthResponse{}, ErrConflict
	}
	if err := verify(); err != nil {
		return model.AuthResponse{}, err
	}
	return m.issueLocked()
}

func (m *Manager) Create(vaultID string, persist func() error) (model.AuthResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return model.AuthResponse{}, ErrUnauthorized
	}
	if m.vaultID != "" {
		return model.AuthResponse{}, ErrExists
	}
	if err := persist(); err != nil {
		return model.AuthResponse{}, err
	}
	m.vaultID = vaultID
	m.keyEpoch = 1
	return m.issueLocked()
}

func (m *Manager) Rekey(c *Claims, epoch int64, persist func() error) (model.AuthResponse, error) {
	m.mu.Lock()
	if !m.validLocked(c) {
		m.mu.Unlock()
		return model.AuthResponse{}, ErrUnauthorized
	}
	if epoch != m.keyEpoch+1 {
		m.mu.Unlock()
		return model.AuthResponse{}, ErrConflict
	}
	if err := persist(); err != nil {
		m.mu.Unlock()
		return model.AuthResponse{}, err
	}
	closers := m.clearLocked()
	m.keyEpoch = epoch
	response, err := m.issueLocked()
	m.mu.Unlock()
	for _, close := range closers {
		close()
	}
	return response, err
}

func (m *Manager) Register(c *Claims, close func()) (func(), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.validLocked(c) {
		return nil, ErrUnauthorized
	}
	m.nextConnection++
	id := m.nextConnection
	m.sessions[c.ID].connections[id] = close
	return func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if s, ok := m.sessions[c.ID]; ok {
			delete(s.connections, id)
		}
	}, nil
}

func (m *Manager) Revoke(c *Claims) {
	m.mu.Lock()
	var closers []func()
	if c != nil {
		if s, ok := m.sessions[c.ID]; ok {
			for _, close := range s.connections {
				closers = append(closers, close)
			}
			delete(m.sessions, c.ID)
		}
	}
	m.mu.Unlock()
	for _, close := range closers {
		close()
	}
}

func (m *Manager) clearLocked() []func() {
	var closers []func()
	for _, s := range m.sessions {
		for _, close := range s.connections {
			closers = append(closers, close)
		}
	}
	m.sessions = make(map[string]*session)
	return closers
}

func (m *Manager) reap() {
	defer close(m.done)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-ticker.C:
			m.mu.Lock()
			var closers []func()
			for id, s := range m.sessions {
				if !time.Now().Before(s.claims.ExpiresAt.Time) {
					for _, close := range s.connections {
						closers = append(closers, close)
					}
					delete(m.sessions, id)
				}
			}
			m.mu.Unlock()
			for _, close := range closers {
				close()
			}
		}
	}
}

func (m *Manager) Close() {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return
	}
	m.closed = true
	closers := m.clearLocked()
	close(m.stop)
	m.mu.Unlock()
	for _, close := range closers {
		close()
	}
	<-m.done
}
