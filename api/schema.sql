CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visited_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flags (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO flags (name, enabled) VALUES ('blog', 1);
INSERT OR IGNORE INTO flags (name, enabled) VALUES ('hello', 1);
INSERT OR IGNORE INTO flags (name, enabled) VALUES ('paypal', 1);
INSERT OR IGNORE INTO flags (name, enabled) VALUES ('about', 1);
INSERT OR IGNORE INTO flags (name, enabled) VALUES ('projects', 1);
INSERT OR IGNORE INTO flags (name, enabled) VALUES ('links', 1);

-- Store
CREATE TABLE IF NOT EXISTS products (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  file_key TEXT,
  file_name TEXT,
  preview_key TEXT,
  preview_type TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  product_slug TEXT NOT NULL REFERENCES products(slug),
  email TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid
  stripe_session_id TEXT,
  download_token TEXT UNIQUE,
  download_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

-- Hidden until you flip it on
INSERT OR IGNORE INTO flags (name, enabled) VALUES ('store', 0);
