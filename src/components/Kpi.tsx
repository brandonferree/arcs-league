/** Headline number tile. Gold only for winners, champions and records. */
export function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: "gold" | "cyan";
}) {
  const color = tone === "gold" ? "var(--gold)" : tone === "cyan" ? "var(--cyan-light)" : undefined;
  return (
    <div className="panel kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value" style={color ? { color } : undefined}>
        {value}
      </div>
      {note ? <div className="kpi__note">{note}</div> : null}
    </div>
  );
}
