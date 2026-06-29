package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func Init(dbPath string) (*sql.DB, error) {
	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(on)")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return db, nil
}

func migrate(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS vault_config (
			id          INTEGER PRIMARY KEY CHECK (id = 1),
			salt        TEXT NOT NULL,
			auth_hash   TEXT NOT NULL,
			jwt_secret  TEXT NOT NULL,
			kdf_algo    TEXT NOT NULL DEFAULT 'pbkdf2-sha512',
			kdf_params  TEXT NOT NULL DEFAULT '{"algorithm":"pbkdf2-sha512","iterations":1000000,"cipher":"AES-256-GCM","keyLength":256}'
		)`,
		`CREATE TABLE IF NOT EXISTS servers (
			id             TEXT PRIMARY KEY,
			encrypted_data TEXT NOT NULL,
			iv             TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS user_settings (
			id            INTEGER PRIMARY KEY CHECK (id = 1),
			settings_json TEXT NOT NULL DEFAULT '{}'
		)`,
	}

	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("exec migration: %w", err)
		}
	}

	// Best-effort migration to drop old columns if they exist.
	// Requires SQLite 3.35.0+ which is typical in modern go-sqlite3.
	db.Exec("ALTER TABLE servers DROP COLUMN name")
	db.Exec("ALTER TABLE servers DROP COLUMN created_at")
	db.Exec("ALTER TABLE servers DROP COLUMN updated_at")
	db.Exec("ALTER TABLE vault_config DROP COLUMN created_at")

	return nil
}
