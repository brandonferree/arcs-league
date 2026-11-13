import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local development database) ships WASM and must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
  // Lets a second local dev server (e.g. the "dev-demo" launch config) run beside
  // the usual one: Next allows one dev server per build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
