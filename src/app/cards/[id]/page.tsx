import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardText } from "@/components/CardText";
import { FateChip } from "@/components/fates";
import { Kpi } from "@/components/Kpi";
import { getDb } from "@/db";
import { buriedGiantCardUrl } from "@/lib/cards";
import { fateSlug, formatPct, productName, ROMAN } from "@/lib/format";
import { getCard } from "@/server/cards";

type Params = Promise<{ id: string }>;

async function load(id: string) {
  return getCard(await getDb(), decodeURIComponent(id));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const c = await load((await params).id);
  return { title: c?.name ?? "Card" };
}

export default async function CardPage({ params }: { params: Params }) {
  const card = await load((await params).id);
  if (!card) notFound();
  const extraTags = card.tags.slice(2).filter((t) => t !== card.fate?.name);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          <Link href="/cards">Cards</Link> · {card.type} · {productName(card.product)}
        </div>
        <h1>{card.name}</h1>
        <div className="actions small muted">
          {card.fate ? (
            <Link href={`/fates/${fateSlug(card.fate.name)}`} className="chip-link">
              <FateChip fate={card.fate.name} tier={card.fate.tier} />
            </Link>
          ) : null}
          {card.act ? <span>Act {ROMAN[card.act as 1 | 2 | 3]}</span> : null}
          {card.keys !== null ? <span>{card.keys} keys</span> : null}
          {extraTags.length ? <span>{extraTags.join(" · ")}</span> : null}
          <span className="tabular">{card.id}</span>
        </div>
      </div>

      {card.removedAt ? (
        <p className="notice">
          This card is no longer in Buried Giant Studios&rsquo; database. It is kept here because tags refer to it.
        </p>
      ) : null}

      <div className="grid-2 grid-2--even">
        <section className="panel" aria-labelledby="text-h">
          <div className="panel__head">
            <h2 id="text-h" className="panel__title">
              Rules text
            </h2>
            <a className="panel__note" href={buriedGiantCardUrl(card.id)} rel="noopener">
              View on Buried Giant
            </a>
          </div>
          <CardText text={card.text} />
          {card.flip ? (
            <p className="small" style={{ marginBottom: 0 }}>
              Other side: <Link href={`/cards/${card.flip.id}`}>{card.flip.name}</Link>
            </p>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="stats-h">
          <div className="panel__head">
            <h2 id="stats-h" className="panel__title">
              From tagged photos
            </h2>
          </div>
          <div className="grid-kpi grid-kpi--2">
            <Kpi label="Seen" value={String(card.stats.tagged)} note="tableau photos tagged with it" />
            <Kpi
              label="Holders won"
              value={card.stats.holders ? formatPct(card.stats.wins / card.stats.holders) : "–"}
              note={card.stats.holders ? `${card.stats.wins} of ${card.stats.holders} in closed campaigns` : "no closed campaigns yet"}
            />
          </div>
          {card.sightings.length ? (
            <ul className="sighting-list">
              {card.sightings.map((s) => (
                <li key={s.photoId}>
                  <Link href={`/campaigns/${s.campaignId}/photos/${s.photoId}`}>
                    {s.campaignTitle}, Act {ROMAN[s.actNo]}
                  </Link>{" "}
                  · {s.player}
                  {s.isWinner && s.status === "closed" ? <span className="badge badge--winner">Winner</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty" style={{ marginTop: 14 }}>
              Not tagged on any tableau photo yet.
            </p>
          )}
        </section>
      </div>

      <p className="muted small">
        Card text from{" "}
        <a href={buriedGiantCardUrl(card.id)} rel="noopener">
          Buried Giant Studios&rsquo; card database
        </a>
        , used with permission.
      </p>
    </>
  );
}
