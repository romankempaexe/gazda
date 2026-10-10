-- Pripomienka v konkrétny čas: due_time „HH:MM“ (prázdne = bez pripomienky).
-- reminded = „termín čas“, pre ktorý už pripomienka odišla (zmena termínu/času ju znova zapne).
ALTER TABLE cinnosti ADD COLUMN due_time TEXT NOT NULL DEFAULT '';
ALTER TABLE cinnosti ADD COLUMN reminded TEXT NOT NULL DEFAULT '';
