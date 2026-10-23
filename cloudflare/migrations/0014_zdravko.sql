-- Zdravko: zdravie členov rodiny. Všetko patrí rodine (households).
-- Časy sú ISO 8601 v UTC (aplikácia ich ukazuje v miestnom čase), dátumy yyyy-MM-dd.

CREATE TABLE zdravko_members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  birth_date TEXT NOT NULL DEFAULT '',
  weight REAL, -- kg
  height REAL, -- cm
  blood_group TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '', -- Muž | Žena
  email TEXT NOT NULL DEFAULT '',
  is_child INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX zdravko_members_household ON zdravko_members(household_id);

-- Záznamy: teplota, liek, fyzikálna metóda (rest) a udalosť v kalendári (lekár, vyšetrenie, očkovanie).
CREATE TABLE zdravko_records (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES zdravko_members(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- temperature | medicine | rest | calendar_event
  recorded_at TEXT NOT NULL, -- kedy (pri udalosti = kedy bola zapísaná)
  temperature REAL,
  medicine_name TEXT NOT NULL DEFAULT '',
  dosage TEXT NOT NULL DEFAULT '', -- napr. „2.5 ml“
  substance_id TEXT NOT NULL DEFAULT '', -- ibuprofen | paracetamol | acetylsalicylic_acid | ''
  rest_method TEXT NOT NULL DEFAULT '',
  duration_hours REAL,
  event_type TEXT NOT NULL DEFAULT '', -- doctor_visit | examination | vaccination
  subtype TEXT NOT NULL DEFAULT '', -- názov (napr. „Pediatrička / pediater“)
  event_at TEXT NOT NULL DEFAULT '', -- čas návštevy (UTC)
  notes TEXT NOT NULL DEFAULT '',
  reminders TEXT NOT NULL DEFAULT '[]', -- JSON: hour_before | day_before | week_before
  cost REAL, -- €
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX zdravko_records_member ON zdravko_records(member_id, recorded_at);
CREATE INDEX zdravko_records_events ON zdravko_records(household_id, event_at) WHERE type = 'calendar_event';

-- Miery dieťaťa.
CREATE TABLE zdravko_measurements (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES zdravko_members(id) ON DELETE CASCADE,
  measured_at TEXT NOT NULL, -- yyyy-MM-dd
  weight REAL, -- kg
  height REAL, -- cm
  head REAL, -- obvod hlavičky, cm
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX zdravko_measurements_member ON zdravko_measurements(member_id, measured_at);

-- Naplánované upozornenia (pripomienky udalostí, striedanie liekov); posiela ich cron.
CREATE TABLE zdravko_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES zdravko_records(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- hour_before | day_before | week_before | alt_4h | alt_8h
  fire_at TEXT NOT NULL, -- UTC
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX zdravko_reminders_due ON zdravko_reminders(fire_at) WHERE sent_at = '';

-- Verzia údajov Zdravka v rodine (aplikácia sa jej pýta a celé údaje načíta len pri zmene).
ALTER TABLE households ADD COLUMN zdravko_rev INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER zdravko_members_rev_insert AFTER INSERT ON zdravko_members
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER zdravko_members_rev_update AFTER UPDATE ON zdravko_members
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER zdravko_members_rev_delete AFTER DELETE ON zdravko_members
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = OLD.household_id;
END;
CREATE TRIGGER zdravko_records_rev_insert AFTER INSERT ON zdravko_records
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER zdravko_records_rev_update AFTER UPDATE ON zdravko_records
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER zdravko_records_rev_delete AFTER DELETE ON zdravko_records
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = OLD.household_id;
END;
CREATE TRIGGER zdravko_measurements_rev_insert AFTER INSERT ON zdravko_measurements
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER zdravko_measurements_rev_update AFTER UPDATE ON zdravko_measurements
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER zdravko_measurements_rev_delete AFTER DELETE ON zdravko_measurements
BEGIN
  UPDATE households SET zdravko_rev = zdravko_rev + 1 WHERE id = OLD.household_id;
END;
