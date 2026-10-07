-- Gazda: dátová štruktúra (zodpovedá listom Google tabuľky z verzie Apps Script).
-- Dátumy sú text yyyy-MM-dd, časy ISO 8601.

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Kto má prístup k domácnosti (role = owner | member).
CREATE TABLE members (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  added_at TEXT NOT NULL,
  PRIMARY KEY (household_id, email)
);
CREATE INDEX members_email ON members(email);

CREATE TABLE priestory (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX priestory_household ON priestory(household_id);

-- Činnosti (úlohy); priestor môže chýbať len pri nákupe (kind = 'nakup').
CREATE TABLE cinnosti (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  priestor_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assigned_to TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'home',
  color TEXT NOT NULL DEFAULT '#4CAF50',
  due_date TEXT NOT NULL,
  periodicity TEXT NOT NULL DEFAULT 'none',
  repeat_interval INTEGER,
  kind TEXT NOT NULL DEFAULT '',
  store TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX cinnosti_household ON cinnosti(household_id);
CREATE INDEX cinnosti_assigned ON cinnosti(assigned_to, due_date);

-- Checklist činnosti.
CREATE TABLE polozky (
  id TEXT PRIMARY KEY,
  cinnost_id TEXT NOT NULL REFERENCES cinnosti(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL,
  text TEXT NOT NULL,
  qty TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX polozky_cinnost ON polozky(cinnost_id, position);
CREATE INDEX polozky_household ON polozky(household_id);

-- Obchody a produkty, ktoré domácnosť už zadala (našepkávanie).
CREATE TABLE obchody (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (household_id, name)
);

CREATE TABLE produkty (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  uses INTEGER NOT NULL DEFAULT 1,
  last_used TEXT NOT NULL,
  PRIMARY KEY (household_id, name)
);

-- Používatelia; token_hash = SHA-256 kľúča z osobného odkazu (kľúč sa neukladá).
CREATE TABLE users (
  email TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE,
  last_household_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
