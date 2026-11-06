import { z } from "zod";

export const DISPLAY_NAME_MAX_LENGTH = 24;
export const MESSAGE_MAX_LENGTH = 500;
export const roomKeySchema = z.enum(["everyone", "ours"]);
export const messageIdSchema = z.string().regex(/^(?:0|[1-9]\d{0,18})$/u);
export const actorIdSchema = z.string().uuid();
export const reactionSchema = z.enum(["👍", "❤️", "😂", "😮", "😢", "🔥"]);

export const newMessageSchema = z.object({
  room: roomKeySchema.default("everyone"),
  displayName: z.string().trim().min(1, "Choose a display name.")
    .max(DISPLAY_NAME_MAX_LENGTH, \`Names must be \${DISPLAY_NAME_MAX_LENGTH} characters or fewer.\`)
    .regex(/^[^\u0000-\u001F\u007F]+$/u, "Names cannot contain control characters."),
  replyToId: messageIdSchema.nullable().optional(),
  content: z.string().trim().min(1, "Write a message before sending.")
    .max(MESSAGE_MAX_LENGTH, \`Messages must be \${MESSAGE_MAX_LENGTH} characters or fewer.\`)
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value), {
      message: "Messages contain unsupported control characters.",
    }),
}).strict();
