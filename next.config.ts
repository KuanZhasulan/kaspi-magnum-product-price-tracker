import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "resources.cdn-kaspi.kz",
      },
      {
        protocol: "https",
        hostname: "kaspi.kz",
      },
    ],
  },
};

export default nextConfig;
