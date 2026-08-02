import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/heavy server-only packages: loaded at runtime, never bundled.
  serverExternalPackages: ["telegram", "sharp"],
};

export default nextConfig;
