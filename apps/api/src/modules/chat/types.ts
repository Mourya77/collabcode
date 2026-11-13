import type { ProjectRole } from "@collabcode/shared";
import type { MessageWithSender } from "../../repositories/types.js";
import type { OnlineUser } from "./presence.js";

export interface MessageDto {
  id: string;
  projectId: string;
  content: string;
  createdAt: string;
  sender: { id: string; name: string; avatarUrl: string | null };
}

export function toMessageDto({ message, sender }: MessageWithSender): MessageDto {
  return {
    id: message.id,
    projectId: message.projectId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    sender: { id: sender.id, name: sender.name, avatarUrl: sender.avatarUrl },
  };
}

export interface MessagePageDto {
  messages: MessageDto[];
  /** Pass as ?cursor= to fetch the next (older) page; null when exhausted. */
  nextCursor: string | null;
}

export interface PresenceMemberDto {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: ProjectRole;
  online: boolean;
  activeFileId: string | null;
  lastSeenAt: string | null;
}

export interface PresenceDto {
  online: OnlineUser[];
  members: PresenceMemberDto[];
}
