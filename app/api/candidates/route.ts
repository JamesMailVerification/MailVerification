import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { scheduleCandidates } from "../../../db/schema";

export const dynamic = "force-dynamic";

const listForUser = (userId: string) => getDb().select().from(scheduleCandidates).where(eq(scheduleCandidates.userId, userId));

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  return NextResponse.json({ candidates: await listForUser(user.userId) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const body = await request.json() as { candidates?: Array<Record<string, unknown>> };
  const candidates = body.candidates ?? [];
  if (candidates.some((item) => String(item.sourceUrl ?? "").startsWith("https://mail.daum.net/#morrow-"))) {
    // Remove only stale, unregistered rows created before Daum messages had
    // unique URLs. Registered calendar entries must never be deleted here.
    await getDb().delete(scheduleCandidates).where(and(
      eq(scheduleCandidates.userId, user.userId),
      eq(scheduleCandidates.sourceUrl, "https://mail.daum.net/"),
      isNull(scheduleCandidates.calendarEventId),
    ));
  }
  for (const item of candidates) {
    const values = {
      userId: user.userId,
      title: String(item.title ?? ""), type: String(item.type ?? "기타"), sender: String(item.sender ?? ""),
      email: String(item.email ?? ""), sourceUrl: String(item.sourceUrl ?? ""), summary: String(item.summary ?? "").slice(0, 100),
      location: String(item.location ?? "").slice(0, 100), receivedAt: String(item.receivedAt ?? "").slice(0, 100), accountEmail: String(item.accountEmail ?? "").slice(0, 320), date: String(item.date ?? ""), endDate: String(item.endDate ?? item.date ?? ""),
      time: String(item.time ?? ""), endTime: String(item.endTime ?? ""), deadline: item.deadline ? String(item.deadline) : null,
      timeAmbiguous: Boolean(item.timeAmbiguous),
      needsReview: Boolean(item.needsReview), updatedAt: new Date().toISOString(),
    };
    if (!values.title || !values.sourceUrl) continue;
    await getDb().insert(scheduleCandidates).values(values).onConflictDoUpdate({
      target: [scheduleCandidates.userId, scheduleCandidates.sourceUrl, scheduleCandidates.title],
      set: { type: values.type, sender: values.sender, email: values.email, summary: values.summary, location: values.location, receivedAt: values.receivedAt, accountEmail: values.accountEmail, date: values.date, endDate: values.endDate, time: values.time, endTime: values.endTime, timeAmbiguous: values.timeAmbiguous, deadline: values.deadline, needsReview: values.needsReview, updatedAt: values.updatedAt },
    });
  }
  return NextResponse.json({ candidates: await listForUser(user.userId) });
}

export async function PATCH(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const body = await request.json() as { id?: number; changes?: Record<string, unknown> };
  if (!body.id) return NextResponse.json({ error: "INVALID_CANDIDATE" }, { status: 400 });
  const allowed = ["title", "date", "endDate", "time", "endTime", "timeAmbiguous", "needsReview", "selected", "completed"] as const;
  const changes: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) if (body.changes && key in body.changes) changes[key] = body.changes[key];
  if ("time" in changes && !(body.changes && "timeAmbiguous" in body.changes)) {
    changes.timeAmbiguous = false;
    if (changes.time || body.changes?.date) changes.needsReview = false;
  }
  await getDb().update(scheduleCandidates).set(changes).where(and(eq(scheduleCandidates.id, body.id), eq(scheduleCandidates.userId, user.userId)));
  return NextResponse.json({ updated: true });
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  await getDb().delete(scheduleCandidates).where(and(eq(scheduleCandidates.id, id), eq(scheduleCandidates.userId, user.userId)));
  return NextResponse.json({ deleted: true });
}
