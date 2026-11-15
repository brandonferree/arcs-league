import { afterEach, describe, expect, it } from "vitest";
import { bearerMatches, importResponse, importSecret } from "./import-http";

const SECRET = "s".repeat(40);

afterEach(() => {
  delete process.env.MEEPLES_IMPORT_SECRET;
});

describe("push authentication", () => {
  it("needs a configured secret of at least 32 characters", () => {
    expect(importSecret()).toBeNull();
    process.env.MEEPLES_IMPORT_SECRET = "short";
    expect(importSecret()).toBeNull();
    process.env.MEEPLES_IMPORT_SECRET = ` ${SECRET} `;
    expect(importSecret()).toBe(SECRET);
  });

  it("accepts only the exact Bearer token", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches(`bearer  ${SECRET} `, SECRET)).toBe(true);
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(bearerMatches(SECRET, SECRET)).toBe(false);
    expect(bearerMatches(null, SECRET)).toBe(false);
  });
});

describe("responses", () => {
  const base = "https://league.example";
  it("maps each outcome to the documented status and body", () => {
    expect(importResponse({ status: "saved", importId: 1, campaignId: 7, actNo: 2 }, base)).toEqual({
      status: 201,
      body: { status: "saved", actUrl: "https://league.example/campaigns/7#act-2" },
    });
    expect(importResponse({ status: "pending", importId: 3, problems: ["x"] }, base)).toEqual({
      status: 202,
      body: { status: "pending", confirmUrl: "https://league.example/imports/3", problems: ["x"] },
    });
    expect(importResponse({ status: "conflict", importId: 3, campaignId: 7, actNo: 1 }, base).status).toBe(409);
    expect(importResponse({ status: "invalid", errors: ["bad"] }, base)).toEqual({
      status: 400,
      body: { status: "invalid", errors: ["bad"] },
    });
  });
});
