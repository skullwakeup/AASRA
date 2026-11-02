import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not let `next dev` write AI-agent rule files into the repository.
  agentRules: false,
};

export default nextConfig;
