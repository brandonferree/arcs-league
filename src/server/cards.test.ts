import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connectPglite, type DB } from "@/db";
import { auditLog, cards, cardTags, fates, players } from "@/db/schema";
import { parseUpstream } from "@/lib/cards";
import { createCampaign, getCampaign, NotFoundError, PermissionError, RuleError, saveAct } from "./campaigns";
import sharp from "sharp";
import {
  addCardTag,
  cardImageKeys,
  cardImagesWaiting,
  cardTypes,
  copyCardImages,
  fateCards,
  fetchUpstreamCards,
  getCard,
  importCards,
  lastCardImport,
  listCards,
  photoForTagging,
  previewCardImport,
  removeCardTag,
  tagsForPhotos,
} from "./cards";
import { memoryPhotoStore } from "./photo-store";
import { savePhoto } from "./photos";

const RAW: Record<string, unknown>[] = [
  { id: "ARCS-FATE01", name: "Steward", text: "**YOUR PATH**", image: "https://cardcdn.buriedgiant.com/cards/arcs/en-US/FATE01.webp", tags: ["Blighted Reach", "Fate", "Steward"], meta: { act: 1, complexity: 2 }, game: "arcs", product: "blightedreach" },
  { id: "ARCS-F103", name: "Dealmakers", text: "**Bargain (Secure):** Choose a Court card.", image: "https://cardcdn.buriedgiant.com/cards/arcs/en-US/F103.webp", tags: ["Blighted Reach", "Guild", "Psionic", "Steward"], meta: { keys: 0, act: 1 }, game: "arcs", product: "blightedreach" },
  { id: "ARCS-CC01", name: "Mining Interest", text: "Gain 1 Material.", image: "https://cardcdn.buriedgiant.com/cards/arcs/en-US/CC01.webp", tags: ["Blighted Reach", "Blighted Reach Court", "Guild", "Material"], meta: { keys: 2 }, game: "arcs", product: "blightedreach" },
  { id: "ARCS-L01", name: "Tool-Priests", text: "Build 1 ship.", image: "https://evil.example.com/L01.webp", tags: ["Base", "Lore"], game: "arcs", product: "arcsbasegame" },
  { id: "ARCS-F101A", name: "Steward Act I Setup", tags: ["Blighted Reach", "Setup", "Steward"], game: "arcs", product: "blightedreach" },
];
const upstream = (raw = RAW) => ({ ...parseUpstream(raw), version: "v1" });

function fakeJpeg(width: number, height: number) {
  const frame = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, ...Array(10).fill(0)];
  return new Uint8Array([0xff, 0xd8, ...frame, 0xff, 0xd9]);
}

let db: DB;
let ids: Record<string, number>;
const actor = (name: string, isModerator = false) => ({ playerId: ids[name], isModerator });

beforeEach(async () => {
  db = await connectPglite();
  const rows = await db
    .insert(players)
    .values(["Emma", "Chris", "Mark", "Outsider", "Mod"].map((n, i) => ({ displayName: n, discordId: `d${i}` })))
    .returning();
  ids = Object.fromEntries(rows.map((r) => [r.displayName, r.id]));
});

