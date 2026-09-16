package database

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"log"
	_ "modernc.org/sqlite"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Store struct {
	*sql.DB
	path           string
	writes         chan struct{}
	stop           chan struct{}
	done           chan struct{}
	closeOnce      sync.Once
	cleanupPending atomic.Bool
	maintenanceMu  sync.Mutex
}

func Init(dbPath string) (*Store, error) {
	abs, err := filepath.Abs(dbPath)
	if err != nil {
		return nil, err
	}
	dir := filepath.Dir(abs)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	if err := protectPath(dir, true); err != nil {
		return nil, fmt.Errorf("protect data directory: %w", err)
	}
	file, err := os.OpenFile(abs, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, fmt.Errorf("create database: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, err
	}
	if err := protectPath(abs, false); err != nil {
		return nil, fmt.Errorf("protect database: %w", err)
	}
	pragmas := []struct{ name, value string }{
		{"secure_delete", "ON"}, {"journal_mode", "WAL"}, {"wal_autocheckpoint", "64"},
		{"journal_size_limit", "0"}, {"synchronous", "FULL"}, {"temp_store", "MEMORY"}, {"busy_timeout", "5000"},
	}
	query := url.Values{}
	for _, p := range pragmas {
		query.Add("_pragma", p.name+"("+p.value+")")
	}
	uriPath := filepath.ToSlash(abs)
	if !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath
	}
	dbURL := url.URL{Scheme: "file", Path: uriPath, RawQuery: query.Encode()}
	db, err := sql.Open("sqlite", dbURL.String())
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	s := &Store{DB: db, path: abs, writes: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{})}
	ok := false
	defer func() {
		if !ok {
			db.Close()
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for name, want := range map[string]string{"secure_delete": "1", "journal_mode": "wal", "wal_autocheckpoint": "64", "journal_size_limit": "0", "synchronous": "2", "temp_store": "2", "busy_timeout": "5000"} {
		var value string
		if err := db.QueryRowContext(ctx, "PRAGMA "+name).Scan(&value); err != nil {
			return nil, fmt.Errorf("verify %s: %w", name, err)
		}
		if value != want {
			return nil, fmt.Errorf("database pragma %s was not applied", name)
		}
	}
	if err := s.createSchema(ctx); err != nil {
		return nil, err
	}
	if err := s.protectFiles(); err != nil {
		return nil, err
	}
	s.checkpoint()
	go s.maintain()
	ok = true
	return s, nil
}

func (s *Store) createSchema(ctx context.Context) error {
	var count int
	if err := s.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'vault'`).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return errors.New("legacy or unsupported database schema, create a fresh database explicitly, existing data was not migrated or deleted")
	}
	var version int
	if err := s.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version != 0 && version != 1 {
		return errors.New("unsupported vault database version")
	}
	if err := s.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='vault'`).Scan(&count); err != nil {
		return err
	}
	if count == 1 && version != 1 {
		return errors.New("unrecognized vault schema, database was left intact")
	}
	if count == 0 && version != 0 {
		return errors.New("incomplete vault database schema")
	}
	if count == 0 {
		tx, err := s.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		_, err = tx.ExecContext(ctx, `CREATE TABLE vault (
			id INTEGER PRIMARY KEY CHECK(id = 1), vault_id TEXT NOT NULL,
			format_version INTEGER NOT NULL CHECK(format_version = 1),
			key_epoch INTEGER NOT NULL CHECK(key_epoch > 0), revision INTEGER NOT NULL CHECK(revision > 0),
			salt TEXT NOT NULL, auth_hash TEXT NOT NULL, kdf_algo TEXT NOT NULL, kdf_params TEXT NOT NULL,
			iv TEXT NOT NULL, encrypted_data TEXT NOT NULL
		)`)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version=1"); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	rows, err := s.QueryContext(ctx, `SELECT id,vault_id,format_version,key_epoch,revision,salt,auth_hash,kdf_algo,kdf_params,iv,encrypted_data FROM vault LIMIT 0`)
	if err != nil {
		return fmt.Errorf("invalid vault schema: %w", err)
	}
	return rows.Close()
}

func (s *Store) protectFiles() error {
	for _, p := range []string{s.path, s.path + "-wal", s.path + "-shm"} {
		if _, err := os.Stat(p); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return err
		}
		if err := protectPath(p, false); err != nil {
			return fmt.Errorf("protect database file: %w", err)
		}
	}
	return nil
}
func (s *Store) Written() {
	select {
	case s.writes <- struct{}{}:
	default:
	}
}
func (s *Store) CleanupPending() bool { return s.cleanupPending.Load() }

func (s *Store) checkpoint() {
	s.maintenanceMu.Lock()
	defer s.maintenanceMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, err := s.Conn(ctx)
	if err == nil {
		defer conn.Close()
		// Maintenance never waits for the normal five-second busy handler
		_, err = conn.ExecContext(ctx, "PRAGMA busy_timeout=0")
		if err == nil {
			// Reserve part of the same two-second budget for restoring connection settings
			deadline, _ := ctx.Deadline()
			checkpointContext, stop := context.WithDeadline(ctx, deadline.Add(-100*time.Millisecond))
			var busy, frames, copied int
			err = conn.QueryRowContext(checkpointContext, "PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &frames, &copied)
			stop()
			if err == nil && (busy != 0 || (frames >= 0 && frames != copied)) {
				err = errors.New("checkpoint remains busy")
			}
			if _, restoreErr := conn.ExecContext(ctx, "PRAGMA busy_timeout=5000"); restoreErr != nil {
				// Discard an unrestored connection, its replacement reapplies all DSN pragmas
				_ = conn.Raw(func(any) error { return driver.ErrBadConn })
				if err == nil {
					err = restoreErr
				}
			}
		}
	}
	if err == nil {
		err = s.protectFiles()
	}
	previous := s.cleanupPending.Swap(err != nil)
	if err != nil && !previous {
		log.Print("database history cleanup pending, retry scheduled")
	}
	if err == nil && previous {
		log.Print("database history cleanup completed")
	}
}

func (s *Store) maintain() {
	defer close(s.done)
	periodic := time.NewTicker(30 * time.Second)
	defer periodic.Stop()
	var timer *time.Timer
	var timerC <-chan time.Time
	for {
		select {
		case <-s.writes:
			if timer == nil {
				timer = time.NewTimer(time.Second)
				timerC = timer.C
			}
		case <-timerC:
			timer = nil
			timerC = nil
			s.checkpoint()
		case <-periodic.C:
			s.checkpoint()
		case <-s.stop:
			if timer != nil {
				timer.Stop()
			}
			s.checkpoint()
			return
		}
	}
}
func (s *Store) Close() error {
	s.closeOnce.Do(func() { close(s.stop); <-s.done })
	return s.DB.Close()
}
