import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@driveme/ui", "@driveme/design-tokens"]
};

export default nextConfig;
