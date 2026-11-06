import { NextRequest, NextResponse } from "next/server";
import { ensureChatSchema, getSql } from "@/src/lib/database";
import { actorIdSchema, messageIdSchema, reactionSchema, roomKeySchema } from "@/src/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Send valid reaction data." }, { status: 400 }); }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Send valid reaction data." }, { status: 400 });
  }
  const value = body as Record<string, unknown>;
  const messageId = messageIdSchema.safeParse(value.messageId);
  const room = roomKeySchema.safeParse(value.room);
  const actorId = actorIdSchema.safeParse(value.actorId);
  const emoji = reactionSchema.safeParse(value.emoji);
  if (!messageId.success || !room.success || !actorId.success || !emoji.success) {
    return NextResponse.json({ error: "That reaction is not valid." }, { status: 400 });
  }

  try {
    await ensureChatSchema();
    const sql = getSql();
    const [message] = await sql\`
      SELECT id FROM chat_messages WHERE id = \${messageId.data}::bigint AND room_key = \${room.data}
    \`;
    if (!message) return NextResponse.json({ error: "Message not found in this room." }, { status: 404 });

    await sql\`
      WITH removed AS (
        DELETE FROM chat_message_reactions
        WHERE message_id = \${messageId.data}::bigint
          AND emoji = \${emoji.data} AND actor_id = \${actorId.data}::uuid
        RETURNING id
      )
      INSERT INTO chat_message_reactions (message_id, room_key, emoji, actor_id)
      SELECT \${messageId.data}::bigint, \${room.data}, \${emoji.data}, \${actorId.data}::uuid
      WHERE NOT EXISTS (SELECT 1 FROM removed)
      ON CONFLICT (message_id, emoji, actor_id) DO NOTHING
    \`;
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The reaction could not be saved. Check the database connection." }, { status: 503 });
  }
}
