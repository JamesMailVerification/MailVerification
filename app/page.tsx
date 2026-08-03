"use client";

import { useEffect, useMemo, useState } from "react";

type Candidate = {
  id: number;
  title: string;
  type: string;
  sender: string;
  email: string;
  date: string;
  time: string;
  deadline?: string;
  needsReview?: boolean;
  selected: boolean;
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
};

const initialCandidates: Candidate[] = [
  { id: 1, title: "파트너사 킥오프 미팅", type: "회의", sender: "김민지 · Northstar", email: "프로젝트 킥오프 일정 안내", date: "2026-08-04", time: "14:00", selected: true },
  { id: 2, title: "Q3 제안서 피드백 회신", type: "회신", sender: "Alex Morgan · Pilotworks", email: "Re: Q3 Proposal Review", date: "2026-08-05", time: "오전 중", deadline: "8월 5일까지", needsReview: true, selected: false },
  { id: 3, title: "PoC 결과 보고서 제출", type: "자료 제출", sender: "이서준 · Vanta Labs", email: "PoC 최종 산출물 제출 요청", date: "2026-08-06", time: "17:00", deadline: "8월 6일 17:00", selected: true },
  { id: 4, title: "서비스 계약 갱신 검토", type: "계약", sender: "박소연 · Legal", email: "2026 서비스 계약 갱신 건", date: "2026-08-08", time: "", deadline: "다음 주까지", needsReview: true, selected: false },
];

const navItems = [
  { id: "dashboard", icon: "⌂", label: "오늘의 업무" },
  { id: "inbox", icon: "↙", label: "메일 분석", badge: "12" },
  { id: "candidates", icon: "◇", label: "일정 후보", badge: "4" },
  { id: "calendar", icon: "□", label: "캘린더" },
];

