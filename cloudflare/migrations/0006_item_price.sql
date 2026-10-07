-- Cena položky (napr. prečítaná z letáka), text s desatinnou bodkou: „2.49“.
ALTER TABLE polozky ADD COLUMN price TEXT NOT NULL DEFAULT '';
