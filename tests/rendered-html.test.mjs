import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps the Smart Mail Scheduler confirmation-first workflow", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /오늘의 업무/);
  assert.match(page, /확인이 필요해요/);
  assert.match(page, /수정하고 선택한 일정만 캘린더에 등록/);
  assert.match(page, /마감 3일 전부터 매일 오전 9시/);
  assert.match(page, /\[확인 필요\]/);
  assert.doesNotMatch(page, /자동 회신|AI 답장/);
});

test("stores identity and connection credentials only in encrypted fields", async () => {
  const [schema, sessionRoute, migration, hosting] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("app/api/session/route.ts", root), "utf8"),
    readFile(new URL("drizzle/0000_even_selene.sql", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
  ]);

  assert.match(hosting, /"d1": "DB"/);
  assert.match(schema, /encryptedAccessToken/);
  assert.match(schema, /encryptedRefreshToken/);
  assert.match(schema, /encryptedAppPassword/);
  assert.match(schema, /passwordNonce/);
  assert.match(schema, /idx_oauth_connections_user_provider/);
  assert.match(schema, /idx_imap_connections_user_email/);
  assert.match(schema, /scheduleCandidates/);
  assert.match(schema, /calendarEventId/);
  assert.doesNotMatch(schema, /appPassword:\s*text|text\("app_password"\)|clientSecret/);
  assert.match(sessionRoute, /getChatGPTUser/);
  assert.match(sessionRoute, /AUTHENTICATION_REQUIRED/);
  assert.match(migration, /FOREIGN KEY \(`user_id`\) REFERENCES `users`\(`id`\)/);
});

