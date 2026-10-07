-- Prihlásenie Google účtom namiesto osobných odkazov.

-- Relácie prihlásených zariadení (cookie). Ukladá sa len SHA-256 hodnoty cookie.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_email ON sessions(email);

-- Údaje z Google účtu (meno a fotka pre zobrazenie, kedy sa naposledy prihlásil).
ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN picture TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN last_login TEXT NOT NULL DEFAULT '';
