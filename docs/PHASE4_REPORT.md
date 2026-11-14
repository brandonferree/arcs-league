# Phase 4 report: photos

Built ahead of phase 3 (the bot) at the owner's request (2026-11-14).

## Built

- **Photos panel on every campaign page**, per recorded act: one board photo and one tableau photo per player. Thumbnails open the full photo.
- **Upload** (`PhotoUpload`): the browser decodes the photo (respecting the camera's orientation), shrinks it to at most 2048 px on the longest side (JPEG, quality 0.82) plus a 480 px thumbnail, and uploads both to `POST /api/photos`. Re-encoding drops EXIF data, including location. Unreadable files (e.g. HEIC in Chrome) get a plain error.
- **Server checks** (`src/server/photos.ts`): the files must really be JPEGs (frame header parsed), within the pixel and byte limits (`PHOTO_LIMITS`), for a recorded act and a player in that campaign. Uploading to a filled slot replaces the photo; the new photo gets a new id and the old files are deleted. Every add, replace, removal and visibility change is audit-logged.
- **Storage** (`src/server/photo-store.ts`): a private Vercel Blob store when `BLOB_READ_WRITE_TOKEN` is set; `./.photos-local` in local development; in memory for tests. Without a token on Vercel, uploads say storage is not set up and nothing else breaks.
- **Serving** (`GET /api/photos/<id>/full|thumb`): to signed-in members, or to anyone once the campaign's photos are public. Cached in the viewer's browser only (`private, max-age=86400`), so switching back to members-only takes effect for everyone else at once.
- **Visibility switch**: "Make public" / "Make members-only" on the Photos panel.
- **"No photos" badge** on the campaign list and campaign page while recorded acts are missing photos ("Photos 5/8" when some are in). Not shown on void campaigns.
- Deleting a campaign also deletes its photo files.
- The act form notes that photos are added on the campaign page after saving.

## Decisions made (owner to confirm)

- **Who can add, replace and remove photos, and switch them public:** players in the campaign and whoever logged it, at any time (photos often arrive late), except on a void campaign; moderators always. Spec section 5 did not say.
- **Sizes:** 2048 px full size keeps card names legible for phase 5 tagging; 480 px thumbnails.
- **Upload route rather than a server action**, because server actions cap request bodies at 1 MB.

## Verified

- 110 Vitest tests pass (14 new: JPEG header parsing, add, replace with file cleanup, size and format rejection, unrecorded acts, permissions including void campaigns, removal, visibility switch, badge counts, campaign deletion).
- Typecheck and production build pass with no warnings.
- In the browser against demo data (local file storage): a 4000×3000, 5.4 MB image uploaded as a 2048×1536 JPEG of 546 KB plus a 54 KB thumbnail; replace, portrait upload, removal, the badge count, the unreadable-file error, and a 375 px phone layout with no sideways scrolling. Signed out: the photo route returns 403 and the page shows a sign-in prompt with no photo URLs; after "Make public", both work signed out.

## Not verified

- Real Vercel Blob storage: the Blob SDK calls (`put`, `get`, `del` with private access) are untested until the owner connects a store (`docs/SETUP.md` step 4).
- Real phone cameras, including iPhone HEIC photos in Safari and EXIF orientation from a real camera file (the browser test used generated images).

## Open

- Phase 5 (card tagging) will tag cards on these tableau photos.
- Phase 3 (the bot) is still not built.
