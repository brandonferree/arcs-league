/**
 * What the bot posts. Pure functions from league data to Discord message
 * bodies, so the wording is tested without Discord or a database.
 */
import type { CampaignDetail, CampaignListRow } from "@/server/campaigns";
import type { FateSummary, PlayerSummary } from "@/lib/stats";
import { fateSlug, formatAvg, formatDate, formatPct, joinNames, ROMAN } from "@/lib/format";
import type { Button, MessageBody } from "./discord-api";

const VIOLET = 0xa855f7;
const CYAN = 0x22d3ee;
const GOLD = 0xf5c451;

const NO_PINGS = { parse: [] } as const;

const link = (label: string, url: string): Button => ({ type: 2, style: 5, label, url });
const row = (...components: Button[]) => ({ type: 1 as const, components });

export const campaignUrl = (base: string, id: number) => `${base}/campaigns/${id}`;
export const actFormUrl = (base: string, id: number, actNo: number) => `${base}/campaigns/${id}/act/${actNo}`;

/** Discord markdown would treat * _ ~ ` | > in a player's name as formatting. */
export function escapeMd(s: string): string {
  return s.replace(/([\\*_~`|>[\]()])/g, "\\$1");
}

/** Plain-text reply, e.g. an error after a button press. */
export function notice(text: string, ephemeral = true): MessageBody {
  return { content: text, allowed_mentions: NO_PINGS, ...(ephemeral ? { flags: 64 } : {}) };
}

// ---------------------------------------------------------------------------
// Lobby

export const LOBBY_MIN = 3;
export const LOBBY_MAX = 4;

export interface LobbyView {
  id: number;
  status: "open" | "started" | "closed";
  openedBy: string;
  players: { name: string; discordId: string | null }[];
  campaign: { id: number; title: string; threadId: string | null } | null;
}

const who = (p: { name: string; discordId: string | null }) => (p.discordId ? `<@${p.discordId}>` : escapeMd(p.name));

export function lobbyMessage(l: LobbyView, base: string): MessageBody {
  const list = l.players.map((p, i) => `${i + 1}. ${who(p)}`).join("\n") || "_Nobody yet._";
  if (l.status === "started" && l.campaign) {
    const c = l.campaign;
    return {
      content: "",
      embeds: [
        {
          title: `${c.title} has started`,
          url: campaignUrl(base, c.id),
          color: VIOLET,
          description: `${list}\n\n${c.threadId ? `Play on in <#${c.threadId}>. ` : ""}Record each act on the site after it is played.`,
        },
      ],
      components: [row(link("Campaign page", campaignUrl(base, c.id)), link("Record Act I", actFormUrl(base, c.id, 1)))],
      allowed_mentions: NO_PINGS,
    };
  }
  if (l.status === "closed") {
    return {
      content: "",
      embeds: [{ title: "Campaign lobby closed", color: CYAN, description: "Everyone left. Use `/campaign start` to open a new one." }],
      components: [],
      allowed_mentions: NO_PINGS,
    };
  }
  const n = l.players.length;
  return {
    content: "",
    embeds: [
      {
        title: "ARCS campaign lobby",
        color: VIOLET,
        description: `Opened by ${escapeMd(l.openedBy)}. Blighted Reach campaigns take 3 or 4 players; once there are enough, any player here presses **Start**.\n\n${list}`,
        footer: { text: `${n} of ${LOBBY_MAX} joined` },
      },
    ],
    components: [
      row(
        { type: 2, style: 1, label: "Join", custom_id: `lobby:join:${l.id}`, disabled: n >= LOBBY_MAX },
        { type: 2, style: 2, label: "Leave", custom_id: `lobby:leave:${l.id}` },
        { type: 2, style: 3, label: "Start", custom_id: `lobby:start:${l.id}`, disabled: n < LOBBY_MIN },
      ),
    ],
    allowed_mentions: NO_PINGS,
  };
}

// ---------------------------------------------------------------------------
// Campaign threads

type Seat = Pick<CampaignDetail["players"][number], "name" | "isWinner" | "cpId"> & { discordId?: string | null };

/** First message in a campaign's thread. Mentions add the players to the thread. */
export function threadWelcome(c: Pick<CampaignDetail, "id" | "title">, seats: Seat[], base: string): MessageBody {
  const ids = seats.flatMap((s) => (s.discordId ? [s.discordId] : []));
  return {
    content:
      `**${escapeMd(c.title)}**: ${joinNames(seats.map((s) => who({ name: s.name, discordId: s.discordId ?? null })))}.\n` +
      "After each act, any player records it on the site; the result card appears here.",
    components: [row(link("Record Act I", actFormUrl(base, c.id, 1)), link("Campaign page", campaignUrl(base, c.id)))],
    allowed_mentions: { users: ids },
  };
}

const fateLabel = (r: { fate: string; tier: string }) => `${r.fate} (${r.tier})`;

/** The result card posted in the thread after an act, and edited if the act is. */
export function resultCard(c: CampaignDetail, actNo: 1 | 2 | 3, base: string): MessageBody | null {
  const act = c.acts.find((a) => a.actNo === actNo);
  if (!act) return null;
  const lines = c.players.map((p) => {
    const r = act.results[p.cpId];
    if (!r) return `**${escapeMd(p.name)}**: –`;
    const parts = [fateLabel(r), `${r.score} power`];
    if (actNo < 3) parts.push(r.success ? "succeeded" : "failed");
    const mark = actNo === 3 ? (p.isWinner ? "🏆 " : "") : r.success ? "✅ " : "❌ ";
    return `${mark}**${escapeMd(p.name)}** · ${parts.join(" · ")}`;
  });
  const fields = [{ name: "Played", value: formatDate(act.playedOn), inline: true }];
  if (actNo === 3) {
    const winners = c.players.filter((p) => p.isWinner).map((p) => escapeMd(p.name));
    if (winners.length) fields.push({ name: winners.length > 1 ? "Winners" : "Winner", value: joinNames(winners), inline: true });
    if (c.winnerOverridden && c.winnerOverrideReason) {
      fields.push({ name: "Why not the top score", value: escapeMd(c.winnerOverrideReason).slice(0, 1000), inline: false });
    }
  }
  if (act.vodUrl) fields.push({ name: "VOD", value: act.vodUrl, inline: true });
  const buttons = [link("Campaign page", campaignUrl(base, c.id))];
  if (actNo < 3 && c.status === "in_progress" && !c.acts.some((a) => a.actNo === actNo + 1)) {
    buttons.push(link(`Record Act ${ROMAN[(actNo + 1) as 2 | 3]}`, actFormUrl(base, c.id, actNo + 1)));
  }
  return {
    content: "",
    embeds: [
      {
        title: `${c.title}: Act ${ROMAN[actNo]}`,
        url: campaignUrl(base, c.id),
        color: actNo === 3 ? GOLD : VIOLET,
        description: lines.join("\n"),
        fields,
        footer: { text: "Players can edit an act for 24 hours after it is saved." },
      },
    ],
    components: [row(...buttons)],
    allowed_mentions: NO_PINGS,
  };
}

/** Announced in #arcs when Act III closes a campaign. */
export function closeAnnouncement(c: CampaignDetail, base: string): MessageBody {
  const act3 = c.acts.find((a) => a.actNo === 3);
  const winners = c.players.filter((p) => p.isWinner);
  const pathOf = (cpId: number) =>
    c.acts
      .map((a) => a.results[cpId])
      .filter(Boolean)
      .map((r) => fateLabel(r!))
      .join(" → ");
  const standings = [...c.players]
    .sort((a, b) => (act3?.results[b.cpId]?.score ?? 0) - (act3?.results[a.cpId]?.score ?? 0))
    .map((p) => `${p.isWinner ? "🏆 " : ""}**${escapeMd(p.name)}** · ${act3?.results[p.cpId]?.score ?? "–"} · ${pathOf(p.cpId)}`);
  const title = winners.length
    ? `${joinNames(winners.map((w) => w.name))} ${winners.length > 1 ? "share" : "wins"} ${c.title}`
    : `${c.title} is over`;
  return {
    content: "",
    embeds: [
      {
        title: title.slice(0, 256),
        url: campaignUrl(base, c.id),
        color: GOLD,
        description: standings.join("\n") + (c.discordThreadId ? `\n\nThe campaign: <#${c.discordThreadId}>` : ""),
      },
    ],
    components: [row(link("Campaign page", campaignUrl(base, c.id)))],
    allowed_mentions: NO_PINGS,
  };
}