test("connects Daum through TLS IMAP without adding SMTP sending", async () => {
  const [imapModule, daumRoute, daumMessagesRoute] = await Promise.all([
    readFile(new URL("app/lib/daum-imap.ts", root), "utf8"),
    readFile(new URL("app/api/connections/daum/route.ts", root), "utf8"),
    readFile(new URL("app/api/daum/messages/route.ts", root), "utf8"),
  ]);

  assert.match(imapModule, /imap\.daum\.net/);
  assert.match(imapModule, /port: 993/);
  assert.match(imapModule, /secureTransport: "on"/);
  assert.match(imapModule, /DEFAULT_DAUM_MAILBOX = "Collie"/);
  assert.match(imapModule, /EXAMINE \$\{quoteImap\(mailboxName\)\}/);
  assert.match(imapModule, /BODY\.PEEK\[HEADER\.FIELDS/);
  assert.match(imapModule, /BODY\.PEEK\[TEXT\]/);
  assert.match(daumRoute, /encryptToken\(appPassword\)/);
  assert.match(daumRoute, /connections/);
  assert.match(daumRoute, /imapConnections\.emailAddress/);
  assert.match(daumRoute, /DAUM_MAILBOX_NOT_FOUND/);
  assert.match(daumRoute, /mailboxName/);
  assert.match(daumMessagesRoute, /Promise\.allSettled\(connections\.map/);
  assert.match(imapModule, /IMAP_MAILBOX_FAILED/);
  assert.doesNotMatch(imapModule, /smtp\.daum\.net|\bSEND\b|\bSTORE\b|\bEXPUNGE\b/i);
});

test("uses read-only Gmail OAuth and returns mail summaries without persisting bodies", async () => {
  const [startRoute, callbackRoute, messagesRoute, cryptoModule, googleModule] = await Promise.all([
    readFile(new URL("app/api/auth/google/start/route.ts", root), "utf8"),
    readFile(new URL("app/api/auth/google/callback/route.ts", root), "utf8"),
    readFile(new URL("app/api/gmail/messages/route.ts", root), "utf8"),
    readFile(new URL("app/lib/oauth-crypto.ts", root), "utf8"),
    readFile(new URL("app/lib/google-oauth.ts", root), "utf8"),
  ]);

  assert.match(googleModule, /gmail\.readonly/);
  assert.match(startRoute, /httpOnly: true/);
  assert.match(callbackRoute, /encryptToken/);
  assert.match(messagesRoute, /format", "metadata"/);
  assert.match(messagesRoute, /storedBody: false/);
  assert.doesNotMatch(messagesRoute, /db\.insert\([^)]*message/i);
  assert.match(cryptoModule, /AES-GCM/);
});

test("builds review-first candidates from real mail summaries instead of demo candidates", async () => {
  const [page, extractor, route] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/lib/schedule-extractor.ts", root), "utf8"),
    readFile(new URL("app/api/candidates/extract/route.ts", root), "utf8"),
  ]);

  assert.match(page, /const initialCandidates: Candidate\[\] = \[\]/);
  assert.match(page, /\/api\/candidates\/extract/);
  assert.match(extractor, /sourceUrl: message\.sourceUrl/);
  assert.match(extractor, /function conciseTitle/);
  assert.match(extractor, /(?:re\|fw\|fwd)/i);
  assert.match(extractor, /value\.length <= 60/);
  assert.match(extractor, /title: conciseTitle\(message\.subject, type\)/);
  assert.match(extractor, /email: message\.subject/);
  assert.match(extractor, /timeAmbiguous: time\.ambiguous/);
  assert.match(extractor, /endTime: time\.endValue/);
  assert.match(extractor, /todayInKorea\(\)/);
  assert.match(extractor, /clockRange/);
  assert.match(extractor, /needsReview: date\.ambiguous \|\| time\.ambiguous/);
  assert.match(extractor, /\\\(광고\\\)/);
  assert.doesNotMatch(page, /label: "메일 분석", badge: "12"/);
  assert.match(page, /scopedMessageCount/);
  assert.match(page, /업무 확인 대상/);
  assert.match(page, /className="mail-row"/);
  assert.match(page, /Daum Mail/);
  assert.match(page, /＋ 메일 추가/);
  assert.match(page, /추가할 메일 종류를 선택하세요/);
  assert.match(page, /daumConnections\.map/);
  assert.match(page, /조회할 내 메일함/);
  assert.match(page, /CollieGolf/);
  assert.match(page, /Daum 메일 설정에서 발급받은 앱 비밀번호/);
  assert.match(page, /이 앱은 비밀번호를 자동 생성하지 않습니다/);
  assert.doesNotMatch(page, /autoComplete="new-password"|Morrow 전용 앱 비밀번호/);
  assert.match(page, /type AnalysisScope = "today" \| "unread" \| "recent7" \| "recent30"/);
  assert.match(page, /\{ id: "recent30", label: "최근 한 달" \}/);
  assert.match(page, /filterMessagesByScope/);
  assert.match(page, /aria-pressed=\{scope === option\.id\}/);
  assert.match(page, /className="all-day-toggle"/);
  assert.match(page, /toggleAllDay/);
  assert.match(page, /checked=\{allDay\}/);
  assert.match(page, /현재 Morrow 로그인 계정/);
  assert.match(page, /연결된 메일 관리/);
  assert.match(page, /메일 계정 추가/);
  assert.match(page, /\/signout-with-chatgpt\?return_to=%2F/);
  assert.match(page, /const todayItems = candidates\.filter/);
  assert.match(page, /오늘 받은 메일 \{todayMailCount\}개/);
  assert.doesNotMatch(page, /value: "3", label: "오늘 할 일"/);
  assert.doesNotMatch(page, /프로젝트 범위 확인 회신|파트너사 킥오프 미팅/);
  assert.match(page, /body: JSON\.stringify\(\{ messages: scopedMessages \}\)/);
  assert.match(page, /fetch\("\/api\/candidates"\)/);
  assert.match(page, /fetch\("\/api\/calendar\/events"/);
  assert.match(route, /getChatGPTUser/);
  assert.match(route, /storedBody: false/);
});

test("renders registered Google Calendar events in the correct dynamic month cell", async () => {
  const [page, calendarRoute] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/calendar/events/route.ts", root), "utf8"),
  ]);

  assert.match(page, /const \[visibleMonth, setVisibleMonth\] = useState/);
  assert.match(page, /item\.date === cell\.dateKey/);
  assert.match(page, /cell\.dateKey === todayKey/);
  assert.doesNotMatch(page, /day===3|<h1>8월 일정<\/h1>/);
  assert.match(calendarRoute, /calendar\.events/);
  assert.match(calendarRoute, /CANDIDATE_DATE_TIME_REQUIRED/);
  assert.match(calendarRoute, /submittedById/);
  assert.match(calendarRoute, /selected: true, needsReview: false, calendarEventId/);
  assert.match(page, /candidates: selected\.map/);
  assert.match(page, /GOOGLE_CALENDAR_PERMISSION_DENIED/);
  assert.match(page, /GOOGLE_CALENDAR_API_DISABLED/);
  assert.match(page, /registering \? "등록 중…" : "최종 등록"/);
  assert.match(calendarRoute, /accessNotConfigured/);
  assert.match(calendarRoute, /GOOGLE_CALENDAR_UNREACHABLE/);
  assert.match(calendarRoute, /GOOGLE_RECONNECT_REQUIRED/);
  assert.match(calendarRoute, /\+ 180/);
  assert.match(calendarRoute, /start: \{ date \}/);
  assert.match(calendarRoute, /end: \{ date: nextDate\(date\) \}/);
  assert.match(calendarRoute, /explicitEventEnd/);
  assert.match(calendarRoute, /submitted\?\.endTime/);
  assert.match(page, /<span>종일<\/span>/);
  assert.match(page, /종료 시간/);
  assert.match(page, /endTime: item\.endTime/);
  assert.match(page, /const openRegistration/);
  assert.match(page, /type="time"/);
  assert.match(page, /field-warning/);
  assert.doesNotMatch(calendarRoute, /!item\.selected/);
});
