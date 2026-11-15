/**
 * The act summary format (docs/ACT_SUMMARY_FORMAT.md, v1): the JSON that meeples,
 * TTS and screenshot reading produce for one act of one campaign. Pure, so the
 * parser and helpers are unit-tested against the real samples in
 * docs/reference/meeples/.
 */
import { z } from "zod";

export const ACT_SUMMARY_FORMAT = "arcs-league-act-summary";
export const MAX_SUMMARY_BYTES = 64 * 1024;
export const PLATFORMS = ["meeples", "tts", "screenshot"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<string, string> = {
  meeples: "meeples",
  tts: "Tabletop Simulator",
  screenshot: "Screenshot",
};

const cardRef = z
  .object({
    cardId: z.string().trim().max(40).nullable().optional(),
    name: z.string().trim().max(120).nullable().optional(),
  })
  .passthrough()
  .refine((c) => !!c.cardId || !!c.name, "A tableau card needs a cardId or a name");

const playerSchema = z
  .object({
    name: z.string().trim().min(1, "Player name is required").max(60),
    discordId: z
      .string()
      .trim()
      .regex(/^\d{5,25}$/, "discordId must be a Discord user id")
      .nullable()
      .optional(),
    color: z.string().trim().max(20).nullable().optional(),
    seat: z.number().int().min(1).max(4).nullable().optional(),
    fate: z
      .object({
        name: z.string().trim().min(1).max(40),
        cardId: z.string().trim().max(20).nullable().optional(),
      })
      .passthrough(),
    score: z.number().int("score must be a whole number").min(-999).max(999),
    success: z.boolean().nullable().optional(),
    winner: z.boolean().nullable().optional(),
    favors: z.record(z.string(), z.number().int().min(0).max(99)).nullable().optional(),
    tableau: z.array(cardRef).max(60).nullable().optional(),
  })
  .passthrough();

export const actSummarySchema = z
  .object({
    format: z.literal(ACT_SUMMARY_FORMAT, { message: `format must be "${ACT_SUMMARY_FORMAT}"` }),
    version: z.literal(1, { message: "Only version 1 is supported" }),
    source: z
      .object({
        platform: z.enum(PLATFORMS),
        gameId: z.string().trim().min(1).max(100).nullable().optional(),
        campaignGameId: z.string().trim().min(1).max(100).nullable().optional(),
        url: z.string().trim().max(500).nullable().optional(),
        exportedAt: z.string().trim().min(1).max(40),
      })
      .passthrough(),
    leagueCampaign: z.union([z.string().trim().max(500), z.number().int().positive()]).nullable().optional(),
    act: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    datePlayed: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "datePlayed must be YYYY-MM-DD")
      .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "datePlayed is not a valid date"),
    players: z.array(playerSchema).min(3, "A table has 3 or 4 players").max(4, "A table has 3 or 4 players"),
    notes: z.string().max(4000).nullable().optional(),
  })
  .passthrough()
  .superRefine((s, ctx) => {
    const names = s.players.map((p) => p.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: "custom", path: ["players"], message: "Player names must be unique" });
    }
    if (s.act < 3) {
      s.players.forEach((p, i) => {
        if (typeof p.success !== "boolean") {
          ctx.addIssue({ code: "custom", path: ["players", i, "success"], message: "success is required in Acts I and II" });
        }
      });
    }
    if ((s.source.platform === "meeples" || s.source.platform === "tts") && !s.source.gameId) {
      ctx.addIssue({ code: "custom", path: ["source", "gameId"], message: "gameId is required for this platform" });
    }
  });

export type ActSummary = z.infer<typeof actSummarySchema>;
export type SummaryPlayer = ActSummary["players"][number];

export type ParseResult = { ok: true; summary: ActSummary } | { ok: false; errors: string[] };

/** Parses and checks a summary, given as JSON text or an already-parsed value. */
export function parseActSummary(input: unknown): ParseResult {
  let value = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > MAX_SUMMARY_BYTES) {
      return { ok: false, errors: ["The summary is larger than 64 KB."] };
    }
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, errors: ["The summary is not valid JSON."] };
    }
  }
  const r = actSummarySchema.safeParse(value);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)),
    };
  }
  return { ok: true, summary: r.data };
}

/** The platform's key for the whole campaign: the Act I game id when acts are separate games. */
export function campaignKeyOf(s: ActSummary): string | null {
  return s.source.campaignGameId || s.source.gameId || null;
}

/** A league campaign id from `leagueCampaign`: a number, "42", or a link ending in /campaigns/42. */
export function leagueCampaignId(value: ActSummary["leagueCampaign"]): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const m = /^(\d+)$/.exec(value) ?? /\/campaigns\/(\d+)(?:[/?#]|$)/.exec(value);
  const n = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Lower-cased, trimmed, inner spaces collapsed: how names are compared and aliases stored. */
export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface FateRef {
  id: number;
  name: string;
  cardId: string | null;
}

/** Finds a summary player's fate by Buried Giant id, then by name. */
export function findFate(fates: readonly FateRef[], ref: SummaryPlayer["fate"]): FateRef | null {
  if (ref.cardId) {
    const byId = fates.find((f) => f.cardId && f.cardId.toUpperCase() === ref.cardId!.toUpperCase());
    if (byId) return byId;
  }
  const wanted = normaliseName(ref.name);
  return fates.find((f) => normaliseName(f.name) === wanted) ?? null;
}

export interface CardRef {
  id: string;
  name: string;
}

/**
 * Resolves tableau entries to card ids: by id, then by name when exactly one
 * card has that name (several court cards exist in more than one version).
 */
export function matchTableau(
  cards: readonly CardRef[],
  tableau: SummaryPlayer["tableau"],
): { cardIds: string[]; unmatched: string[] } {
  const byId = new Map(cards.map((c) => [c.id.toUpperCase(), c.id]));
  const byName = new Map<string, string[]>();
  for (const c of cards) {
    const k = normaliseName(c.name);
    byName.set(k, [...(byName.get(k) ?? []), c.id]);
  }
  const cardIds: string[] = [];
  const unmatched: string[] = [];
  for (const t of tableau ?? []) {
    const hit = (t.cardId && byId.get(t.cardId.toUpperCase())) || null;
    const named = !hit && t.name ? byName.get(normaliseName(t.name)) : undefined;
    const id = hit ?? (named?.length === 1 ? named[0] : null);
    if (id) {
      if (!cardIds.includes(id)) cardIds.push(id);
    } else {
      unmatched.push(t.name || t.cardId || "?");
    }
  }
  return { cardIds, unmatched };
}

/**
 * Act III winners named by the game, or null to let the league use the highest
 * score. Only `true` flags count.
 */
export function gameWinners(s: ActSummary): string[] | null {
  if (s.act !== 3) return null;
  const w = s.players.filter((p) => p.winner === true).map((p) => p.name);
  return w.length ? w : null;
}

export function winnerReason(platform: string): string {
  return `Winner as decided by the game on ${PLATFORM_LABEL[platform] ?? platform}.`;
}
