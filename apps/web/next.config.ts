import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every authenticated page reads the session cookie, so static prerendering
  // is not useful here; keep routes dynamic and skip cache-components mode.
  typedRoutes: false,
  // The quote PDF reads these from disk at request time. path.join(process.cwd(), …)
  // is invisible to the file tracer, so a serverless function would ship without them.
  // The fonts directory is named [token]; a literal glob treats that as a character class.
  experimental: {
    // Two 2 MB logo files (light + dark) plus the rest of the form.
    serverActions: { bodySizeLimit: "5mb" },
  },
  outputFileTracingIncludes: {
    "/q/[token]/pdf": ["./src/app/q/**/fonts/**/*", "./public/brand/lq-mark-256.png"],
    "/settings/branding/sample-pdf": ["./src/app/q/**/fonts/**/*", "./public/brand/lq-mark-256.png"],
  },
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
