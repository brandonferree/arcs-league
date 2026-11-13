import type { Metadata } from "next";
import { headers } from "next/headers";
import { discordConfig, devStubEnabled } from "@/server/discord";
import { getSession, safeNext } from "@/server/session";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  "not-member": "That Discord account is not a member of the league's server. Join the server, then try again.",
  "not-configured": "Discord sign-in is not configured on this site yet.",
  cancelled: "Sign-in was cancelled.",
  state: "Your sign-in link expired or was already used. Please try again.",
  failed: "Discord sign-in failed. Please try again.",
  "dev-name": "Enter a name for the development sign-in.",
};

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : "/");
  const error = typeof sp.error === "string" ? ERRORS[sp.error] ?? ERRORS.failed : null;
  const devStub = devStubEnabled(await headers());
  const configured = !!discordConfig();
  const session = await getSession();

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Members</div>
        <h1>Sign in</h1>
        <p className="lede">
          Sign in with Discord to log campaigns. Any member of the league&rsquo;s Discord server can log games;
          moderators are whoever holds the moderator role there.
        </p>
      </div>
      {error ? (
        <ul className="errors" role="alert">
          <li>{error}</li>
        </ul>
      ) : null}
      {session ? <p className="notice">You are signed in as {session.name}.</p> : null}
      <section className="panel">
        <a
          className="btn"
          href={`/api/auth/discord?next=${encodeURIComponent(next)}`}
          aria-disabled={!configured || undefined}
        >
          Sign in with Discord
        </a>
        <p className="small muted" style={{ marginBottom: 0 }}>
          We ask Discord for your name, avatar and your membership and roles in the league&rsquo;s server only. We
          never see your other servers or messages.
        </p>
      </section>

      {devStub ? (
        <section className="panel panel--cyan" aria-labelledby="dev-h">
          <div className="panel__head">
            <h2 id="dev-h" className="panel__title">
              Development sign-in
            </h2>
            <span className="panel__note">localhost only · DEV_AUTH_STUB=1</span>
          </div>
          <form className="filters" method="post" action="/api/auth/dev">
            <input type="hidden" name="next" value={next} />
            <label className="field">
              <span className="field__label">Name</span>
              <input className="input" name="name" required maxLength={40} placeholder="e.g. Emma" />
            </label>
            <label className="check" style={{ minHeight: 44 }}>
              <input type="checkbox" name="moderator" />
              Moderator
            </label>
            <button className="btn btn--cyan" type="submit">
              Sign in as test user
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
