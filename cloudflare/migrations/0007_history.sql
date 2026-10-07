-- Položka nákupu, ktorú v obchode nemali (missing = 1; done ostáva 0).
ALTER TABLE polozky ADD COLUMN missing INTEGER NOT NULL DEFAULT 0;

-- História: záznam o každej dokončenej činnosti (čo sa urobilo / nakúpilo a kto).
-- items = JSON [{ id, text, qty, price, state: done | missing | open, img }]
CREATE TABLE historia (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  cinnost_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  store TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'home',
  color TEXT NOT NULL DEFAULT '#4CAF50',
  priestor TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  completed_by TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX historia_household ON historia(household_id, completed_at);
