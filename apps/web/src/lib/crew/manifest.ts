export function crewManifest() {
  return {
    name: "LawnQuoter Crew",
    short_name: "Crew",
    id: "/crew",
    scope: "/crew/",
    start_url: "/crew/today?source=pwa",
    display: "standalone" as const,
    orientation: "portrait" as const,
    background_color: "#FFFFFF",
    theme_color: "#1E5235",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" as const },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" as const },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" as const },
    ],
    shortcuts: [{ name: "Today", short_name: "Today", url: "/crew/today" }],
  };
}
