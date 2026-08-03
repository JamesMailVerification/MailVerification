"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Candidate = {
  id: number;
  title: string;
  type: string;
  sender: string;
  email: string;
  sourceUrl: string;
  summary: string;
  location: string;
  date: string;
  time: string;
  endTime: string;
  timeAmbiguous?: boolean;
  deadline?: string;
  needsReview?: boolean;
  selected: boolean;
  completed?: boolean;
  calendarEventId?: string | null;
};

type GmailMessageSummary = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  receivedAt: string;
  snippet: string;
  unread: boolean;
  sourceUrl: string;
  provider?: "gmail" | "daum";
  accountEmail?: string;
};

type DaumConnection = { id: number; emailAddress: string; mailboxName: string; status: string; lastErrorCode?: string | null };

type AnalysisScope = "today" | "unread" | "recent7" | "recent30";

type CalendarEvent = {
  id: string;
  title: string;
  htmlLink: string;
  allDay: boolean;
  date: string;
  time: string;
  endDate: string;
  endTime: string;
};

const initialCandidates: Candidate[] = [];

const isPromotionalMail = (message: GmailMessageSummary) =>
  /^\s*(?:\(광고\)|\[광고\]|광고[: ])/i.test(message.subject);

const isTodayInKorea = (receivedAt: string) => {
  if (!receivedAt) return false;
  const date = new Date(receivedAt);
  if (Number.isNaN(date.getTime())) return false;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(date) === formatter.format(new Date());
};

const isWithinDays = (receivedAt: string, days: number) => {
  const date = new Date(receivedAt);
  return !Number.isNaN(date.getTime()) && date.getTime() >= Date.now() - days * 24 * 60 * 60 * 1000;
};

const filterMessagesByScope = (messages: GmailMessageSummary[], scope: AnalysisScope) => {
  if (scope === "today") return messages.filter((message) => isTodayInKorea(message.receivedAt));
  if (scope === "unread") return messages.filter((message) => message.unread);
  return messages.filter((message) => isWithinDays(message.receivedAt, scope === "recent30" ? 30 : 7));
};

const navItems = [
  { id: "dashboard", icon: "⌂", label: "오늘의 업무" },
  { id: "inbox", icon: "↙", label: "메일 분석" },
  { id: "candidates", icon: "◇", label: "일정 후보" },
  { id: "calendar", icon: "□", label: "캘린더" },
];

