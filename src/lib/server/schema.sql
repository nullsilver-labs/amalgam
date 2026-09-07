CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 12000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  position bigserial UNIQUE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('complete', 'streaming', 'cancelled', 'failed', 'interrupted')),
  model text,
  error text,
  context_manifest jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, position);
CREATE INDEX IF NOT EXISTS conversations_recent ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS conversations_project ON conversations(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_generation ON messages(conversation_id) WHERE status = 'streaming';
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS schema_version (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_version(version) VALUES(1) ON CONFLICT DO NOTHING;
-- Signed-in browsers. The cookie value is 256 random bits; only its SHA-256
-- lives here, so this table cannot be replayed into a session. A row is never
-- deleted on sign-out — it is revoked, which keeps the audit readable.
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  secret_hash text NOT NULL UNIQUE,
  device text NOT NULL CHECK (char_length(device) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_live ON sessions(created_at) WHERE revoked_at IS NULL;
-- Named integration keys. Scopes are the whole authorisation model for them:
-- a token holds exactly what it was created with and never the owner's session.
CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  secret_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_tokens_live ON api_tokens(created_at) WHERE revoked_at IS NULL;
INSERT INTO schema_version(version) VALUES(2) ON CONFLICT DO NOTHING;
-- What a user message quoted from the owner's corpus library: [{id, title,
-- card_type, original_uri, chars}]. The message's own content stays the words
-- the person typed — this column is the attribution beneath them, so a reload
-- can say where the excerpts came from without keeping a second copy of them.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sources jsonb;
INSERT INTO schema_version(version) VALUES(3) ON CONFLICT DO NOTHING;
