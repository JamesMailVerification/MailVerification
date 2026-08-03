import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Smart Mail Scheduler dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Morrow · Smart Mail Scheduler/);
  assert.match(html, /오늘의 업무/);
  assert.match(html, /확인이 필요해요/);
  assert.match(html, /새 메일 확인하기/);
  assert.match(html, /메일 속 일정과 답변 기한/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("communicates confirmation-first calendar behavior", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /확인한 일정만 캘린더에 등록/);
  assert.match(html, /확인 필요/);
  assert.match(html, /불명확해요/);
});
