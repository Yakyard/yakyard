-- Yakyard database. Run on a new D1 database, and again after each update (safe to repeat):
--   npx wrangler d1 execute yakyard --remote --file=schema.sql
-- Every statement is CREATE ... IF NOT EXISTS. New features add new tables rather than new columns,
-- so upgrading an existing database needs no ALTER TABLE.

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'channel',     -- channel | dm
  name TEXT NOT NULL DEFAULT '',            -- slug for channels, empty for DMs
  topic TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  dm_key TEXT UNIQUE,                       -- sorted member ids for DMs
  created_by TEXT,
  created_at INTEGER NOT NULL,
  last_ts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (key TEXT PRIMARY KEY, uploader TEXT, channel_id TEXT, created_at INTEGER, voice TEXT, transcript TEXT, t_status TEXT, t_tries INTEGER NOT NULL DEFAULT 0, t_at INTEGER);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read INTEGER NOT NULL DEFAULT 0,
  section_id TEXT,
  muted INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS mentions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL,                       -- ms since epoch
  thread_id TEXT,                            -- parent message id for replies
  text TEXT NOT NULL DEFAULT '',
  files TEXT NOT NULL DEFAULT '[]',          -- JSON array
  reply_count INTEGER NOT NULL DEFAULT 0,
  last_reply_ts INTEGER NOT NULL DEFAULT 0,
  reply_users TEXT NOT NULL DEFAULT '[]',    -- JSON array of up to 5 user ids
  edited_ts INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'app'         -- app | slack
, also_channel INTEGER NOT NULL DEFAULT 0);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');

CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS pending_members (channel_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (channel_id, user_id));

CREATE TABLE IF NOT EXISTS pins (channel_id TEXT NOT NULL, message_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (channel_id, message_id));

CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT DEFAULT '', created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, message_id TEXT, text TEXT NOT NULL DEFAULT '', due_at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS saved (user_id TEXT NOT NULL, message_id TEXT NOT NULL, created_at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, message_id));

CREATE TABLE IF NOT EXISTS scheduled (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, channel_id TEXT NOT NULL, thread_id TEXT, text TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '[]', also_channel INTEGER NOT NULL DEFAULT 0, send_at INTEGER NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  collapsed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Slack private channel (team id + channel id) -> Yakyard channel. Imports match on this, never on the name.
CREATE TABLE IF NOT EXISTS slack_channels (slack_key TEXT PRIMARY KEY, channel_id TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS slack_channels_channel ON slack_channels(channel_id);

-- People who have signed in at least once. Only the owner can send such accounts a new sign-in link.
CREATE TABLE IF NOT EXISTS signins (user_id TEXT PRIMARY KEY, first_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS slack_imports (user_id TEXT PRIMARY KEY, status TEXT NOT NULL, token_enc TEXT NOT NULL DEFAULT '', slack_user TEXT, state TEXT NOT NULL DEFAULT '{}', msgs INTEGER NOT NULL DEFAULT 0, files INTEGER NOT NULL DEFAULT 0, convs_total INTEGER NOT NULL DEFAULT 0, convs_done INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, finished_at INTEGER NOT NULL DEFAULT 0, lock_until INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  title TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  color TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',      -- owner | admin | member | guest
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
, deactivated INTEGER NOT NULL DEFAULT 0, slack_id TEXT, city TEXT, region TEXT, country TEXT, tz TEXT, lat REAL, lon REAL, loc_at INTEGER, status_emoji TEXT DEFAULT '', status_text TEXT DEFAULT '', status_until INTEGER DEFAULT 0, dnd_until INTEGER DEFAULT 0, dnd_start TEXT DEFAULT '', dnd_end TEXT DEFAULT '', notify_level TEXT DEFAULT 'mentions', vips TEXT DEFAULT '[]', away INTEGER DEFAULT 0);

CREATE VIRTUAL TABLE IF NOT EXISTS voice_fts USING fts5(text, message_id UNINDEXED, file_key UNINDEXED, tokenize='unicode61 remove_diacritics 2');

CREATE INDEX IF NOT EXISTS files_chan ON files(channel_id, created_at);

CREATE INDEX IF NOT EXISTS files_channel ON files(channel_id);

CREATE INDEX IF NOT EXISTS files_t_status ON files(t_status) WHERE t_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS invites_user ON invites(user_id);

CREATE INDEX IF NOT EXISTS members_user ON members(user_id);

CREATE INDEX IF NOT EXISTS mentions_user ON mentions(user_id, ts);

CREATE INDEX IF NOT EXISTS mentions_user_chan ON mentions(user_id, channel_id, ts);

CREATE INDEX IF NOT EXISTS messages_channel_ts ON messages(channel_id, thread_id, ts);

CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, ts);

CREATE INDEX IF NOT EXISTS messages_unread ON messages(channel_id, thread_id, ts, user_id, deleted);

CREATE INDEX IF NOT EXISTS messages_user ON messages(user_id, ts);

CREATE INDEX IF NOT EXISTS messages_user_thread ON messages(user_id, thread_id) WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pending_user ON pending_members(user_id);

CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);

CREATE INDEX IF NOT EXISTS reminders_due ON reminders(done, due_at);

CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled(send_at);

CREATE INDEX IF NOT EXISTS sections_user ON sections(user_id);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text); END;

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text); END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF text ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text); INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text); END;