export default function Home() {
  const [active, setActive] = useState("dashboard");
  const [candidates, setCandidates] = useState(initialCandidates);
  const [connected, setConnected] = useState<"gmail" | "outlook" | null>(null);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [daumConnections, setDaumConnections] = useState<DaumConnection[]>([]);
  const daumEmail = daumConnections[0]?.emailAddress ?? null;
  const [addMailOpen, setAddMailOpen] = useState(false);
  const [providerSetup, setProviderSetup] = useState<"gmail" | "outlook" | null>(null);
  const [daumConnectOpen, setDaumConnectOpen] = useState(false);
  const [daumEmailInput, setDaumEmailInput] = useState("");
  const [daumLoginId, setDaumLoginId] = useState("");
  const [daumMailboxInput, setDaumMailboxInput] = useState("CollieGolf");
  const [daumAppPassword, setDaumAppPassword] = useState("");
  const [daumConnecting, setDaumConnecting] = useState(false);
  const [daumError, setDaumError] = useState("");
  const [sessionUser, setSessionUser] = useState({ displayName: "사용자", email: "로그인 확인 중…" });
  const [profileOpen, setProfileOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [gmailMessages, setGmailMessages] = useState<GmailMessageSummary[]>([]);
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>("recent7");
  const [toast, setToast] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [completed, setCompleted] = useState<number[]>([]);

  const selected = candidates.filter((item) => item.selected);
  const openRegistration = () => {
    const incomplete = selected.find((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || item.timeAmbiguous || (item.time && !/^\d{2}:\d{2}$/.test(item.time)));
    if (incomplete) {
      showToast(`“${incomplete.title}” 일정의 날짜와 모호한 시간을 확인해 주세요.`);
      setActive("candidates");
      return;
    }
    setConfirmOpen(true);
  };
  const reviewCount = candidates.filter((item) => item.needsReview).length;
  const scopedMessageCount = filterMessagesByScope(gmailMessages, analysisScope).length;
  const today = new Date();
  const todayLabel = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(today);
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(today);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("SESSION_UNAVAILABLE");
        return response.json() as Promise<{ user: { displayName: string; email: string } }>;
      })
      .then(({ user }) => setSessionUser(user))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSessionUser({ displayName: "로그인 필요", email: "세션을 확인할 수 없습니다" });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    fetch("/api/candidates")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("CANDIDATES_LOAD_FAILED")))
      .then((data: { candidates: Candidate[] }) => {
        setCandidates(data.candidates ?? []);
        setCompleted((data.candidates ?? []).filter((item) => item.completed).map((item) => item.id));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/connections/daum")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("DAUM_STATUS_FAILED")))
      .then((data: { connections: DaumConnection[] }) => setDaumConnections(data.connections ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/connections")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("CONNECTION_STATUS_FAILED")))
      .then((data: { connections: Array<{ provider: string; providerEmail: string | null; status: string }> }) => {
        const googleConnection = data.connections.find((item) => item.provider === "google" && item.status === "connected");
        if (googleConnection) {
          setConnected("gmail");
          setConnectedEmail(googleConnection.providerEmail);
        }
      })
      .catch(() => undefined);
    Promise.resolve().then(() => {
      const result = new URLSearchParams(window.location.search).get("google");
      if (result === "connected") {
        setConnected("gmail");
        setActive("inbox");
        window.history.replaceState({}, "", "/");
      } else if (result) {
        setActive("inbox");
        setToast("Gmail 연결에 실패했습니다. Google 권한과 환경변수를 확인해 주세요.");
        window.history.replaceState({}, "", "/");
      }
    });
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const connectDaum = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDaumConnecting(true);
    setDaumError("");
    try {
      const response = await fetch("/api/connections/daum", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emailAddress: daumEmailInput, loginId: daumLoginId, appPassword: daumAppPassword, mailboxName: daumMailboxInput }),
      });
      const data = await response.json() as { connection?: DaumConnection; error?: string };
      if (!response.ok || !data.connection) throw new Error(data.error ?? "DAUM_CONNECTION_FAILED");
      setDaumConnections((items) => [...items.filter((item) => item.id !== data.connection!.id), data.connection!]);
      setDaumAppPassword("");
      setDaumConnectOpen(false);
      showToast("Daum 메일이 IMAP 읽기 전용으로 연결되었습니다.");
    } catch (error) {
      setDaumError(error instanceof Error && error.message === "DAUM_MAILBOX_NOT_FOUND"
        ? `‘${daumMailboxInput}’ 메일함을 찾지 못했습니다. Daum 내 메일함의 이름을 정확히 입력해 주세요.`
        : error instanceof Error && error.message === "DAUM_AUTHENTICATION_FAILED"
          ? "로그인하지 못했습니다. Daum 로그인 ID와 앱 비밀번호를 확인해 주세요."
          : "연결하지 못했습니다. IMAP 사용 설정과 입력 정보를 확인해 주세요.");
    } finally {
      setDaumConnecting(false);
    }
  };

  const disconnectDaum = async (id = daumConnections[0]?.id) => {
    if (!id) return;
    const response = await fetch(`/api/connections/daum?id=${id}`, { method: "DELETE" });
    if (!response.ok) {
      showToast("Daum 메일 연결을 해제하지 못했습니다.");
      return;
    }
    setDaumConnections((items) => items.filter((item) => item.id !== id));
    showToast("Daum 메일 연결과 저장된 앱 비밀번호를 삭제했습니다.");
  };

  const startAnalysis = async () => {
    if (!connected && !daumEmail) {
      showToast("먼저 이메일 계정을 연결해 주세요.");
      return;
    }
    setAnalyzing(true);
    setActive("inbox");
    try {
      const sources = [
        ...(connected === "gmail" ? [{ endpoint: `/api/gmail/messages?days=${analysisScope === "recent30" ? 30 : 7}`, provider: "gmail" as const }] : []),
        ...(daumConnections.length ? [{ endpoint: `/api/daum/messages?days=${analysisScope === "recent30" ? 30 : 7}`, provider: "daum" as const }] : []),
      ];
      const results = await Promise.allSettled(sources.map(async ({ endpoint, provider }) => {
        const response = await fetch(endpoint);
        const data = await response.json() as { messages?: GmailMessageSummary[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? `${provider.toUpperCase()}_READ_FAILED`);
        return (data.messages ?? []).map((message) => ({ ...message, provider }));
      }));
      const messages = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      const failedCount = results.filter((result) => result.status === "rejected").length;
      if (!messages.length && failedCount) throw new Error("MAIL_READ_FAILED");
      const sortedMessages = messages.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
      setGmailMessages(sortedMessages);
      const scopedMessages = filterMessagesByScope(sortedMessages, analysisScope);
      const candidateResponse = await fetch("/api/candidates/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: scopedMessages }),
      });
      const candidateData = await candidateResponse.json() as { candidates?: Candidate[] };
      if (!candidateResponse.ok) throw new Error("CANDIDATE_EXTRACTION_FAILED");
      const saveResponse = await fetch("/api/candidates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidates: candidateData.candidates ?? [] }) });
      const savedData = await saveResponse.json() as { candidates?: Candidate[] };
      if (!saveResponse.ok) throw new Error("CANDIDATE_SAVE_FAILED");
      setCandidates(savedData.candidates ?? []);
      showToast(`선택 범위의 실제 메일 ${scopedMessages.length}개에서 일정 후보 ${(candidateData.candidates ?? []).length}개를 찾았습니다${failedCount ? ` · ${failedCount}개 계정 확인 필요` : ""}.`);
    } catch {
      showToast("메일을 불러오지 못했습니다. 연결 상태를 확인해 주세요.");
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleCandidate = (id: number) => {
    const item = candidates.find((candidate) => candidate.id === id);
    if (!item) return;
    const selected = !item.selected;
    setCandidates((items) => items.map((candidate) => candidate.id === id ? { ...candidate, selected } : candidate));
    void fetch("/api/candidates", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, changes: { selected } }) });
  };

  const completeTask = (id: number) => {
    setCompleted((items) => [...items, id]);
    setCandidates((items) => items.map((item) => item.id === id ? { ...item, completed: true } : item));
    void fetch("/api/candidates", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, changes: { completed: true } }) });
    showToast("완료 처리했습니다. 반복 알림에서 제외됩니다.");
  };

  const updateCandidates = (items: Candidate[]) => {
    const removed = candidates.find((candidate) => !items.some((item) => item.id === candidate.id));
    if (removed) void fetch(`/api/candidates?id=${removed.id}`, { method: "DELETE" });
    for (const item of items) {
      const previous = candidates.find((candidate) => candidate.id === item.id);
      if (previous && (previous.title !== item.title || previous.date !== item.date || previous.time !== item.time || previous.endTime !== item.endTime || previous.timeAmbiguous !== item.timeAmbiguous || previous.needsReview !== item.needsReview)) {
        void fetch("/api/candidates", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, changes: { title: item.title, date: item.date, time: item.time, endTime: item.endTime, timeAmbiguous: item.timeAmbiguous, needsReview: item.needsReview } }) });
      }
    }
    setCandidates(items);
  };

  const registerSelected = async () => {
    if (registering) return;
    setRegistering(true);
    try {
      const response = await fetch("/api/calendar/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        candidateIds: selected.map((item) => item.id),
        candidates: selected.map(({ id, title, date, time, endTime }) => ({ id, title, date, time, endTime })),
      }) });
      const data = await response.json().catch(() => ({ error: "INVALID_RESPONSE" })) as { registered?: number[]; error?: string };
      if (data.error === "AUTHENTICATION_REQUIRED") { window.location.assign("/signin-with-chatgpt?return_to=%2F"); return; }
      if (["CALENDAR_PERMISSION_REQUIRED", "GOOGLE_RECONNECT_REQUIRED", "GOOGLE_CALENDAR_PERMISSION_DENIED"].includes(data.error ?? "")) {
        window.location.assign("/api/auth/google/start");
        return;
      }
      if (data.error === "GOOGLE_CALENDAR_API_DISABLED") { showToast("Google Cloud에서 Calendar API를 활성화해 주세요."); return; }
      if (data.error === "GOOGLE_CALENDAR_UNREACHABLE") { showToast("Google Calendar에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요."); return; }
      if (data.error === "CANDIDATE_DATE_TIME_REQUIRED") { showToast("선택한 일정의 날짜와 시간을 모두 입력해 주세요."); return; }
      if (data.error === "GOOGLE_NOT_CONNECTED") { showToast("Gmail 계정을 다시 연결해 주세요."); return; }
      if (data.error === "GOOGLE_CALENDAR_UNAVAILABLE") { showToast("Google Calendar를 사용할 수 있는 계정인지 확인해 주세요."); return; }
      if (!response.ok) { showToast("캘린더 등록에 실패했습니다. 날짜·시간과 Google 연결을 확인해 주세요."); return; }
      const registered = new Set(data.registered ?? []);
      setCandidates((items) => items.map((item) => registered.has(item.id) ? { ...item, calendarEventId: "registered" } : item));
      setConfirmOpen(false);
      setActive("calendar");
      showToast(`${registered.size}개 일정을 Google Calendar에 등록했습니다.`);
    } catch {
      showToast("캘린더 등록 요청을 보내지 못했습니다. 네트워크 연결을 확인해 주세요.");
    } finally {
      setRegistering(false);
    }
  };

  const stats = useMemo(() => {
    const todayItems = candidates.filter((item) => item.date === todayKey);
    const nextThreeDays = new Date(`${todayKey}T00:00:00+09:00`);
    nextThreeDays.setDate(nextThreeDays.getDate() + 3);
    const nextThreeDaysKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(nextThreeDays);
    return [
    { value: String(todayItems.length), label: "오늘 할 일", note: `${todayItems.filter((item) => completed.includes(item.id)).length}개 완료`, tone: "green" },
    { value: String(todayItems.filter((item) => /회신|답변/.test(item.type)).length), label: "회신 필요", note: "오늘 처리할 회신", tone: "coral" },
    { value: String(candidates.filter((item) => item.type === "회의" && item.date > todayKey && item.date <= nextThreeDaysKey).length), label: "다가오는 회의", note: "다음 3일", tone: "blue" },
    { value: String(reviewCount), label: "확인 필요", note: "날짜·시간 검토", tone: "amber" },
  ];
  }, [candidates, completed, reviewCount, todayKey]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setActive("dashboard")} aria-label="홈으로 이동">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><strong>Morrow</strong><small>MAIL SCHEDULER</small></span>
        </button>

        <nav aria-label="주 메뉴">
          <p className="nav-label">WORKSPACE</p>
          {navItems.map((item) => (
            <button key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => setActive(item.id)}>
              <span className="nav-icon">{item.icon}</span>{item.label}
              {item.id === "inbox" && scopedMessageCount > 0 && <span className="nav-badge">{scopedMessageCount}</span>}
              {item.id === "candidates" && candidates.length > 0 && <span className="nav-badge">{candidates.length}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-stack">
            {connected === "gmail" && <div className="connection-card"><span className="status-dot online" /><div><strong>Gmail</strong><small>{connectedEmail ?? "Google 계정 · 연결됨"}</small></div><button aria-label="Gmail 연결 설정" onClick={() => setActive("settings")}>···</button></div>}
            {daumConnections.map((connection) => <div className="connection-card" key={connection.id}><span className={`status-dot ${connection.status === "connected" ? "online" : ""}`} /><div><strong>{connection.emailAddress}</strong><small>Daum Mail · {connection.mailboxName}</small></div><button aria-label={`${connection.emailAddress} 연결 설정`} onClick={() => setActive("settings")}>···</button></div>)}
            {!connected && !daumConnections.length && <div className="connection-card"><span className="status-dot" /><div><strong>메일 연결 필요</strong><small>분석을 시작할 수 없습니다</small></div><button aria-label="연결 설정" onClick={() => setAddMailOpen(true)}>···</button></div>}
          </div>
          <div className="profile-wrap">
            {profileOpen && (
              <div className="profile-menu" id="profile-menu" role="menu">
                <div className="profile-menu-heading">
                  <strong>내 계정</strong>
                  <small>현재 Morrow 로그인 계정</small>
                </div>
                <button role="menuitem" onClick={() => { setProfileOpen(false); setActive("settings"); }}>
                  <span>연결된 메일 관리</span><small>Gmail·Daum 연결 확인 및 해제</small>
                </button>
                <button role="menuitem" onClick={() => { setProfileOpen(false); setAddMailOpen(true); }}>
                  <span>메일 계정 추가</span><small>분석할 메일함 연결</small>
                </button>
                <a role="menuitem" href="/signout-with-chatgpt?return_to=%2F">
                  <span>로그아웃</span><small>Morrow 로그인 종료</small>
                </a>
              </div>
            )}
            <button
              className="profile"
              type="button"
              aria-label="내 계정 메뉴"
              aria-expanded={profileOpen}
              aria-controls="profile-menu"
              onClick={() => setProfileOpen((open) => !open)}
            >
              <span className="avatar">{sessionUser.displayName.slice(0, 2).toUpperCase()}</span>
              <span className="profile-copy"><strong>{sessionUser.displayName}</strong><small>{sessionUser.email}</small></span>
              <span className="profile-chevron" aria-hidden="true">{profileOpen ? "⌃" : "⌄"}</span>
            </button>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand">Morrow</div>
          <a className="privacy-link" href="/privacy">개인정보처리방침</a>
          <div className="top-actions">
            <button className="icon-button" aria-label="검색">⌕</button>
            <button className="icon-button notification" aria-label="알림">♧<span /></button>
            <button className="primary-button compact" onClick={startAnalysis} disabled={analyzing}>
              {analyzing ? <><span className="spinner" />분석 중</> : <>＋ 메일 분석</>}
            </button>
          </div>
        </header>

        <div className="content">
          <section className="product-purpose" aria-label="Morrow 서비스 소개">
            <strong>Morrow</strong>
            <span>연결한 Gmail에서 일정과 답변 기한 후보를 찾아 보여주고, 사용자가 확인한 항목만 일정으로 관리하는 메일 일정 도우미입니다.</span>
          </section>
          {active === "dashboard" && (
            <Dashboard
              todayLabel={todayLabel}
              stats={stats}
              completed={completed}
              onComplete={completeTask}
              onAnalyze={startAnalysis}
              analyzing={analyzing}
              onViewCandidates={() => setActive("candidates")}
              candidates={candidates}
              messages={gmailMessages}
              displayName={sessionUser.displayName}
              todayKey={todayKey}
            />
          )}

          {active === "inbox" && (
            <AnalysisView connected={connected} connectedEmail={connectedEmail} daumConnections={daumConnections} analyzing={analyzing} messages={gmailMessages} scope={analysisScope} onScopeChange={setAnalysisScope} onAnalyze={startAnalysis} onAddMail={() => setAddMailOpen(true)} />
          )}

          {active === "candidates" && (
            <CandidatesView candidates={candidates} selectedCount={selected.length} onToggle={toggleCandidate} onUpdate={updateCandidates} onRegister={openRegistration} />
          )}

          {active === "calendar" && <CalendarView />}
          {active === "settings" && <SettingsView connected={connected} connectedEmail={connectedEmail} daumEmail={daumEmail} onConnect={setConnected} onDisconnected={() => setConnectedEmail(null)} onConnectDaum={() => { setDaumError(""); setDaumConnectOpen(true); }} onDisconnectDaum={() => disconnectDaum()} onNotice={showToast} />}
        </div>
      </section>

      {confirmOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setConfirmOpen(false)} aria-label="닫기">×</button>
            <span className="modal-icon">✓</span>
            <p className="eyebrow">FINAL CHECK</p>
            <h2 id="confirm-title">선택한 일정을 등록할까요?</h2>
            <p className="modal-copy">선택한 {selected.length}개 일정만 Google Calendar에 등록됩니다.</p>
            <div className="confirm-list">
              {selected.map((item) => <div key={item.id}><span>{item.date.slice(5).replace("-", ".")}</span><strong>{item.title}</strong><small>{item.time ? `${item.time}–${item.endTime}` : "종일"}</small></div>)}
            </div>
            <div className="reminder-row"><span>◷</span><div><strong>알림 정책</strong><small>마감 3일 전부터 매일 오전 9시 · 완료 전까지</small></div></div>
            <div className="modal-actions">
              <button className="ghost-button" disabled={registering} onClick={() => setConfirmOpen(false)}>취소</button>
              <button className="primary-button" disabled={registering} onClick={registerSelected}>{registering ? "등록 중…" : "최종 등록"}</button>
            </div>
          </section>
        </div>
      )}

      {addMailOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAddMailOpen(false)}>
          <section className="modal provider-modal" role="dialog" aria-modal="true" aria-labelledby="add-mail-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setAddMailOpen(false)} aria-label="닫기">×</button>
            <p className="eyebrow">ADD MAIL ACCOUNT</p><h2 id="add-mail-title">추가할 메일 종류를 선택하세요</h2>
            <div className="provider-options">
              <button onClick={() => { setAddMailOpen(false); setProviderSetup("gmail"); }}><span className="provider-logo gmail">M</span><strong>Gmail</strong><small>Google OAuth로 연결</small></button>
              <button onClick={() => { setAddMailOpen(false); setProviderSetup("outlook"); }}><span className="provider-logo outlook">O</span><strong>Microsoft Outlook</strong><small>Microsoft 계정 연결</small></button>
              <button onClick={() => { setAddMailOpen(false); setDaumError(""); setDaumEmailInput(""); setDaumLoginId(""); setDaumMailboxInput("CollieGolf"); setDaumConnectOpen(true); }}><span className="provider-logo daum">D</span><strong>Daum Mail</strong><small>내 메일함 IMAP 연결</small></button>
            </div>
          </section>
        </div>
      )}

      {providerSetup && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setProviderSetup(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="provider-setup-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setProviderSetup(null)} aria-label="닫기">×</button>
            <span className={`modal-icon ${providerSetup === "gmail" ? "" : "outlook-icon"}`}>{providerSetup === "gmail" ? "M" : "O"}</span>
            <p className="eyebrow">{providerSetup === "gmail" ? "GOOGLE OAUTH" : "MICROSOFT OAUTH"}</p>
            <h2 id="provider-setup-title">{providerSetup === "gmail" ? "Gmail 계정 추가" : "Outlook 계정 추가"}</h2>
            <p className="modal-copy">{providerSetup === "gmail" ? "Google 로그인 화면에서 추가할 Gmail 계정을 선택하고 읽기 전용 권한을 승인해 주세요." : "Microsoft OAuth 서버 연결은 아직 준비 중입니다. 설정이 완료되기 전에는 계정이 연결된 것으로 표시되지 않습니다."}</p>
            <div className="modal-actions"><button className="ghost-button" onClick={() => setProviderSetup(null)}>취소</button><button className="primary-button" disabled={providerSetup === "outlook"} onClick={() => { window.location.href = "/api/auth/google/start"; }}>{providerSetup === "gmail" ? "Google에서 계속" : "준비 중"}</button></div>
          </section>
        </div>
      )}

      {daumConnectOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !daumConnecting && setDaumConnectOpen(false)}>
          <section className="modal daum-connect-modal" role="dialog" aria-modal="true" aria-labelledby="daum-connect-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setDaumConnectOpen(false)} aria-label="닫기" disabled={daumConnecting}>×</button>
            <span className="modal-icon daum-icon">D</span>
            <p className="eyebrow">DAUM IMAP</p>
            <h2 id="daum-connect-title">Daum 메일 연결</h2>
            <p className="modal-copy">IMAP 읽기 전용으로 연결합니다. Daum 메일 설정에서 발급받은 앱 비밀번호를 그대로 입력해 주세요. 이 앱은 비밀번호를 자동 생성하지 않습니다.</p>
            <form className="connection-form" onSubmit={connectDaum}>
              <label>표시할 회사 메일 주소<input type="email" autoComplete="email" value={daumEmailInput} onChange={(event) => setDaumEmailInput(event.target.value)} placeholder="name@company.com" required /></label>
              <label>Daum 로그인 ID<input value={daumLoginId} onChange={(event) => setDaumLoginId(event.target.value)} placeholder="Daum ID 또는 스마트워크 로그인 ID" required /></label>
              <label>조회할 내 메일함<input value={daumMailboxInput} onChange={(event) => setDaumMailboxInput(event.target.value)} placeholder="예: CollieGolf" required /></label>
              <label>Daum 발급 앱 비밀번호<input type="password" autoComplete="off" value={daumAppPassword} onChange={(event) => setDaumAppPassword(event.target.value)} placeholder="Daum에서 생성된 앱 비밀번호 입력" required /></label>
              <p className="connection-help">서버: imap.daum.net · 포트 993 · SSL/TLS</p>
              {daumError && <p className="connection-error" role="alert">{daumError}</p>}
              <div className="modal-actions"><button type="button" className="ghost-button" onClick={() => setDaumConnectOpen(false)} disabled={daumConnecting}>취소</button><button type="submit" className="primary-button" disabled={daumConnecting}>{daumConnecting ? <><span className="spinner" />연결 확인 중</> : "안전하게 연결"}</button></div>
            </form>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Dashboard({ todayLabel, stats, completed, onComplete, onAnalyze, analyzing, onViewCandidates, candidates, messages, displayName, todayKey }: { todayLabel: string; stats: {value:string;label:string;note:string;tone:string}[]; completed:number[]; onComplete:(id:number)=>void; onAnalyze:()=>void; analyzing:boolean; onViewCandidates:()=>void; candidates:Candidate[]; messages:GmailMessageSummary[]; displayName:string; todayKey:string }) {
  const tasks = candidates.filter((item) => item.date === todayKey);
  const reviewItems = candidates.filter((item) => item.needsReview).slice(0, 2);
  const todayMailCount = messages.filter((message) => isTodayInKorea(message.receivedAt)).length;
  const dateEyebrow = new Intl.DateTimeFormat("en-US", { weekday:"long", month:"long", day:"2-digit" }).format(new Date()).toUpperCase();
  return <>
    <section className="hero-row">
      <div><p className="eyebrow">{dateEyebrow}</p><h1>좋은 오후예요, {displayName}님.</h1><p>{todayLabel} · 중요한 일정부터 차근차근 정리해 볼까요?</p></div>
      <button className="primary-button" onClick={onAnalyze} disabled={analyzing}>{analyzing ? <><span className="spinner" />메일 확인 중</> : <>✦ 새 메일 확인하기</>}</button>
    </section>

    <section className="stats-grid">
      {stats.map((stat) => {
        const labelLines = stat.label === "오늘 할 일" ? ["오늘", "할 일"] : stat.label.split(" ");
        return <article className="stat-card" key={stat.label}><span className={`stat-accent ${stat.tone}`} /><div><strong>{stat.value}</strong><p className="stat-label">{labelLines.map((line, index) => <span key={`${stat.label}-${index}`}>{line}</span>)}</p><small>{stat.note}</small></div><span className="stat-arrow">↗</span></article>;
      })}
    </section>

    <section className="main-grid">
      <article className="panel schedule-panel">
        <div className="panel-header"><div><p className="eyebrow">TODAY</p><h2>오늘의 일정</h2></div><button className="text-button">전체 보기 →</button></div>
        <div className="task-list">
          {!tasks.length && <div className="empty-state"><strong>오늘 일정이 아직 없습니다.</strong><small>새 메일을 확인하면 실제 일정 후보가 여기에 표시됩니다.</small></div>}
          {tasks.map((task) => {
            const isDone = completed.includes(task.id);
            return <div className={`task-row ${isDone ? "done" : ""}`} key={task.id}>
              <div className="task-time"><strong>{task.time || "종일"}</strong><span>{task.type}</span></div>
              <span className={`timeline-dot ${task.needsReview ? "urgent" : ""}`} />
              <div className="task-main"><strong>{task.title}</strong><small>{task.sender}</small></div>
              <span className={`pill ${task.needsReview ? "danger" : "soft"}`}>{task.needsReview ? "확인 필요" : "오늘 일정"}</span>
              <button className="check-button" onClick={() => onComplete(task.id)} aria-label={`${task.title} 완료`}>{isDone ? "✓" : ""}</button>
            </div>;
          })}
        </div>
        <div className="completion-line"><span style={{width:`${tasks.length ? tasks.filter((task) => completed.includes(task.id)).length / tasks.length * 100 : 0}%`}} /><small>{tasks.filter((task) => completed.includes(task.id)).length}/{tasks.length} 완료</small></div>
      </article>

      <aside className="side-stack">
        <article className="panel review-panel">
          <div className="panel-header"><div><p className="eyebrow coral">NEEDS REVIEW</p><h2>확인이 필요해요</h2></div><span className="count-badge">{reviewItems.length}</span></div>
          {!reviewItems.length && <div className="empty-state compact"><strong>확인할 항목이 없습니다.</strong><small>날짜나 시간이 불명확한 후보가 표시됩니다.</small></div>}
          {reviewItems.map((item) => <button className="review-item" onClick={onViewCandidates} key={item.id}><span className="date-tile">{item.date ? item.date.slice(-2) : "?"}<small>{item.date ? item.date.slice(5,7) + "월" : "확인"}</small></span><span><strong>{item.title}</strong><small>날짜 또는 시간을 확인해 주세요.</small></span><b>›</b></button>)}
          {!!reviewItems.length && <button className="wide-outline" onClick={onViewCandidates}>{reviewCountLabel(reviewItems.length)} 확인하기</button>}
        </article>

        <article className="panel inbox-panel">
          <div className="mail-art"><span>✉</span><i /><i /></div>
          <div><p className="eyebrow">INBOX PULSE</p><h3>메일 분석 현황</h3><p>오늘 받은 메일 {todayMailCount}개 중<br/><strong>{candidates.length}개의 일정 후보</strong>를 찾았어요.</p></div>
        </article>
      </aside>
    </section>
  </>;
}

