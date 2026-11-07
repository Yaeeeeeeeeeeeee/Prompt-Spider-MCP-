-- Additive only. Existing events(request_id,event,project,received_at) is untouched.
-- Production runner must verify existing schema and private backup before applying.
CREATE TABLE IF NOT EXISTS spider_events_v1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL CHECK(version = 1),
  source TEXT NOT NULL CHECK(source IN ('windows','cloud')),
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  received_at TEXT NOT NULL,
  sequence INTEGER,
  node_id TEXT NOT NULL DEFAULT 'default',
  simulated INTEGER NOT NULL DEFAULT 0 CHECK(simulated IN (0,1)),
  payload_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spider_v1_run ON spider_events_v1(source,project_id,run_id,id);
CREATE INDEX IF NOT EXISTS spider_v1_received ON spider_events_v1(received_at);
CREATE TABLE IF NOT EXISTS spider_rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0)
);
