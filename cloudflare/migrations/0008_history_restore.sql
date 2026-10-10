-- Celá činnosť v čase dokončenia (JSON riadku cinnosti), aby sa dala z histórie vrátiť späť.
ALTER TABLE historia ADD COLUMN task TEXT NOT NULL DEFAULT '';