// ---------------------------------------------------------------------------
// Commands

export function statusMessage(rows: (CampaignListRow & { threadId: string | null })[], base: string): MessageBody {
  if (!rows.length) {
    return notice("No campaigns are in progress. Open a lobby with `/campaign start`.", false);
  }
  const lines = rows.map((c) => {
    const next = c.actsRecorded < 3 ? `next: Act ${ROMAN[(c.actsRecorded + 1) as 1 | 2 | 3]}` : "";
    return [
      `**[${escapeMd(c.title)}](${campaignUrl(base, c.id)})**`,
      escapeMd(c.players.map((p) => p.name).join(", ")),
      `${c.actsRecorded} of 3 acts${next ? `, ${next}` : ""}`,
      c.threadId ? `<#${c.threadId}>` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  });
  return {
    content: "",
    embeds: [{ title: "Campaigns in progress", url: `${base}/campaigns?status=in_progress`, color: CYAN, description: lines.join("\n").slice(0, 4000) }],
    allowed_mentions: NO_PINGS,
  };
}

export function playerStatsMessage(s: PlayerSummary, base: string): MessageBody {
  return {
    content: "",
    embeds: [
      {
        title: s.name,
        url: `${base}/players/${s.playerId}`,
        color: CYAN,
        fields: [
          { name: "Games", value: String(s.games), inline: true },
          { name: "Wins", value: String(s.wins), inline: true },
          { name: "Win rate", value: formatPct(s.winRate), inline: true },
          { name: "Avg Act III", value: formatAvg(s.avgAct3), inline: true },
          { name: "Best Act III", value: s.bestAct3 === null ? "–" : String(s.bestAct3), inline: true },
          { name: "Finished on", value: `A ${s.finishTiers.A} · B ${s.finishTiers.B} · C ${s.finishTiers.C}`, inline: true },
        ],
        footer: { text: "Closed campaigns only" },
      },
    ],
    allowed_mentions: NO_PINGS,
  };
}

export function fateStatsMessage(f: FateSummary, base: string): MessageBody {
  return {
    content: "",
    embeds: [
      {
        title: `${f.name} (${f.tier})`,
        url: `${base}/fates/${fateSlug(f.name)}`,
        color: CYAN,
        fields: [
          { name: "Plays (I / II / III)", value: f.plays.join(" / "), inline: true },
          { name: "Success (I / II)", value: `${formatPct(f.successRate[0])} / ${formatPct(f.successRate[1])}`, inline: true },
          { name: "Keep %", value: formatPct(f.keepRate), inline: true },
          { name: "Act III finishes", value: String(f.finishes), inline: true },
          { name: "Win rate", value: formatPct(f.winRate), inline: true },
          { name: "Avg Act III", value: formatAvg(f.avgScore[2]), inline: true },
        ],
        footer: { text: `Closed campaigns only${f.complexity ? ` · complexity ${f.complexity}` : ""}` },
      },
    ],
    allowed_mentions: NO_PINGS,
  };
}
