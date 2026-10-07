-- Prezývka, pod ktorou používateľa vidia ostatní (zadá ju po prvom prihlásení).
ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
