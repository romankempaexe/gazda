-- Kontakty: telefónny zoznam dôležitých čísel rodiny (lekár, škola, susedia, servis…).
-- Patria rodine (households) – vidia a menia ich všetci jej členovia.

CREATE TABLE kontakty_entries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0, -- dôležité: zobrazia sa navrchu
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX kontakty_entries_household ON kontakty_entries(household_id);

-- Verzia údajov Kontaktov v rodine – aplikácia sa jej pýta a celé údaje načíta len pri zmene.
ALTER TABLE households ADD COLUMN kontakty_rev INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER kontakty_entries_rev_insert AFTER INSERT ON kontakty_entries
BEGIN
  UPDATE households SET kontakty_rev = kontakty_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER kontakty_entries_rev_update AFTER UPDATE ON kontakty_entries
BEGIN
  UPDATE households SET kontakty_rev = kontakty_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER kontakty_entries_rev_delete AFTER DELETE ON kontakty_entries
BEGIN
  UPDATE households SET kontakty_rev = kontakty_rev + 1 WHERE id = OLD.household_id;
END;
