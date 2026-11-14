/**
 * Act photos (spec section 4, phase 4): one board photo per act and one tableau
 * photo per player per act. Requested, never required.
 *
 * The browser downscales and re-encodes every photo as JPEG before upload (which
 * also drops EXIF data such as GPS). The server re-checks the format, the size in
 * bytes and the pixel dimensions, then stores a full-size and a thumbnail copy.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { acts, campaigns, photos, players } from "@/db/schema";
import { canManagePhotos, type Actor } from "@/lib/permissions";
import type { ActNumber } from "@/lib/rules";
import { audit, getCampaign, NotFoundError, PermissionError, RuleError } from "./campaigns";
import { newPhotoKey, type PhotoStore } from "./photo-store";

/** The browser aims for these; the server accepts up to them. */
export const PHOTO_LIMITS = {
  fullMaxEdge: 2048,
  thumbMaxEdge: 480,
  fullMaxBytes: 3_500_000,
  thumbMaxBytes: 300_000,
} as const;

export type PhotoSlot = "board" | number;

export interface PhotoView {
  id: number;
  actId: number;
  actNo: ActNumber;
  /** null for the board photo. */
  campaignPlayerId: number | null;
  width: number;
  height: number;
  uploadedBy: string | null;
  createdAt: Date;
}

/** Width and height from a baseline or progressive JPEG's frame header; null if it is not a JPEG. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // markers without a length
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width && height ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

function checkImage(bytes: Uint8Array, what: string, maxEdge: number, maxBytes: number) {
  const size = jpegSize(bytes);
  if (!size) throw new RuleError([`The ${what} is not a JPEG image.`]);
  if (bytes.length > maxBytes) throw new RuleError([`The ${what} is too large (over ${Math.round(maxBytes / 1e5) / 10} MB).`]);
  if (Math.max(size.width, size.height) > maxEdge) {
    throw new RuleError([`The ${what} is too large (over ${maxEdge} pixels on its longest side).`]);
  }
  return size;
}

async function loadAccess(db: DbOrTx, campaignId: number) {
  const c = await getCampaign(db, campaignId);
  if (!c) throw new NotFoundError("Campaign not found.");
  return c;
}

function slotWhere(actId: number, slot: PhotoSlot) {
  return and(eq(photos.actId, actId), slot === "board" ? isNull(photos.campaignPlayerId) : eq(photos.campaignPlayerId, slot));
}

export interface SavePhotoInput {
  campaignId: number;
  actNo: number;
  slot: PhotoSlot;
  full: Uint8Array;
  thumb: Uint8Array;
}

/** Adds a photo to an empty slot, or replaces the one there. Returns the new photo id. */
export async function savePhoto(db: DB, store: PhotoStore, actor: Actor, input: SavePhotoInput): Promise<number> {
  const c = await loadAccess(db, input.campaignId);
  if (!canManagePhotos(actor, c.access)) {
    throw new PermissionError("Only players in this campaign, or a moderator, can add its photos.");
  }
  const act = c.acts.find((a) => a.actNo === input.actNo);
  if (!act) throw new NotFoundError("That act has not been recorded yet.");
  const player = input.slot === "board" ? null : c.players.find((p) => p.cpId === input.slot);
  if (input.slot !== "board" && !player) throw new NotFoundError("That player is not in this campaign.");

  const size = checkImage(input.full, "photo", PHOTO_LIMITS.fullMaxEdge, PHOTO_LIMITS.fullMaxBytes);
  checkImage(input.thumb, "thumbnail", PHOTO_LIMITS.thumbMaxEdge, PHOTO_LIMITS.thumbMaxBytes);

  const slotName = input.slot === "board" ? "board" : `p${input.slot}`;
  const fullKey = newPhotoKey(c.id, act.actNo, slotName, "full");
  const thumbKey = newPhotoKey(c.id, act.actNo, slotName, "thumb");
  await Promise.all([store.put(fullKey, input.full, "image/jpeg"), store.put(thumbKey, input.thumb, "image/jpeg")]);

  let replaced: { fullKey: string; thumbKey: string } | null = null;
  let id: number;
  try {
    id = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(photos).where(slotWhere(act.id, input.slot));
      if (old) {
        await tx.delete(photos).where(eq(photos.id, old.id));
        replaced = { fullKey: old.fullKey, thumbKey: old.thumbKey };
      }
      const [row] = await tx
        .insert(photos)
        .values({
          actId: act.id,
          campaignPlayerId: player?.cpId ?? null,
          fullKey,
          thumbKey,
          width: size.width,
          height: size.height,
          bytes: input.full.length + input.thumb.length,
          uploadedById: actor.playerId,
        })
        .returning({ id: photos.id });
      await audit(tx, actor, {
        action: old ? "photo.replace" : "photo.add",
        entityType: "photo",
        entityId: row.id,
        campaignId: c.id,
        before: old ? { photoId: old.id } : null,
        after: { act: act.actNo, of: player ? player.name : "board", width: size.width, height: size.height },
      });
      return row.id;
    });
  } catch (err) {
    await store.del([fullKey, thumbKey]).catch(() => {});
    throw err;
  }
  const old = replaced as { fullKey: string; thumbKey: string } | null;
  if (old) await store.del([old.fullKey, old.thumbKey]).catch((e) => console.error("photo cleanup failed", e));
  return id;
}

