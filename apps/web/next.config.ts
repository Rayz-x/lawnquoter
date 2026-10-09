import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every authenticated page reads the session cookie, so static prerendering
  // is not useful here; keep routes dynamic and skip cache-components mode.
  typedRoutes: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
