import { describe, expect, it } from "vitest";
import {
  buriedGiantCardUrl,
  cardTextPlain,
  parseCardText,
  parseUpstream,
  pickerGroups,
  planCardImport,
  toCardRow,
  type PickerCard,
} from "./cards";

const fatesByName = new Map([
  ["Steward", 1],
  ["Founder", 2],
]);

const upstream = [
  { id: "ARCS-FATE01", name: "Steward", text: "x", tags: ["Blighted Reach", "Fate", "Steward"], meta: { act: 1, complexity: 2 }, game: "arcs", product: "blightedreach" },
  { id: "ARCS-F103", name: "Dealmakers", text: "y", tags: ["Blighted Reach", "Guild", "Psionic", "Steward"], meta: { keys: 0, act: 1 }, game: "arcs", product: "blightedreach" },
  { id: "ARCS-F101A", name: "Steward Act I Setup", tags: ["Blighted Reach", "Setup", "Steward"], game: "arcs", product: "blightedreach" },
  { id: "ARCS-AID01A", name: "Imperial Council in Session", tags: ["Blighted Reach", "Imperial Council"], game: "arcs", product: "blightedreach" },
  { id: "ARCS-L01", name: "Tool-Priests", text: "z", tags: ["Base", "Lore"], game: "arcs", product: "arcsbasegame" },
  { id: "ARCS-BC01", name: "Loyal Engineers", tags: ["Base", "Base Court", "Guild", "Material"], game: "arcs", product: "arcsbasegame" },
  { id: "ARCS-BAD", tags: ["Base"], game: "arcs" },
  { id: "ROOT-1", name: "Not ARCS", tags: ["A", "B"], game: "root" },
];

describe("parseUpstream", () => {
  it("keeps ARCS cards, drops setup cards, player aids and base court cards, counts malformed records", () => {
    const { cards, skipped } = parseUpstream(upstream);
    expect(cards.map((c) => c.id)).toEqual(["ARCS-FATE01", "ARCS-F103", "ARCS-L01"]);
    expect(skipped).toBe(1);
  });
  it("refuses something that is not a list", () => {
    expect(() => parseUpstream({ cards: [] })).toThrow();
  });
});

describe("toCardRow", () => {
  it("takes type, fate, act and keys from tags and meta", () => {
    const [fate, guild, lore] = parseUpstream(upstream).cards.map((c) => toCardRow(c, fatesByName));
    expect(fate).toMatchObject({ type: "Fate", fateId: 1, act: 1, keys: null });
    expect(guild).toMatchObject({ type: "Guild", fateId: 1, act: 1, keys: 0, product: "blightedreach" });
    expect(lore).toMatchObject({ type: "Lore", fateId: null, act: null });
  });
});

describe("planCardImport", () => {
  const { cards } = parseUpstream(upstream);
  it("adds everything the first time", () => {
    const plan = planCardImport([], cards, fatesByName);
    expect(plan.added.map((a) => a.id)).toEqual(["ARCS-FATE01", "ARCS-F103", "ARCS-L01"]);
    expect(plan.rows).toHaveLength(3);
  });
  it("finds changed, removed and restored cards, ignoring key order", () => {
    const existing = [
      { id: "ARCS-FATE01", name: "Steward", source: { ...cards[0] }, removedAt: null },
      // same content, keys in another order: unchanged
      { id: "ARCS-L01", name: "Tool-Priests", source: Object.fromEntries(Object.entries(cards[2]).reverse()), removedAt: null },
      { id: "ARCS-OLD", name: "Gone", source: {}, removedAt: null },
      { id: "ARCS-F103", name: "Dealmakers", source: {}, removedAt: new Date() },
    ];
    const edited = [{ ...cards[0], text: "new text" }, cards[1], cards[2]];
    const plan = planCardImport(existing, edited, fatesByName);
    expect(plan.changed.map((c) => c.id)).toEqual(["ARCS-FATE01"]);
    expect(plan.removed.map((c) => c.id)).toEqual(["ARCS-OLD"]);
    expect(plan.restored.map((c) => c.id)).toEqual(["ARCS-F103"]);
    expect(plan.added).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });
});

describe("parseCardText", () => {
  it("splits paragraphs and reads bold, italic, bold italic and symbols", () => {
    const p = parseCardText("**Summon (Build):** build at ***any*** city.\n \n*Yes, even Rivals!* Advance 1 `symbol:clock`.");
    expect(p).toEqual([
      [[{ kind: "b", value: "Summon (Build):" }, { kind: "text", value: " build at " }, { kind: "bi", value: "any" }, { kind: "text", value: " city." }]],
      [[{ kind: "i", value: "Yes, even Rivals!" }, { kind: "text", value: " Advance 1 " }, { kind: "symbol", value: "clock" }, { kind: "text", value: "." }]],
    ]);
  });
  it("tolerates upstream symbol typos and leaves stray asterisks as text", () => {
    expect(parseCardText("`symobl:clock` and `symbol\"clock`")[0][0].filter((s) => s.kind === "symbol")).toHaveLength(2);
    expect(cardTextPlain("5 * 3 is 15")).toBe("5 * 3 is 15");
  });
  it("is empty for missing text", () => {
    expect(parseCardText(null)).toEqual([]);
    expect(parseCardText(" ")).toEqual([]);
  });
});

describe("pickerGroups", () => {
  const all: PickerCard[] = [
    { id: "F1", name: "Steward", type: "Fate", fateId: 1, act: 1 },
    { id: "F2", name: "Tax Collectors", type: "Guild", fateId: 1, act: 2 },
    { id: "F3", name: "Dealmakers", type: "Guild", fateId: 1, act: 1 },
    { id: "F4", name: "Steward Act I Resolution", type: "Resolution", fateId: 1, act: 1 },
    { id: "G1", name: "Founder Guild", type: "Guild", fateId: 2, act: 1 },
    { id: "G2", name: "Founder Law", type: "Law", fateId: 2, act: 2 },
    { id: "C1", name: "Mining Interest", type: "Blighted Reach Court", fateId: null, act: null },
    { id: "C2", name: "Loyal Engineers", type: "Base Court", fateId: null, act: null },
    { id: "L1", name: "Tool-Priests", type: "Lore", fateId: null, act: null },
    { id: "L2", name: "Golem Beacon", type: "Lore", fateId: 1, act: 1 },
    { id: "X1", name: "Elder", type: "Leader", fateId: null, act: null },
  ];
  it("offers the player's fate cards first, this act's first, then court, Lore and other fates' court-bound cards, each once", () => {
    const groups = pickerGroups(all, { id: 1, name: "Steward" }, 2);
    expect(groups.map((g) => [g.label, g.cards.map((c) => c.id)])).toEqual([
      ["Steward cards", ["F2", "F3", "L2"]],
      ["Court cards", ["C1"]],
      ["Lore", ["L1"]],
      ["Other fates' Guild and Vox cards", ["G1"]],
    ]);
  });
});

it("links each card back to Buried Giant", () => {
  expect(buriedGiantCardUrl("ARCS-F103")).toBe("https://cards.buriedgiant.com/card/ARCS-F103");
});
