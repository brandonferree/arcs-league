/**
 * Cards (spec section 7, phase 5): what to import from Buried Giant Studios'
 * card database, how their text markup reads, and which cards the tagging
 * picker offers. Pure, so it is unit-tested and shared by server and pages.
 */
import { z } from "zod";

export const BURIED_GIANT_CARDS_URL = "https://cardcdn.buriedgiant.com/cards.json";
export const BURIED_GIANT_VERSION_URL = "https://cardcdn.buriedgiant.com/version.json";

/** Our copy of a card's image (never Buried Giant's URL); null until it has been copied. v changes when the image does. */
export function cardImageUrl(id: string, size: "full" | "thumb", v: number | null | undefined): string | null {
  return v == null ? null : `/api/cards/${encodeURIComponent(id)}/${size}?v=${v}`;
}

/** Each card's page on Buried Giant's own database; every card links back there. */
export function buriedGiantCardUrl(id: string): string {
  return `https://cards.buriedgiant.com/card/${encodeURIComponent(id)}`;
}

/** One record of Buried Giant's cards.json. Unknown fields are kept (they go into `source`). */
export const upstreamCard = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    text: z.string().optional(),
    tags: z.array(z.string()).min(2),
    game: z.string(),
    product: z.string().default(""),
    meta: z.record(z.string(), z.unknown()).optional(),
    flipSide: z.string().optional(),
  })
  .passthrough();
export type UpstreamCard = z.infer<typeof upstreamCard>;

/**
 * Everything ARCS except setup cards and the player aids (AID…), per the spec,
 * and the base game's court cards (BC…), which the league does not use (owner, 2026-11-14).
 */
export function isImportable(c: Pick<UpstreamCard, "id" | "tags" | "game">): boolean {
  return c.game === "arcs" && !c.tags.includes("Setup") && !c.id.startsWith("ARCS-AID") && !c.id.startsWith("ARCS-BC");
}

/** Picks the ARCS cards out of the full cards.json; malformed records are counted, not fatal. */
export function parseUpstream(json: unknown): { cards: UpstreamCard[]; skipped: number } {
  if (!Array.isArray(json)) throw new Error("Buried Giant's cards.json is not a list of cards.");
  const cards: UpstreamCard[] = [];
  let skipped = 0;
  for (const raw of json) {
    if (!raw || typeof raw !== "object" || (raw as { game?: unknown }).game !== "arcs") continue;
    const r = upstreamCard.safeParse(raw);
    if (!r.success) skipped++;
    else if (isImportable(r.data)) cards.push(r.data);
  }
  return { cards, skipped };
}

export interface CardRowInput {
  id: string;
  name: string;
  text: string | null;
  type: string;
  product: string;
  tags: string[];
  fateId: number | null;
  act: number | null;
  keys: number | null;
  flipSideId: string | null;
  source: UpstreamCard;
}

function smallInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 100 ? v : null;
}

/** Maps an upstream card to our row. Its fate is whichever later tag names one (the fate card itself included). */
export function toCardRow(c: UpstreamCard, fateIdByName: ReadonlyMap<string, number>): CardRowInput {
  const fateName = c.tags.slice(2).find((t) => fateIdByName.has(t));
  return {
    id: c.id,
    name: c.name,
    text: c.text?.trim() ? c.text : null,
    type: c.tags[1],
    product: c.product,
    tags: c.tags,
    fateId: fateName ? fateIdByName.get(fateName)! : null,
    act: smallInt(c.meta?.act),
    keys: smallInt(c.meta?.keys),
    flipSideId: c.flipSide ?? null,
    source: c,
  };
}

/** Stable JSON (sorted keys), so a re-ordered but identical record is not a change. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export interface ExistingCard {
  id: string;
  name: string;
  source: unknown;
  removedAt: Date | null;
}

export interface CardImportPlan {
  rows: CardRowInput[];
  added: { id: string; name: string }[];
  changed: { id: string; name: string }[];
  /** No longer upstream: marked removed, never deleted, so their tags survive. */
  removed: { id: string; name: string }[];
  /** Marked removed before, back upstream now. */
  restored: { id: string; name: string }[];
  unchanged: number;
}

