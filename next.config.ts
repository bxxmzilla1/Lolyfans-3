import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/heavy server-only packages: loaded at runtime, never bundled.
  serverExternalPackages: ["sharp", "ffmpeg-static"],
  // Make sure the ffmpeg binary ships with the thumbnail function on Vercel —
  // it's resolved at runtime, so file tracing can miss it otherwise.
  outputFileTracingIncludes: {
    "/api/media/thumb": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
