/**
 * Fills a separate local PGlite database with made-up campaigns, so the stats
 * pages can be seen with data. Never touches Postgres/Neon or ./.pglite.
 *
 *   npm run db:seed-demo                 # writes ./.pglite-demo (replacing it)
 *   DATABASE_URL=pglite:./.pglite-demo   # then point the dev server at it
 *
 * Every campaign goes through the real createCampaign / saveAct path, so the
 * fate rules are enforced exactly as on the site. Output is deterministic.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { connectPglite } from "@/db";
import { fates, players, seasons } from "@/db/schema";
import { createCampaign, getCampaign, saveAct, voidCampaign } from "@/server/campaigns";

const dir = path.resolve(process.argv[2] ?? ".pglite-demo");
if (path.basename(dir) === ".pglite") {
  console.error("seed-demo: refusing to overwrite ./.pglite; pass another folder.");
  process.exit(1);
}
rmSync(dir, { recursive: true, force: true });
const db = await connectPglite(dir);

// Small deterministic PRNG (mulberry32).
let seed = 20261113;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const allFates = await db.select().from(fates);
const byTier = (t: "A" | "B" | "C") => allFates.filter((f) => f.tier === t);

const names = ["Emma", "Chris", "Mark", "Priya", "Jonah", "Ines", "Theo"];
const made = await db
  .insert(players)
  .values([
    ...names.map((n, i) => ({ displayName: n, discordId: `demo-${i}` })),
    { displayName: "Mod Mia", discordId: "demo-mod", isModerator: true },
  ])
  .returning();
const pid = Object.fromEntries(made.map((p) => [p.displayName, p.id]));
const mod = { playerId: pid["Mod Mia"], isModerator: true };
const [season] = await db.insert(seasons).values({ name: "Season 1", startsOn: "2026-06-01" }).returning();

// Players have a skill bias so the leaderboard is not flat.
const skill: Record<string, number> = { Emma: 14, Chris: 8, Mark: 0, Priya: 10, Jonah: 4, Ines: 6, Theo: 2, Gail: 5 };

async function play(i: number, opts: { stopAfter?: number; voided?: boolean } = {}) {
  const size = rand() < 0.35 ? 4 : 3;
  const table = shuffle(names).slice(0, size);
  const guest = rand() < 0.15;
  const who = table.map((n, k) => (guest && k === size - 1 ? { guestName: "Gail" } : { playerId: pid[n] }));
  const seatNames = who.map((w, k) => ("guestName" in w ? "Gail" : table[k]));
  const month = 3 + Math.floor(i / 3);
  const day = 1 + ((i * 7) % 25);
  const date = (offset: number) => `2026-${String(month).padStart(2, "0")}-${String(day + offset).padStart(2, "0")}`;

  const id = await createCampaign(db, mod, { players: who, seasonId: month >= 6 ? season.id : null });
  const used = new Set<number>();
  const held: { fateId: number; success: boolean }[][] = seatNames.map(() => []);
  const withSeats = rand() < 0.6;
  const seatOrder = shuffle(seatNames.map((_, k) => k + 1));

  for (let act = 1; act <= (opts.stopAfter ?? 3); act++) {
    const c = (await getCampaign(db, id))!;
    const picks = seatNames.map((name, k) => {
      const prev = held[k][act - 2];
      const keepChance = act === 2 ? 0.55 : 0.45;
      if (prev?.success && rand() < keepChance) return prev.fateId;
      const pool = act === 1 ? byTier("A") : act === 2 ? byTier("B") : rand() < 0.8 ? byTier("C") : byTier("B");
      const choice = shuffle(pool).find((f) => !used.has(f.id))!;
      used.add(choice.id);
      return choice.id;
    });
    const results = c.players.map((p, k) => {
      const success = rand() * 30 + skill[seatNames[k]] > 14;
      const score = act === 3 ? int(25, 70) + skill[seatNames[k]] : int(0, 8) + Math.round(skill[seatNames[k]] / 3) + (act === 2 ? 4 : 0);
      held[k][act - 1] = { fateId: picks[k], success };
      return {
        campaignPlayerId: p.cpId,
        fateId: picks[k],
        score,
        success: act < 3 ? success : null,
        seat: withSeats ? seatOrder[k] : null,
      };
    });
    await saveAct(db, mod, id, act as 1 | 2 | 3, { playedOn: date(act - 1), results });
  }
  if (opts.voided) await voidCampaign(db, mod, id, "Demo: abandoned game");
  return id;
}

let closed = 0;
for (let i = 0; i < 24; i++) {
  await play(i);
  closed++;
}
await play(24, { stopAfter: 2 });
await play(25, { voided: true });

console.log(`seed-demo: ${closed} closed, 1 in progress and 1 void campaign written to ${dir}`);
console.log(`seed-demo: run the dev server with DATABASE_URL=pglite:${path.relative(process.cwd(), dir) || "."}`);
process.exit(0);
