export type HeaderGroup = {
  source: string;
  headers: { key: string; value: string }[];
};

const TILE_HOSTS = [
  "https://ibasemaps-api.arcgis.com",
  "https://server.arcgisonline.com",
  "https://services.arcgisonline.com",
];

const GEOCODER_HOSTS = ["https://maps.googleapis.com", "https://places.googleapis.com"];

function originOf(raw: string | undefined): { http: string; ws: string } | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const ws = url.protocol === "https:" ? "wss:" : "ws:";
    return { http: url.origin, ws: `${ws}//${url.host}` };
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(options: {
  isDev: boolean;
  supabaseUrl?: string;
  frameAncestors: "'none'" | "*";
}): string {
  const supabase = originOf(options.supabaseUrl);
  const connect = ["'self'", supabase?.http, supabase?.ws, ...TILE_HOSTS, ...GEOCODER_HOSTS].filter(Boolean);
  const img = ["'self'", "blob:", "data:", supabase?.http, ...TILE_HOSTS].filter(Boolean);
  const script = ["'self'", "'unsafe-inline'", options.isDev ? "'unsafe-eval'" : null].filter(Boolean);
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img.join(" ")}`,
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${options.frameAncestors}`,
    "frame-src 'none'",
    options.isDev ? null : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

function sharedHeaders(csp: string, isDev: boolean): { key: string; value: string }[] {
  const headers = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  ];
  if (!isDev) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }
  return headers;
}

/**
 * Security headers for every route. The embeddable widget path may be framed;
 * every other route, including public proposals, sends frame-ancestors 'none'.
 */
export function securityHeaderGroups(options: { isDev: boolean; supabaseUrl?: string }): HeaderGroup[] {
  const strict = sharedHeaders(
    contentSecurityPolicy({ ...options, frameAncestors: "'none'" }),
    options.isDev,
  );
  const widget = sharedHeaders(contentSecurityPolicy({ ...options, frameAncestors: "*" }), options.isDev);
  return [
    { source: "/", headers: strict },
    { source: "/:path*", headers: strict },
    { source: "/widget", headers: widget },
    { source: "/widget/:path*", headers: widget },
  ];
}
