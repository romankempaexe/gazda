-- Komentáre pri činnosti (krátke správy pre ostatných, napr. „kúp radšej polotučné“).
CREATE TABLE komentare (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  cinnost_id TEXT NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX komentare_cinnost ON komentare(cinnost_id, created_at);
CREATE INDEX komentare_household ON komentare(household_id);

-- nákup naživo: nový alebo zmazaný komentár zmení verziu domácnosti
CREATE TRIGGER komentare_rev_insert AFTER INSERT ON komentare
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER komentare_rev_delete AFTER DELETE ON komentare
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = OLD.household_id;
END;
