/**
 * Language adapters.
 *
 * Each supported language is a small declarative definition: a FIXED Docker
 * image (clients can never choose images) and the ordered steps needed to
 * run a program — an optional compile step followed by a run step. Both
 * runners consume the same step list; the local (subprocess) runner uses the
 * same binary names (node / python3 / g++) that the images provide.
 *
 * Adding a language = adding one entry here. Nothing else in the service
 * (validation, API, frontend language detection) hardcodes commands.
 */
export type LanguageId = "javascript" | "python" | "cpp";

export type StepPhase = "compile" | "run";

export interface RunStep {
  phase: StepPhase;
  argv: string[];
}

export interface LanguageDef {
  id: LanguageId;
  /** Fixed image used by the Docker runner. Never client-controlled. */
  dockerImage: string;
  /**
   * Steps for a job, given the entry-point path RELATIVE to the workspace
   * root (e.g. "src/main.cpp"). The workspace is the process working
   * directory in both runners (Docker: /workspace, mounted from the host).
   * The C++ build product goes to ".build/app" inside the workspace so the
   * run step (a separate container/process) can execute it.
   */
  steps(entryPoint: string): RunStep[];
}

export const LANGUAGES: Record<LanguageId, LanguageDef> = {
  javascript: {
    id: "javascript",
    dockerImage: "node:20-alpine",
    steps: (entryPoint) => [{ phase: "run", argv: ["node", entryPoint] }],
  },
  python: {
    id: "python",
    dockerImage: "python:3.12-alpine",
    steps: (entryPoint) => [{ phase: "run", argv: ["python3", entryPoint] }],
  },
  cpp: {
    id: "cpp",
    dockerImage: "gcc:13-bookworm",
    steps: (entryPoint) => [
      { phase: "compile", argv: ["g++", "-O2", "-std=c++17", "-o", ".build/app", entryPoint] },
      { phase: "run", argv: [".build/app"] },
    ],
  },
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];

export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === "string" && (LANGUAGE_IDS as string[]).includes(value);
}

export function getLanguage(id: LanguageId): LanguageDef {
  return LANGUAGES[id];
}