const reviewCountLabel = (count:number) => `${count}개 항목`;

function AnalysisView({ connected, connectedEmail, daumConnections, analyzing, messages, scope, onScopeChange, onAnalyze, onAddMail }: { connected:string|null; connectedEmail:string|null; daumConnections:DaumConnection[]; analyzing:boolean; messages:GmailMessageSummary[]; scope:AnalysisScope; onScopeChange:(scope:AnalysisScope)=>void; onAnalyze:()=>void; onAddMail:()=>void }) {
  const scopedMessages = filterMessagesByScope(messages, scope);
  const organizedMessages = scopedMessages.filter((message) => !isPromotionalMail(message));
  const promotionalCount = scopedMessages.length - organizedMessages.length;
  const scopeOptions: Array<{ id: AnalysisScope; label: string }> = [
    { id: "today", label: "오늘 받은 메일" },
    { id: "unread", label: "읽지 않은 메일" },
    { id: "recent7", label: "최근 7일" },
    { id: "recent30", label: "최근 한 달" },
  ];
  return <section className="view-page">
    <div className="view-heading"><p className="eyebrow">EMAIL ANALYSIS</p><h1>메일에서 중요한 일정을 찾아볼게요.</h1><p>승인한 범위의 메일만 읽고, 원문은 별도로 저장하지 않습니다.</p></div>
    <div className="view-actions"><button className="primary-button" onClick={onAddMail}>＋ 메일 추가</button></div>
    <div className="analysis-layout">
      <article className="panel connect-panel"><span className="provider-logo gmail">M</span><div><h2>Gmail</h2><p>{connected === "gmail" ? connectedEmail ?? "Google 계정 · 연결됨" : "읽기 전용 권한으로 안전하게 연결합니다."}</p></div><button className={connected === "gmail" ? "connected-button" : "primary-button"} onClick={() => { if (connected !== "gmail") window.location.href = "/api/auth/google/start"; }}>{connected === "gmail" ? "✓ 연결됨" : "연결하기"}</button></article>
      <article className="panel connect-panel"><span className="provider-logo outlook">O</span><div><h2>Microsoft Outlook</h2><p>Microsoft OAuth 연결 준비 중</p></div><button className="ghost-button" onClick={onAddMail}>추가 설정</button></article>
      {daumConnections.map((connection) => <article className="panel connect-panel daum-panel" key={connection.id}><span className="provider-logo daum">D</span><div><h2>Daum Mail</h2><p>{connection.mailboxName} 메일함 · {connection.emailAddress}</p></div><span className="connected-button">✓ 연결됨</span></article>)}
    </div>
    <article className="panel analysis-box">
      <div className={`scan-visual ${analyzing ? "scanning" : ""}`}><span>✉</span><i /></div>
      <h2>{analyzing ? "메일을 살펴보고 있어요…" : "분석할 범위를 확인해 주세요"}</h2>
      <p>{analyzing ? "일정, 회신 요청, 제출 기한을 안전하게 추출하고 있습니다." : messages.length ? `최근 조회한 실제 메일 ${messages.length}개` : scope === "recent30" ? "연결된 계정의 최근 한 달 메일을 조회합니다." : "연결된 계정의 최근 7일 메일을 조회합니다."}</p>
      <div className="scope-chips" role="group" aria-label="메일 분석 범위">{scopeOptions.map((option) => <button type="button" className={scope === option.id ? "active" : ""} aria-pressed={scope === option.id} onClick={() => onScopeChange(option.id)} key={option.id}>{option.label}</button>)}</div>
      <button className="primary-button" onClick={onAnalyze} disabled={analyzing}>{analyzing ? <><span className="spinner" />메일 분석 중</> : "메일 분석 시작"}</button>
    </article>
    {messages.length > 0 && <article className="panel mail-results">
      <div className="panel-header"><div><p className="eyebrow">선택한 분석 범위</p><h2>조회한 메일 {scopedMessages.length}개</h2><p className="mail-summary">업무 확인 대상 {organizedMessages.length}개 · 광고 {promotionalCount}개 제외</p></div></div>
      <div className="mail-list">
        {organizedMessages.map((message) => <a className="mail-row" href={message.sourceUrl} target="_blank" rel="noreferrer" key={`${message.provider}-${message.id}`}>
          <span className={`timeline-dot ${message.unread ? "urgent" : ""}`} />
          <span className="mail-content"><strong>{message.subject || "제목 없음"}</strong><small>{message.provider === "daum" ? "Daum Mail" : "Gmail"} · {message.from}</small><span>{message.snippet || "미리보기 없음"}</span></span>
          <span className="pill soft">{message.unread ? "읽지 않음" : "읽음"}</span>
        </a>)}
        {organizedMessages.length === 0 && <div className="mail-empty">광고를 제외하면 확인할 메일이 없습니다.</div>}
      </div>
    </article>}
  </section>;
}

