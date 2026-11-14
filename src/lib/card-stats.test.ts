import { describe, expect, it } from "vitest";
import {
  CARD_WIN_RATE_MIN_HOLDERS,
  cardKind,
  enoughHolders,
  loreGuildByAct,
  playerCards,
  type ActNo,
  type StatTableau,
  type TableauCard,
} from "./card-stats";

const LORE_A: TableauCard = { id: "ARCS-L01", name: "Tool-Priests", type: "Lore", tags: ["Base", "Lore"], imageV: 1 };
const LORE_B: TableauCard = { id: "ARCS-L02", name: "Galactic Rifles", type: "Lore", tags: ["Base", "Lore"], imageV: null };
const COURT_GUILD: TableauCard = { id: "ARCS-CC01", name: "Mining Interest", type: "Blighted Reach Court", tags: ["Blighted Reach", "Blighted Reach Court", "Guild", "Material"], imageV: 2 };
const FATE_GUILD: TableauCard = { id: "ARCS-F103", name: "Dealmakers", type: "Guild", tags: ["Blighted Reach", "Guild", "Psionic", "Steward"], imageV: 3 };
const VOX: TableauCard = { id: "ARCS-CC20", name: "Populist Demands", type: "Blighted Reach Court", tags: ["Blighted Reach", "Blighted Reach Court", "Vox"], imageV: 4 };
const FATE_VOX: TableauCard = { id: "ARCS-F104", name: "Call to Order", type: "Vox", tags: ["Blighted Reach", "Vox", "Steward"], imageV: 5 };

function tab(
  campaignId: number,
  actNo: ActNo,
  playerId: number,
  cards: TableauCard[],
  o: { closed?: boolean; winner?: boolean; playedOn?: string } = {},
): StatTableau {
  return {
    campaignId,
    title: `Campaign #${campaignId}`,
    playedOn: o.playedOn ?? `2026-10-${String(campaignId).padStart(2, "0")}`,
    closed: o.closed ?? true,
    actNo,
    campaignPlayerId: campaignId * 10 + playerId,
    playerId,
    player: `P${playerId}`,
    isGuest: false,
    isWinner: o.winner ?? false,
    cards,
  };
}

describe("cardKind", () => {
  it("Lore is type Lore; Guild is type Guild or tagged Guild (court Guild cards)", () => {
    expect(cardKind(LORE_A)).toBe("lore");
    expect(cardKind(FATE_GUILD)).toBe("guild");
    expect(cardKind(COURT_GUILD)).toBe("guild");
    expect(cardKind(VOX)).toBeNull();
    expect(cardKind(FATE_VOX)).toBeNull();
    expect(cardKind({ type: "Fate", tags: ["Blighted Reach", "Fate", "Steward"] })).toBeNull();
  });
});

