export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  children?: FileNode[];
}

export function flattenFiles(nodes: FileNode[], acc: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    if (n.type === "file") acc.push(n);
    if (n.children) flattenFiles(n.children, acc);
  }
  return acc;
}

export function findNode(nodes: FileNode[], id: string): FileNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const f = findNode(n.children, id);
      if (f) return f;
    }
  }
  return undefined;
}
