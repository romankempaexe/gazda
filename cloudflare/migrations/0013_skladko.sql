-- Skládko: sklady → skupiny (ľubovoľne vnorené) → položky. Všetko patrí rodine (households).
-- Prázdny text ('') namiesto NULL: group_id = '' je položka priamo v sklade, parent_id = '' je skupina v sklade.

CREATE TABLE skladko_warehouses (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'inventory_2',
  location_id TEXT NOT NULL DEFAULT '', -- predvoľba (pantry, fridge, …) alebo custom
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX skladko_warehouses_household ON skladko_warehouses(household_id);

CREATE TABLE skladko_groups (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL REFERENCES skladko_warehouses(id) ON DELETE CASCADE,
  parent_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'folder',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX skladko_groups_household ON skladko_groups(household_id);

CREATE TABLE skladko_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL REFERENCES skladko_warehouses(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  min_qty INTEGER NOT NULL DEFAULT 0, -- „dochádza“, keď quantity <= min_qty (0 = nesleduje sa)
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'inventory_2',
  expiration_date TEXT NOT NULL DEFAULT '', -- yyyy-MM-dd
  image_rev TEXT NOT NULL DEFAULT '', -- prázdne = bez fotky; inak verzia do adresy obrázka
  import_image_url TEXT NOT NULL DEFAULT '', -- fotka z Firebase, ktorú ešte treba preniesť
  notified_exp TEXT NOT NULL DEFAULT '', -- pre ktorý dátum už odišlo upozornenie na trvanlivosť
  notified_low INTEGER NOT NULL DEFAULT 0, -- upozornenie „dochádza“ už odišlo (do doplnenia)
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX skladko_items_household ON skladko_items(household_id);
CREATE INDEX skladko_items_expiration ON skladko_items(expiration_date) WHERE expiration_date <> '';

-- Fotky položiek (zmenšené v prehliadači, JPEG); načítavajú sa zvlášť cez /api/skladko/image/<id>.
CREATE TABLE skladko_images (
  item_id TEXT PRIMARY KEY REFERENCES skladko_items(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL
);

-- Verzia údajov Skládka v rodine – aplikácia sa jej pýta a celé údaje načíta len pri zmene.
ALTER TABLE households ADD COLUMN skladko_rev INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER skladko_warehouses_rev_insert AFTER INSERT ON skladko_warehouses
BEGIN
  UPDATE households SET skladko_rev = skladko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER skladko_warehouses_rev_update AFTER UPDATE ON skladko_warehouses
BEGIN
  UPDATE households SET skladko_rev = skladko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER skladko_warehouses_rev_delete AFTER DELETE ON skladko_warehouses
BEGIN
  UPDATE households SET skladko_rev = skladko_rev + 1 WHERE id = OLD.household_id;
END;
CREATE TRIGGER skladko_groups_rev_insert AFTER INSERT ON skladko_groups
BEGIN
  UPDATE households SET skladko_rev = skladko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER skladko_groups_rev_update AFTER UPDATE ON skladko_groups
BEGIN
  UPDATE households SET skladko_rev = skladko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER skladko_groups_rev_delete AFTER DELETE ON skladko_groups
BEGIN
  UPDATE households SET skladko_rev = skladko_rev + 1 WHERE id = OLD.household_id;
END;
CREATE TRIGGER skladko_items_rev_insert AFTER INSERT ON skladko_items
BEGIN
  UPDATE households SET skladko_rev = skladko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER skladko_items_rev_update AFTER UPDATE ON skladko_items
BEGIN
  UPDATE households SET skladko_rev = skladko_rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER skladko_items_rev_delete AFTER DELETE ON skladko_items
BEGIN
  UPDATE households SET skladko_rev = skladko_rev + 1 WHERE id = OLD.household_id;
END;
