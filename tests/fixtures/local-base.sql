-- Development database only. No inserts, drops or production execution.
CREATE TABLE IF NOT EXISTS events(request_id TEXT PRIMARY KEY,event TEXT,project TEXT,received_at TEXT);
