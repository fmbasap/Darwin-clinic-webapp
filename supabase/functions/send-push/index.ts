// Supabase Edge Function: send-push
// messages 테이블에 sender='clinic'인 새 메시지가 INSERT되면
// Database Webhook이 이 함수를 호출한다. 이 함수는 해당 환자의
// 모든 등록된 기기로 실제 웹 푸시 알림을 전송한다.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:example@example.com";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  try {
    // Database Webhook 설정 시 등록한 비밀 헤더와 일치하는 요청만 처리한다.
    if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = await req.json();
    const row = payload.record;

    // 병원이 보낸 메시지에만 반응한다 (환자가 보낸 메시지는 푸시 안 보냄)
    if (!row || row.sender !== "clinic") {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("patient_phone", row.patient_phone);

    if (error) throw error;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const notificationPayload = JSON.stringify({
      title: "다윈 통증의학과",
      body: row.body,
    });

    let sent = 0;
    for (const sub of subs) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(pushSubscription, notificationPayload);
        sent++;
      } catch (err) {
        // 구독이 만료/삭제된 경우(410, 404) DB에서도 정리한다
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        } else {
          console.error("push send error", err);
        }
      }
    }

    return new Response(JSON.stringify({ sent }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
