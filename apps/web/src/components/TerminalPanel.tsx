import { useState, type FormEvent } from "react";

interface Line {
  id: number;
  text: string;
  kind: "cmd" | "info";
}

let nextId = 2;
const INITIAL: Line[] = [
  { id: 1, kind: "info", text: "CollabCode terminal — no interactive shell is connected to this panel. To run a program, use the Run button and read its captured output in the Output tab." },
];

export function TerminalPanel() {
  const [lines, setLines] = useState<Line[]>(INITIAL);
  const [value, setValue] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const cmd = value.trim();
    if (!cmd) return;
    setLines((prev) => [
      ...prev,
      { id: nextId++, kind: "cmd", text: `$ ${cmd}` },
      { id: nextId++, kind: "info", text: "Not connected: there is no interactive shell behind this panel. Use Run + the Output tab to execute code." },
    ]);
    setValue("");
  }

  return (
    <div className="flex h-full flex-col font-mono text-xs">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" aria-label="Terminal output">
        {lines.map((l) => (
          <p key={l.id} className={l.kind === "cmd" ? "text-zinc-800 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400"}>
            {l.text}
          </p>
        ))}
      </div>
      <form onSubmit={submit} className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <span aria-hidden className="text-zinc-500">$</span>
        <label className="sr-only" htmlFor="terminal-input">Terminal command</label>
        <input
          id="terminal-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Interactive shell not connected — use Run for program execution"
          className="h-7 flex-1 bg-transparent text-zinc-800 focus:outline-none dark:text-zinc-100"
        />
      </form>
    </div>
  );
}
