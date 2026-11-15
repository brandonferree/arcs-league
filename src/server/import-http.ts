/**
 * HTTP side of the meeples push (POST /api/import/act), kept apart from the
 * route so it is unit-tested: the Bearer check and the response for each
 * outcome, as documented in docs/ACT_SUMMARY_FORMAT.md.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { ReceiveOutcome } from "./imports";

/** The configured secret, or null when pushes are switched off. */
export function importSecret(): string | null {
  const s = process.env.MEEPLES_IMPORT_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
}

/** Constant-time check of an `Authorization: Bearer <secret>` header. */
export function bearerMatches(header: string | null, secret: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "");
  if (!m) return false;
  const a = createHash("sha256").update(m[1].trim()).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export interface ImportHttpResponse {
  status: number;
  body: Record<string, unknown>;
}

export function importResponse(outcome: ReceiveOutcome, base: string): ImportHttpResponse {
  switch (outcome.status) {
    case "saved":
      return { status: 201, body: { status: "saved", actUrl: `${base}/campaigns/${outcome.campaignId}#act-${outcome.actNo}` } };
    case "pending":
      return { status: 202, body: { status: "pending", confirmUrl: `${base}/imports/${outcome.importId}`, problems: outcome.problems } };
    case "conflict":
      return {
        status: 409,
        body: {
          status: "conflict",
          actUrl: `${base}/campaigns/${outcome.campaignId}#act-${outcome.actNo}`,
          confirmUrl: `${base}/imports/${outcome.importId}`,
        },
      };
    case "invalid":
      return { status: 400, body: { status: "invalid", errors: outcome.errors } };
  }
}
