-- Súkromná adresa kalendára Family Grid (Google Kalendár / iPhone): len SHA-256 tokenu z adresy.
CREATE TABLE calendar_feeds (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_access TEXT NOT NULL DEFAULT ''
);
CREATE INDEX calendar_feeds_email ON calendar_feeds(email);
