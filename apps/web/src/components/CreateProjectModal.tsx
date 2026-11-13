import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectStore } from "../stores/projectStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Modal } from "./ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectModal({ open, onOpenChange }: Props) {
  const createProject = useProjectStore((s) => s.createProject);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openAfter, setOpenAfter] = useState(true);

  function reset() {
    setName("");
    setDescription("");
    setError(null);
    setSubmitting(false);
    setOpenAfter(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const project = await createProject(name, description);
    setSubmitting(false);
    if (!project) {
      setError(useProjectStore.getState().error ?? "Could not create the project.");
      return;
    }
    onOpenChange(false);
    reset();
    if (openAfter) navigate(`/workspace/${project.id}`);
  }

  return (
    <Modal open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }} title="Create project" description="The project is created on the CollabCode server with starter files (welcome.md and src/main.ts).">
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="project-name">Project name</Label>
          <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My awesome project" autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-description">Description (optional)</Label>
          <Input id="project-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What are you building?" />
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" checked={openAfter} onChange={(e) => setOpenAfter(e.target.checked)} className="h-4 w-4 accent-sky-600" />
          Open the workspace after creating
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create project"}</Button>
        </div>
      </form>
    </Modal>
  );
}
