import { useState, useEffect, useRef } from "react";
import {
  Calendar,
  MessageCircle,
  Send,
  Check,
  X,
  ChevronLeft,
  Activity,
  Loader2,
  User,
  Phone,
  LogOut,
  Lock,
  Users,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  RotateCcw,
  Users2,
  Trash2,
} from "lucide-react";
import { supabase } from "./supabaseClient";

// ---- Design tokens ----
const COLORS = {
  paper: "#F5F2EA",
  paperDeep: "#EDE8DA",
  ink: "#20281F",
  inkSoft: "#5B6459",
  pine: "#37543F",
  pineDeep: "#233A2C",
  amber: "#C98A3A",
  slate: "#7C8B94",
  white: "#FFFFFF",
  danger: "#B0503A",
};

const CLINIC = {
  name: "다윈 통증의학과",
  deptName: "통증의학과",
  deptEn: "PAIN MEDICINE",
  icon: Activity,
};

const DOCTOR = { name: "신관호 원장", title: "통증의학과 전문의" };
const ADMIN_PIN = "2025"; // 데모용 고정 PIN. 실제 운영 시 Supabase Auth 등 진짜 인증으로 교체 필요

const TIMES = ["10:00", "10:30", "11:00", "11:30", "12:00", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"];
const CLOSED_WEEKDAYS = [4, 0]; // 0=일 1=월 2=화 3=수 4=목 5=금 6=토 (목요일·일요일 정기휴무)
const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const CLOSED_DAYS_LABEL = CLOSED_WEEKDAYS.map((i) => WEEKDAY_NAMES[i]).join("·");
const CLINIC_HOURS_LABEL = "10:00~18:00 (점심 12:30~14:00)";

// 서버(Edge Function)에서 발급한 VAPID 공개키와 반드시 짝이 맞아야 함
const VAPID_PUBLIC_KEY = "BOWhM_xADN6MuPRxAIjRVn8KWta-2TqDXhLMFIja0eCf4vFPuTO9E0RYjH68_cTatzlek8k3hg6Z0jvD00_a6Mw";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function subscribeToPush(patientPhone) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { error: "이 브라우저는 푸시 알림을 지원하지 않아요." };
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const json = subscription.toJSON();
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        patient_phone: patientPhone,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      },
      { onConflict: "endpoint" }
    );
    if (error) return { error: error.message };
    return { error: null };
  } catch (e) {
    return { error: e.message || "알림 등록에 실패했어요." };
  }
}

async function unsubscribeFromPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { error: null };
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      await subscription.unsubscribe();
    }
    return { error: null };
  } catch (e) {
    return { error: e.message || "알림 끄기에 실패했어요." };
  }
}
const STATUS_LABEL = { confirmed: "확정", done: "진료완료", cancelled: "취소" };
const STATUS_COLOR = { confirmed: COLORS.pine, done: COLORS.slate, cancelled: COLORS.danger };

function nextDays(n) {
  const days = [];
  const today = new Date();
  const weekday = ["일", "월", "화", "수", "목", "금", "토"];
  for (let i = 1; i <= n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({
      key: d.toISOString().slice(0, 10),
      label: `${d.getMonth() + 1}.${d.getDate()}`,
      weekday: weekday[d.getDay()],
      closed: CLOSED_WEEKDAYS.includes(d.getDay()),
    });
  }
  return days;
}

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

// ---- Row mappers (DB snake_case <-> app camelCase) ----
function fromApptRow(r) {
  return {
    id: r.id,
    patientName: r.patient_name,
    patientPhone: r.patient_phone,
    dateLabel: r.date_label,
    weekday: r.weekday,
    time: r.appt_time,
    status: r.status,
    createdAt: r.created_at,
  };
}
function fromMsgRow(r) {
  return {
    id: r.id,
    patientName: r.patient_name,
    patientPhone: r.patient_phone,
    from: r.sender,
    text: r.body,
    at: r.created_at,
  };
}

