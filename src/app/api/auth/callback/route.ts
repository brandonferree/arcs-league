import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { appUrl, discordConfig, exchangeCode, fetchIdentity, upsertDiscordPlayer } from "@/server/discord";
import { safeNext, SESSION_COOKIE, sessionCookieOptions, signSession } from "@/server/session";

const STATE_COOKIE = "arcs_oauth_state";

function fail(reason: string, next = "/") {
  const res = NextResponse.redirect(`${appUrl()}/sign-in?error=${reason}&next=${encodeURIComponent(next)}`);
  res.cookies.delete({ name: STATE_COOKIE, path: "/api/auth" });
  return res;
}

function sameString(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Discord redirects here after the user approves (or cancels) sign-in. */
export async function GET(req: NextRequest) {
  const cfg = discordConfig();
  if (!cfg) return fail("not-configured");

  const [expectedState, rawNext] = (req.cookies.get(STATE_COOKIE)?.value ?? "").split("|");
  const next = safeNext(rawNext);
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail("cancelled", next);
  const state = params.get("state") ?? "";
  const code = params.get("code");
  if (!expectedState || !code || !sameString(state, expectedState)) return fail("state", next);

  try {
    const token = await exchangeCode(cfg, code);
    const identity = await fetchIdentity(cfg, token);
    if (!identity.isMember) return fail("not-member", next);

    const db = await getDb();
    const player = await upsertDiscordPlayer(db, identity);
    const jwt = await signSession({
      playerId: player.id,
      name: player.displayName,
      avatarUrl: player.avatarUrl,
      isModerator: player.isModerator,
      via: "discord",
    });
    const res = NextResponse.redirect(`${appUrl()}${next}`);
    res.cookies.set(SESSION_COOKIE, jwt, sessionCookieOptions);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/auth" });
    return res;
  } catch (err) {
    console.error("Discord sign-in failed:", err);
    return fail("failed", next);
  }
}
