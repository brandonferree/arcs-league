import { PROGRESSION_LABELS, type ProgressionStep, type Tier } from "@/lib/rules";

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={`tier-badge tier-${tier}`} title={`Tier ${tier}`}>
      {tier}
    </span>
  );
}

/** Solid chip in the tier colour with dark text; the tier letter is always shown. */
export function FateChip({ fate, tier }: { fate: string; tier: Tier }) {
  return (
    <span className={`chip tier-${tier}`}>
      <span className="chip__tier" aria-label={`Tier ${tier}`}>
        {tier}
      </span>
      {fate}
    </span>
  );
}

export function FatePath({ steps }: { steps: { fate: string; tier: Tier }[] }) {
  return (
    <span className="path">
      {steps.map((s, i) => (
        <span key={i} className="path">
          {i > 0 ? (
            <span className="path__sep" aria-hidden="true">
              ›
            </span>
          ) : null}
          <FateChip fate={s.fate} tier={s.tier} />
        </span>
      ))}
    </span>
  );
}

const GLYPH: Record<ProgressionStep, string> = {
  started: "▸",
  kept: "=",
  "changed-after-success": "✓",
  "changed-after-failure": "✗",
};

export function ProgressionMark({ step, withLabel = false }: { step: ProgressionStep; withLabel?: boolean }) {
  return (
    <span className={`prog prog--${step}`} title={PROGRESSION_LABELS[step]}>
      <span className="prog__glyph" aria-hidden="true">
        {GLYPH[step]}
      </span>
      {withLabel ? PROGRESSION_LABELS[step] : <span className="sr-only">{PROGRESSION_LABELS[step]}</span>}
    </span>
  );
}

export function ProgressionLegend() {
  return (
    <div className="legend" aria-label="Progression key">
      {(Object.keys(GLYPH) as ProgressionStep[]).map((s) => (
        <ProgressionMark key={s} step={s} withLabel />
      ))}
    </div>
  );
}
