-- Dávkovanie: ak dávku po pripomienke nikto nezapíše ako podanú, o 30 minút príde pripomienka znova.
ALTER TABLE zdravko_courses ADD COLUMN followup_at TEXT NOT NULL DEFAULT ''; -- kedy pripomenúť znova (UTC), '' = nie
ALTER TABLE zdravko_courses ADD COLUMN followup_dose TEXT NOT NULL DEFAULT ''; -- čas dávky, ktorej sa týka (UTC)
