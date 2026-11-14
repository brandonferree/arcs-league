"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** Match PHOTO_LIMITS in src/server/photos.ts (kept out of this bundle). */
const FULL_EDGE = 2048;
const THUMB_EDGE = 480;
const FULL_MAX_BYTES = 3_500_000;

type Source = { image: CanvasImageSource; width: number; height: number; close?: () => void };

/** Decodes the file, honouring the camera's orientation. */
async function decode(file: File): Promise<Source> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { image: img, width: img.naturalWidth, height: img.naturalHeight };
    } catch {
      throw new Error(
        "This browser could not read that photo. Try a JPEG or PNG (an iPhone HEIC photo may need converting first).",
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Downscales to fit maxEdge and re-encodes as JPEG, which also drops EXIF data such as location. */
function encode(src: Source, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This browser cannot resize photos."));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h); // transparent PNGs get a black background rather than garbage
  ctx.drawImage(src.image, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the photo."))), "image/jpeg", quality),
  );
}

export function PhotoUpload({
  campaignId,
  actNo,
  slot,
  label,
  replace = false,
}: {
  campaignId: number;
  actNo: number;
  /** "board" or a campaign player id. */
  slot: "board" | number;
  /** What the photo shows, for the accessible name, e.g. "Act I board". */
  label: string;
  replace?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const busy = status !== null || refreshing;

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    setError(null);
    setStatus("Shrinking…");
    let src: Source | null = null;
    try {
      src = await decode(file);
      let full = await encode(src, FULL_EDGE, 0.82);
      if (full.size > FULL_MAX_BYTES) full = await encode(src, FULL_EDGE, 0.68);
      const thumb = await encode(src, THUMB_EDGE, 0.72);

      setStatus("Uploading…");
      const body = new FormData();
      body.set("campaignId", String(campaignId));
      body.set("actNo", String(actNo));
      body.set("slot", String(slot));
      body.set("full", full, "full.jpg");
      body.set("thumb", thumb, "thumb.jpg");
      const res = await fetch("/api/photos", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Upload failed (${res.status}).`);
      setStatus(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      src?.close?.();
    }
  }

  return (
    <div className="photo-upload">
      <label className={`btn btn--small ${replace ? "btn--quiet" : "btn--cyan"}`} aria-disabled={busy || undefined}>
        {status ?? (refreshing ? "Saving…" : replace ? "Replace" : "Add photo")}
        <input
          className="sr-only"
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={onChange}
          aria-label={`${replace ? "Replace" : "Add"} photo: ${label}`}
        />
      </label>
      {error ? (
        <p className="photo-upload__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
