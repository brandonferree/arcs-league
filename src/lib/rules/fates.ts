/**
 * The 24 fates of ARCS: The Blighted Reach, in three tiers of eight.
 * Tier equals the act the fate card belongs to.
 *
 *   A fates -> any act (after Act I only as a continuation)
 *   B fates -> Act II or III
 *   C fates -> Act III only
 *
 * The database is the source of truth at runtime (fates are moderator-editable);
 * this list is the seed data and the default for pure rule checks and tests.
 */

export type Tier = "A" | "B" | "C";
export type ActNumber = 1 | 2 | 3;

export const TIERS: readonly Tier[] = ["A", "B", "C"];

export const A_FATES = [
  "Steward", "Founder", "Magnate", "Advocate",
  "Caretaker", "Partisan", "Admiral", "Believer",
] as const;
export const B_FATES = [
  "Pathfinder", "Hegemon", "Planet Breaker", "Pirate",
  "Blight Speaker", "Pacifist", "Peacekeeper", "Warden",
] as const;
export const C_FATES = [
  "Overlord", "Survivalist", "Redeemer", "Guardian",
  "Naturalist", "Gate Wraith", "Conspirator", "Judge",
] as const;

export interface FateSeed {
  name: string;
  tier: Tier;
  act: ActNumber;
  /** Buried Giant card id, ARCS-FATE01..24, in tier order. */
  cardId: string;
  sortOrder: number;
}

export const FATE_SEED: readonly FateSeed[] = [
  ...A_FATES.map((name) => ({ name, tier: "A" as const, act: 1 as const })),
  ...B_FATES.map((name) => ({ name, tier: "B" as const, act: 2 as const })),
  ...C_FATES.map((name) => ({ name, tier: "C" as const, act: 3 as const })),
].map((f, i) => ({ ...f, cardId: `ARCS-FATE${String(i + 1).padStart(2, "0")}`, sortOrder: i + 1 }));

/** Looks up a fate's tier by name; undefined when the fate is unknown. */
export type TierLookup = (fate: string) => Tier | undefined;

export function tierLookupFrom(fates: ReadonlyArray<{ name: string; tier: Tier }>): TierLookup {
  const map = new Map(fates.map((f) => [f.name, f.tier]));
  return (fate) => map.get(fate);
}

export const defaultTierOf: TierLookup = tierLookupFrom(FATE_SEED);

/** Tiers whose fates may be *selected* in a given act (before continuation rules). */
export function tiersSelectableInAct(act: ActNumber): Tier[] {
  if (act === 1) return ["A"];
  if (act === 2) return ["A", "B"];
  return ["A", "B", "C"];
}
