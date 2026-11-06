import { NextRequest, NextResponse } from "next/server";
import { ensureChatSchema, getSql } from "@/src/lib/database";
import { actorIdSchema, messageIdSchema, newMessageSchema, roomKeySchema } from "@/src/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

type Reaction = { emoji: string; count: number; reacted: boolean };
type DatabaseMessage = {
  id: string; displayName: string; content: string; createdAt: string | Date;
  replyToId?: string | null; replyToName?: string | null; replyToContent?: string | null;
  reactions?: Reaction[] | null;
};
type PublicMessage = {
  id: string; displayName: string; content: string; createdAt: string;
  replyTo?: { id: string; displayName: string; content: string } | null;
  reactions: Reaction[];
};
function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}
function normalizeMessage(row: DatabaseMessage): PublicMessage {
  const { replyToId, replyToName, replyToContent } = row;
  return {
    id: String(row.id), displayName: row.displayName, content: row.content,
    createdAt: new Date(row.createdAt).toISOString(),
    replyTo: replyToId && replyToName != null && replyToContent != null
      ? { id: replyToId, displayName: replyToName, content: replyToContent } : null,
    reactions: Array.isArray(row.reactions) ? row.reactions : [],
  };
}
function readPageSize(value: string | null) {
  if (value === null) return DEFAULT_PAGE_SIZE;
  const size = Number(value);
  return Number.isInteger(size) && size >= 1 && size <= MAX_PAGE_SIZE ? size : null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const beforeId = url.searchParams.get("beforeId");
  const afterId = url.searchParams.get("afterId");
  const room = roomKeySchema.safeParse(url.searchParams.get("room") ?? "everyone");
  const rawActor = url.searchParams.get("actorId");
  const actorId = rawActor && actorIdSchema.safeParse(rawActor).success ? rawActor : null;
  const limit = readPageSize(url.searchParams.get("limit"));
  if (!room.success) return jsonResponse({ error: "That room does not exist." }, 400);
  if (limit === null) return jsonResponse({ error: "Invalid page size." }, 400);
  if (beforeId && afterId) return jsonResponse({ error: "Choose either older history or new messages, not both." }, 400);
  if ((beforeId && !messageIdSchema.safeParse(beforeId).success) || (afterId && !messageIdSchema.safeParse(afterId).success)) {
    return jsonResponse({ error: "The message cursor is invalid." }, 400);
  }
  try {
    await ensureChatSchema();
    const sql = getSql();
    let rows: DatabaseMessage[];
    const common = (cursorClause: "before" | "after" | "all") => cursorClause;
    void common;
    if (beforeId) {
      rows = await sql`
        SELECT m.id::text AS id, m.display_name AS "displayName", m.content, m.created_at AS "createdAt",
          p.id::text AS "replyToId", p.display_name AS "replyToName", p.content AS "replyToContent",
          COALESCE(r.reactions, '[]'::json) AS reactions
        FROM chat_messages m
        LEFT JOIN chat_messages p ON p.id = m.reply_to_id AND p.room_key = m.room_key
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object('emoji', g.emoji, 'count', g.n, 'reacted', g.reacted)) AS reactions
          FROM (SELECT emoji, COUNT(*)::int AS n, COALESCE(BOOL_OR(actor_id = ${actorId}::uuid), false) AS reacted
            FROM chat_message_reactions WHERE message_id = m.id GROUP BY emoji) g
        ) r ON TRUE
        WHERE m.room_key = ${room.data} AND m.id < ${beforeId}::bigint
        ORDER BY m.id DESC LIMIT ${limit + 1}
      ` as unknown as DatabaseMessage[];
    } else if (afterId) {
      rows = await sql`
        SELECT m.id::text AS id, m.display_name AS "displayName", m.content, m.created_at AS "createdAt",
          p.id::text AS "replyToId", p.display_name AS "replyToName", p.content AS "replyToContent",
          COALESCE(r.reactions, '[]'::json) AS reactions
        FROM chat_messages m
        LEFT JOIN chat_messages p ON p.id = m.reply_to_id AND p.room_key = m.room_key
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object('emoji', g.emoji, 'count', g.n, 'reacted', g.reacted)) AS reactions
          FROM (SELECT emoji, COUNT(*)::int AS n, COALESCE(BOOL_OR(actor_id = ${actorId}::uuid), false) AS reacted
            FROM chat_message_reactions WHERE message_id = m.id GROUP BY emoji) g
        ) r ON TRUE
        WHERE m.room_key = ${room.data} AND m.id > ${afterId}::bigint
        ORDER BY m.id ASC LIMIT ${limit + 1}
      ` as unknown as DatabaseMessage[];
    } else {
      rows = await sql`
        SELECT m.id::text AS id, m.display_name AS "displayName", m.content, m.created_at AS "createdAt",
          p.id::text AS "replyToId", p.display_name AS "replyToName", p.content AS "replyToContent",
          COALESCE(r.reactions, '[]'::json) AS reactions
        FROM chat_messages m
        LEFT JOIN chat_messages p ON p.id = m.reply_to_id AND p.room_key = m.room_key
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object('emoji', g.emoji, 'count', g.n, 'reacted', g.reacted)) AS reactions
          FROM (SELECT emoji, COUNT(*)::int AS n, COALESCE(BOOL_OR(actor_id = ${actorId}::uuid), false) AS reacted
            FROM chat_message_reactions WHERE message_id = m.id GROUP BY emoji) g
        ) r ON TRUE
        WHERE m.room_key = ${room.data}
        ORDER BY m.id DESC LIMIT ${limit + 1}
      ` as unknown as DatabaseMessage[];
    }
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    if (!afterId) page.reverse();
    return jsonResponse({ messages: page.map(normalizeMessage), hasMore });
  } catch {
    return jsonResponse({ code: "database_unavailable", error: "The chat database is not connected yet. Connect PostgreSQL to load this room." }, 503);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "Send a valid JSON message." }, 400); }
  const parsed = newMessageSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ error: parsed.error.issues[0]?.message ?? "Check your message and try again." }, 400);
  try {
    await ensureChatSchema();
    const sql = getSql();
    const [row] = await sql`
      WITH allocated AS (
        UPDATE chat_room_counters SET next_id = next_id + 1
        WHERE room_key = 'global' RETURNING (next_id - 1)::text AS id
      ), inserted AS (
        INSERT INTO chat_messages (id, display_name, content, created_at, reply_to_id, room_key)
        SELECT a.id::bigint, ${parsed.data.displayName}, ${parsed.data.content}, clock_timestamp(),
          CASE WHEN ${parsed.data.replyToId ?? null}::bigint IS NULL THEN NULL
            ELSE (SELECT id FROM chat_messages WHERE id = ${parsed.data.replyToId ?? null}::bigint AND room_key = ${parsed.data.room}) END,
          ${parsed.data.room}
        FROM allocated a
        WHERE ${parsed.data.replyToId ?? null}::bigint IS NULL
          OR EXISTS (SELECT 1 FROM chat_messages WHERE id = ${parsed.data.replyToId ?? null}::bigint AND room_key = ${parsed.data.room})
        RETURNING id, display_name, content, created_at, reply_to_id
      )
      SELECT i.id::text AS id, i.display_name AS "displayName", i.content, i.created_at AS "createdAt",
        p.id::text AS "replyToId", p.display_name AS "replyToName", p.content AS "replyToContent"
      FROM inserted i LEFT JOIN chat_messages p ON p.id = i.reply_to_id
    ` as unknown as DatabaseMessage[];
    if (!row) return jsonResponse({ error: "The message you are replying to no longer exists in this room." }, 404);
    return jsonResponse({ message: normalizeMessage(row) }, 201);
  } catch {
    return jsonResponse({ code: "database_unavailable", error: "Your message could not be saved. Check the database connection." }, 503);
  }
}
