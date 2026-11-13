/**
 * Charts for player and fate pages. Server-rendered, no client JS: every mark is
 * focusable and carries its value in a native tooltip and an accessible name,
 * and every value is also in a table on the same page.
 *
 * Progression colours for fills (validated for colour-blind separation on the
 * panel surface): Started muted, Kept cyan, Changed after success violet,
 * Changed after failure red. Each segment also shows its glyph, and the legend
 * is always present, so identity never rests on colour alone.
 */
import { ROMAN, formatPct } from "@/lib/format";
import { PROGRESSION_LABELS, type ProgressionStep } from "@/lib/rules/progression";
import type { StepCounts, TimelinePoint } from "@/lib/stats";

export const STEP_ORDER: ProgressionStep[] = ["started", "kept", "changed-after-success", "changed-after-failure"];

const GLYPH: Record<ProgressionStep, string> = {
  started: "▸",
  kept: "=",
  "changed-after-success": "✓",
  "changed-after-failure": "✗",
};

export function StepLegend({ steps = STEP_ORDER }: { steps?: ProgressionStep[] }) {
  return (
    <ul className="chart-legend" aria-label="Key">
      {steps.map((s) => (
        <li key={s}>
          <span className={`chart-swatch pbar-seg--${s}`} aria-hidden="true" />
          {PROGRESSION_LABELS[s]}
        </li>
      ))}
    </ul>
  );
}

/**
 * One 100% bar per act: how the fate was reached (player page: how this player
 * reached each act's fate; fate page: how players came to this fate).
 */
export function ProgressionBars({
  rows,
  noun = "plays",
}: {
  rows: { act: 1 | 2 | 3; counts: StepCounts }[];
  noun?: string;
}) {
  const shown = rows.filter((r) => STEP_ORDER.some((s) => r.counts[s] > 0));
  if (!shown.length) return <p className="empty">Nothing to chart yet.</p>;
  const used = STEP_ORDER.filter((s) => shown.some((r) => r.counts[s] > 0));
  return (
    <figure className="chart">
      <div className="pbar-rows">
        {shown.map(({ act, counts }) => {
          const total = STEP_ORDER.reduce((n, s) => n + counts[s], 0);
          return (
            <div key={act} className="pbar-row">
              <div className="pbar-row__label">
                Act {ROMAN[act]}
                <span className="muted small tabular">
                  {" "}
                  · {total} {noun}
                </span>
              </div>
              <div
                className="pbar"
                role="img"
                aria-label={`Act ${ROMAN[act]}: ${STEP_ORDER.filter((s) => counts[s])
                  .map((s) => `${PROGRESSION_LABELS[s]} ${counts[s]} of ${total}`)
                  .join(", ")}`}
              >
                {STEP_ORDER.filter((s) => counts[s] > 0).map((s) => {
                  const share = counts[s] / total;
                  const label = `${PROGRESSION_LABELS[s]}: ${counts[s]} of ${total} (${formatPct(share)})`;
                  return (
                    <span key={s} className={`pbar-seg pbar-seg--${s}`} style={{ flexGrow: counts[s] }} title={label}>
                      {share >= 0.14 ? (
                        <span className="pbar-seg__text" aria-hidden="true">
                          {GLYPH[s]} {formatPct(share)}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <StepLegend steps={used} />
    </figure>
  );
}

// Sized close to a half-width panel so text renders near its CSS size.
const W = 440;
const H = 200;
const PAD = { top: 14, right: 46, bottom: 28, left: 40 };

/** Cumulative win rate after each game, oldest to newest. One series, so no legend. */
export function WinRateLine({ points, label }: { points: TimelinePoint[]; label: string }) {
  if (!points.length) return <p className="empty">Nothing to chart yet.</p>;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (r: number) => PAD.top + (1 - r) * ih;
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.winRate).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const showDots = points.length <= 40;
  const xTicks = points.length === 1 ? [0] : [0, points.length - 1];

  return (
    <figure className="chart">
      <svg
        className="line-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: ${formatPct(last.winRate)} after ${last.n} ${last.n === 1 ? "game" : "games"}`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line className="line-chart__grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="line-chart__tick" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} className="line-chart__tick" x={x(i)} y={H - 8} textAnchor={points.length === 1 ? "middle" : i ? "end" : "start"}>
            Game {points[i].n}
          </text>
        ))}
        <path className="line-chart__line" d={d} />
        {points.map((p, i) => {
          const tip = `Game ${p.n} · ${p.title} (${p.playedOn}) · ${p.won ? "Won" : "Lost"} · ${formatPct(p.winRate)} so far`;
          return (
            <g key={p.campaignId + ":" + i} className="line-chart__point" tabIndex={0} aria-label={tip}>
              <title>{tip}</title>
              <circle className="line-chart__hit" cx={x(i)} cy={y(p.winRate)} r={12} />
              {showDots || i === points.length - 1 ? (
                <circle className="line-chart__dot" cx={x(i)} cy={y(p.winRate)} r={4} />
              ) : null}
            </g>
          );
        })}
        <text className="line-chart__end" x={x(points.length - 1) + 10} y={y(last.winRate)} dy="0.32em">
          {formatPct(last.winRate)}
        </text>
      </svg>
    </figure>
  );
}
