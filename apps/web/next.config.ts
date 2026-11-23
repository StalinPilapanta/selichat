import type { NextConfig } from "next";

// El navegador habla solo con la web; /api/* se reenvía al API.
// Así las cookies de sesión son del mismo dominio.
const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  transpilePackages: ["@chatea/shared"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default config;
