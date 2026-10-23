-- Financie: rodinný rozpočet podľa tabuľky „Financie“ (Excel). Patrí rodine (households).
-- Položky: príjmy, mesačné výdavky (s kategóriou) a ročné výdavky (s mesiacom splatnosti).
-- Sumy sú v centoch (celé čísla – bez zaokrúhľovacích chýb).

CREATE TABLE financie_categories (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  is_saving INTEGER NOT NULL DEFAULT 0 -- sporenie: nie je to minutie, finančné zdravie ho nepočíta
);
CREATE INDEX financie_categories_household ON financie_categories(household_id, sort);

CREATE TABLE financie_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- income | monthly | yearly
  name TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0, -- centy
  category_id TEXT NOT NULL DEFAULT '', -- len mesačné výdavky
  due_month INTEGER NOT NULL DEFAULT 0, -- len ročné: 1–12, 0 = neurčené
  sort INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX financie_items_household ON financie_items(household_id, kind, sort);

-- Núdzová rezerva (centy) a verzia údajov Financií v rodine.
ALTER TABLE households ADD COLUMN financie_reserve INTEGER NOT NULL DEFAULT 0;
ALTER TABLE households ADD COLUMN financie_reserve_months INTEGER NOT NULL DEFAULT 6;
ALTER TABLE households ADD COLUMN financie_rev INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER financie_items_rev_insert AFTER INSERT ON financie_items
BEGIN
  UPDATE households SET financie_rev = financie_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER financie_items_rev_update AFTER UPDATE ON financie_items
BEGIN
  UPDATE households SET financie_rev = financie_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER financie_items_rev_delete AFTER DELETE ON financie_items
BEGIN
  UPDATE households SET financie_rev = financie_rev + 1 WHERE id = OLD.household_id;
END;
CREATE TRIGGER financie_categories_rev_insert AFTER INSERT ON financie_categories
BEGIN
  UPDATE households SET financie_rev = financie_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER financie_categories_rev_update AFTER UPDATE ON financie_categories
BEGIN
  UPDATE households SET financie_rev = financie_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER financie_categories_rev_delete AFTER DELETE ON financie_categories
BEGIN
  UPDATE households SET financie_rev = financie_rev + 1 WHERE id = OLD.household_id;
END;
