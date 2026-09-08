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
-- Conversations branch. A message follows its parent; messages with the same
-- parent are alternatives, such as an answer generated again beside the first.
-- The conversation remembers the leaf it was last read at, so the same branch
-- opens on every device. Rows from before branching are threaded in position
-- order, once: a later root with no parent is a branch, not an orphan.
-- An assistant message also keeps the reasoning its model showed, and how long
-- the model took before the first character of its answer.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS thinking text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS thinking_ms integer;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS leaf_id uuid;
CREATE INDEX IF NOT EXISTS messages_parent ON messages(parent_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_version WHERE version = 4) THEN
    UPDATE messages m SET parent_id = p.prev
      FROM (SELECT id, lag(id) OVER (PARTITION BY conversation_id ORDER BY position) AS prev FROM messages) p
      WHERE m.id = p.id AND p.prev IS NOT NULL;
    UPDATE conversations c SET leaf_id = (SELECT id FROM messages WHERE conversation_id = c.id ORDER BY position DESC LIMIT 1);
  END IF;
END $$;
INSERT INTO schema_version(version) VALUES(4) ON CONFLICT DO NOTHING;
-- What a response cost and how fast it came. Token counts are the provider's
-- own when it reported them and an estimate from characters when it did not,
-- which `tokens_estimated` says. `input_tokens` is the whole request the answer
-- was given; `first_token_ms` is when the first piece arrived and `duration_ms`
-- when the last did, both from the request.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS input_tokens integer;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS output_tokens integer;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tokens_estimated boolean;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS first_token_ms integer;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS duration_ms integer;
CREATE INDEX IF NOT EXISTS messages_usage ON messages(created_at) WHERE role = 'assistant' AND output_tokens IS NOT NULL;
INSERT INTO schema_version(version) VALUES(5) ON CONFLICT DO NOTHING;
