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
