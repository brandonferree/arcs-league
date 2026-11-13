import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local development database) ships WASM and must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
};

export default nextConfig;
