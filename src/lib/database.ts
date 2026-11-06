import { neon } from "@neondatabase/serverless";

type GlobalWithChatSchema = typeof globalThis & {
  __chatSchemaReady?: Promise<void>;
};

const globalForChat = globalThis as GlobalWithChatSchema;

export function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  return neon(connectionString);
}

export async function ensureChatSchema() {
  const sql = getSql();

  if (!globalForChat.__chatSchemaReady) {
    globalForChat.__chatSchemaReady = (async () => {
      await sql.transaction([
        sql`SELECT pg_advisory_xact_lock(hashtextextended('chatting-web:chat-schema:v1', 0))`,
        sql`CREATE TABLE IF NOT EXISTS chat_messages (
          id BIGINT PRIMARY KEY,
          display_name VARCHAR(24) NOT NULL CHECK (length(btrim(display_name)) > 0),
          content VARCHAR(500) NOT NULL CHECK (length(btrim(content)) > 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id BIGINT REFERENCES chat_messages(id)`,
        sql`CREATE TABLE IF NOT EXISTS chat_room_counters (
          room_key TEXT PRIMARY KEY,
          next_id BIGINT NOT NULL CHECK (next_id > 0)
        )`,
        sql`
          INSERT INTO chat_room_counters (room_key, next_id)
          SELECT 'lobby', COALESCE(MAX(id), 0) + 1
          FROM chat_messages
          ON CONFLICT (room_key) DO UPDATE
          SET next_id = GREATEST(chat_room_counters.next_id, EXCLUDED.next_id)
        `,
      ]);
    })();
  }

  const schemaReady = globalForChat.__chatSchemaReady;
  try {
    await schemaReady;
  } catch (error) {
    if (globalForChat.__chatSchemaReady === schemaReady) {
      globalForChat.__chatSchemaReady = undefined;
    }
    throw error;
  }
}
