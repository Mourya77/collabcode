import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * Invitation email delivery (Phase 4).
 *
 * Two implementations behind the Mailer interface:
 *
 * - DevMailer (default, whenever SMTP_HOST is unset): "delivers" by logging
 *   the invitation link and relying on the API returning that link in the
 *   POST /invitations response (`inviteUrl`). This is DEVELOPMENT MODE —
 *   anyone who can call the invitations endpoint can copy the link, so it is
 *   only appropriate for local development and demos.
 *
 * - SmtpMailer: configuration shell for production. It validates that the
 *   full SMTP_* configuration exists (and fails loudly when it does not),
 *   but the API intentionally bundles NO SMTP transport: production
 *   deployments wire a real transport (nodemailer with these settings, or a
 *   provider SDK such as Resend/SES) in this class. See docs/api.md
 *   ("Email delivery") for the required configuration.
 */

export interface InvitationEmail {
  to: string;
  inviteUrl: string;
  projectName: string;
  inviterName: string;
  role: "EDITOR" | "VIEWER";
  expiresAt: Date;
}

export interface Mailer {
  readonly mode: "dev" | "smtp";
  sendInvitation(email: InvitationEmail): Promise<void>;
}

export class DevMailer implements Mailer {
  readonly mode = "dev" as const;
  async sendInvitation(email: InvitationEmail): Promise<void> {
    logger.info(
      { to: email.to, project: email.projectName, role: email.role, expiresAt: email.expiresAt.toISOString() },
      `[dev-mailer] Invitation to join "${email.projectName}" — share this link with ${email.to}: ${email.inviteUrl}`,
    );
  }
}

const SMTP_REQUIRED = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;

export class SmtpMailer implements Mailer {
  readonly mode = "smtp" as const;
  constructor() {
    const missing = SMTP_REQUIRED.filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(
        `SMTP email delivery is not configured: missing ${missing.join(", ")}. ` +
          "Set the full SMTP_* configuration or unset SMTP_HOST to use the development mailer (see docs/api.md).",
      );
    }
  }
  async sendInvitation(_email: InvitationEmail): Promise<void> {
    throw new Error(
      "SMTP is configured but no SMTP transport is bundled with this API build. " +
        "Wire a transport (nodemailer / provider SDK) in src/lib/mailer.ts — see docs/api.md.",
    );
  }
}

let cached: Mailer | null = null;

/** Process-wide mailer, chosen from configuration (see class docs above). */
export function getMailer(): Mailer {
  cached ??= env.SMTP_HOST ? new SmtpMailer() : new DevMailer();
  return cached;
}