function CandidatesView({ candidates, selectedCount, onToggle, onUpdate, onRegister }: { candidates:Candidate[]; selectedCount:number; onToggle:(id:number)=>void; onUpdate:(items:Candidate[])=>void; onRegister:()=>void }) {
  const update = (id:number, field:keyof Candidate, value:string) => onUpdate(candidates.map((item) => {
    if (item.id !== id) return item;
    const addThreeHours = (start:string) => {
      const [hour, minute] = start.split(":").map(Number);
      const total = (hour * 60 + minute + 180) % 1440;
      return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    };
    const updated = field === "time"
      ? { ...item, time: value, endTime: value ? addThreeHours(value) : "" }
      : field === "endTime" && !value && item.time
        ? { ...item, endTime: addThreeHours(item.time) }
        : { ...item, [field]: value };
    return { ...updated, timeAmbiguous: field === "time" ? false : updated.timeAmbiguous, needsReview: !updated.date || (field === "time" ? false : Boolean(updated.timeAmbiguous)) };
  }));
  const toggleAllDay = (id:number, checked:boolean) => onUpdate(candidates.map((item) => item.id === id
    ? checked
      ? { ...item, time: "", endTime: "", timeAmbiguous: false, needsReview: !item.date }
      : { ...item, time: "", endTime: "", timeAmbiguous: true, needsReview: true }
    : item));
  const remove = (id:number) => onUpdate(candidates.filter((item) => item.id !== id));
  return <section className="view-page candidates-page">
    <div className="view-heading inline"><div><p className="eyebrow">SCHEDULE CANDIDATES</p><h1>찾은 일정 후보를 확인해 주세요.</h1><p>수정하고 선택한 일정만 캘린더에 등록됩니다.</p></div><button className="primary-button" disabled={!selectedCount} onClick={onRegister}>{selectedCount}개 일정 등록</button></div>
    <div className="candidate-toolbar"><span><strong>{candidates.length}</strong>개의 후보</span><div><button className="filter active">전체</button><button className="filter">확인 필요</button><button className="filter">선택됨</button></div></div>
    <div className="candidate-list">
      {candidates.map((item) => {
        const allDay = !item.time && !item.timeAmbiguous;
        const incomplete = !item.date || Boolean(item.timeAmbiguous) || Boolean(item.time && !/^\d{2}:\d{2}$/.test(item.time));
        return <article className={`candidate-card ${item.selected ? "selected" : ""} ${incomplete ? "incomplete" : ""}`} key={item.id}>
        <button className={`select-box ${item.selected ? "checked" : ""}`} onClick={() => onToggle(item.id)} aria-label={`${item.title} 선택`}>{item.selected ? "✓" : ""}</button>
        <div className="candidate-date"><strong>{item.date ? item.date.slice(8) : "?"}</strong><span>{item.date ? `${item.date.slice(5,7)}월` : "확인"}</span></div>
        <div className="candidate-content">
          <div className="candidate-title"><span className="type-pill">{item.type}</span>{item.needsReview && <span className="pill danger">확인 필요</span>}</div>
          <input aria-label="일정 제목" value={item.title} onChange={(event) => update(item.id, "title", event.target.value)} />
          <p>{item.sender} · <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.email} ↗</a></p>
        </div>
        <div className="candidate-fields"><label>날짜<input type="date" value={item.date} aria-invalid={!item.date} onChange={(event) => update(item.id, "date", event.target.value)} /></label><label>시작 시간<input type="time" disabled={allDay} value={/^\d{2}:\d{2}$/.test(item.time) ? item.time : ""} aria-invalid={Boolean(item.timeAmbiguous)} onChange={(event) => update(item.id, "time", event.target.value)} /></label><label>종료 시간<input type="time" disabled={allDay || !item.time} value={item.time && /^\d{2}:\d{2}$/.test(item.endTime) ? item.endTime : ""} onChange={(event) => update(item.id, "endTime", event.target.value)} /></label><label className="all-day-toggle"><input type="checkbox" checked={allDay} onChange={(event) => toggleAllDay(item.id, event.target.checked)} /><span>종일</span></label>{incomplete && <small className="field-warning">[확인 필요] 날짜와 모호한 시간을 확인해 주세요.</small>}</div>
        <button className="delete-button" onClick={() => remove(item.id)} aria-label="일정 후보 삭제">×</button>
      </article>})}
    </div>
    {!candidates.length && <div className="empty-state"><span>◇</span><h2>일정 후보가 없어요</h2><p>새 메일을 분석하면 이곳에 후보가 표시됩니다.</p></div>}
  </section>;
}

