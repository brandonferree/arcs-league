import type { Metadata } from "next";
import { getDb } from "@/db";
import { listSeasons, listSelectablePlayers } from "@/server/campaigns";
import { getSession } from "@/server/session";
import { NewCampaignForm } from "./NewCampaignForm";

export const metadata: Metadata = { title: "Log a game" };

export default async function NewCampaignPage() {
  const session = await getSession();
  if (!session) {
    return (
      <>
        <div className="page-head">
          <div className="eyebrow">New campaign</div>
          <h1>Log a game</h1>
        </div>
        <section className="panel">
          <p style={{ marginTop: 0 }}>Sign in with Discord to log a campaign. Any member of the server can log games.</p>
          <a className="btn" href="/sign-in?next=/campaigns/new">
            Sign in with Discord
          </a>
        </section>
      </>
    );
  }

  const db = await getDb();
  const [players, seasons] = await Promise.all([listSelectablePlayers(db), listSeasons(db)]);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">New campaign</div>
        <h1>Log a game</h1>
        <p className="lede">
          Set up the table, then record each act after it is played. The campaign stays in progress until Act III is
          saved with a winner.
        </p>
      </div>
      <NewCampaignForm
        players={players}
        seasons={seasons.map((s) => ({ id: s.id, name: s.name }))}
        me={session.playerId}
      />
    </>
  );
}