describe("card import", () => {
  it("is for moderators only", async () => {
    expect(await importCards(db, actor("Emma"), upstream()).then(() => null, (e) => e)).toBeInstanceOf(PermissionError);
  });

  it("imports cards, links them to fates, fills fate complexity and audits", async () => {
    const plan = await importCards(db, actor("Mod", true), upstream());
    expect(plan.added).toHaveLength(4);
    const steward = (await db.select().from(fates).where(eq(fates.name, "Steward")))[0];
    expect(steward.complexity).toBe(2);
    expect((await fateCards(db, steward.id)).map((c) => c.id)).toEqual(["ARCS-F103", "ARCS-FATE01"]);
    expect(await lastCardImport(db)).toMatchObject({ version: "v1", total: 4, by: "Mod" });
    expect((await cardTypes(db)).map((t) => t.type)).toEqual(["Blighted Reach Court", "Fate", "Guild", "Lore"]);
  });

  it("re-importing reports changes and removals, and keeps removed cards' rows", async () => {
    await importCards(db, actor("Mod", true), upstream());
    const next = RAW.filter((c) => c.id !== "ARCS-L01").map((c) => (c.id === "ARCS-CC01" ? { ...c, text: "Gain 2 Material." } : c));
    const preview = await previewCardImport(db, upstream(next));
    expect(preview.changed.map((c) => c.id)).toEqual(["ARCS-CC01"]);
    expect(preview.removed.map((c) => c.id)).toEqual(["ARCS-L01"]);
    await importCards(db, actor("Mod", true), upstream(next));
    expect((await getCard(db, "ARCS-CC01"))?.text).toBe("Gain 2 Material.");
    expect((await getCard(db, "ARCS-L01"))?.removedAt).not.toBeNull();
    expect((await listCards(db)).map((c) => c.id)).not.toContain("ARCS-L01");
    // Back again later: restored.
    const again = await importCards(db, actor("Mod", true), upstream());
    expect(again.restored.map((c) => c.id)).toEqual(["ARCS-L01"]);
  });

  it("searches names and text, and filters by type and fate", async () => {
    await importCards(db, actor("Mod", true), upstream());
    expect((await listCards(db, { q: "material" })).map((c) => c.id)).toEqual(["ARCS-CC01"]);
    expect((await listCards(db, { q: "100%_" })).length).toBe(0);
    expect((await listCards(db, { type: "Lore" })).map((c) => c.id)).toEqual(["ARCS-L01"]);
    const steward = (await db.select().from(fates).where(eq(fates.name, "Steward")))[0];
    expect((await listCards(db, { fateId: steward.id })).map((c) => c.fate?.name)).toEqual(["Steward", "Steward"]);
  });

  it("fetches only ARCS cards and the cards.json version", async () => {
    const fake = (async (url: string) =>
      new Response(JSON.stringify(url.endsWith("version.json") ? { files: { "cards.json": "abc" } } : RAW), { status: 200 })) as typeof fetch;
    const u = await fetchUpstreamCards(fake);
    expect(u.version).toBe("abc");
    expect(u.cards).toHaveLength(4);
    const down = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    expect(await fetchUpstreamCards(down).then(() => null, (e) => e)).toBeInstanceOf(RuleError);
  });
});

describe("card tags", () => {
  async function setup() {
    await importCards(db, actor("Mod", true), upstream());
    const fateId = Object.fromEntries((await db.select().from(fates)).map((f) => [f.name, f.id]));
    const id = await createCampaign(db, actor("Emma"), {
      players: [{ playerId: ids.Emma }, { playerId: ids.Chris }, { playerId: ids.Mark }],
    });
    const c = (await getCampaign(db, id))!;
    await saveAct(db, actor("Emma"), id, 1, {
      playedOn: "2026-11-01",
      results: c.players.map((p, i) => ({ campaignPlayerId: p.cpId, fateId: fateId[["Steward", "Founder", "Magnate"][i]], score: 5, success: true })),
    });
    const store = memoryPhotoStore();
    const photo = (slot: "board" | number) =>
      savePhoto(db, store, actor("Emma"), { campaignId: id, actNo: 1, slot, full: fakeJpeg(1600, 1200), thumb: fakeJpeg(400, 300) });
    const emmaPhoto = await photo(c.players[0].cpId);
    const boardPhoto = await photo("board");
    return { id, c, store, photo, emmaPhoto, boardPhoto };
  }

  it("knows whose tableau a photo is and their fate that act", async () => {
    const { emmaPhoto } = await setup();
    const p = await photoForTagging(db, emmaPhoto);
    expect(p?.player?.name).toBe("Emma");
    expect(p?.fate?.name).toBe("Steward");
  });

  it("lets any member tag a tableau photo once per card, and audits it", async () => {
    const { emmaPhoto, boardPhoto } = await setup();
    await addCardTag(db, actor("Outsider"), emmaPhoto, "ARCS-F103");
    await addCardTag(db, actor("Chris"), emmaPhoto, "ARCS-F103"); // duplicate: ignored
    await addCardTag(db, actor("Chris"), emmaPhoto, "ARCS-L01");
    const tags = (await tagsForPhotos(db, [emmaPhoto])).get(emmaPhoto)!;
    expect(tags.map((t) => [t.name, t.taggedBy])).toEqual([
      ["Dealmakers", "Outsider"],
      ["Tool-Priests", "Chris"],
    ]);
    expect(await addCardTag(db, null, emmaPhoto, "ARCS-L01").then(() => null, (e) => e)).toBeInstanceOf(PermissionError);
    expect(await addCardTag(db, actor("Emma"), boardPhoto, "ARCS-L01").then(() => null, (e) => e)).toBeInstanceOf(RuleError);
    expect(await addCardTag(db, actor("Emma"), emmaPhoto, "ARCS-NOPE").then(() => null, (e) => e)).toBeInstanceOf(NotFoundError);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "card_tag.add"))).toHaveLength(2);
  });

  it("lets the tagger, participants and moderators remove tags, nobody else", async () => {
    const { emmaPhoto } = await setup();
    await addCardTag(db, actor("Outsider"), emmaPhoto, "ARCS-F103");
    await addCardTag(db, actor("Emma"), emmaPhoto, "ARCS-L01");
    const [a, b] = (await tagsForPhotos(db, [emmaPhoto])).get(emmaPhoto)!;
    expect(await removeCardTag(db, actor("Outsider"), b.tagId).then(() => null, (e) => e)).toBeInstanceOf(PermissionError);
    await removeCardTag(db, actor("Outsider"), a.tagId);
    await removeCardTag(db, actor("Mark"), b.tagId);
    expect(await db.select().from(cardTags)).toEqual([]);
  });

  it("counts sightings and wins per card, and keeps tags when a photo is replaced", async () => {
    const { emmaPhoto, c, photo } = await setup();
    await addCardTag(db, actor("Chris"), emmaPhoto, "ARCS-F103");
    const replaced = await photo(c.players[0].cpId);
    expect((await tagsForPhotos(db, [replaced])).get(replaced)?.map((t) => t.cardId)).toEqual(["ARCS-F103"]);
    const card = await getCard(db, "ARCS-F103");
    expect(card?.stats).toEqual({ tagged: 1, holders: 0, wins: 0 }); // campaign not closed yet
    expect(card?.sightings.map((s) => [s.player, s.actNo])).toEqual([["Emma", 1]]);
    expect((await db.select().from(cards).where(eq(cards.id, "ARCS-F103")))[0].fateId).not.toBeNull();
  });
});

