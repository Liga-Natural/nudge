// The service worker is served from a route so every deploy changes its bytes. The browser then
// installs the new one at once (skipWaiting + claim) and the page shows "Update available".
export const dynamic = "force-static";

const BUILD = process.env.NUDGE_BUILD ?? "dev";

const SCRIPT = `// Nudge service worker. build: ${BUILD}
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  let data = { title: "Nudge", body: "", url: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch (e) {
    // keep defaults
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      // Buttons show on Android and desktop. iPhone ignores them; a tap opens the item with the same buttons on top.
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 3) : [],
      data: { url: data.url, occ: data.occ },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const info = event.notification.data || {};
  const url = info.url || "/";
  const open = () =>
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    });
  if (event.action && info.occ) {
    event.waitUntil(
      fetch("/api/notify/action", {
        method: "POST",
        credentials: "same-origin",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occ: info.occ, action: event.action }),
      })
        .then((res) => (res.ok ? undefined : open()))
        .catch(open),
    );
    return;
  }
  event.waitUntil(open());
});
`;

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
