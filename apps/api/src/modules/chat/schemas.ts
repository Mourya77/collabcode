import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 2000;

export const listMessagesQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

/** Shared content rule for chat messages (REST docs + WS gateway frames). */
export function validateMessageContent(raw: unknown): { ok: true; content: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Message content must be a string." };
  const content = raw.trim();
  if (content.length === 0) return { ok: false, error: "Message content must not be empty." };
  if (content.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Message content must be at most ${MAX_MESSAGE_LENGTH} characters.` };
  }
  return { ok: true, content };
}
