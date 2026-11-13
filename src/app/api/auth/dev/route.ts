import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { devStubEnabled, upsertDiscordPlayer } from "@/server/discord";
import { safeNext, SESSION_COOKIE, sessionCookieOptions, signSession } from "@/server/session";

/**
 * Development-only sign-in stub. Works only when DEV_AUTH_STUB=1, outside a
 * production build, on localhost. Creates players with a "dev:" Discord id.
 */
export async function POST(req: NextRequest) {
  if (!devStubEnabled(req.headers)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  const isModerator = form.get("moderator") === "on";
  const next = safeNext(String(form.get("next") ?? "/"));
  if (!name) return NextResponse.redirect(new URL("/sign-in?error=dev-name", req.url), 303);

  const db = await getDb();
  const player = await upsertDiscordPlayer(db, {
    discordId: `dev:${name.toLowerCase()}`,
    displayName: name,
    avatarUrl: null,
    isModerator,
  });
  const jwt = await signSession({
    playerId: player.id,
    name: player.displayName,
    avatarUrl: null,
    isModerator: player.isModerator,
    via: "dev",
  });
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(SESSION_COOKIE, jwt, sessionCookieOptions);
  return res;
}
