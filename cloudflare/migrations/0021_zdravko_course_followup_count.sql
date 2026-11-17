-- Dávkovanie: nezapísaná dávka sa pripomína každých 30 minút, najviac 6-krát – koľko už odišlo.
ALTER TABLE zdravko_courses ADD COLUMN followup_count INTEGER NOT NULL DEFAULT 0;
