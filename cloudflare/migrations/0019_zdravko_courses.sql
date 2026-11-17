-- Zdravko: dávkovanie liekov (liečba) – liek, dávka, časy podania počas dňa, od kedy a koľko dní.
-- Cron posiela pripomienku každej dávky (next_at = najbližšia naplánovaná dávka v UTC, '' = skončené).

CREATE TABLE zdravko_courses (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES zdravko_members(id) ON DELETE CASCADE,
  medicine_name TEXT NOT NULL,
  substance_id TEXT NOT NULL DEFAULT '', -- ibuprofen | paracetamol | …
  dosage TEXT NOT NULL DEFAULT '', -- napr. „5 ml“
  times TEXT NOT NULL DEFAULT '[]', -- JSON: ["08:00", "20:00"] (čas v Bratislave)
  start_date TEXT NOT NULL, -- yyyy-MM-dd
  end_date TEXT NOT NULL DEFAULT '', -- posledný deň (vrátane), '' = do odvolania
  notes TEXT NOT NULL DEFAULT '',
  next_at TEXT NOT NULL DEFAULT '', -- najbližšia dávka (UTC), '' = dávkovanie skončilo
  stopped_at TEXT NOT NULL DEFAULT '', -- ukončené ručne
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX zdravko_courses_member ON zdravko_courses(member_id);
CREATE INDEX zdravko_courses_due ON zdravko_courses(next_at) WHERE next_at <> '';

-- Podaná dávka z dávkovania (záznam typu medicine).
ALTER TABLE zdravko_records ADD COLUMN course_id TEXT NOT NULL DEFAULT '';

CREATE TRIGGER zdravko_courses_rev_insert AFTER INSERT ON zdravko_courses
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER zdravko_courses_rev_update AFTER UPDATE ON zdravko_courses
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER zdravko_courses_rev_delete AFTER DELETE ON zdravko_courses
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = OLD.household_id;
END;
