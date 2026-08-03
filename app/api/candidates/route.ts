import { and, eq } from "drizzle-orm";
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
  for (const item of body.candidates ?? []) {
    const values = {
      userId: user.userId,
      title: String(item.title ?? ""), type: String(item.type ?? "기타"), sender: String(item.sender ?? ""),
      email: String(item.email ?? ""), sourceUrl: String(item.sourceUrl ?? ""), date: String(item.date ?? ""),
      time: String(item.time ?? ""), deadline: item.deadline ? String(item.deadline) : null,
      needsReview: Boolean(item.needsReview), updatedAt: new Date().toISOString(),
    };
    if (!values.title || !values.sourceUrl) continue;
    await getDb().insert(scheduleCandidates).values(values).onConflictDoUpdate({
      target: [scheduleCandidates.userId, scheduleCandidates.sourceUrl, scheduleCandidates.title],
      set: { type: values.type, sender: values.sender, email: values.email, date: values.date, time: values.time, deadline: values.deadline, needsReview: values.needsReview, updatedAt: values.updatedAt },
    });
  }
  return NextResponse.json({ candidates: await listForUser(user.userId) });
}

export async function PATCH(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const body = await request.json() as { id?: number; changes?: Record<string, unknown> };
  if (!body.id) return NextResponse.json({ error: "INVALID_CANDIDATE" }, { status: 400 });
  const allowed = ["title", "date", "time", "selected", "completed"] as const;
  const changes: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) if (body.changes && key in body.changes) changes[key] = body.changes[key];
  if ("time" in changes && changes.time) changes.needsReview = false;
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
