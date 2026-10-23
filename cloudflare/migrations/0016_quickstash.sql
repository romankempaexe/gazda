-- QuickStash: texty, odkazy a heslá na rýchle skopírovanie. Patria rodine (households);
-- owner_email = '' je spoločná položka celej rodiny, inak súkromná (vidí ju len tento človek).

CREATE TABLE quickstash_entries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', -- text | password
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX quickstash_entries_household ON quickstash_entries(household_id, owner_email);

-- Verzia údajov QuickStashu v rodine – aplikácia sa jej pýta a celé údaje načíta len pri zmene.
ALTER TABLE households ADD COLUMN quickstash_rev INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER quickstash_entries_rev_insert AFTER INSERT ON quickstash_entries
BEGIN
  UPDATE households SET quickstash_rev = quickstash_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER quickstash_entries_rev_update AFTER UPDATE ON quickstash_entries
BEGIN
  UPDATE households SET quickstash_rev = quickstash_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER quickstash_entries_rev_delete AFTER DELETE ON quickstash_entries
BEGIN
  UPDATE households SET quickstash_rev = quickstash_rev + 1 WHERE id = OLD.household_id;
END;
