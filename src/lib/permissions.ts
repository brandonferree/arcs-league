/**
 * Who may do what (spec section 5). Pure, so it is unit-tested and shared by
 * pages (to show or hide controls) and server actions (to enforce).
 */

export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const STALLED_AFTER_DAYS = 60;

export interface Actor {
  playerId: number;
  isModerator: boolean;
}

export interface CampaignAccess {
  status: "in_progress" | "closed" | "void";
  createdById: number | null;
  /** Player ids of everyone at the table. */
  playerIds: readonly number[];
}

/** Players at the table and whoever created the campaign count as participants. */
export function isParticipant(actor: Actor | null, c: CampaignAccess): boolean {
  if (!actor) return false;
  return c.playerIds.includes(actor.playerId) || c.createdById === actor.playerId;
}

/** Recording a new act: participants or moderators, on an in-progress campaign. */
export function canRecordAct(actor: Actor | null, c: CampaignAccess): boolean {
  if (!actor || c.status !== "in_progress") return false;
  return actor.isModerator || isParticipant(actor, c);
}

/** Editing a saved act: participants for 24 hours after it was first saved; moderators always. */
export function canEditAct(
  actor: Actor | null,
  c: CampaignAccess,
  actSavedAt: Date,
  now: Date = new Date(),
): boolean {
  if (!actor) return false;
  if (actor.isModerator) return true;
  if (c.status === "void") return false;
  return isParticipant(actor, c) && now.getTime() - actSavedAt.getTime() < EDIT_WINDOW_MS;
}

export function editWindowEndsAt(actSavedAt: Date): Date {
  return new Date(actSavedAt.getTime() + EDIT_WINDOW_MS);
}

export function isStalled(status: CampaignAccess["status"], lastActivityAt: Date, now: Date = new Date()): boolean {
  return status === "in_progress" && now.getTime() - lastActivityAt.getTime() > STALLED_AFTER_DAYS * 86_400_000;
}
