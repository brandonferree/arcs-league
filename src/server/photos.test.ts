import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connectPglite, type DB } from "@/db";
import { auditLog, fates, photos, players } from "@/db/schema";
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  NotFoundError,
  PermissionError,
  RuleError,
  saveAct,
  voidCampaign,
} from "./campaigns";
import { memoryPhotoStore } from "./photo-store";
import {
  campaignPhotoKeys,
  deletePhoto,
  expectedPhotos,
  jpegSize,
  listCampaignPhotos,
  photoForServing,
  savePhoto,
  setPhotosPublic,
} from "./photos";

/** Just enough JPEG for the header parser: SOI, an APP0 segment, then a frame header. */
function fakeJpeg(width: number, height: number, { sof = 0xc0, pad = 0 } = {}) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)];
  const frame = [0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, ...Array(10).fill(0)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...frame, ...Array(pad).fill(0), 0xff, 0xd9]);
}
const FULL = fakeJpeg(2048, 1536);
const THUMB = fakeJpeg(480, 360);

let db: DB;
let store: ReturnType<typeof memoryPhotoStore>;
let ids: Record<string, number>;
const actor = (name: string, isModerator = false) => ({ playerId: ids[name], isModerator });

beforeEach(async () => {
  db = await connectPglite();
  store = memoryPhotoStore();
  const rows = await db
    .insert(players)
    .values(["Emma", "Chris", "Mark", "Outsider", "Mod"].map((n, i) => ({ displayName: n, discordId: `d${i}` })))
    .returning();
  ids = Object.fromEntries(rows.map((r) => [r.displayName, r.id]));
});

/** A campaign with Act I recorded. Returns its id and the campaign player ids in seat order. */
async function campaignWithAct1() {
  const fateId = Object.fromEntries((await db.select().from(fates)).map((f) => [f.name, f.id]));
  const id = await createCampaign(db, actor("Emma"), {
    players: [{ playerId: ids.Emma }, { playerId: ids.Chris }, { playerId: ids.Mark }],
  });
  const c = (await getCampaign(db, id))!;
  await saveAct(db, actor("Emma"), id, 1, {
    playedOn: "2026-11-01",
    results: c.players.map((p, i) => ({
      campaignPlayerId: p.cpId,
      fateId: fateId[["Steward", "Founder", "Magnate"][i]],
      score: 5,
      success: true,
    })),
  });
  return { id, cps: c.players.map((p) => p.cpId) };
}

async function errorOf(p: Promise<unknown>) {
  return p.then(() => null, (e) => e);
}

