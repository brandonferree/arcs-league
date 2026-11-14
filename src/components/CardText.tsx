import { Fragment } from "react";
import { parseCardText, type TextSegment } from "@/lib/cards";

function Segment({ s }: { s: TextSegment }) {
  switch (s.kind) {
    case "b":
      return <strong>{s.value}</strong>;
    case "i":
      return <em>{s.value}</em>;
    case "bi":
      return (
        <strong>
          <em>{s.value}</em>
        </strong>
      );
    case "symbol":
      return (
        <span className="card-sym" title={`${s.value} symbol`}>
          {s.value}
        </span>
      );
    default:
      return <>{s.value}</>;
  }
}

/** A card's rules text from Buried Giant's markup, rendered without raw HTML. */
export function CardText({ text, className = "card-text" }: { text: string | null; className?: string }) {
  const paragraphs = parseCardText(text);
  if (!paragraphs.length) return <p className="muted small">No rules text.</p>;
  return (
    <div className={className}>
      {paragraphs.map((lines, i) => (
        <p key={i}>
          {lines.map((line, j) => (
            <Fragment key={j}>
              {j > 0 ? <br /> : null}
              {line.map((s, k) => (
                <Segment key={k} s={s} />
              ))}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
