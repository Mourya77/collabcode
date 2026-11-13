import { z } from "zod";

/**
 * Create-execution body. The client names FILES (by id), never paths or
 * content addressed by path: paths and any DB content are resolved
 * server-side from the File rows, so a client cannot smuggle arbitrary
 * filesystem paths into the execution service. Optional per-file `content`
 * carries the caller's live editor state for files they have open.
 */
export const createExecutionSchema = z.object({
  entryFileId: z.string().uuid(),
  files: z
    .array(
      z.object({
        fileId: z.string().uuid(),
        content: z.string().max(1_000_000).optional(),
      }),
    )
    .max(50)
    .optional(),
});

export type CreateExecutionInput = z.infer<typeof createExecutionSchema>;
