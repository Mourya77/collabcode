import { z } from "zod";

export const createVersionSchema = z.object({
  content: z.string().max(1_000_000),
  /** Optional label — a labelled create is stored as a user SNAPSHOT (Phase 6). */
  label: z.string().trim().min(1).max(120).optional(),
});

export type CreateVersionInput = z.infer<typeof createVersionSchema>;

/** Phase 6 restore: the caller's current live editor content (snapshotted before the restore). */
export const restoreVersionSchema = z.object({
  currentContent: z.string().max(1_000_000),
});

export type RestoreVersionInput = z.infer<typeof restoreVersionSchema>;