describe("jpegSize", () => {
  it("reads baseline and progressive frame headers past other segments", () => {
    expect(jpegSize(fakeJpeg(1600, 1200))).toEqual({ width: 1600, height: 1200 });
    expect(jpegSize(fakeJpeg(300, 4000, { sof: 0xc2 }))).toEqual({ width: 300, height: 4000 });
  });
  it("rejects anything that is not a JPEG", () => {
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("act photos", () => {
  it("adds a board and a tableau photo, storing both sizes and auditing", async () => {
    const { id, cps } = await campaignWithAct1();
    const board = await savePhoto(db, store, actor("Chris"), { campaignId: id, actNo: 1, slot: "board", full: FULL, thumb: THUMB });
    await savePhoto(db, store, actor("Chris"), { campaignId: id, actNo: 1, slot: cps[0], full: FULL, thumb: THUMB });

    const list = await listCampaignPhotos(db, id);
    expect(list.map((p) => [p.actNo, p.campaignPlayerId, p.width, p.height, p.uploadedBy])).toEqual([
      [1, null, 2048, 1536, "Chris"],
      [1, cps[0], 2048, 1536, "Chris"],
    ]);
    expect(store.files.size).toBe(4);
    expect(await photoForServing(db, board)).toMatchObject({ photosPublic: false });
    const log = await db.select().from(auditLog).where(eq(auditLog.entityType, "photo"));
    expect(log.map((l) => l.action)).toEqual(["photo.add", "photo.add"]);
  });

  it("replacing a photo gives it a new id and deletes the old files", async () => {
    const { id } = await campaignWithAct1();
    const first = await savePhoto(db, store, actor("Emma"), { campaignId: id, actNo: 1, slot: "board", full: FULL, thumb: THUMB });
    const oldKeys = await campaignPhotoKeys(db, id);
    const second = await savePhoto(db, store, actor("Emma"), { campaignId: id, actNo: 1, slot: "board", full: FULL, thumb: THUMB });

    expect(second).not.toBe(first);
    expect(await listCampaignPhotos(db, id)).toHaveLength(1);
    expect(await photoForServing(db, first)).toBeNull();
    for (const k of oldKeys) expect(store.files.has(k)).toBe(false);
    expect(store.files.size).toBe(2);
    const [last] = await db.select().from(auditLog).where(eq(auditLog.entityId, String(second)));
    expect(last.action).toBe("photo.replace");
  });

  it("rejects files that are not JPEGs, or are too large", async () => {
    const { id } = await campaignWithAct1();
    const save = (full: Uint8Array, thumb = THUMB) =>
      errorOf(savePhoto(db, store, actor("Emma"), { campaignId: id, actNo: 1, slot: "board", full, thumb }));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0]);
    expect(((await save(png)) as RuleError).errors[0]).toContain("not a JPEG");
    expect(((await save(fakeJpeg(4032, 3024))) as RuleError).errors[0]).toContain("2048 pixels");
    expect(((await save(FULL, fakeJpeg(1024, 768))) as RuleError).errors[0]).toContain("thumbnail");
    expect(((await save(fakeJpeg(2000, 1500, { pad: 3_600_000 }))) as RuleError).errors[0]).toContain("MB");
    expect(store.files.size).toBe(0);
  });

  it("only takes photos for recorded acts and players in the campaign", async () => {
    const { id } = await campaignWithAct1();
    expect(await errorOf(savePhoto(db, store, actor("Emma"), { campaignId: id, actNo: 2, slot: "board", full: FULL, thumb: THUMB }))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(savePhoto(db, store, actor("Emma"), { campaignId: id, actNo: 1, slot: 99999, full: FULL, thumb: THUMB }))).toBeInstanceOf(NotFoundError);
  });

  it("lets only participants and moderators manage photos; not participants once void", async () => {
    const { id } = await campaignWithAct1();
    const input = { campaignId: id, actNo: 1, slot: "board" as const, full: FULL, thumb: THUMB };
    expect(await errorOf(savePhoto(db, store, actor("Outsider"), input))).toBeInstanceOf(PermissionError);
    await voidCampaign(db, actor("Mod", true), id, "test");
    expect(await errorOf(savePhoto(db, store, actor("Emma"), input))).toBeInstanceOf(PermissionError);
    const photoId = await savePhoto(db, store, actor("Mod", true), input);
    expect(await errorOf(deletePhoto(db, store, actor("Emma"), photoId))).toBeInstanceOf(PermissionError);
    expect(store.files.size).toBe(2);
  });

  it("removes a photo and its files", async () => {
    const { id } = await campaignWithAct1();
    const photoId = await savePhoto(db, store, actor("Emma"), { campaignId: id, actNo: 1, slot: "board", full: FULL, thumb: THUMB });
    expect(await deletePhoto(db, store, actor("Chris"), photoId)).toBe(id);
    expect(await listCampaignPhotos(db, id)).toEqual([]);
    expect(store.files.size).toBe(0);
    const log = await db.select().from(auditLog).where(eq(auditLog.action, "photo.delete"));
    expect(log).toHaveLength(1);
  });

  it("switches a campaign's photos public, for participants only, and audits it", async () => {
    const { id } = await campaignWithAct1();
    const photoId = await savePhoto(db, store, actor("Emma"), { campaignId: id, actNo: 1, slot: "board", full: FULL, thumb: THUMB });
    expect(await errorOf(setPhotosPublic(db, actor("Outsider"), id, true))).toBeInstanceOf(PermissionError);
    await setPhotosPublic(db, actor("Mark"), id, true);
    await setPhotosPublic(db, actor("Mark"), id, true); // no change, no audit row
    expect((await photoForServing(db, photoId))?.photosPublic).toBe(true);
    expect((await getCampaign(db, id))?.photosPublic).toBe(true);
    const log = await db.select().from(auditLog).where(eq(auditLog.action, "campaign.photos_public"));
    expect(log).toHaveLength(1);
  });

  it("counts photos for the badge, and deleting a campaign removes its photo rows", async () => {
    const { id, cps } = await campaignWithAct1();
    await savePhoto(db, store, actor("Emma"), { campaignId: id, actNo: 1, slot: "board", full: FULL, thumb: THUMB });
    await savePhoto(db, store, actor("Emma"), { campaignId: id, actNo: 1, slot: cps[1], full: FULL, thumb: THUMB });
    const [row] = await listCampaigns(db);
    expect(row.photoCount).toBe(2);
    expect(expectedPhotos(row.actsRecorded, row.playerCount)).toBe(4);

    expect(await campaignPhotoKeys(db, id)).toHaveLength(4);
    await deleteCampaign(db, actor("Mod", true), id);
    expect(await db.select().from(photos)).toEqual([]);
  });
});
