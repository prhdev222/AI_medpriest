-- Local-only schema for Wrangler D1 (--local)
-- Mirrors the production tables needed by /api/chat

CREATE TABLE IF NOT EXISTS ipd_stays (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hn             TEXT NOT NULL,
  ward           TEXT NOT NULL,
  admit_date     TEXT NOT NULL,
  discharge_date TEXT DEFAULT '',
  los            INTEGER DEFAULT 0,
  stay_type      TEXT DEFAULT 'admit'
);

CREATE TABLE IF NOT EXISTS discharge_plans (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  ipd_stay_id             INTEGER NOT NULL,
  hn                     TEXT NOT NULL,
  ward                   TEXT NOT NULL,
  fit_discharge_date     TEXT DEFAULT '',
  actual_discharge_date  TEXT DEFAULT '',
  delay_days             INTEGER DEFAULT 0,
  delay_reason           TEXT DEFAULT '',
  delay_detail           TEXT DEFAULT '',
  created_at             TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (ipd_stay_id) REFERENCES ipd_stays(id)
);

-- Rate limit table (no PHI)
CREATE TABLE IF NOT EXISTS chat_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_usage_ip_created_at
  ON chat_usage (ip, created_at);

