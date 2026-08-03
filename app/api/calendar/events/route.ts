import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { decryptToken, encryptToken } from "../../../lib/oauth-crypto";
import { refreshGoogleAccessToken } from "../../../lib/google-oauth";
import { getDb } from "../../../../db";
import { oauthConnections, scheduleCandidates } from "../../../../db/schema";

export const dynamic = "force-dynamic";

function eventEnd(date: string, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  if (hour < 23) return { date, time: `${String(hour + 1).padStart(2, "0")}:${String(minute || 0).padStart(2, "0")}` };
  const nextDate = new Date(`${date}T00:00:00+09:00`);
  nextDate.setDate(nextDate.getDate() + 1);
  return { date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(nextDate), time: `00:${String(minute || 0).padStart(2, "0")}` };
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const { candidateIds = [] } = await request.json() as { candidateIds?: number[] };
  if (!candidateIds.length) return NextResponse.json({ error: "NO_SELECTED_CANDIDATES" }, { status: 400 });
  const db = getDb();
  const [connection] = await db.select().from(oauthConnections).where(and(eq(oauthConnections.userId, user.userId), eq(oauthConnections.provider, "google"))).limit(1);
  const scopes = connection ? JSON.parse(connection.scopes) as string[] : [];
  if (!connection || !scopes.includes("https://www.googleapis.com/auth/calendar.events")) return NextResponse.json({ error: "CALENDAR_PERMISSION_REQUIRED" }, { status: 409 });
  const nonces = JSON.parse(connection.tokenNonce ?? "{}") as { access?: string; refresh?: string };
  if (!connection.encryptedAccessToken || !nonces.access) return NextResponse.json({ error: "GOOGLE_NOT_CONNECTED" }, { status: 409 });
  let accessToken = await decryptToken(connection.encryptedAccessToken, nonces.access);
  if (connection.tokenExpiresAt && Date.parse(connection.tokenExpiresAt) <= Date.now() + 60_000) {
    if (!connection.encryptedRefreshToken || !nonces.refresh) return NextResponse.json({ error: "GOOGLE_RECONNECT_REQUIRED" }, { status: 409 });
    const refreshed = await refreshGoogleAccessToken(await decryptToken(connection.encryptedRefreshToken, nonces.refresh));
    accessToken = refreshed.access_token;
    const encrypted = await encryptToken(accessToken);
    await db.update(oauthConnections).set({ encryptedAccessToken: encrypted.ciphertext, tokenNonce: JSON.stringify({ ...nonces, access: encrypted.nonce }), tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString() }).where(eq(oauthConnections.id, connection.id));
  }
  const candidates = await db.select().from(scheduleCandidates).where(and(eq(scheduleCandidates.userId, user.userId), inArray(scheduleCandidates.id, candidateIds)));
  const registered: number[] = [];
  for (const item of candidates) {
    if (!item.selected || !item.date || !/^\d{2}:\d{2}$/.test(item.time) || item.calendarEventId) continue;
    const end = eventEnd(item.date, item.time);
    const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ summary: item.title, description: `Morrow 일정 후보\n원본 메일: ${item.sourceUrl}`, start: { dateTime: `${item.date}T${item.time}:00`, timeZone: "Asia/Seoul" }, end: { dateTime: `${end.date}T${end.time}:00`, timeZone: "Asia/Seoul" } }),
    });
    if (!response.ok) return NextResponse.json({ error: "CALENDAR_CREATE_FAILED" }, { status: 502 });
    const event = await response.json() as { id: string };
    await db.update(scheduleCandidates).set({ calendarEventId: event.id, updatedAt: new Date().toISOString() }).where(eq(scheduleCandidates.id, item.id));
    registered.push(item.id);
  }
  return NextResponse.json({ registered });
}