describe("loreGuildByAct", () => {
  const data = [
    // Campaign 1, closed, P1 won.
    tab(1, 1, 1, [LORE_A, VOX], { winner: true }),
    tab(1, 1, 2, [COURT_GUILD]),
    tab(1, 2, 1, [LORE_A, COURT_GUILD, FATE_GUILD], { winner: true }),
    tab(1, 2, 2, [LORE_B]),
    // Campaign 2, closed, P3 won.
    tab(2, 1, 3, [LORE_A], { winner: true }),
    tab(2, 1, 1, [VOX]),
    // Campaign 3, in progress: counts towards "held" and averages, not win rates.
    tab(3, 1, 2, [LORE_A, LORE_B, COURT_GUILD], { closed: false }),
  ];
  const [a1, a2, a3] = loreGuildByAct(data);

  it("counts held tableaux per card and act, most held first", () => {
    expect(a1.actNo).toBe(1);
    expect(a1.lore.map((r) => [r.id, r.held])).toEqual([
      ["ARCS-L01", 3],
      ["ARCS-L02", 1],
    ]);
    expect(a1.guild.map((r) => [r.id, r.held])).toEqual([["ARCS-CC01", 2]]);
    expect(a2.guild.map((r) => r.id).sort()).toEqual(["ARCS-CC01", "ARCS-F103"]);
    expect(a3).toMatchObject({ tableaux: 0, avgLore: null, avgGuild: null, lore: [], guild: [] });
  });

  it("win rate counts closed campaigns only", () => {
    const tool = a1.lore[0];
    expect(tool).toMatchObject({ held: 3, holders: 2, wins: 2, winRate: 1 });
    const mining = a1.guild[0];
    expect(mining).toMatchObject({ held: 2, holders: 1, wins: 0, winRate: 0 });
    const rifles = a1.lore[1];
    expect(rifles).toMatchObject({ held: 1, holders: 0, wins: 0, winRate: null });
  });

  it("averages Lore and Guild cards per recorded tableau", () => {
    // Act I tableaux: [L,V] [G] [L] [V] [L,L,G] -> Lore 1+0+1+0+2 = 4 / 5; Guild 0+1+0+0+1 = 2 / 5.
    expect(a1.tableaux).toBe(5);
    expect(a1.avgLore).toBeCloseTo(0.8);
    expect(a1.avgGuild).toBeCloseTo(0.4);
    // Act II: [L,G,G] [L] -> Lore 2/2, Guild 2/2.
    expect(a2).toMatchObject({ tableaux: 2, avgLore: 1, avgGuild: 1 });
  });

  it("ties on held break by closed holders, then name", () => {
    const [x] = loreGuildByAct([
      tab(1, 1, 1, [LORE_B], { closed: false }),
      tab(2, 1, 1, [LORE_A]),
    ]);
    expect(x.lore.map((r) => r.id)).toEqual(["ARCS-L01", "ARCS-L02"]);
  });

  it("names the small-sample threshold", () => {
    expect(enoughHolders(CARD_WIN_RATE_MIN_HOLDERS)).toBe(true);
    expect(enoughHolders(CARD_WIN_RATE_MIN_HOLDERS - 1)).toBe(false);
  });
});

describe("playerCards", () => {
  const data = [
    tab(1, 1, 1, [VOX, LORE_A], { winner: true, playedOn: "2026-10-01" }),
    tab(1, 2, 1, [LORE_A, COURT_GUILD, FATE_GUILD], { winner: true, playedOn: "2026-10-01" }),
    tab(1, 1, 2, [LORE_B]),
    tab(2, 1, 1, [LORE_A, COURT_GUILD], { closed: false, playedOn: "2026-11-01" }),
  ];

  it("is null for a player with no recorded tableaux", () => {
    expect(playerCards(data, 99)).toBeNull();
  });

  it("lists the cards held per act, Lore then Guild then the rest, with counts", () => {
    const p = playerCards(data, 1)!;
    expect(p.byAct[0].cards.map((c) => [c.id, c.kind, c.count])).toEqual([
      ["ARCS-L01", "lore", 2],
      ["ARCS-CC01", "guild", 1],
      ["ARCS-CC20", null, 1],
    ]);
    expect(p.byAct[0]).toMatchObject({ tableaux: 2, avgLore: 1, avgGuild: 0.5 });
    expect(p.byAct[1]).toMatchObject({ tableaux: 1, avgLore: 1, avgGuild: 2 });
    expect(p.byAct[2]).toMatchObject({ tableaux: 0, avgLore: null, cards: [] });
  });

  it("summarises each campaign's tableaux, newest first", () => {
    const p = playerCards(data, 1)!;
    expect(p.campaigns.map((c) => c.campaignId)).toEqual([2, 1]);
    expect(p.campaigns[1]).toMatchObject({
      won: true,
      closed: true,
      acts: [{ lore: 1, guild: 0, total: 2 }, { lore: 1, guild: 2, total: 3 }, null],
    });
    expect(p.campaigns[0]).toMatchObject({ won: false, closed: false });
  });
});
