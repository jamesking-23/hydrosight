import type { NextConfig } from "next";

// Static preview mode (GitHub Pages). Enabled only when NEXT_PUBLIC_BASE_PATH is set by the
// Pages workflow. The normal server/Docker build is unchanged (standalone output).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isStaticPreview = basePath !== "";

const nextConfig: NextConfig = {
  ...(isStaticPreview
    ? { output: "export", basePath, trailingSlash: true, images: { unoptimized: true } }
    : { output: "standalone" }),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
