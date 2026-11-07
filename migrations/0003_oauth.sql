CREATE TABLE IF NOT EXISTS oauth_clients(id TEXT PRIMARY KEY, redirects TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_forms(id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_codes(id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_tokens(id TEXT PRIMARY KEY, kind TEXT NOT NULL, client TEXT NOT NULL, resource TEXT NOT NULL, expires INTEGER NOT NULL, grant_expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_rates(id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS oauth_clients_expires ON oauth_clients(expires);
CREATE INDEX IF NOT EXISTS oauth_forms_expires ON oauth_forms(expires);
CREATE INDEX IF NOT EXISTS oauth_codes_expires ON oauth_codes(expires);
CREATE INDEX IF NOT EXISTS oauth_tokens_expires ON oauth_tokens(expires);
CREATE INDEX IF NOT EXISTS oauth_rates_expires ON oauth_rates(expires);
