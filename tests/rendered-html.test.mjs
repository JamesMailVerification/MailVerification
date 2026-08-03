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
  assert.doesNotMatch(schema, /appPassword:\s*text|text\("app_password"\)|clientSecret/);
  assert.match(sessionRoute, /getChatGPTUser/);
  assert.match(sessionRoute, /AUTHENTICATION_REQUIRED/);
  assert.match(migration, /FOREIGN KEY \(`user_id`\) REFERENCES `users`\(`id`\)/);
});

test("connects Daum through TLS IMAP without adding SMTP sending", async () => {
  const [imapModule, daumRoute] = await Promise.all([
    readFile(new URL("app/lib/daum-imap.ts", root), "utf8"),
    readFile(new URL("app/api/connections/daum/route.ts", root), "utf8"),
  ]);

  assert.match(imapModule, /imap\.daum\.net/);
  assert.match(imapModule, /port: 993/);
  assert.match(imapModule, /secureTransport: "on"/);
  assert.match(imapModule, /EXAMINE INBOX/);
  assert.match(imapModule, /BODY\.PEEK\[HEADER\.FIELDS/);
  assert.match(imapModule, /BODY\.PEEK\[TEXT\]/);
  assert.match(daumRoute, /encryptToken\(appPassword\)/);
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
