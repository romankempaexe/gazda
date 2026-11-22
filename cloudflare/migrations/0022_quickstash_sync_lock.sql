-- QuickStash: synchronizácia so súborom na Google Drive a zámok biometriou (WebAuthn).

-- Prepojený súbor na Google Drive (pre každého človeka a rodinu). Súbor číta prehliadač
-- (Google prihlásenie s oprávnením na čítanie Drive), server dostane len jeho obsah.
CREATE TABLE quickstash_sync (
  email TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 1, -- 1 = nové položky súkromné, 0 = spoločné v rodine
  synced_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (email, household_id)
);

-- Z ktorého súboru položka prišla (pri synchronizácii sa zmaže, keď v súbore už nie je).
ALTER TABLE quickstash_entries ADD COLUMN sync_file TEXT NOT NULL DEFAULT '';

-- Zámok biometriou: kto má aspoň jeden kľúč, musí QuickStash na každom zariadení odomknúť
-- (odtlačok prsta, tvár, Windows Hello…). Verejný kľúč je SPKI (base64url).
CREATE TABLE webauthn_credentials (
  id TEXT PRIMARY KEY, -- id kľúča (base64url)
  email TEXT NOT NULL,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL, -- -7 = ES256, -257 = RS256
  device TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX webauthn_credentials_email ON webauthn_credentials(email);

-- Jednorazové výzvy (platia 5 minút, viazané na reláciu).
CREATE TABLE webauthn_challenges (
  challenge TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL,
  kind TEXT NOT NULL, -- create | get
  created_at TEXT NOT NULL
);

-- Do kedy je QuickStash na tomto zariadení (relácii) odomknutý.
ALTER TABLE sessions ADD COLUMN qs_unlocked_until TEXT NOT NULL DEFAULT '';
