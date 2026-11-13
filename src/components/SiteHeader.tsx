import Link from "next/link";
import { getSession } from "@/server/session";
import { NavLinks } from "./NavLinks";

export async function SiteHeader() {
  const session = await getSession();
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        ARCS LEAGUE
      </Link>
      <nav className="nav" aria-label="Main">
        <NavLinks isModerator={!!session?.isModerator} />
        {session ? (
          <span className="nav__user">
            {session.avatarUrl ? <img className="avatar" src={session.avatarUrl} alt="" width={28} height={28} /> : null}
            <span>{session.name}</span>
            {session.isModerator ? <span className="badge badge--mod">Mod</span> : null}
            {session.via === "dev" ? <span className="badge">Dev</span> : null}
            <form action="/api/auth/signout" method="post">
              <button className="btn btn--quiet btn--small" type="submit">
                Sign out
              </button>
            </form>
          </span>
        ) : (
          <a className="btn" href="/sign-in">
            Sign in with Discord
          </a>
        )}
      </nav>
    </header>
  );
}