export function planCardImport(
  existing: readonly ExistingCard[],
  upstream: readonly UpstreamCard[],
  fateIdByName: ReadonlyMap<string, number>,
): CardImportPlan {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const plan: CardImportPlan = { rows: [], added: [], changed: [], removed: [], restored: [], unchanged: 0 };
  for (const c of upstream) {
    if (seen.has(c.id)) continue; // a duplicate id upstream: first one wins
    seen.add(c.id);
    plan.rows.push(toCardRow(c, fateIdByName));
    const old = byId.get(c.id);
    const ref = { id: c.id, name: c.name };
    if (!old) plan.added.push(ref);
    else if (old.removedAt) plan.restored.push(ref);
    else if (stableJson(old.source) !== stableJson(c)) plan.changed.push(ref);
    else plan.unchanged++;
  }
  for (const e of existing) {
    if (!seen.has(e.id) && !e.removedAt) plan.removed.push({ id: e.id, name: e.name });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Card text

export type TextSegment =
  | { kind: "text" | "b" | "i" | "bi"; value: string }
  | { kind: "symbol"; value: string };

/** One paragraph is a list of lines; each line a list of segments. */
export type CardTextParagraph = TextSegment[][];

const INLINE = /(\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|\*[^*\s][^*]*?\*|`[^`]+`)/g;

function parseLine(line: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    if (m.index! > last) out.push({ kind: "text", value: line.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("`")) {
      const inner = tok.slice(1, -1);
      // `symbol:clock`, tolerating the odd upstream typo (`symobl:clock`, `symbol"clock`).
      const sym = /^sy\w*[:"]\s*([a-z-]+)$/i.exec(inner);
      out.push(sym ? { kind: "symbol", value: sym[1].toLowerCase() } : { kind: "text", value: inner });
    } else if (tok.startsWith("***")) out.push({ kind: "bi", value: tok.slice(3, -3) });
    else if (tok.startsWith("**")) out.push({ kind: "b", value: tok.slice(2, -2) });
    else out.push({ kind: "i", value: tok.slice(1, -1) });
    last = m.index! + tok.length;
  }
  if (last < line.length) out.push({ kind: "text", value: line.slice(last) });
  return out;
}

/** Buried Giant's markup: paragraphs split by blank lines ("\n \n"), **bold**, *italic*, `symbol:name`. */
export function parseCardText(text: string | null | undefined): CardTextParagraph[] {
  if (!text?.trim()) return [];
  return text
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split("\n").map((l) => parseLine(l.trim())));
}

/** Plain text, for search and short previews. */
export function cardTextPlain(text: string | null | undefined): string {
  return parseCardText(text)
    .map((p) => p.map((l) => l.map((s) => (s.kind === "symbol" ? `[${s.value}]` : s.value)).join("")).join(" "))
    .join(" ");
}

// ---------------------------------------------------------------------------
// The tagging picker (spec section 4): the cards in a player's tableau at the end of an act

export interface PickerCard {
  id: string;
  name: string;
  type: string;
  fateId: number | null;
  /** The fate's name, to tell apart fate versions of court cards (there are several "Loyal Engineers"). */
  fate?: string | null;
  act: number | null;
  /** Image version, for the thumbnail; null until copied. */
  imageV?: number | null;
}

export interface PickerGroup {
  key: string;
  label: string;
  cards: PickerCard[];
}

export const COURT_TYPES = ["Blighted Reach Court"] as const;
/** Fate cards that end up in the shared court, so any player can hold another fate's. */
export const COURT_BOUND_FATE_TYPES = ["Guild", "Vox"] as const;
/** Not tableau cards: the fate card sits beside the board and resolutions are read at the end of an act. */
const NOT_ON_TABLEAU = new Set(["Fate", "Resolution"]);

/**
 * Cards a tableau can be tagged with: the player's own fate cards first
 * (that act's first), then court cards, Lore, and other fates' Guild and Vox
 * cards (which enter the court and can be secured by anyone).
 */
export function pickerGroups(all: readonly PickerCard[], fate: { id: number; name: string } | null, actNo: number): PickerGroup[] {
  const byName = (a: PickerCard, b: PickerCard) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const own = fate
    ? all
        .filter((c) => c.fateId === fate.id && !NOT_ON_TABLEAU.has(c.type))
        .sort((a, b) => Number(b.act === actNo) - Number(a.act === actNo) || (a.act ?? 9) - (b.act ?? 9) || byName(a, b))
    : [];
  const ownIds = new Set(own.map((c) => c.id));
  const rest = all.filter((c) => !ownIds.has(c.id)); // each card appears in one group only
  const court = rest.filter((c) => (COURT_TYPES as readonly string[]).includes(c.type)).sort(byName);
  const lore = rest.filter((c) => c.type === "Lore").sort(byName);
  const others = rest
    .filter((c) => c.fateId !== null && (COURT_BOUND_FATE_TYPES as readonly string[]).includes(c.type))
    .sort(byName);
  return [
    fate ? { key: "fate", label: `${fate.name} cards`, cards: own } : null,
    { key: "court", label: "Court cards", cards: court },
    { key: "lore", label: "Lore", cards: lore },
    { key: "others", label: "Other fates' Guild and Vox cards", cards: others },
  ].filter((g): g is PickerGroup => !!g && g.cards.length > 0);
}
