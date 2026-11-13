import { afterEach, describe, expect, it, vi } from "vitest";
import { devStubEnabled } from "./discord";
import { safeNext } from "./session";

const h = (init: Record<string, string>) => new Headers(init);

describe("dev sign-in stub guard", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("works only on localhost with the flag set outside production", () => {
    vi.stubEnv("DEV_AUTH_STUB", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(devStubEnabled(h({ host: "localhost:3000" }))).toBe(true);
    expect(devStubEnabled(h({ host: "127.0.0.1:3001" }))).toBe(true);
    expect(devStubEnabled(h({ host: "[::1]:3000" }))).toBe(true);
    expect(devStubEnabled(h({ host: "example.com" }))).toBe(false);
    expect(devStubEnabled(h({ host: "localhost.example.com" }))).toBe(false);
    expect(devStubEnabled(h({ host: "localhost:3000", "x-forwarded-host": "arcs.vercel.app" }))).toBe(false);
  });

  it("is off without the flag or in production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH_STUB", "0");
    expect(devStubEnabled(h({ host: "localhost" }))).toBe(false);
    vi.stubEnv("DEV_AUTH_STUB", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(devStubEnabled(h({ host: "localhost" }))).toBe(false);
  });
});

describe("safeNext", () => {
  it("allows same-site paths only", () => {
    expect(safeNext("/campaigns/1")).toBe("/campaigns/1");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext(String.raw`/\evil.com`)).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
