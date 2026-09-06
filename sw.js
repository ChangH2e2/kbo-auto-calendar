const CACHE_NAME = "kbo-gameday-shell-v15";
const API_CACHE_NAME = "kbo-gameday-api-v1";
const SHELL = ["/", "/index.html", "/app.js?v=20260906-inn", "/styles.css?v=20260906-inn", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = new Set([CACHE_NAME, API_CACHE_NAME]);
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(API_CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request)));
    return;
  }
  // 페이지 이동은 네트워크 우선이다. /team/…·/game/… 은 서버가 제목과 canonical을 붙여 주는데
  // 캐시 우선으로 두면 한 번 받은 메타가 다른 주소에도 그대로 굳는다.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match("/index.html"))));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    return response;
  })));
});

// 페이로드 없는 푸시를 받고 내용은 서버에서 받아 온다.
// 암호화된 페이로드(aes128gcm+ECDH)를 직접 구현하지 않기 위한 선택이다.
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let alerts = [];
    try {
      const subscription = await self.registration.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch(`/api/push/alerts?endpoint=${encodeURIComponent(subscription.endpoint)}`, { cache: "no-store" });
        if (response.ok) alerts = (await response.json()).alerts || [];
      }
    } catch (error) {
      // 내용을 못 받아도 알림은 띄워야 한다. 조용한 푸시는 브라우저가 구독을 회수한다.
    }
    if (!alerts.length) {
      return self.registration.showNotification("KBO GameDay", {
        body: "새 소식이 있습니다.", icon: "/icon.svg", badge: "/icon.svg",
        tag: "kbo-generic", data: { url: "/" }
      });
    }
    for (const alert of alerts) {
      await self.registration.showNotification(alert.title, {
        body: alert.body, icon: "/icon.svg", badge: "/icon.svg",
        tag: alert.id, data: { url: alert.url || "/" }
      });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        return client.navigate(target);
      }
    }
    return self.clients.openWindow(target);
  })());
});
