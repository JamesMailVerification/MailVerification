import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { extractScheduleCandidates, type ExtractableMessage } from "../../../lib/schedule-extractor";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const body = await request.json() as { messages?: ExtractableMessage[] };
  if (!Array.isArray(body.messages)) return NextResponse.json({ error: "INVALID_MESSAGES" }, { status: 400 });
  const messages = body.messages.slice(0, 100).map((message) => ({
    id: String(message.id ?? ""),
    subject: String(message.subject ?? "").slice(0, 500),
    from: String(message.from ?? "").slice(0, 500),
    receivedAt: String(message.receivedAt ?? "").slice(0, 100),
    snippet: String(message.snippet ?? "").slice(0, 1500),
    sourceUrl: String(message.sourceUrl ?? "").slice(0, 1000),
    provider: message.provider === "daum" ? "daum" as const : "gmail" as const,
  }));
  return NextResponse.json({ candidates: extractScheduleCandidates(messages), storedBody: false });
}
