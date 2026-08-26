// 최소한의 서비스워커: "홈 화면에 추가"가 가능하도록 등록하고,
// 서버에서 보낸 푸시 알림을 실제 화면 알림으로 띄운다.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());

self.addEventListener("push", (event) => {
  let data = { title: "다윈 통증의학과", body: "새 메시지가 도착했어요." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // ignore malformed payload
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsArr) => {
      if (clientsArr.length > 0) {
        clientsArr[0].focus();
      } else {
        self.clients.openWindow("/");
      }
    })
  );
});
