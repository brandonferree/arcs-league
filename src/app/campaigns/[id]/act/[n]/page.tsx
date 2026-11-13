import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { ROMAN, todayIso } from "@/lib/format";
import { canEditAct, canRecordAct, isParticipant } from "@/lib/permissions";
import type { ActNumber } from "@/lib/rules";
import { getCampaign, listFates } from "@/server/campaigns";
import { getSession, toActor } from "@/server/session";
import { ActForm, type ActFormProps } from "./ActForm";

type Params = Promise<{ id: string; n: string }>;

export const metadata: Metadata = { title: "Record an act" };

function Blocked({ title, children, back }: { title: string; children: React.ReactNode; back: string }) {
  return (
    <>
      <div className="page-head">
        <h1>{title}</h1>
      </div>
      <section className="panel">
        <p style={{ marginTop: 0 }}>{children}</p>
        <Link className="btn btn--quiet" href={back}>
          Back to the campaign
        </Link>
      </section>
    </>
  );
}

export default async function ActPage({ params }: { params: Params }) {
  const { id, n } = await params;
  const campaignId = Number(id);
  const actNo = Number(n) as ActNumber;
  if (!Number.isInteger(campaignId) || ![1, 2, 3].includes(actNo)) notFound();

  const db = await getDb();
  const [c, fates, session] = await Promise.all([getCampaign(db, campaignId), listFates(db), getSession()]);
  if (!c) notFound();
  const back = `/campaigns/${c.id}`;
  const title = `Act ${ROMAN[actNo]}`;

  if (!session) {
    return (
      <Blocked title={title} back={back}>
        <a href={`/sign-in?next=/campaigns/${c.id}/act/${actNo}`}>Sign in with Discord</a> to record this act.
      </Blocked>
    );
  }
  const actor = toActor(session);
  const existing = c.acts.find((a) => a.actNo === actNo);

  if (existing) {
    if (!canEditAct(actor, c.access, existing.createdAt)) {
      return (
        <Blocked title={title} back={back}>
          {isParticipant(actor, c.access)
            ? "The 24-hour edit window for this act has closed. Ask a moderator if something needs fixing."
            : "Only players in this campaign or moderators can edit it."}
        </Blocked>
      );
    }
  } else {
    if (!canRecordAct(actor, c.access)) {
      return (
        <Blocked title={title} back={back}>
          {c.status !== "in_progress"
            ? "This campaign is not in progress."
            : "Only players in this campaign or moderators can record acts."}
        </Blocked>
      );
    }
    if (actNo !== c.acts.length + 1) {
      const next = (c.acts.length + 1) as ActNumber;
      return (
        <Blocked title={title} back={back}>
          Acts are recorded in order. <Link href={`/campaigns/${c.id}/act/${next}`}>Record Act {ROMAN[next]}</Link>{" "}
          first.
        </Blocked>
      );
    }
  }

  const otherActs: ActFormProps["otherActs"] = {};
  for (const a of c.acts) {
    if (a.actNo === actNo) continue;
    otherActs[a.actNo] = Object.fromEntries(
      Object.entries(a.results).map(([cp, r]) => [cp, { fate: r.fate, success: r.success, score: r.score }]),
    );
  }

  const winnersOverridden = existing && actNo === 3 && c.winnerOverridden;
  const initial: ActFormProps["initial"] = {
    playedOn: existing?.playedOn ?? todayIso(),
    vodUrl: existing?.vodUrl ?? "",
    notes: existing?.notes ?? "",
    rows: Object.fromEntries(
      c.players.map((p) => {
        const r = existing?.results[p.cpId];
        return [p.cpId, { fateId: r?.fateId ?? null, score: r?.score ?? null, success: r?.success ?? null, seat: r?.seat ?? null }];
      }),
    ),
    winners: winnersOverridden ? c.players.filter((p) => p.isWinner).map((p) => p.cpId) : null,
    winnerReason: winnersOverridden ? (c.winnerOverrideReason ?? "") : "",
  };

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          <Link href={back}>{c.title}</Link>
        </div>
        <h1>
          {existing ? "Edit" : "Record"} Act {ROMAN[actNo]}
        </h1>
        <p className="lede">
          {existing
            ? "Changes are checked against every act of the campaign and recorded in the change history."
            : actNo === 3
              ? "Saving Act III with a winner closes the campaign."
              : "Each fate choice is checked against the rules as you go."}
        </p>
      </div>
      <ActForm
        campaignId={c.id}
        actNo={actNo}
        isEdit={!!existing}
        players={c.players.map((p) => ({ cpId: p.cpId, name: p.name }))}
        fates={fates.map((f) => ({ id: f.id, name: f.name, tier: f.tier }))}
        otherActs={otherActs}
        initial={initial}
      />
    </>
  );
}
