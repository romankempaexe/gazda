-- Prebiehajúci nákup (celá obrazovka v obchode): kto nakupuje a odkedy (prázdne = nikto).
ALTER TABLE cinnosti ADD COLUMN shopping_by TEXT NOT NULL DEFAULT '';
ALTER TABLE cinnosti ADD COLUMN shopping_since TEXT NOT NULL DEFAULT '';
