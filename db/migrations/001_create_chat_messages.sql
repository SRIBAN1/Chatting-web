BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('chatting-web:chat-schema:v1', 0));

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT PRIMARY KEY,
  display_name VARCHAR(24) NOT NULL CHECK (length(btrim(display_name)) > 0),
  content VARCHAR(500) NOT NULL CHECK (length(btrim(content)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_room_counters (
  room_key TEXT PRIMARY KEY,
  next_id BIGINT NOT NULL CHECK (next_id > 0)
);

INSERT INTO chat_room_counters (room_key, next_id)
SELECT 'lobby', COALESCE(MAX(id), 0) + 1
FROM chat_messages
ON CONFLICT (room_key) DO UPDATE
SET next_id = GREATEST(chat_room_counters.next_id, EXCLUDED.next_id);

COMMIT;
