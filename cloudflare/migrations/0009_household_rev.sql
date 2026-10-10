-- Číslo verzie domácnosti: zvýši sa pri každej zmene činností, položiek, priestorov a členov.
-- Aplikácia sa ho často pýta (lacné) a celé údaje načíta len pri zmene – nákup naživo.
ALTER TABLE households ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER cinnosti_rev_insert AFTER INSERT ON cinnosti
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER cinnosti_rev_update AFTER UPDATE ON cinnosti
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER cinnosti_rev_delete AFTER DELETE ON cinnosti
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = OLD.household_id;
END;
CREATE TRIGGER polozky_rev_insert AFTER INSERT ON polozky
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER polozky_rev_update AFTER UPDATE ON polozky
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER polozky_rev_delete AFTER DELETE ON polozky
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = OLD.household_id;
END;
CREATE TRIGGER priestory_rev_insert AFTER INSERT ON priestory
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER priestory_rev_update AFTER UPDATE ON priestory
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER priestory_rev_delete AFTER DELETE ON priestory
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = OLD.household_id;
END;
CREATE TRIGGER members_rev_insert AFTER INSERT ON members
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER members_rev_update AFTER UPDATE ON members
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = NEW.household_id;
END;
CREATE TRIGGER members_rev_delete AFTER DELETE ON members
BEGIN
  UPDATE households SET rev = rev + 1 WHERE id = OLD.household_id;
END;
