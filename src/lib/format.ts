export const ROMAN = { 1: "I", 2: "II", 3: "III" } as const;

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** "2026-11-08" -> "Nov 08, 2026". Dates played are calendar dates, shown as-is. */
export function formatDate(d: string | null | undefined): string {
  if (!d) return "–";
  return dateFmt.format(new Date(`${d}T00:00:00Z`));
}

export function formatShortDate(d: string | null | undefined): string {
  if (!d) return "–";
  return shortFmt.format(new Date(`${d}T00:00:00Z`));
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "–";
  return dateTimeFmt.format(typeof d === "string" ? new Date(d) : d);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "Planet Breaker" -> "planet-breaker", for fate page URLs. */
export function fateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** 0.5714 -> "57%"; null -> "–". */
export function formatPct(r: number | null | undefined): string {
  return r === null || r === undefined ? "–" : `${Math.round(r * 100)}%`;
}

/** Averages to one decimal place; null -> "–". */
export function formatAvg(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : n.toFixed(1);
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