function CalendarView() {
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [calendarError, setCalendarError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/calendar/events?month=${monthKey}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { events?: CalendarEvent[]; error?: string };
        if (!response.ok) throw new Error(data.error || "CALENDAR_SYNC_FAILED");
        return data.events ?? [];
      })
      .then(setEvents)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const code = error instanceof Error ? error.message : "CALENDAR_SYNC_FAILED";
        setCalendarError(code === "GOOGLE_RECONNECT_REQUIRED" || code === "CALENDAR_PERMISSION_REQUIRED" ? "Google Calendar 권한을 다시 연결해 주세요." : "Google Calendar 일정을 불러오지 못했습니다.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [monthKey, reloadKey]);
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPreviousMonth = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const offsetDay = index - firstWeekday + 1;
    const cellDate = new Date(year, month, offsetDay);
    const dateKey = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, "0")}-${String(cellDate.getDate()).padStart(2, "0")}`;
    return { dateKey, day: offsetDay < 1 ? daysInPreviousMonth + offsetDay : offsetDay > daysInMonth ? offsetDay - daysInMonth : offsetDay, inMonth: offsetDay >= 1 && offsetDay <= daysInMonth };
  });
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const moveMonth = (amount: number) => { setLoading(true); setCalendarError(""); setVisibleMonth(new Date(year, month + amount, 1)); };
  const reload = () => { setLoading(true); setCalendarError(""); setReloadKey((value) => value + 1); };
  return <section className="view-page"><div className="view-heading inline"><div><p className="eyebrow">GOOGLE CALENDAR · 실시간 동기화</p><h1>{month + 1}월 일정</h1><p>Google Calendar 기본 캘린더의 실제 일정을 표시합니다.</p></div><div className="calendar-actions"><button className="sync-button" disabled={loading} onClick={reload}>{loading ? "동기화 중…" : "↻ 새로고침"}</button><div className="month-nav"><button onClick={() => moveMonth(-1)} aria-label="이전 달">‹</button><strong>{year}년 {month + 1}월</strong><button onClick={() => moveMonth(1)} aria-label="다음 달">›</button></div></div></div>{calendarError && <div className="calendar-sync-error"><span>{calendarError}</span><button onClick={reload}>다시 시도</button></div>}<article className={`panel calendar-grid ${loading ? "loading" : ""}`}><div className="weekdays">{["일","월","화","수","목","금","토"].map(d=><span key={d}>{d}</span>)}</div><div className="days">{cells.map((cell)=><div className={`${cell.inMonth ? "" : "muted-day"} ${cell.dateKey === todayKey ? "today" : ""}`} key={cell.dateKey}><b>{cell.day}</b>{events.filter((item) => item.date === cell.dateKey).map((item) => <a className="calendar-event green" href={item.htmlLink || undefined} target="_blank" rel="noreferrer" key={item.id}>{item.allDay ? "종일" : `${item.time}-${item.endTime}`} {item.title}</a>)}</div>)}</div></article></section>;
}

function SettingsView({ connected, connectedEmail, daumEmail, onConnect, onDisconnected, onConnectDaum, onDisconnectDaum, onNotice }: {connected:string|null;connectedEmail:string|null;daumEmail:string|null;onConnect:(value:"gmail"|"outlook"|null)=>void;onDisconnected:()=>void;onConnectDaum:()=>void;onDisconnectDaum:()=>void;onNotice:(message:string)=>void}) {
  const handleGoogleConnection = async () => {
    if (connected !== "gmail") {
      window.location.href = "/api/auth/google/start";
      return;
    }
    try {
      const response = await fetch("/api/connections", { method: "DELETE" });
      if (!response.ok) throw new Error("DISCONNECT_FAILED");
      onConnect(null);
      onDisconnected();
      onNotice("Gmail 연결과 저장된 토큰을 삭제했습니다.");
    } catch {
      onNotice("Gmail 연결을 해제하지 못했습니다. 다시 시도해 주세요.");
    }
  };

  return <section className="view-page"><div className="view-heading"><p className="eyebrow">CONNECTIONS</p><h1>연결 및 개인정보</h1><p>메일과 캘린더 접근 권한을 언제든 관리할 수 있습니다.</p></div><article className="panel settings-panel"><h2>연결된 계정</h2><div className="setting-row"><span className="provider-logo gmail">M</span><div><strong>Google Workspace</strong><small>{connected === "gmail" ? connectedEmail ?? "Google 계정 · 연결됨" : "연결되지 않음"}</small></div><button className="ghost-button" onClick={handleGoogleConnection}>{connected === "gmail" ? "연결 해제" : "연결"}</button></div><div className="setting-row"><span className="provider-logo daum">D</span><div><strong>Daum Mail · IMAP</strong><small>{daumEmail ?? "연결되지 않음"}</small></div><button className="ghost-button" onClick={daumEmail ? onDisconnectDaum : onConnectDaum}>{daumEmail ? "연결 해제" : "연결"}</button></div><div className="privacy-note"><strong>개인정보 보호 원칙</strong><p>메일 원문은 저장하지 않습니다. OAuth 토큰과 Daum 앱 비밀번호는 암호화하며 연결 해제 시 관련 인증정보를 삭제합니다.</p></div></article></section>;
}
