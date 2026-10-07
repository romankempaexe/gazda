-- Push notifikácie: odbery zariadení a nastavenia servera (kľúče VAPID, posledný ranný prehľad).

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX push_subscriptions_email ON push_subscriptions(email);

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
