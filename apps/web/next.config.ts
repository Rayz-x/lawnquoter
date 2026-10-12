import type { NextConfig } from "next";
import { securityHeaderGroups } from "./src/lib/http/security-headers";

const nextConfig: NextConfig = {
  // Statically typed links stay off, so hrefs remain plain strings.
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
    "/help": ["./content/help/**/*.md"],
    "/help/[slug]": ["./content/help/**/*.md"],
  },
  async headers() {
    return securityHeaderGroups({
      isDev: process.env.NODE_ENV === "development",
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    });
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
