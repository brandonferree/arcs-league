/**
 * Session: a signed (HS256) JWT in an httpOnly cookie. Moderator status and
 * server membership are checked at sign-in and carried in the session.
 */
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import type { Actor } from "@/lib/permissions";

export const SESSION_COOKIE = "arcs_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface Session {
  playerId: number;
  name: string;
  avatarUrl: string | null;
  isModerator: boolean;
  /** "discord" for real sign-ins, "dev" for the localhost stub. */
  via: "discord" | "dev";
}

const DEV_FALLBACK_SECRET = "development-only-secret-not-for-production-use";

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET?.trim();
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV !== "production") return new TextEncoder().encode(DEV_FALLBACK_SECRET);
  throw new Error("SESSION_SECRET must be set to at least 32 characters.");
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(session.playerId))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function readSessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.playerId !== "number") return null;
    return {
      playerId: payload.playerId,
      name: String(payload.name ?? ""),
      avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : null,
      isModerator: payload.isModerator === true,
      via: payload.via === "dev" ? "dev" : "discord",
    };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};

/** Current session in a server component, server action or route handler. */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(SESSION_COOKIE)?.value);
}

export function toActor(s: Session): Actor {
  return { playerId: s.playerId, isModerator: s.isModerator };
}

/** Only allows same-site relative paths, to avoid open redirects. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
