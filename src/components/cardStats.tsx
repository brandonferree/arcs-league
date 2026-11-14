import Link from "next/link";
import { CardImage } from "@/components/CardImage";
import { enoughHolders, CARD_WIN_RATE_MIN_HOLDERS } from "@/lib/card-stats";
import { formatPct } from "@/lib/format";
import { rate } from "@/lib/stats";

/** A card's thumbnail and name in a table cell, linking to the card's page. */
export function CardCell({ id, name, imageV }: { id: string; name: string; imageV: number | null }) {
  return (
    <Link href={`/cards/${id}`} className="card-cell">
      <CardImage id={id} name={name} imageV={imageV} className="card-cell__thumb" />
      <span>{name}</span>
    </Link>
  );
}

/** "67%" over "2 of 3", greyed below the minimum number of holders; "–" with none. */
export function HoldersWon({ wins, holders }: { wins: number; holders: number }) {
  if (!holders) return <span className="muted">–</span>;
  const small = !enoughHolders(holders);
  return (
    <span
      className={small ? "muted" : undefined}
      title={small ? `Fewer than ${CARD_WIN_RATE_MIN_HOLDERS} holders in closed campaigns` : undefined}
    >
      {formatPct(rate(wins, holders))}
      <span className="muted small" style={{ display: "block" }}>
        {wins} of {holders}
      </span>
    </span>
  );
}
