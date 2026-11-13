import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, discordConfig } from "@/server/discord";
import { safeNext } from "@/server/session";

const OAUTH_STATE_COOKIE = "arcs_oauth_state";

/** Starts Discord sign-in. */
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const cfg = discordConfig();
  if (!cfg) {
    return NextResponse.redirect(new URL(`/sign-in?error=not-configured&next=${encodeURIComponent(next)}`, req.url));
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(cfg, state));
  res.cookies.set(OAUTH_STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: 600,
  });
  return res;
}