export default function Home() {
  const [active, setActive] = useState("dashboard");
  const [candidates, setCandidates] = useState(initialCandidates);
  const [connected, setConnected] = useState<"gmail" | "outlook" | null>(null);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [sessionUser, setSessionUser] = useState({ displayName: "사용자", email: "로그인 확인 중…" });
  const [analyzing, setAnalyzing] = useState(false);
  const [gmailMessages, setGmailMessages] = useState<GmailMessageSummary[]>([]);
  const [toast, setToast] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [completed, setCompleted] = useState<number[]>([]);

  const selected = candidates.filter((item) => item.selected);
  const reviewCount = candidates.filter((item) => item.needsReview).length;
  const todayLabel = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date(2026, 7, 3));

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

  const startAnalysis = async () => {
    if (!connected) {
      showToast("먼저 이메일 계정을 연결해 주세요.");
      return;
    }
    if (connected !== "gmail") {
      showToast("이번 단계에서는 Gmail 조회만 지원합니다.");
      return;
    }
    setAnalyzing(true);
    setActive("inbox");
    try {
      const response = await fetch("/api/gmail/messages");
      const data = await response.json() as { messages?: GmailMessageSummary[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "GMAIL_READ_FAILED");
      setGmailMessages(data.messages ?? []);
      showToast(`최근 Gmail ${(data.messages ?? []).length}개를 불러왔습니다.`);
    } catch {
      showToast("Gmail을 불러오지 못했습니다. 연결 상태를 확인해 주세요.");
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleCandidate = (id: number) => {
    setCandidates((items) => items.map((item) => item.id === id ? { ...item, selected: !item.selected } : item));
  };

  const completeTask = (id: number) => {
    setCompleted((items) => [...items, id]);
    showToast("완료 처리했습니다. 반복 알림에서 제외됩니다.");
  };

  const stats = useMemo(() => [
    { value: "3", label: "오늘 할 일", note: "1개 완료", tone: "green" },
    { value: "2", label: "회신 필요", note: "오후 5시 전", tone: "coral" },
    { value: "2", label: "다가오는 회의", note: "다음 3일", tone: "blue" },
    { value: String(reviewCount), label: "확인 필요", note: "날짜·시간 검토", tone: "amber" },
  ], [reviewCount]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setActive("dashboard")} aria-label="홈으로 이동">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><strong>morrow</strong><small>MAIL SCHEDULER</small></span>
        </button>

        <nav aria-label="주 메뉴">
          <p className="nav-label">WORKSPACE</p>
          {navItems.map((item) => (
            <button key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => setActive(item.id)}>
              <span className="nav-icon">{item.icon}</span>{item.label}
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className={`status-dot ${connected ? "online" : ""}`} />
            <div><strong>{connected ? "Gmail 연결됨" : "메일 연결 필요"}</strong><small>{connected ? "마지막 동기화 3분 전" : "분석을 시작할 수 없습니다"}</small></div>
            <button aria-label="연결 설정" onClick={() => setActive("settings")}>···</button>
          </div>
          <div className="profile">
            <span className="avatar">{sessionUser.displayName.slice(0, 2).toUpperCase()}</span>
            <div><strong>{sessionUser.displayName}</strong><small>{sessionUser.email}</small></div>
            <button aria-label="프로필 메뉴">⌄</button>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand">morrow</div>
          <div className="top-actions">
            <button className="icon-button" aria-label="검색">⌕</button>
            <button className="icon-button notification" aria-label="알림">♧<span /></button>
            <button className="primary-button compact" onClick={startAnalysis} disabled={analyzing}>
              {analyzing ? <><span className="spinner" />분석 중</> : <>＋ 메일 분석</>}
            </button>
          </div>
        </header>

        <div className="content">
          {active === "dashboard" && (
            <Dashboard
              todayLabel={todayLabel}
              stats={stats}
              completed={completed}
              onComplete={completeTask}
              onAnalyze={startAnalysis}
              analyzing={analyzing}
              onViewCandidates={() => setActive("candidates")}
            />
          )}

          {active === "inbox" && (
            <AnalysisView connected={connected} connectedEmail={connectedEmail} analyzing={analyzing} messages={gmailMessages} onAnalyze={startAnalysis} onConnect={setConnected} />
          )}

          {active === "candidates" && (
            <CandidatesView candidates={candidates} selectedCount={selected.length} onToggle={toggleCandidate} onUpdate={setCandidates} onRegister={() => setConfirmOpen(true)} />
          )}

          {active === "calendar" && <CalendarView />}
          {active === "settings" && <SettingsView connected={connected} connectedEmail={connectedEmail} onConnect={setConnected} onDisconnected={() => setConnectedEmail(null)} onNotice={showToast} />}
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
              {selected.map((item) => <div key={item.id}><span>{item.date.slice(5).replace("-", ".")}</span><strong>{item.title}</strong><small>{item.time || "[확인 필요]"}</small></div>)}
            </div>
            <div className="reminder-row"><span>◷</span><div><strong>알림 정책</strong><small>마감 3일 전부터 매일 오전 9시 · 완료 전까지</small></div></div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setConfirmOpen(false)}>취소</button>
              <button className="primary-button" onClick={() => { setConfirmOpen(false); setActive("dashboard"); showToast(`${selected.length}개 일정을 등록했습니다.`); }}>최종 등록</button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Dashboard({ todayLabel, stats, completed, onComplete, onAnalyze, analyzing, onViewCandidates }: { todayLabel: string; stats: {value:string;label:string;note:string;tone:string}[]; completed:number[]; onComplete:(id:number)=>void; onAnalyze:()=>void; analyzing:boolean; onViewCandidates:()=>void }) {
  const tasks = [
    { id: 11, time: "10:30", type: "회신", title: "프로젝트 범위 확인 회신", person: "김민지 · Northstar", tag: "오늘 마감", urgent: true },
    { id: 12, time: "14:00", type: "회의", title: "파트너사 킥오프 미팅", person: "Google Meet · 45분", tag: "1시간 전 알림" },
    { id: 13, time: "17:00", type: "제출", title: "월간 성과 보고서 제출", person: "이서준 · Vanta Labs", tag: "오늘 마감", urgent: true },
  ];
  return <>
    <section className="hero-row">
      <div><p className="eyebrow">MONDAY · AUGUST 03</p><h1>좋은 오후예요, 박인환님.</h1><p>{todayLabel} · 중요한 일정부터 차근차근 정리해 볼까요?</p></div>
      <button className="primary-button" onClick={onAnalyze} disabled={analyzing}>{analyzing ? <><span className="spinner" />메일 확인 중</> : <>✦ 새 메일 확인하기</>}</button>
    </section>

    <section className="stats-grid">
      {stats.map((stat) => <article className="stat-card" key={stat.label}><span className={`stat-accent ${stat.tone}`} /><div><strong>{stat.value}</strong><p>{stat.label}</p><small>{stat.note}</small></div><span className="stat-arrow">↗</span></article>)}
    </section>

    <section className="main-grid">
      <article className="panel schedule-panel">
        <div className="panel-header"><div><p className="eyebrow">TODAY</p><h2>오늘의 일정</h2></div><button className="text-button">전체 보기 →</button></div>
        <div className="task-list">
          {tasks.map((task) => {
            const isDone = completed.includes(task.id);
            return <div className={`task-row ${isDone ? "done" : ""}`} key={task.id}>
              <div className="task-time"><strong>{task.time}</strong><span>{task.type}</span></div>
              <span className={`timeline-dot ${task.urgent ? "urgent" : ""}`} />
              <div className="task-main"><strong>{task.title}</strong><small>{task.person}</small></div>
              <span className={`pill ${task.urgent ? "danger" : "soft"}`}>{task.tag}</span>
              <button className="check-button" onClick={() => onComplete(task.id)} aria-label={`${task.title} 완료`}>{isDone ? "✓" : ""}</button>
            </div>;
          })}
        </div>
        <div className="completion-line"><span style={{width:`${completed.length / 3 * 100}%`}} /><small>{completed.length}/3 완료</small></div>
      </article>

      <aside className="side-stack">
        <article className="panel review-panel">
          <div className="panel-header"><div><p className="eyebrow coral">NEEDS REVIEW</p><h2>확인이 필요해요</h2></div><span className="count-badge">2</span></div>
          <button className="review-item" onClick={onViewCandidates}><span className="date-tile">05<small>AUG</small></span><span><strong>Q3 제안서 피드백 회신</strong><small>시간이 “오전 중”으로 불명확해요.</small></span><b>›</b></button>
          <button className="review-item" onClick={onViewCandidates}><span className="date-tile">08<small>AUG</small></span><span><strong>서비스 계약 갱신 검토</strong><small>종료 시간이 지정되지 않았어요.</small></span><b>›</b></button>
          <button className="wide-outline" onClick={onViewCandidates}>2개 항목 확인하기</button>
        </article>

        <article className="panel inbox-panel">
          <div className="mail-art"><span>✉</span><i /><i /></div>
          <div><p className="eyebrow">INBOX PULSE</p><h3>메일함은 잘 정리되고 있어요</h3><p>오늘 받은 메일 28개 중<br/><strong>4개의 일정 후보</strong>를 찾았어요.</p></div>
        </article>
      </aside>
    </section>
  </>;
}

function AnalysisView({ connected, connectedEmail, analyzing, messages, onAnalyze, onConnect }: { connected:string|null; connectedEmail:string|null; analyzing:boolean; messages:GmailMessageSummary[]; onAnalyze:()=>void; onConnect:(value:"gmail"|"outlook"|null)=>void }) {
  return <section className="view-page">
    <div className="view-heading"><p className="eyebrow">EMAIL ANALYSIS</p><h1>메일에서 중요한 일정을 찾아볼게요.</h1><p>승인한 범위의 메일만 읽고, 원문은 별도로 저장하지 않습니다.</p></div>
    <div className="analysis-layout">
      <article className="panel connect-panel"><span className="provider-logo gmail">M</span><div><h2>Gmail</h2><p>{connected === "gmail" ? connectedEmail ?? "Google 계정 · 연결됨" : "읽기 전용 권한으로 안전하게 연결합니다."}</p></div><button className={connected === "gmail" ? "connected-button" : "primary-button"} onClick={() => { if (connected !== "gmail") window.location.href = "/api/auth/google/start"; }}>{connected === "gmail" ? "✓ 연결됨" : "연결하기"}</button></article>
      <article className="panel connect-panel"><span className="provider-logo outlook">O</span><div><h2>Microsoft Outlook</h2><p>{connected === "outlook" ? "업무 계정 · 연결됨" : "Microsoft 계정과 캘린더를 연결하세요."}</p></div><button className={connected === "outlook" ? "connected-button" : "ghost-button"} onClick={() => onConnect(connected === "outlook" ? null : "outlook")}>{connected === "outlook" ? "✓ 연결됨" : "연결하기"}</button></article>
    </div>
    <article className="panel analysis-box">
      <div className={`scan-visual ${analyzing ? "scanning" : ""}`}><span>✉</span><i /></div>
      <h2>{analyzing ? "메일을 살펴보고 있어요…" : "분석할 범위를 확인해 주세요"}</h2>
      <p>{analyzing ? "일정, 회신 요청, 제출 기한을 안전하게 추출하고 있습니다." : "오늘 받은 메일 28개 · 읽지 않은 메일 12개"}</p>
      <div className="scope-chips"><span>오늘 받은 메일</span><span>읽지 않은 메일</span><span>최근 7일</span></div>
      <button className="primary-button" onClick={onAnalyze} disabled={analyzing}>{analyzing ? <><span className="spinner" />28개 메일 분석 중</> : "메일 분석 시작"}</button>
    </article>
    {messages.length > 0 && <article className="panel analysis-box">
      <div className="panel-header"><div><p className="eyebrow">GMAIL · 최근 7일</p><h2>조회한 메일 {messages.length}개</h2></div></div>
      <div className="task-list">
        {messages.map((message) => <a className="task-row" href={message.sourceUrl} target="_blank" rel="noreferrer" key={message.id}>
          <span className={`timeline-dot ${message.unread ? "urgent" : ""}`} />
          <span className="task-main"><strong>{message.subject}</strong><small>{message.from}</small><small>{message.snippet}</small></span>
          <span className="pill soft">{message.unread ? "읽지 않음" : "읽음"}</span>
        </a>)}
      </div>
    </article>}
  </section>;
}

function CandidatesView({ candidates, selectedCount, onToggle, onUpdate, onRegister }: { candidates:Candidate[]; selectedCount:number; onToggle:(id:number)=>void; onUpdate:(items:Candidate[])=>void; onRegister:()=>void }) {
  const update = (id:number, field:keyof Candidate, value:string) => onUpdate(candidates.map((item) => item.id === id ? {...item, [field]: value, needsReview: field === "time" && value ? false : item.needsReview} : item));
  const remove = (id:number) => onUpdate(candidates.filter((item) => item.id !== id));
  return <section className="view-page candidates-page">
    <div className="view-heading inline"><div><p className="eyebrow">SCHEDULE CANDIDATES</p><h1>찾은 일정 후보를 확인해 주세요.</h1><p>수정하고 선택한 일정만 캘린더에 등록됩니다.</p></div><button className="primary-button" disabled={!selectedCount} onClick={onRegister}>{selectedCount}개 일정 등록</button></div>
    <div className="candidate-toolbar"><span><strong>{candidates.length}</strong>개의 후보</span><div><button className="filter active">전체</button><button className="filter">확인 필요</button><button className="filter">선택됨</button></div></div>
    <div className="candidate-list">
      {candidates.map((item) => <article className={`candidate-card ${item.selected ? "selected" : ""}`} key={item.id}>
        <button className={`select-box ${item.selected ? "checked" : ""}`} onClick={() => onToggle(item.id)} aria-label={`${item.title} 선택`}>{item.selected ? "✓" : ""}</button>
        <div className="candidate-date"><strong>{item.date.slice(8)}</strong><span>{item.date.slice(5,7)}월</span></div>
        <div className="candidate-content">
          <div className="candidate-title"><span className="type-pill">{item.type}</span>{item.needsReview && <span className="pill danger">확인 필요</span>}</div>
          <input aria-label="일정 제목" value={item.title} onChange={(event) => update(item.id, "title", event.target.value)} />
          <p>{item.sender} · <a href={`mailto:${item.sender}`}>{item.email} ↗</a></p>
        </div>
        <div className="candidate-fields"><label>날짜<input type="date" value={item.date} onChange={(event) => update(item.id, "date", event.target.value)} /></label><label>시간<input value={item.time} placeholder="[확인 필요]" onChange={(event) => update(item.id, "time", event.target.value)} /></label></div>
        <button className="delete-button" onClick={() => remove(item.id)} aria-label="일정 후보 삭제">×</button>
      </article>)}
    </div>
    {!candidates.length && <div className="empty-state"><span>◇</span><h2>일정 후보가 없어요</h2><p>새 메일을 분석하면 이곳에 후보가 표시됩니다.</p></div>}
  </section>;
}

function CalendarView() {
  const days = Array.from({length:35}, (_,i) => i - 2);
  return <section className="view-page"><div className="view-heading inline"><div><p className="eyebrow">CALENDAR</p><h1>8월 일정</h1><p>사용자가 확인하고 등록한 일정만 표시됩니다.</p></div><div className="month-nav"><button>‹</button><strong>2026년 8월</strong><button>›</button></div></div><article className="panel calendar-grid"><div className="weekdays">{["일","월","화","수","목","금","토"].map(d=><span key={d}>{d}</span>)}</div><div className="days">{days.map((day,i)=><div className={day<1 || day>31 ? "muted-day" : day===3 ? "today" : ""} key={i}><b>{day<1 ? 31+day : day>31 ? day-31 : day}</b>{day===4&&<span className="calendar-event green">14:00 킥오프</span>}{day===5&&<span className="calendar-event coral">제안서 회신</span>}{day===6&&<span className="calendar-event amber">17:00 보고서</span>}</div>)}</div></article></section>;
}

function SettingsView({ connected, connectedEmail, onConnect, onDisconnected, onNotice }: {connected:string|null;connectedEmail:string|null;onConnect:(value:"gmail"|"outlook"|null)=>void;onDisconnected:()=>void;onNotice:(message:string)=>void}) {
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

  return <section className="view-page"><div className="view-heading"><p className="eyebrow">CONNECTIONS</p><h1>연결 및 개인정보</h1><p>메일과 캘린더 접근 권한을 언제든 관리할 수 있습니다.</p></div><article className="panel settings-panel"><h2>연결된 계정</h2><div className="setting-row"><span className="provider-logo gmail">M</span><div><strong>Google Workspace</strong><small>{connected === "gmail" ? connectedEmail ?? "Google 계정 · 연결됨" : "연결되지 않음"}</small></div><button className="ghost-button" onClick={handleGoogleConnection}>{connected === "gmail" ? "연결 해제" : "연결"}</button></div><div className="privacy-note"><strong>개인정보 보호 원칙</strong><p>비밀번호와 메일 원문은 저장하지 않습니다. OAuth 최소 권한을 사용하며 연결 해제 시 관련 접근 권한을 삭제합니다.</p></div></article></section>;
}
