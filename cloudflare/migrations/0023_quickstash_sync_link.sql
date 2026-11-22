-- QuickStash: synchronizácia podľa odkazu (súbor zdieľaný „Ktokoľvek s odkazom“) – server ho
-- stiahne sám, netreba nastavovať Google Drive API. url = '' → súbor číta prehliadač cez Drive API.
ALTER TABLE quickstash_sync ADD COLUMN url TEXT NOT NULL DEFAULT '';
