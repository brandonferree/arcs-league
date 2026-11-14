/**
 * Where photo files live.
 *
 *  - BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID set (production; Vercel sets one or
 *    the other when a store is connected, the latter with OIDC auth): a *private*
 *    Vercel Blob store. Files
 *    are never linked directly; /api/photos/<id>/<size> checks who is asking and
 *    streams them, so members-only photos stay members-only.
 *  - Neither, outside Vercel (local development): files in ./.photos-local.
 *  - Tests: memoryPhotoStore().
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredPhoto {
  body: ReadableStream<Uint8Array> | Uint8Array;
  contentType: string;
}

export interface PhotoStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredPhoto | null>;
  /** Best effort: missing keys are ignored. */
  del(keys: string[]): Promise<void>;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Photo storage is not set up yet: a moderator needs to connect a Vercel Blob store.");
    this.name = "StorageNotConfiguredError";
  }
}

/** A fresh, unguessable key. Keys are never reused, so files can be cached forever. */
export function newPhotoKey(campaignId: number, actNo: number, slot: string, size: "full" | "thumb"): string {
  return `photos/c${campaignId}/act${actNo}/${slot}-${randomUUID()}-${size}.jpg`;
}

/** token undefined = let the SDK use Vercel OIDC with BLOB_STORE_ID. */
function blobStore(token: string | undefined): PhotoStore {
  // Imported lazily so local development and tests never load the SDK.
  const sdk = () => import("@vercel/blob");
  return {
    async put(key, body, contentType) {
      const { put } = await sdk();
      await put(key, Buffer.from(body), { access: "private", contentType, token, addRandomSuffix: false });
    },
    async get(key) {
      const { get } = await sdk();
      const r = await get(key, { access: "private", token });
      if (!r || r.statusCode !== 200) return null;
      return { body: r.stream, contentType: r.blob.contentType };
    },
    async del(keys) {
      if (!keys.length) return;
      const { del } = await sdk();
      await del(keys, { token });
    },
  };
}

function localStore(root: string): PhotoStore {
  const file = (key: string) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error("Bad photo key.");
    return p;
  };
  return {
    async put(key, body) {
      const p = file(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    async get(key) {
      try {
        return { body: new Uint8Array(await readFile(file(key))), contentType: "image/jpeg" };
      } catch {
        return null;
      }
    },
    async del(keys) {
      await Promise.all(keys.map((k) => rm(file(k), { force: true })));
    },
  };
}

export function memoryPhotoStore(): PhotoStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(key, body) {
      files.set(key, body);
    },
    async get(key) {
      const body = files.get(key);
      return body ? { body, contentType: "image/jpeg" } : null;
    },
    async del(keys) {
      for (const k of keys) files.delete(k);
    },
  };
}

let cached: PhotoStore | null = null;

/** The store for this environment. Throws StorageNotConfiguredError on Vercel without a Blob store. */
export function getPhotoStore(): PhotoStore {
  if (cached) return cached;
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim() || undefined;
  if (token || process.env.BLOB_STORE_ID?.trim()) cached = blobStore(token);
  else if (process.env.VERCEL) throw new StorageNotConfiguredError();
  else cached = localStore(path.join(/*turbopackIgnore: true*/ process.cwd(), ".photos-local"));
  return cached;
}
