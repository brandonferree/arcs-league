import { describe, expect, it } from "vitest";
import { canEditAct, canManagePhotos, canRemoveCardTag, canTagCards, canRecordAct, canViewPhotos, isStalled, type CampaignAccess } from "./permissions";

const campaign: CampaignAccess = { status: "in_progress", createdById: 9, playerIds: [1, 2, 3] };
const player = { playerId: 1, isModerator: false };
const outsider = { playerId: 7, isModerator: false };
const creator = { playerId: 9, isModerator: false };
const mod = { playerId: 8, isModerator: true };
const saved = new Date("2026-11-01T12:00:00Z");
const hours = (h: number) => new Date(saved.getTime() + h * 3_600_000);

describe("recording an act", () => {
  it("is open to players, the creator and moderators", () => {
    expect(canRecordAct(player, campaign)).toBe(true);
    expect(canRecordAct(creator, campaign)).toBe(true);
    expect(canRecordAct(mod, campaign)).toBe(true);
  });
  it("is closed to outsiders, anonymous users and finished campaigns", () => {
    expect(canRecordAct(outsider, campaign)).toBe(false);
    expect(canRecordAct(null, campaign)).toBe(false);
    expect(canRecordAct(player, { ...campaign, status: "closed" })).toBe(false);
  });
});

describe("24-hour edit window", () => {
  it("lets a player edit within 24 hours", () => {
    expect(canEditAct(player, campaign, saved, hours(23.9))).toBe(true);
  });
  it("locks players out after 24 hours", () => {
    expect(canEditAct(player, campaign, saved, hours(24))).toBe(false);
  });
  it("applies to closed campaigns too", () => {
    expect(canEditAct(player, { ...campaign, status: "closed" }, saved, hours(1))).toBe(true);
  });
  it("never lets outsiders edit", () => {
    expect(canEditAct(outsider, campaign, saved, hours(1))).toBe(false);
  });
  it("always lets moderators edit", () => {
    expect(canEditAct(mod, campaign, saved, hours(24 * 365))).toBe(true);
    expect(canEditAct(mod, { ...campaign, status: "void" }, saved, hours(1))).toBe(true);
  });
});

describe("stalled", () => {
  const now = new Date("2026-11-13T00:00:00Z");
  it("flags in-progress campaigns idle for more than 60 days", () => {
    expect(isStalled("in_progress", new Date("2026-09-01T00:00:00Z"), now)).toBe(true);
    expect(isStalled("in_progress", new Date("2026-10-01T00:00:00Z"), now)).toBe(false);
  });
  it("never flags closed campaigns", () => {
    expect(isStalled("closed", new Date("2020-01-01T00:00:00Z"), now)).toBe(false);
  });
});

describe("photos", () => {
  it("lets participants manage photos at any time, but not on a void campaign", () => {
    expect(canManagePhotos(player, { ...campaign, status: "closed" })).toBe(true);
    expect(canManagePhotos(player, { ...campaign, status: "void" })).toBe(false);
  });
  it("never lets outsiders or signed-out visitors manage photos", () => {
    expect(canManagePhotos(outsider, campaign)).toBe(false);
    expect(canManagePhotos(null, campaign)).toBe(false);
  });
  it("always lets moderators manage photos", () => {
    expect(canManagePhotos(mod, { ...campaign, status: "void" })).toBe(true);
  });
  it("shows photos to members, or to everyone once switched public", () => {
    expect(canViewPhotos(false, false)).toBe(false);
    expect(canViewPhotos(true, false)).toBe(true);
    expect(canViewPhotos(false, true)).toBe(true);
  });
});

describe("card tags", () => {
  it("lets any signed-in member tag", () => {
    expect(canTagCards(outsider)).toBe(true);
    expect(canTagCards(null)).toBe(false);
  });
  it("lets the tagger, participants and moderators remove a tag", () => {
    expect(canRemoveCardTag(outsider, outsider.playerId, campaign)).toBe(true);
    expect(canRemoveCardTag(outsider, player.playerId, campaign)).toBe(false);
    expect(canRemoveCardTag(player, outsider.playerId, campaign)).toBe(true);
    expect(canRemoveCardTag(player, outsider.playerId, { ...campaign, status: "void" })).toBe(false);
    expect(canRemoveCardTag(mod, null, campaign)).toBe(true);
  });
});
