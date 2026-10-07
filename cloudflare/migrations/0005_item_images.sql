-- Miniatúry položiek (napr. vystrihnuté z letáka). Samostatne, aby sa obrázky
-- neposielali pri každom načítaní domácnosti – prehliadač si ich stiahne raz
-- cez /api/item-image/<id> a ponechá v pamäti.
CREATE TABLE item_images (
  item_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  data TEXT NOT NULL, -- data:image/jpeg;base64,…
  created_at TEXT NOT NULL
);
CREATE INDEX item_images_household ON item_images(household_id);
