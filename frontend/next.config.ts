import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not let `next dev` write AGENTS.md / CLAUDE.md into the repository.
  agentRules: false,
};

export default nextConfig;
