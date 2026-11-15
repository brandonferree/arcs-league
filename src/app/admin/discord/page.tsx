import type { Metadata } from "next";
import Link from "next/link";
import { appUrl } from "@/server/discord";
import { inviteUrl, missingBotEnv } from "@/server/bot/register";
import { getSession } from "@/server/session";
import { registerCommandsAction } from "./actions";

export const metadata: Metadata = { title: "Discord bot" };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function DiscordAdminPage({ searchParams }: { searchParams: SP }) {
  const [sp, session] = await Promise.all([searchParams, getSession()]);
  const error = typeof sp.error === "string" ? sp.error : null;
  const notice = typeof sp.notice === "string" ? sp.notice : null;

  const head = (
    <div className="page-head">
      <div className="eyebrow">Moderation</div>
      <h1>Discord bot</h1>
      <p className="lede">
        The bot opens campaign lobbies in #arcs, makes a thread for each campaign, posts a result card after every act
        and announces the winner. It answers <code>/campaign start</code>, <code>/campaign status</code>,{" "}
        <code>/stats player</code> and <code>/stats fate</code>.
      </p>
    </div>
  );

  if (!session?.isModerator) {
    return (
      <>
        {head}
        <section className="panel">
          <p className="empty">
            {session ? (
              "Only moderators can set up the bot."
            ) : (
              <>
                Moderators set up the bot. <Link href="/sign-in?next=/admin/discord">Sign in</Link> first.
              </>
            )}
          </p>
        </section>
      </>
    );
  }

  const missing = missingBotEnv();
  const appId = process.env.DISCORD_CLIENT_ID?.trim();
  const endpoint = `${appUrl()}/api/discord/interactions`;

  return (
    <>
      {head}

      {error ? (
        <ul className="errors" role="alert">
          <li>{error}</li>
        </ul>
      ) : null}
      {notice ? (
        <p className="ok-note" role="status">
          {notice}
        </p>
      ) : null}

      <section className="panel" aria-labelledby="setup-h">
        <div className="panel__head">
          <h2 id="setup-h" className="panel__title">
            Setup
          </h2>
          <span className="panel__note">Full steps in docs/SETUP.md, step 7</span>
        </div>
        <ol className="setup-steps">
          <li>
            <strong>Environment variables.</strong>{" "}
            {missing.length ? (
              <>
                Not set yet: <code>{missing.join(", ")}</code>. Add them in Vercel and redeploy.
              </>
            ) : (
              "All set."
            )}
          </li>
          <li>
            <strong>Interactions endpoint.</strong> In the Discord developer portal, on the application&rsquo;s{" "}
            <em>General Information</em> page, set <em>Interactions Endpoint URL</em> to <code>{endpoint}</code> and save.
            Discord checks the address when you save, so the variables must be live first.
          </li>
          <li>
            <strong>Invite the bot.</strong>{" "}
            {appId ? (
              <>
                <a href={inviteUrl(appId)} target="_blank" rel="noreferrer">
                  Add the bot to your server
                </a>{" "}
                with the permissions it needs (view, send, embed links, read history, create threads, send in threads).
              </>
            ) : (
              "Needs DISCORD_CLIENT_ID."
            )}
          </li>
          <li>
            <strong>Register the commands.</strong> Run this once, and again whenever the commands change.
            <form action={registerCommandsAction} style={{ marginTop: 10 }}>
              <button className="btn btn--cyan" type="submit" disabled={missing.length > 0}>
                Register slash commands
              </button>
            </form>
          </li>
        </ol>
      </section>
    </>
  );
}
