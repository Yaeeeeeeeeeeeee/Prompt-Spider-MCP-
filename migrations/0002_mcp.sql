CREATE TABLE IF NOT EXISTS mcp_sessions (
 id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL DEFAULT 0,
 closed INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(length(CAST(state AS BLOB)) <= 921600),
 context TEXT NOT NULL DEFAULT '{"source":"unknown"}',
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_artifacts (
 id TEXT PRIMARY KEY,
 filename TEXT NOT NULL UNIQUE,
 body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) <= 921600),
 created_at INTEGER NOT NULL
);