export async function deletePhoto(db: DB, store: PhotoStore, actor: Actor, photoId: number): Promise<number> {
  const [row] = await db
    .select({ p: photos, campaignId: acts.campaignId, actNo: acts.actNo })
    .from(photos)
    .innerJoin(acts, eq(acts.id, photos.actId))
    .where(eq(photos.id, photoId));
  if (!row) throw new NotFoundError("Photo not found.");
  const c = await loadAccess(db, row.campaignId);
  if (!canManagePhotos(actor, c.access)) {
    throw new PermissionError("Only players in this campaign, or a moderator, can remove its photos.");
  }
  const of = row.p.campaignPlayerId ? (c.players.find((p) => p.cpId === row.p.campaignPlayerId)?.name ?? "player") : "board";
  await db.transaction(async (tx) => {
    await tx.delete(photos).where(eq(photos.id, photoId));
    await audit(tx, actor, {
      action: "photo.delete",
      entityType: "photo",
      entityId: photoId,
      campaignId: c.id,
      before: { act: row.actNo, of },
    });
  });
  await store.del([row.p.fullKey, row.p.thumbKey]).catch((e) => console.error("photo cleanup failed", e));
  return c.id;
}

export async function setPhotosPublic(db: DB, actor: Actor, campaignId: number, value: boolean) {
  const c = await loadAccess(db, campaignId);
  if (!canManagePhotos(actor, c.access)) {
    throw new PermissionError("Only players in this campaign, or a moderator, can change who sees its photos.");
  }
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ v: campaigns.photosPublic }).from(campaigns).where(eq(campaigns.id, campaignId));
    if (before.v === value) return;
    await tx.update(campaigns).set({ photosPublic: value, updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
    await audit(tx, actor, {
      action: "campaign.photos_public",
      entityType: "campaign",
      entityId: campaignId,
      campaignId,
      before: { photosPublic: before.v },
      after: { photosPublic: value },
    });
  });
}

export async function listCampaignPhotos(db: DbOrTx, campaignId: number): Promise<PhotoView[]> {
  const rows = await db
    .select({
      id: photos.id,
      actId: photos.actId,
      actNo: acts.actNo,
      campaignPlayerId: photos.campaignPlayerId,
      width: photos.width,
      height: photos.height,
      uploadedBy: players.displayName,
      createdAt: photos.createdAt,
    })
    .from(photos)
    .innerJoin(acts, eq(acts.id, photos.actId))
    .leftJoin(players, eq(players.id, photos.uploadedById))
    .where(eq(acts.campaignId, campaignId))
    .orderBy(asc(acts.actNo), asc(photos.id));
  return rows.map((r) => ({ ...r, actNo: r.actNo as ActNumber }));
}

/** What the photo route needs to decide whether, and what, to serve. */
export async function photoForServing(db: DbOrTx, photoId: number) {
  const [row] = await db
    .select({ fullKey: photos.fullKey, thumbKey: photos.thumbKey, photosPublic: campaigns.photosPublic })
    .from(photos)
    .innerJoin(acts, eq(acts.id, photos.actId))
    .innerJoin(campaigns, eq(campaigns.id, acts.campaignId))
    .where(eq(photos.id, photoId));
  return row ?? null;
}

/** Every stored file of a campaign's photos, to delete along with the campaign. */
export async function campaignPhotoKeys(db: DbOrTx, campaignId: number): Promise<string[]> {
  const rows = await db
    .select({ fullKey: photos.fullKey, thumbKey: photos.thumbKey })
    .from(photos)
    .innerJoin(acts, eq(acts.id, photos.actId))
    .where(eq(acts.campaignId, campaignId));
  return rows.flatMap((r) => [r.fullKey, r.thumbKey]);
}

/** Photos a campaign should have: a board photo and one per player, for every recorded act. */
export function expectedPhotos(actsRecorded: number, playerCount: number): number {
  return actsRecorded * (playerCount + 1);
}
