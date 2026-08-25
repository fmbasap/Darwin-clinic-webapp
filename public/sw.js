// 최소한의 서비스워커: "홈 화면에 추가"가 가능하도록 등록만 해요.
// 오프라인 캐싱이 필요하면 나중에 캐시 전략을 추가하면 돼요.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());