// ---- Supabase data layer ----
async function loadAppointments() {
  const { data, error } = await supabase.from("appointments").select("*").order("created_at", { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return data.map(fromApptRow);
}
async function insertAppointment(appt) {
  const { error } = await supabase.from("appointments").insert([
    {
      patient_name: appt.patientName,
      patient_phone: appt.patientPhone,
      date_label: appt.dateLabel,
      weekday: appt.weekday,
      appt_time: appt.time,
      status: "confirmed",
    },
  ]);
  if (error && error.code !== "23505") console.error(error);
  return { error };
}
async function updateAppointmentStatus(id, status) {
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
  if (error && error.code !== "23505") console.error(error);
  return { error };
}

async function loadMessages() {
  const { data, error } = await supabase.from("messages").select("*").order("created_at", { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return data.map(fromMsgRow);
}
async function insertMessage(msg) {
  const { error } = await supabase.from("messages").insert([
    {
      patient_name: msg.patientName,
      patient_phone: msg.patientPhone,
      sender: msg.from,
      body: msg.text,
    },
  ]);
  if (error) console.error(error);
}
async function deleteMessage(id) {
  const { error } = await supabase.from("messages").delete().eq("id", id);
  if (error) console.error(error);
}

async function loadNotice() {
  const { data, error } = await supabase.from("notice").select("*").eq("id", 1).maybeSingle();
  if (error) {
    console.error(error);
    return "";
  }
  return data?.content || "";
}
async function saveNotice(content) {
  const { error } = await supabase.from("notice").upsert({ id: 1, content, updated_at: new Date().toISOString() });
  if (error) console.error(error);
}

// ---- 커뮤니티 게시판 ----
function maskName(name) {
  const trimmed = (name || "").trim();
  if (trimmed.length <= 1) return trimmed + "님";
  if (trimmed.length === 2) return trimmed[0] + "O";
  return trimmed[0] + "O".repeat(trimmed.length - 2) + trimmed[trimmed.length - 1];
}

async function loadPosts() {
  const { data, error } = await supabase.from("community_posts").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  return data.map((r) => ({
    id: r.id,
    patientPhone: r.patient_phone,
    displayName: r.display_name,
    content: r.content,
    createdAt: r.created_at,
  }));
}
async function insertPost({ patientPhone, patientName, content }) {
  const { error } = await supabase.from("community_posts").insert([
    {
      patient_phone: patientPhone,
      display_name: maskName(patientName),
      content,
    },
  ]);
  if (error) console.error(error);
  return { error };
}
async function deletePost(id) {
  const { error } = await supabase.from("community_posts").delete().eq("id", id);
  if (error) console.error(error);
}

// ---- Local profile (per-device "로그인 유지") ----
function loadProfile() {
  try {
    const raw = localStorage.getItem("patient-profile");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveProfile(value) {
  try {
    localStorage.setItem("patient-profile", JSON.stringify(value));
  } catch {
    // ignore
  }
}
function clearProfile() {
  try {
    localStorage.removeItem("patient-profile");
  } catch {
    // ignore
  }
}

// ---- Shared bits ----
function TicketPunch({ side }) {
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        [side]: -10,
        transform: "translateY(-50%)",
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: COLORS.paper,
      }}
    />
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: COLORS.inkSoft }}>{label}</span>
      <span className="font-semibold" style={{ color: COLORS.ink }}>
        {value}
      </span>
    </div>
  );
}

function AppHeader({ title, subtitle }) {
  return (
    <div>
      <div className="text-[10px] tracking-widest font-semibold" style={{ color: COLORS.amber }}>
        {title}
      </div>
      <h1 className="text-2xl font-extrabold mt-1" style={{ color: COLORS.pineDeep }}>
        {CLINIC.name}
      </h1>
      {subtitle && (
        <p className="text-xs mt-1" style={{ color: COLORS.inkSoft }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

// =========================================================
// ENTRY
// =========================================================
function EntryScreen({ onPick }) {
  const [notice, setNotice] = useState("");

  useEffect(() => {
    loadNotice().then(setNotice);
  }, []);

  return (
    <div
      className="min-h-screen flex flex-col justify-center px-6"
      style={{ background: COLORS.paper, fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}
    >
      <div className="mb-10">
        <div className="text-[10px] tracking-widest font-semibold" style={{ color: COLORS.amber }}>
          PATIENT PORTAL
        </div>
        <h1 className="text-3xl font-extrabold mt-1" style={{ color: COLORS.pineDeep }}>
          {CLINIC.name}
        </h1>
        <p className="text-sm mt-2" style={{ color: COLORS.inkSoft }}>
          이용하실 화면을 선택해주세요.
        </p>
      </div>

      <div className="rounded-xl px-4 py-3 mb-4 flex items-center justify-between" style={{ background: COLORS.white }}>
        <div className="text-xs" style={{ color: COLORS.inkSoft }}>
          진료시간 {CLINIC_HOURS_LABEL}
        </div>
        <div className="text-xs font-bold" style={{ color: COLORS.danger }}>
          정기휴무 {CLOSED_DAYS_LABEL}
        </div>
      </div>

      {notice.trim() && (
        <div className="rounded-xl px-4 py-3.5 mb-5" style={{ background: COLORS.white, borderLeft: `3px solid ${COLORS.amber}` }}>
          <div className="text-[11px] font-bold mb-1" style={{ color: COLORS.amber }}>
            공지사항
          </div>
          <div className="text-sm whitespace-pre-wrap" style={{ color: COLORS.ink }}>
            {notice}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <button onClick={() => onPick("patient")} className="w-full flex items-center gap-3 rounded-xl px-4 py-4" style={{ background: COLORS.white }}>
          <User size={20} color={COLORS.pine} />
          <div className="text-left">
            <div className="font-bold text-sm" style={{ color: COLORS.ink }}>
              환자용
            </div>
            <div className="text-xs" style={{ color: COLORS.inkSoft }}>
              예약하고 메시지 남기기
            </div>
          </div>
        </button>
        <button onClick={() => onPick("admin")} className="w-full flex items-center gap-3 rounded-xl px-4 py-4" style={{ background: COLORS.white }}>
          <Lock size={20} color={COLORS.slate} />
          <div className="text-left">
            <div className="font-bold text-sm" style={{ color: COLORS.ink }}>
              관리자용
            </div>
            <div className="text-xs" style={{ color: COLORS.inkSoft }}>
              병원 직원 전용
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

// =========================================================
// PATIENT SIDE
// =========================================================
function LoginScreen({ onLogin, onBack }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birth, setBirth] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const valid = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 10 && birth.length === 6;

  const submit = async () => {
    if (!valid) {
      setError("이름, 휴대폰 번호, 생년월일(6자리)을 확인해주세요.");
      return;
    }
    setError("");
    setSubmitting(true);
    await onLogin({ name: name.trim(), phone, birth });
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex flex-col justify-center px-6" style={{ background: COLORS.paper, fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}>
      <button onClick={onBack} className="flex items-center gap-1 text-xs font-medium mb-6" style={{ color: COLORS.slate }}>
        <ArrowLeft size={14} />
        처음으로
      </button>
      <div className="mb-8">
        <AppHeader title="PATIENT PORTAL" subtitle="본인 확인 후 예약과 메시지를 이용하실 수 있어요." />
      </div>

      <div className="space-y-3">
        <div className="rounded-xl flex items-center gap-3 px-4 py-3.5" style={{ background: COLORS.white }}>
          <User size={18} color={COLORS.slate} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" className="flex-1 outline-none text-sm bg-transparent" style={{ color: COLORS.ink }} />
        </div>
        <div className="rounded-xl flex items-center gap-3 px-4 py-3.5" style={{ background: COLORS.white }}>
          <Phone size={18} color={COLORS.slate} />
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="휴대폰 번호 (010-0000-0000)"
            inputMode="numeric"
            className="flex-1 outline-none text-sm bg-transparent"
            style={{ color: COLORS.ink }}
          />
        </div>
        <div className="rounded-xl flex items-center gap-3 px-4 py-3.5" style={{ background: COLORS.white }}>
          <Calendar size={18} color={COLORS.slate} />
          <input
            value={birth}
            onChange={(e) => setBirth(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="생년월일 6자리 (예: 900101)"
            inputMode="numeric"
            className="flex-1 outline-none text-sm bg-transparent"
            style={{ color: COLORS.ink }}
          />
        </div>

        {error && (
          <div className="text-xs font-medium" style={{ color: COLORS.danger }}>
            {error}
          </div>
        )}

        <button onClick={submit} disabled={submitting} className="w-full mt-3 rounded-xl py-3.5 font-bold flex items-center justify-center gap-2" style={{ background: COLORS.pineDeep, color: COLORS.white }}>
          {submitting && <Loader2 size={16} className="animate-spin" />}
          시작하기
        </button>
        <p className="text-[11px] text-center mt-2" style={{ color: COLORS.slate }}>
          입력하신 정보는 예약 확인과 병원 문의 응대 목적으로 사용돼요.
        </p>
      </div>
    </div>
  );
}

function AppointmentTicket({ appt, onCancel }) {
  const Icon = CLINIC.icon;
  return (
    <div style={{ background: COLORS.white, position: "relative" }} className="rounded-2xl shadow-sm overflow-hidden mb-4">
      <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ color: COLORS.white, background: COLORS.pine }}>
        <div className="flex items-center gap-2">
          <Icon size={18} strokeWidth={2} />
          <span className="text-sm font-semibold tracking-wide">{CLINIC.deptName}</span>
        </div>
        <span className="text-[10px] tracking-widest opacity-80">{CLINIC.deptEn}</span>
      </div>

      <div style={{ position: "relative", borderTop: `2px dashed ${COLORS.paperDeep}` }} className="px-5 pt-4 pb-4">
        <TicketPunch side="left" />
        <TicketPunch side="right" />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold" style={{ color: COLORS.ink }}>
              {DOCTOR.name}
            </div>
            <div className="text-xs mt-0.5" style={{ color: COLORS.inkSoft }}>
              {DOCTOR.title}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs" style={{ color: COLORS.inkSoft }}>
              {appt.dateLabel} ({appt.weekday})
            </div>
            <div className="text-xl font-extrabold" style={{ color: COLORS.pine }}>
              {appt.time}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ color: STATUS_COLOR[appt.status] || COLORS.pine, background: COLORS.paper }}>
            {STATUS_LABEL[appt.status] || "확정"}
          </span>
          {appt.status !== "cancelled" && appt.status !== "done" && (
            <button onClick={() => onCancel(appt.id)} className="text-xs font-medium underline underline-offset-2" style={{ color: COLORS.danger }}>
              예약 취소
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BookingFlow({ allAppointments, myAppointments, onCreated, onClose }) {
  const [step, setStep] = useState(1);
  const [day, setDay] = useState(null);
  const [time, setTime] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [conflictMsg, setConflictMsg] = useState("");

  const days = nextDays(30);
  const back = () => setStep((s) => Math.max(1, s - 1));

  const myActiveDates = new Set(myAppointments.filter((a) => a.status !== "cancelled").map((a) => a.dateLabel));

  const bookedTimesForDay = day
    ? new Set(allAppointments.filter((a) => a.dateLabel === day.label && a.status !== "cancelled").map((a) => a.time))
    : new Set();

  const pickDay = (d) => {
    if (myActiveDates.has(d.label)) {
      setConflictMsg("이미 이 날짜에 예약이 있어요. 하루에 한 건만 예약 가능해요.");
      return;
    }
    setConflictMsg("");
    setDay(d);
    setStep(2);
  };

  const confirm = async () => {
    setSubmitting(true);
    setConflictMsg("");
    const result = await onCreated({ dateLabel: day.label, weekday: day.weekday, time });
    setSubmitting(false);
    if (!result.ok) {
      if (result.reason === "already_booked_today") {
        setConflictMsg("이미 이 날짜에 예약이 있어요. 하루에 한 건만 예약 가능해요.");
        setDay(null);
        setTime(null);
        setStep(1);
      } else {
        setConflictMsg("죄송해요, 방금 다른 환자가 이 시간을 먼저 예약했어요. 다른 시간을 선택해주세요.");
        setTime(null);
        setStep(2);
      }
    }
  };

  const stepLabel = ["날짜", "시간", "확인"][step - 1];

  return (
    <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center" style={{ background: "rgba(32,40,31,0.45)" }}>
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col" style={{ background: COLORS.paper, maxHeight: "88vh" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${COLORS.paperDeep}` }}>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button onClick={back} aria-label="이전 단계">
                <ChevronLeft size={20} color={COLORS.ink} />
              </button>
            )}
            <span className="text-[11px] tracking-widest font-semibold" style={{ color: COLORS.slate }}>
              STEP {step}/3 · {stepLabel}
            </span>
          </div>
          <button onClick={onClose} aria-label="닫기">
            <X size={20} color={COLORS.ink} />
          </button>
        </div>

        <div className="px-5 py-5 overflow-y-auto">
          {step === 1 && (
            <div>
              <h2 className="text-lg font-bold mb-1" style={{ color: COLORS.ink }}>
                날짜를 선택해주세요
              </h2>
              <p className="text-xs mb-3" style={{ color: COLORS.slate }}>
                매주 목요일·일요일은 정기휴무예요. 하루에 한 건만 예약 가능해요.
              </p>
              {conflictMsg && (
                <p className="text-xs mb-3 font-medium" style={{ color: COLORS.danger }}>
                  {conflictMsg}
                </p>
              )}
              <div className="grid grid-cols-4 gap-2">
                {days.map((d) =>
                  d.closed ? (
                    <div
                      key={d.key}
                      className="rounded-xl py-3 flex flex-col items-center opacity-50"
                      style={{ background: COLORS.paperDeep }}
                    >
                      <span className="text-[10px]" style={{ color: COLORS.inkSoft }}>
                        {d.weekday}
                      </span>
                      <span className="text-sm font-bold mt-0.5" style={{ color: COLORS.inkSoft }}>
                        {d.label}
                      </span>
                      <span className="text-[9px] font-bold mt-0.5" style={{ color: COLORS.danger }}>
                        휴무
                      </span>
                    </div>
                  ) : myActiveDates.has(d.label) ? (
                    <div
                      key={d.key}
                      className="rounded-xl py-3 flex flex-col items-center opacity-50"
                      style={{ background: COLORS.paperDeep }}
                    >
                      <span className="text-[10px]" style={{ color: COLORS.inkSoft }}>
                        {d.weekday}
                      </span>
                      <span className="text-sm font-bold mt-0.5" style={{ color: COLORS.inkSoft }}>
                        {d.label}
                      </span>
                      <span className="text-[9px] font-bold mt-0.5" style={{ color: COLORS.pine }}>
                        예약됨
                      </span>
                    </div>
                  ) : (
                    <button key={d.key} onClick={() => pickDay(d)} className="rounded-xl py-3 flex flex-col items-center" style={{ background: COLORS.white }}>
                      <span className="text-[10px]" style={{ color: COLORS.inkSoft }}>
                        {d.weekday}
                      </span>
                      <span className="text-sm font-bold mt-0.5" style={{ color: COLORS.ink }}>
                        {d.label}
                      </span>
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-lg font-bold mb-1" style={{ color: COLORS.ink }}>
                시간을 선택해주세요
              </h2>
              {conflictMsg && (
                <p className="text-xs mb-3 font-medium" style={{ color: COLORS.danger }}>
                  {conflictMsg}
                </p>
              )}
              {!conflictMsg && <div className="mb-3" />}
              <div className="grid grid-cols-3 gap-2">
                {TIMES.map((t) =>
                  bookedTimesForDay.has(t) ? (
                    <div key={t} className="rounded-xl py-2.5 text-sm font-semibold text-center opacity-50" style={{ background: COLORS.paperDeep, color: COLORS.inkSoft }}>
                      마감
                    </div>
                  ) : (
                    <button
                      key={t}
                      onClick={() => {
                        setTime(t);
                        setStep(3);
                      }}
                      className="rounded-xl py-2.5 text-sm font-semibold"
                      style={{ background: COLORS.white, color: COLORS.ink }}
                    >
                      {t}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-lg font-bold mb-4" style={{ color: COLORS.ink }}>
                예약 내용을 확인해주세요
              </h2>
              <div className="rounded-xl p-4 space-y-2" style={{ background: COLORS.white }}>
                <Row label="진료과" value={CLINIC.deptName} />
                <Row label="담당의" value={DOCTOR.name} />
                <Row label="날짜" value={`${day.label} (${day.weekday})`} />
                <Row label="시간" value={time} />
              </div>
              <button
                onClick={confirm}
                disabled={submitting}
                className="w-full mt-5 rounded-xl py-3.5 font-bold flex items-center justify-center gap-2"
                style={{ background: COLORS.pine, color: COLORS.white }}
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                예약 확정하기
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MessagesView({ messages, onSend }) {
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-sm mt-16" style={{ color: COLORS.inkSoft }}>
            병원에 궁금한 점을 편하게 남겨주세요.
            <br />
            보통 영업시간 내 답변드려요.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.from === "patient" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm"
              style={
                m.from === "patient"
                  ? { background: COLORS.pine, color: COLORS.white, borderBottomRightRadius: 4 }
                  : { background: COLORS.white, color: COLORS.ink, borderBottomLeftRadius: 4 }
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: `1px solid ${COLORS.paperDeep}`, background: COLORS.paper }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="메시지를 입력하세요"
          className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none"
          style={{ background: COLORS.white, color: COLORS.ink }}
        />
        <button onClick={send} aria-label="보내기" className="rounded-full p-2.5 flex items-center justify-center" style={{ background: COLORS.pine }}>
          <Send size={16} color={COLORS.white} />
        </button>
      </div>
    </div>
  );
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

function CommunityBoard({ posts, myPhone, onPost, onDelete, onRefresh, refreshing }) {
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    await onPost(text.trim());
    setSubmitting(false);
    setText("");
    setComposing(false);
  };

  return (
    <div className="h-full overflow-y-auto px-5 pb-24">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold" style={{ color: COLORS.inkSoft }}>
          환자들과 경험을 나눠보세요
        </span>
        <button onClick={onRefresh} className="flex items-center gap-1 text-xs font-medium" style={{ color: COLORS.pine }}>
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          새로고침
        </button>
      </div>

      <button onClick={() => setComposing(true)} className="w-full rounded-2xl py-3.5 font-bold text-sm mb-4" style={{ background: COLORS.pineDeep, color: COLORS.white }}>
        글쓰기
      </button>

      {posts.length === 0 ? (
        <div className="text-center text-sm mt-10" style={{ color: COLORS.inkSoft }}>
          아직 게시글이 없어요. 첫 글을 남겨보세요.
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <div key={p.id} className="rounded-xl px-4 py-3.5" style={{ background: COLORS.white }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-bold" style={{ color: COLORS.ink }}>
                  {p.displayName}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px]" style={{ color: COLORS.slate }}>
                    {timeAgo(p.createdAt)}
                  </span>
                  {p.patientPhone === myPhone && (
                    <button onClick={() => onDelete(p.id)} aria-label="삭제">
                      <X size={13} color={COLORS.slate} />
                    </button>
                  )}
                </div>
              </div>
              <div className="text-sm whitespace-pre-wrap" style={{ color: COLORS.ink }}>
                {p.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {composing && (
        <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center" style={{ background: "rgba(32,40,31,0.45)" }}>
          <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden" style={{ background: COLORS.paper }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${COLORS.paperDeep}` }}>
              <span className="text-sm font-bold" style={{ color: COLORS.ink }}>
                글쓰기
              </span>
              <button onClick={() => setComposing(false)} aria-label="닫기">
                <X size={20} color={COLORS.ink} />
              </button>
            </div>
            <div className="px-5 py-4">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 500))}
                placeholder="경험이나 궁금한 점을 나눠보세요. (최대 500자)"
                rows={5}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
                style={{ background: COLORS.white, color: COLORS.ink }}
              />
              <div className="text-right text-[11px] mt-1" style={{ color: COLORS.slate }}>
                {text.length}/500
              </div>
              <button
                onClick={submit}
                disabled={submitting || !text.trim()}
                className="w-full mt-2 rounded-xl py-3 font-bold text-sm flex items-center justify-center gap-2"
                style={{ background: COLORS.pineDeep, color: COLORS.white }}
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                게시하기
              </button>
              <p className="text-[11px] text-center mt-2" style={{ color: COLORS.slate }}>
                작성자 실명·연락처는 다른 환자에게 보이지 않아요. 부적절한 글은 병원이 삭제할 수 있어요.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PatientApp({ onExit }) {
  const [tab, setTab] = useState("book");
  const [allAppointments, setAllAppointments] = useState([]);
  const [allMessages, setAllMessages] = useState([]);
  const [posts, setPosts] = useState([]);
  const [postsRefreshing, setPostsRefreshing] = useState(false);
  const [booking, setBooking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [notifPermission, setNotifPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const pollRef = useRef(null);
  const seenMsgIds = useRef(null);
  const profileRef = useRef(null);
  profileRef.current = profile;

  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // ignore
    }
  };

  const isStandalone =
    typeof window !== "undefined" && (window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches);
  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  const requestNotifPermission = async () => {
    setPushError("");
    if (isIOS && !isStandalone) {
      setPushError("아이폰에서는 반드시 '홈 화면에 추가'로 설치한 아이콘으로 열어야 알림을 켤 수 있어요. 사파리 공유 버튼 → 홈 화면에 추가를 먼저 해주세요.");
      return;
    }
    if (typeof Notification === "undefined") {
      setNotifPermission("unsupported");
      setPushError("이 브라우저에서는 알림 기능을 지원하지 않아요.");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
      if (perm === "granted" && profileRef.current) {
        localStorage.removeItem(`push-disabled:${profileRef.current.phone}`);
        const { error } = await subscribeToPush(profileRef.current.phone);
        if (error) setPushError(error);
        else setPushEnabled(true);
      } else if (perm === "denied") {
        setPushError("알림이 차단되어 있어요. 기기 설정에서 이 앱의 알림 권한을 허용해주세요.");
      }
    } catch (e) {
      setNotifPermission("unsupported");
      setPushError(e.message || "알림 권한 요청 중 문제가 발생했어요.");
    }
  };

  const handleDisablePush = async () => {
    if (profile) localStorage.setItem(`push-disabled:${profile.phone}`, "1");
    await unsubscribeFromPush();
    setPushEnabled(false);
  };

  const [pushError, setPushError] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);

  // 예전에 이미 알림 권한을 허용해둔 경우, 버튼 없이도 자동으로 구독을 등록한다.
  // 단, 환자가 직접 "끄기"를 눌렀던 경우에는 다시 자동으로 켜지지 않는다.
  useEffect(() => {
    if (!profile) return;
    if (localStorage.getItem(`push-disabled:${profile.phone}`) === "1") return;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      subscribeToPush(profile.phone).then(({ error }) => {
        if (error) setPushError(error);
        else setPushEnabled(true);
      });
    }
  }, [profile]);

  const refreshAll = async () => {
    const [a, m] = await Promise.all([loadAppointments(), loadMessages()]);
    setAllAppointments(a);

    const p = profileRef.current;
    if (p) {
      const myMsgs = m.filter((x) => x.patientPhone === p.phone);
      if (seenMsgIds.current) {
        const freshClinicMsgs = myMsgs.filter((x) => x.from === "clinic" && !seenMsgIds.current.has(x.id));
        // 탭이 열려있는 동안은 소리로만 알려주고, 실제 알림 표시는 서버 푸시(서비스워커)가 담당한다.
        // (둘 다 시스템 알림을 띄우면 중복 알림이 뜰 수 있어 여기서는 beep만 사용)
        if (freshClinicMsgs.length > 0) playBeep();
      }
      seenMsgIds.current = new Set(myMsgs.map((x) => x.id));
    }
    setAllMessages(m);
  };

  useEffect(() => {
    (async () => {
      const p = loadProfile();
      if (p) {
        await refreshAll();
        setPosts(await loadPosts());
        setProfile(p);
      }
      setLoading(false);
    })();
  }, []);

  // 직원이 답장을 보내거나 예약 상태를 바꿔도 환자 화면에 반영되도록
  // 로그인된 동안 8초마다 자동으로 새로고침한다.
  useEffect(() => {
    if (!profile) return;
    pollRef.current = setInterval(refreshAll, 8000);
    return () => clearInterval(pollRef.current);
  }, [profile]);

  const handleLogin = async (p) => {
    saveProfile(p);
    setProfile(p);
    profileRef.current = p;
    await refreshAll();
    setPosts(await loadPosts());
  };

  const handleLogout = () => {
    clearProfile();
    setProfile(null);
    setTab("book");
  };

  const myAppointments = profile ? allAppointments.filter((a) => a.patientPhone === profile.phone) : [];
  const myMessages = profile ? allMessages.filter((m) => m.patientPhone === profile.phone) : [];
  const hasUnreadReply = tab !== "messages" && myMessages.length > 0 && myMessages.at(-1)?.from === "clinic";

  const handleCreated = async (draft) => {
    const { error } = await insertAppointment({ patientName: profile.name, patientPhone: profile.phone, ...draft });
    const a = await loadAppointments();
    setAllAppointments(a);
    if (!error) {
      setBooking(false);
      return { ok: true };
    }
    if (error.message && error.message.includes("patient_date")) {
      return { ok: false, reason: "already_booked_today" };
    }
    return { ok: false, reason: "time_taken" };
  };

  const handleCancel = async (id) => {
    await updateAppointmentStatus(id, "cancelled");
    setAllAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "cancelled" } : a)));
  };

  const handleSend = async (text) => {
    await insertMessage({ patientName: profile.name, patientPhone: profile.phone, from: "patient", text });
    const m = await loadMessages();
    setAllMessages(m);
  };

  const refreshPosts = async () => {
    setPostsRefreshing(true);
    setPosts(await loadPosts());
    setPostsRefreshing(false);
  };

  const handlePost = async (content) => {
    await insertPost({ patientPhone: profile.phone, patientName: profile.name, content });
    setPosts(await loadPosts());
  };

  const handleDeletePost = async (id) => {
    await deletePost(id);
    setPosts((prev) => prev.filter((p) => p.id !== id));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.paper }}>
        <Loader2 size={24} className="animate-spin" color={COLORS.pine} />
      </div>
    );
  }

  if (!profile) {
    return <LoginScreen onLogin={handleLogin} onBack={onExit} />;
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: COLORS.paper, fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}>
      <div className="px-5 pt-6 pb-4 flex items-start justify-between">
        <AppHeader title="PATIENT PORTAL" subtitle={`${profile.name}님, 안녕하세요`} />
        <button onClick={handleLogout} className="flex items-center gap-1 text-xs font-medium mt-1" style={{ color: COLORS.slate }}>
          <LogOut size={14} />
          로그아웃
        </button>
      </div>

      {!pushEnabled && notifPermission !== "unsupported" && (
        <div className="mx-5 mb-3 rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: COLORS.white }}>
          <span className="text-xs" style={{ color: COLORS.inkSoft }}>
            {isIOS && !isStandalone
              ? "아이폰은 '홈 화면에 추가'로 설치해야 알림을 받을 수 있어요"
              : "앱을 꺼두어도 병원 답장을 알림으로 받아보시겠어요?"}
          </span>
          <button onClick={requestNotifPermission} className="text-xs font-bold whitespace-nowrap" style={{ color: COLORS.pine }}>
            알림 켜기
          </button>
        </div>
      )}
      {pushEnabled && (
        <div className="mx-5 mb-3 rounded-xl px-4 py-2.5 flex items-center justify-between" style={{ background: COLORS.white }}>
          <span className="text-xs font-semibold" style={{ color: COLORS.pine }}>
            ✓ 알림이 켜졌어요
          </span>
          <button onClick={handleDisablePush} className="text-xs font-medium" style={{ color: COLORS.slate }}>
            끄기
          </button>
        </div>
      )}
      {pushError && (
        <div className="mx-5 mb-3 rounded-xl px-4 py-2.5" style={{ background: COLORS.white }}>
          <span className="text-xs" style={{ color: COLORS.danger }}>
            알림 등록에 실패했어요: {pushError}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {tab === "book" ? (
          <div className="h-full overflow-y-auto px-5 pb-24">
            <button onClick={() => setBooking(true)} className="w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 mb-5" style={{ background: COLORS.pineDeep, color: COLORS.white }}>
              <Calendar size={18} />새 예약 잡기
            </button>

            {myAppointments.length === 0 ? (
              <div className="text-center text-sm mt-10" style={{ color: COLORS.inkSoft }}>
                아직 예약된 진료가 없어요.
              </div>
            ) : (
              myAppointments.map((a) => <AppointmentTicket key={a.id} appt={a} onCancel={handleCancel} />)
            )}
          </div>
        ) : tab === "messages" ? (
          <MessagesView messages={myMessages} onSend={handleSend} />
        ) : (
          <CommunityBoard posts={posts} myPhone={profile.phone} onPost={handlePost} onDelete={handleDeletePost} onRefresh={refreshPosts} refreshing={postsRefreshing} />
        )}
      </div>

      <div className="flex" style={{ borderTop: `1px solid ${COLORS.paperDeep}`, background: COLORS.paper }}>
        {[
          { id: "book", label: "예약", icon: Calendar },
          { id: "messages", label: "메시지", icon: MessageCircle },
          { id: "community", label: "커뮤니티", icon: Users2 },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className="flex-1 flex flex-col items-center gap-1 py-3 relative">
              <div className="relative">
                <Icon size={20} color={active ? COLORS.pine : COLORS.slate} strokeWidth={active ? 2.5 : 2} />
                {t.id === "messages" && hasUnreadReply && (
                  <span className="absolute -top-0.5 -right-1 rounded-full" style={{ width: 8, height: 8, background: COLORS.danger }} />
                )}
              </div>
              <span className="text-[11px] font-semibold" style={{ color: active ? COLORS.pine : COLORS.slate }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {booking && (
        <BookingFlow allAppointments={allAppointments} myAppointments={myAppointments} onCreated={handleCreated} onClose={() => setBooking(false)} />
      )}
    </div>
  );
}

// =========================================================
// ADMIN SIDE
// =========================================================
function AdminLogin({ onSuccess, onBack }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    if (pin === ADMIN_PIN) onSuccess();
    else setError("PIN이 올바르지 않아요.");
  };

  return (
    <div className="min-h-screen flex flex-col justify-center px-6" style={{ background: COLORS.paper, fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}>
      <button onClick={onBack} className="flex items-center gap-1 text-xs font-medium mb-6" style={{ color: COLORS.slate }}>
        <ArrowLeft size={14} />
        처음으로
      </button>
      <div className="mb-8">
        <AppHeader title="STAFF ONLY" subtitle="직원 PIN을 입력해주세요." />
      </div>
      <div className="rounded-xl flex items-center gap-3 px-4 py-3.5 mb-3" style={{ background: COLORS.white }}>
        <Lock size={18} color={COLORS.slate} />
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="PIN"
          type="password"
          inputMode="numeric"
          className="flex-1 outline-none text-sm bg-transparent tracking-widest"
          style={{ color: COLORS.ink }}
        />
      </div>
      {error && (
        <div className="text-xs font-medium mb-2" style={{ color: COLORS.danger }}>
          {error}
        </div>
      )}
      <button onClick={submit} className="w-full rounded-xl py-3.5 font-bold" style={{ background: COLORS.pineDeep, color: COLORS.white }}>
        확인
      </button>
    </div>
  );
}

function AdminAppointments({ appointments, onStatusChange, onMessage, onRefresh, refreshing }) {
  const grouped = {};
  appointments
    .filter((a) => a.status !== "cancelled")
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .forEach((a) => {
      const k = `${a.dateLabel} (${a.weekday})`;
      grouped[k] = grouped[k] || [];
      grouped[k].push(a);
    });
  const cancelled = appointments.filter((a) => a.status === "cancelled");

  return (
    <div className="h-full overflow-y-auto px-5 pb-24">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold" style={{ color: COLORS.inkSoft }}>
          전체 예약 {appointments.filter((a) => a.status !== "cancelled").length}건
        </span>
        <button onClick={onRefresh} className="flex items-center gap-1 text-xs font-medium" style={{ color: COLORS.pine }}>
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          새로고침
        </button>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="text-center text-sm mt-10" style={{ color: COLORS.inkSoft }}>
          예약이 아직 없어요.
        </div>
      ) : (
        Object.entries(grouped).map(([date, items]) => (
          <div key={date} className="mb-5">
            <div className="text-xs font-bold mb-2" style={{ color: COLORS.pineDeep }}>
              {date}
            </div>
            <div className="space-y-2">
              {items
                .sort((a, b) => a.time.localeCompare(b.time))
                .map((a) => (
                  <div key={a.id} className="rounded-xl px-4 py-3" style={{ background: COLORS.white }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold text-sm" style={{ color: COLORS.ink }}>
                          {a.time} · {a.patientName}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: COLORS.inkSoft }}>
                          {a.patientPhone}
                        </div>
                      </div>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ color: STATUS_COLOR[a.status], background: COLORS.paper }}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-2.5">
                      {a.status !== "done" && (
                        <button onClick={() => onStatusChange(a.id, "done")} className="flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold" style={{ background: COLORS.paper, color: COLORS.pine }}>
                          <CheckCircle2 size={13} />
                          진료완료
                        </button>
                      )}
                      <button onClick={() => onMessage(a.patientPhone, a.patientName)} className="flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold" style={{ background: COLORS.paper, color: COLORS.slate }}>
                        <MessageCircle size={13} />
                        메시지
                      </button>
                      <button onClick={() => onStatusChange(a.id, "cancelled")} className="flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold" style={{ background: COLORS.paper, color: COLORS.danger }}>
                        <XCircle size={13} />
                        취소 처리
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))
      )}

      {cancelled.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-bold mb-2" style={{ color: COLORS.slate }}>
            취소된 예약 ({cancelled.length})
          </div>
          <div className="space-y-2">
            {cancelled.map((a) => (
              <div key={a.id} className="rounded-xl px-4 py-3" style={{ background: COLORS.white }}>
                <div className="flex items-center justify-between">
                  <div className="text-sm opacity-60" style={{ color: COLORS.ink }}>
                    {a.dateLabel} {a.time} · {a.patientName}
                  </div>
                  <button
                    onClick={() => onStatusChange(a.id, "confirmed")}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
                    style={{ background: COLORS.paper, color: COLORS.pine }}
                  >
                    <RotateCcw size={13} />
                    복구
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ComposeMessage({ candidates, onStart, onClose }) {
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  const startManual = () => {
    if (manualName.trim().length < 2 || manualPhone.replace(/\D/g, "").length < 10) return;
    onStart(manualPhone, manualName.trim());
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center" style={{ background: "rgba(32,40,31,0.45)" }}>
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col" style={{ background: COLORS.paper, maxHeight: "85vh" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${COLORS.paperDeep}` }}>
          <span className="text-sm font-bold" style={{ color: COLORS.ink }}>
            새 메시지 보내기
          </span>
          <button onClick={onClose} aria-label="닫기">
            <X size={20} color={COLORS.ink} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          {candidates.length > 0 && (
            <>
              <div className="text-xs font-semibold mb-2" style={{ color: COLORS.inkSoft }}>
                예약 기록이 있는 환자
              </div>
              <div className="space-y-2 mb-5">
                {candidates.map((c) => (
                  <button
                    key={c.phone}
                    onClick={() => onStart(c.phone, c.name)}
                    className="w-full flex items-center justify-between rounded-xl px-4 py-3"
                    style={{ background: COLORS.white }}
                  >
                    <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>
                      {c.name}
                    </span>
                    <span className="text-xs" style={{ color: COLORS.inkSoft }}>
                      {c.phone}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="text-xs font-semibold mb-2" style={{ color: COLORS.inkSoft }}>
            직접 입력해서 새로 시작
          </div>
          <div className="space-y-2">
            <div className="rounded-xl flex items-center gap-3 px-4 py-3" style={{ background: COLORS.white }}>
              <User size={16} color={COLORS.slate} />
              <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="환자 이름" className="flex-1 outline-none text-sm bg-transparent" style={{ color: COLORS.ink }} />
            </div>
            <div className="rounded-xl flex items-center gap-3 px-4 py-3" style={{ background: COLORS.white }}>
              <Phone size={16} color={COLORS.slate} />
              <input
                value={manualPhone}
                onChange={(e) => setManualPhone(formatPhone(e.target.value))}
                placeholder="휴대폰 번호"
                inputMode="numeric"
                className="flex-1 outline-none text-sm bg-transparent"
                style={{ color: COLORS.ink }}
              />
            </div>
            <button onClick={startManual} className="w-full rounded-xl py-3 font-bold text-sm" style={{ background: COLORS.pineDeep, color: COLORS.white }}>
              대화 시작하기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminMessages({ messages, appointments, onReply, onDelete, onRefresh, refreshing, openTarget, onConsumeOpenTarget }) {
  const [openThread, setOpenThread] = useState(null); // { phone, name } | null
  const [composeOpen, setComposeOpen] = useState(false);
  const [reply, setReply] = useState("");
  const bottomRef = useRef(null);

  // 예약 목록에서 "메시지" 버튼을 눌렀을 때 해당 환자 대화창을 바로 연다.
  useEffect(() => {
    if (openTarget) {
      setOpenThread(openTarget);
      onConsumeOpenTarget();
    }
  }, [openTarget]);

  const threads = {};
  messages.forEach((m) => {
    threads[m.patientPhone] = threads[m.patientPhone] || { name: m.patientName, phone: m.patientPhone, items: [] };
    threads[m.patientPhone].items.push(m);
  });
  const threadList = Object.values(threads)
    .map((t) => ({ ...t, items: t.items.sort((a, b) => new Date(a.at) - new Date(b.at)) }))
    .sort((a, b) => new Date(b.items.at(-1)?.at || 0) - new Date(a.items.at(-1)?.at || 0));

  // 예약은 있지만 아직 대화가 없는 환자 목록 (관리자가 먼저 말을 걸 수 있는 대상)
  const knownPatients = {};
  appointments.forEach((a) => {
    if (!threads[a.patientPhone]) knownPatients[a.patientPhone] = { name: a.patientName, phone: a.patientPhone };
  });
  const composeCandidates = Object.values(knownPatients);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [openThread, messages]);

  if (openThread) {
    const items = threads[openThread.phone]?.items || [];
    const send = () => {
      if (!reply.trim()) return;
      onReply(openThread.phone, openThread.name, reply.trim());
      setReply("");
    };
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${COLORS.paperDeep}` }}>
          <button onClick={() => setOpenThread(null)} aria-label="목록으로">
            <ChevronLeft size={20} color={COLORS.ink} />
          </button>
          <div>
            <div className="font-bold text-sm" style={{ color: COLORS.ink }}>
              {openThread.name}
            </div>
            <div className="text-[11px]" style={{ color: COLORS.inkSoft }}>
              {openThread.phone}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {items.length === 0 && (
            <div className="text-center text-sm mt-10" style={{ color: COLORS.inkSoft }}>
              아직 대화가 없어요. 먼저 메시지를 보내보세요.
            </div>
          )}
          {items.map((m) => (
            <div key={m.id} className={`group flex items-center gap-1.5 ${m.from === "clinic" ? "justify-end" : "justify-start"}`}>
              {m.from === "clinic" && (
                <button
                  onClick={() => {
                    if (window.confirm("이 메시지를 삭제할까요?")) onDelete(m.id);
                  }}
                  aria-label="메시지 삭제"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={14} color={COLORS.slate} />
                </button>
              )}
              <div
                className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm"
                style={
                  m.from === "clinic"
                    ? { background: COLORS.pine, color: COLORS.white, borderBottomRightRadius: 4 }
                    : { background: COLORS.white, color: COLORS.ink, borderBottomLeftRadius: 4 }
                }
              >
                {m.text}
              </div>
              {m.from === "patient" && (
                <button
                  onClick={() => {
                    if (window.confirm("이 메시지를 삭제할까요?")) onDelete(m.id);
                  }}
                  aria-label="메시지 삭제"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={14} color={COLORS.slate} />
                </button>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: `1px solid ${COLORS.paperDeep}` }}>
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="메시지를 입력하세요"
            className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none"
            style={{ background: COLORS.white, color: COLORS.ink }}
          />
          <button onClick={send} aria-label="보내기" className="rounded-full p-2.5 flex items-center justify-center" style={{ background: COLORS.pine }}>
            <Send size={16} color={COLORS.white} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 pb-24">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold" style={{ color: COLORS.inkSoft }}>
          환자 문의 {threadList.length}건
        </span>
        <div className="flex items-center gap-3">
          <button onClick={onRefresh} className="flex items-center gap-1 text-xs font-medium" style={{ color: COLORS.pine }}>
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            새로고침
          </button>
        </div>
      </div>

      <button
        onClick={() => setComposeOpen(true)}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-bold text-sm mb-4"
        style={{ background: COLORS.pineDeep, color: COLORS.white }}
      >
        새 메시지 보내기
      </button>

      {threadList.length === 0 ? (
        <div className="text-center text-sm mt-10" style={{ color: COLORS.inkSoft }}>
          아직 문의가 없어요.
        </div>
      ) : (
        <div className="space-y-2">
          {threadList.map((t) => {
            const last = t.items.at(-1);
            return (
              <button key={t.phone} onClick={() => setOpenThread({ phone: t.phone, name: t.name })} className="w-full flex items-center justify-between rounded-xl px-4 py-3.5" style={{ background: COLORS.white }}>
                <div className="text-left">
                  <div className="font-bold text-sm" style={{ color: COLORS.ink }}>
                    {t.name}
                  </div>
                  <div className="text-xs mt-0.5 truncate max-w-[220px]" style={{ color: COLORS.inkSoft }}>
                    {last.from === "clinic" ? "나: " : ""}
                    {last.text}
                  </div>
                </div>
                <ChevronLeft size={16} color={COLORS.slate} style={{ transform: "rotate(180deg)" }} />
              </button>
            );
          })}
        </div>
      )}

      {composeOpen && (
        <ComposeMessage
          candidates={composeCandidates}
          onClose={() => setComposeOpen(false)}
          onStart={(phone, name) => {
            setOpenThread({ phone, name });
            setComposeOpen(false);
          }}
        />
      )}
    </div>
  );
}

function NoticeEditor({ initialValue, onSave, onClose }) {
  const [text, setText] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await onSave(text);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center" style={{ background: "rgba(32,40,31,0.45)" }}>
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col" style={{ background: COLORS.paper }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${COLORS.paperDeep}` }}>
          <span className="text-sm font-bold" style={{ color: COLORS.ink }}>
            공지사항 관리
          </span>
          <button onClick={onClose} aria-label="닫기">
            <X size={20} color={COLORS.ink} />
          </button>
        </div>
        <div className="px-5 py-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="환자에게 보여줄 공지사항을 입력하세요. 비워두면 공지사항이 표시되지 않아요."
            rows={5}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
            style={{ background: COLORS.white, color: COLORS.ink }}
          />
          <button onClick={save} disabled={saving} className="w-full mt-3 rounded-xl py-3 font-bold text-sm flex items-center justify-center gap-2" style={{ background: COLORS.pineDeep, color: COLORS.white }}>
            {saving && <Loader2 size={16} className="animate-spin" />}
            저장하기
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminCommunity({ posts, onDelete, onRefresh, refreshing }) {
  return (
    <div className="h-full overflow-y-auto px-5 pb-24">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold" style={{ color: COLORS.inkSoft }}>
          게시글 {posts.length}건
        </span>
        <button onClick={onRefresh} className="flex items-center gap-1 text-xs font-medium" style={{ color: COLORS.pine }}>
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          새로고침
        </button>
      </div>
      {posts.length === 0 ? (
        <div className="text-center text-sm mt-10" style={{ color: COLORS.inkSoft }}>
          아직 게시글이 없어요.
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <div key={p.id} className="rounded-xl px-4 py-3.5" style={{ background: COLORS.white }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-bold" style={{ color: COLORS.ink }}>
                  {p.displayName}
                  <span className="ml-2 text-[11px] font-normal" style={{ color: COLORS.slate }}>
                    {p.patientPhone}
                  </span>
                </span>
                <button
                  onClick={() => {
                    if (window.confirm("이 게시글을 삭제할까요?")) onDelete(p.id);
                  }}
                  className="flex items-center gap-1 text-xs font-semibold"
                  style={{ color: COLORS.danger }}
                >
                  <Trash2 size={13} />
                  삭제
                </button>
              </div>
              <div className="text-sm whitespace-pre-wrap" style={{ color: COLORS.ink }}>
                {p.content}
              </div>
              <div className="text-[11px] mt-1.5" style={{ color: COLORS.slate }}>
                {timeAgo(p.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminApp({ onExit }) {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState("appointments");
  const [appointments, setAppointments] = useState([]);
  const [messages, setMessages] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [notifPermission, setNotifPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const [newApptCount, setNewApptCount] = useState(0);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const [messageTarget, setMessageTarget] = useState(null); // { phone, name } | null
  const [notice, setNotice] = useState("");
  const [noticeEditorOpen, setNoticeEditorOpen] = useState(false);
  const [posts, setPosts] = useState([]);
  const [postsRefreshing, setPostsRefreshing] = useState(false);

  const seenApptIds = useRef(null);
  const seenMsgIds = useRef(null);
  const pollRef = useRef(null);

  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // ignore
    }
  };

  const notify = (title, body) => {
    playBeep();
    setToast({ title, body });
    setTimeout(() => setToast(null), 4500);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, { body });
      }
    } catch {
      // ignore
    }
  };

  const requestNotifPermission = async () => {
    try {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
    } catch {
      setNotifPermission("unsupported");
    }
  };

  const refresh = async (silent) => {
    if (!silent) setRefreshing(true);
    const [a, m] = await Promise.all([loadAppointments(), loadMessages()]);

    if (seenApptIds.current) {
      const freshAppts = a.filter((x) => !seenApptIds.current.has(x.id));
      if (freshAppts.length > 0) {
        setNewApptCount((c) => c + freshAppts.length);
        const first = freshAppts[0];
        notify("새 예약", freshAppts.length === 1 ? `${first.patientName}님 · ${first.dateLabel} ${first.time}` : `${freshAppts.length}건의 새 예약이 있어요`);
      }
    }
    if (seenMsgIds.current) {
      const freshMsgs = m.filter((x) => !seenMsgIds.current.has(x.id) && x.from === "patient");
      if (freshMsgs.length > 0) {
        setNewMsgCount((c) => c + freshMsgs.length);
        const first = freshMsgs[0];
        notify("새 메시지", freshMsgs.length === 1 ? `${first.patientName}: ${first.text}` : `${freshMsgs.length}건의 새 메시지가 있어요`);
      }
    }

    seenApptIds.current = new Set(a.map((x) => x.id));
    seenMsgIds.current = new Set(m.map((x) => x.id));
    setAppointments(a);
    setMessages(m);
    if (!silent) setRefreshing(false);
  };

  useEffect(() => {
    if (!authed) return;
    (async () => {
      setLoading(true);
      await refresh(false);
      setNotice(await loadNotice());
      setPosts(await loadPosts());
      setLoading(false);
    })();
    pollRef.current = setInterval(() => refresh(true), 15000);
    return () => clearInterval(pollRef.current);
  }, [authed]);

  const handleSaveNotice = async (text) => {
    await saveNotice(text);
    setNotice(text);
  };

  const refreshPosts = async () => {
    setPostsRefreshing(true);
    setPosts(await loadPosts());
    setPostsRefreshing(false);
  };

  const handleDeletePost = async (id) => {
    await deletePost(id);
    setPosts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleStatusChange = async (id, status) => {
    const { error } = await updateAppointmentStatus(id, status);
    if (error && error.code === "23505") {
      window.alert("이 시간은 이미 다른 예약으로 채워져서 복구할 수 없어요. 환자에게 다른 시간으로 다시 예약하도록 안내해주세요.");
      return;
    }
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  };

  const handleReply = async (patientPhone, patientName, text) => {
    await insertMessage({ patientName, patientPhone, from: "clinic", text });
    const m = await loadMessages();
    setMessages(m);
  };

  const handleDeleteMessage = async (id) => {
    await deleteMessage(id);
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  if (!authed) {
    return <AdminLogin onSuccess={() => setAuthed(true)} onBack={onExit} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.paper }}>
        <Loader2 size={24} className="animate-spin" color={COLORS.pine} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: COLORS.paper, fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}>
      {toast && (
        <div className="fixed top-3 left-1/2 z-30 rounded-xl px-4 py-3 shadow-lg" style={{ background: COLORS.pineDeep, color: COLORS.white, transform: "translateX(-50%)", width: "88%", maxWidth: 360 }}>
          <div className="text-sm font-bold">{toast.title}</div>
          <div className="text-xs mt-0.5 opacity-90">{toast.body}</div>
        </div>
      )}

      <div className="px-5 pt-6 pb-4 flex items-start justify-between">
        <AppHeader title="STAFF DASHBOARD" subtitle={DOCTOR.name} />
        <div className="flex flex-col items-end gap-2 mt-1">
          <button onClick={() => setAuthed(false)} className="flex items-center gap-1 text-xs font-medium" style={{ color: COLORS.slate }}>
            <LogOut size={14} />
            로그아웃
          </button>
          <button onClick={() => setNoticeEditorOpen(true)} className="text-xs font-medium" style={{ color: COLORS.pine }}>
            공지사항 관리
          </button>
        </div>
      </div>

      {notifPermission !== "granted" && notifPermission !== "unsupported" && (
        <div className="mx-5 mb-3 rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: COLORS.white }}>
          <span className="text-xs" style={{ color: COLORS.inkSoft }}>
            새 예약·메시지를 브라우저 알림으로 받을까요?
          </span>
          <button onClick={requestNotifPermission} className="text-xs font-bold" style={{ color: COLORS.pine }}>
            알림 켜기
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {tab === "appointments" ? (
          <AdminAppointments
            appointments={appointments}
            onStatusChange={handleStatusChange}
            onMessage={(phone, name) => {
              setMessageTarget({ phone, name });
              setTab("messages");
              setNewMsgCount(0);
            }}
            onRefresh={() => refresh(false)}
            refreshing={refreshing}
          />
        ) : tab === "messages" ? (
          <AdminMessages
            messages={messages}
            appointments={appointments}
            onReply={handleReply}
            onDelete={handleDeleteMessage}
            onRefresh={() => refresh(false)}
            refreshing={refreshing}
            openTarget={messageTarget}
            onConsumeOpenTarget={() => setMessageTarget(null)}
          />
        ) : (
          <AdminCommunity posts={posts} onDelete={handleDeletePost} onRefresh={refreshPosts} refreshing={postsRefreshing} />
        )}
      </div>

      <div className="flex" style={{ borderTop: `1px solid ${COLORS.paperDeep}`, background: COLORS.paper }}>
        {[
          { id: "appointments", label: "예약 관리", icon: Calendar, badge: newApptCount },
          { id: "messages", label: "메시지 관리", icon: Users, badge: newMsgCount },
          { id: "community", label: "커뮤니티 관리", icon: Users2, badge: 0 },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                if (t.id === "appointments") setNewApptCount(0);
                if (t.id === "messages") setNewMsgCount(0);
              }}
              className="flex-1 flex flex-col items-center gap-1 py-3 relative"
            >
              <div className="relative">
                <Icon size={20} color={active ? COLORS.pine : COLORS.slate} strokeWidth={active ? 2.5 : 2} />
                {t.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 rounded-full text-[9px] font-bold flex items-center justify-center" style={{ background: COLORS.danger, color: COLORS.white, minWidth: 14, height: 14, padding: "0 3px" }}>
                    {t.badge}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-semibold" style={{ color: active ? COLORS.pine : COLORS.slate }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {noticeEditorOpen && <NoticeEditor initialValue={notice} onSave={handleSaveNotice} onClose={() => setNoticeEditorOpen(false)} />}
    </div>
  );
}
export default function App() {
  const [mode, setMode] = useState(null);

  if (mode === "patient") return <PatientApp onExit={() => setMode(null)} />;
  if (mode === "admin") return <AdminApp onExit={() => setMode(null)} />;
  return <EntryScreen onPick={setMode} />;
}