describe("card images", () => {
  async function webp() {
    return sharp({ create: { width: 744, height: 1039, channels: 3, background: "#446" } }).webp().toBuffer();
  }

  it("copies images in batches with thumbnails, refuses other hosts, and re-copies changed cards", async () => {
    await importCards(db, actor("Mod", true), upstream());
    expect(await cardImagesWaiting(db)).toBe(4);
    const img = await webp();
    const fetched: string[] = [];
    const fake = (async (u: URL | string) => {
      fetched.push(String(u));
      return new Response(new Uint8Array(img), { status: 200 });
    }) as typeof fetch;
    const store = memoryPhotoStore();

    expect(await copyCardImages(db, store, actor("Emma"), { fetcher: fake }).then(() => null, (e) => e)).toBeInstanceOf(PermissionError);
    const first = await copyCardImages(db, store, actor("Mod", true), { fetcher: fake, limit: 2 });
    expect(first).toMatchObject({ copied: 2, remaining: 2 });
    const rest = await copyCardImages(db, store, actor("Mod", true), { fetcher: fake });
    expect(rest.copied).toBe(1);
    expect(rest.failed.map((f) => [f.id, f.error])).toEqual([["ARCS-L01", "unexpected image address evil.example.com"]]);
    expect(fetched.every((u) => u.startsWith("https://cardcdn.buriedgiant.com/"))).toBe(true);
    expect(store.files.size).toBe(6);

    const keys = await cardImageKeys(db, "ARCS-F103");
    const thumb = await sharp(store.files.get(keys!.thumbKey!)!).metadata();
    expect([thumb.format, thumb.width]).toEqual(["webp", 240]);

    // A changed card waits for a new copy; the old files go once it is copied.
    const next = RAW.map((c) => (c.id === "ARCS-F103" ? { ...c, text: "errata" } : c));
    await importCards(db, actor("Mod", true), upstream(next));
    expect(await cardImagesWaiting(db)).toBe(2); // F103 again, and L01 still failing
    await copyCardImages(db, store, actor("Mod", true), { fetcher: fake, skip: ["ARCS-L01"] });
    expect(store.files.has(keys!.imageKey!)).toBe(false);
    expect(store.files.size).toBe(6);
    expect((await getCard(db, "ARCS-F103"))?.imageV).not.toBeNull();
    expect((await getCard(db, "ARCS-L01"))?.imageV).toBeNull();
  });
});
