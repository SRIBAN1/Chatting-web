import { NextRequest, NextResponse } from "next/server";
import { ensureChatSchema, getSql } from "@/src/lib/database";
import { messageIdSchema, newMessageSchema } from "@/src/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

type DatabaseMessage = {
  id: string;
  displayName: string;
  content: string;
  createdAt: string | Date;
  replyToId?: string | null;
  replyToName?: string | null;
  replyToContent?: string | null;
};

type PublicMessage = {
  id: string;
  displayName: string;
  content: string;
  createdAt: string;
  replyTo?: { id: string; displayName: string; content: string } | null;
};

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function normalizeMessage(row: DatabaseMessage): PublicMessage {
  return {
    id: String(row.id),
    displayName: row.displayName,
    content: row.content,
    createdAt: new Date(row.createdAt).toISOString(),
    replyTo: row.replyToId && typeof row.replyToName === "string" && typeof row.replyToContent === "string"
      ? { id: row.replyToId, displayName: row.replyToName, content: row.replyToContent }
      : null,
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
  const limit = readPageSize(url.searchParams.get("limit"));

  if (limit === null) {
    return jsonResponse({ error: `Page size must be between 1 and ${MAX_PAGE_SIZE}.` }, 400);
  }
  if (beforeId && afterId) {
    return jsonResponse({ error: "Choose either older history or new messages, not both." }, 400);
  }
  if ((beforeId && !messageIdSchema.safeParse(beforeId).success) || (afterId && !messageIdSchema.safeParse(afterId).success)) {
    return jsonResponse({ error: "The message cursor is invalid." }, 400);
  }

  try {
    await ensureChatSchema();
    const sql = getSql();
    let rows: DatabaseMessage[];

    if (beforeId) {
      rows = (await sql`
        SELECT message.id::text AS id, message.display_name AS "displayName", message.content,
          message.created_at AS "createdAt", parent.id::text AS "replyToId",
          parent.display_name AS "replyToName", parent.content AS "replyToContent"
        FROM chat_messages AS message
        LEFT JOIN chat_messages AS parent ON parent.id = message.reply_to_id
        WHERE message.id < ${beforeId}::bigint
        ORDER BY message.id DESC
        LIMIT ${limit + 1}
      `) as unknown as DatabaseMessage[];
    } else if (afterId) {
      rows = (await sql`
        SELECT message.id::text AS id, message.display_name AS "displayName", message.content,
          message.created_at AS "createdAt", parent.id::text AS "replyToId",
          parent.display_name AS "replyToName", parent.content AS "replyToContent"
        FROM chat_messages AS message
        LEFT JOIN chat_messages AS parent ON parent.id = message.reply_to_id
        WHERE message.id > ${afterId}::bigint
        ORDER BY message.id ASC
        LIMIT ${limit + 1}
      `) as unknown as DatabaseMessage[];
    } else {
      rows = (await sql`
        SELECT message.id::text AS id, message.display_name AS "displayName", message.content,
          message.created_at AS "createdAt", parent.id::text AS "replyToId",
          parent.display_name AS "replyToName", parent.content AS "replyToContent"
        FROM chat_messages AS message
        LEFT JOIN chat_messages AS parent ON parent.id = message.reply_to_id
        ORDER BY message.id DESC
        LIMIT ${limit + 1}
      `) as unknown as DatabaseMessage[];
    }

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    if (!afterId) page.reverse();

    return jsonResponse({ messages: page.map(normalizeMessage), hasMore });
  } catch {
    return jsonResponse(
      {
        code: "database_unavailable",
        error: "The chat database is not connected yet. Connect PostgreSQL to this deployment to load the conversation.",
      },
      503,
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Send a valid JSON message." }, 400);
  }

  const parsed = newMessageSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: parsed.error.issues[0]?.message ?? "Check the name and message and try again." }, 400);
  }

  try {
    await ensureChatSchema();
    const sql = getSql();
    const [row] = (await sql`
      WITH allocated AS (
        UPDATE chat_room_counters
        SET next_id = next_id + 1
        WHERE room_key = 'lobby'
        RETURNING (next_id - 1)::text AS id
      ), inserted AS (
        INSERT INTO chat_messages (id, display_name, content, created_at, reply_to_id)
        SELECT allocated.id::bigint, ${parsed.data.displayName}, ${parsed.data.content}, clock_timestamp(),
          CASE WHEN ${parsed.data.replyToId ?? null}::bigint IS NULL THEN NULL
            ELSE (SELECT id FROM chat_messages WHERE id = ${parsed.data.replyToId ?? null}::bigint)
          END
        FROM allocated
        WHERE ${parsed.data.replyToId ?? null}::bigint IS NULL
          OR EXISTS (SELECT 1 FROM chat_messages WHERE id = ${parsed.data.replyToId ?? null}::bigint)
        RETURNING id, display_name, content, created_at, reply_to_id
      )
      SELECT inserted.id::text AS id, inserted.display_name AS "displayName", inserted.content,
        inserted.created_at AS "createdAt", parent.id::text AS "replyToId",
        parent.display_name AS "replyToName", parent.content AS "replyToContent"
      FROM inserted LEFT JOIN chat_messages AS parent ON parent.id = inserted.reply_to_id
    `) as unknown as DatabaseMessage[];

    if (!row) return jsonResponse({ error: "The message you are replying to no longer exists." }, 404);
    return jsonResponse({ message: normalizeMessage(row) }, 201);
  } catch {
    return jsonResponse(
      {
        code: "database_unavailable",
        error: "Your message could not be saved. Connect PostgreSQL to this deployment, then try again.",
      },
      503,
    );
  }
}
