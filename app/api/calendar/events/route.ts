import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { decryptToken, encryptToken } from "../../../lib/oauth-crypto";
import { refreshGoogleAccessToken } from "../../../lib/google-oauth";
import { getDb } from "../../../../db";
import { oauthConnections, scheduleCandidates } from "../../../../db/schema";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
  pragma: "no-cache",
  expires: "0",
};

type GoogleApiError = {
  error?: {
    status?: string;
    errors?: Array<{ reason?: string }>;
  };
};

function googleCalendarError(response: Response, body: GoogleApiError | null) {
  const reason = body?.error?.errors?.[0]?.reason;
  if (reason === "accessNotConfigured" || reason === "serviceDisabled") {
    return { error: "GOOGLE_CALENDAR_API_DISABLED", status: 503 };
  }
  if (response.status === 401 || reason === "authError") {
    return { error: "GOOGLE_RECONNECT_REQUIRED", status: 409 };
  }
  if (response.status === 403) {
    return { error: "GOOGLE_CALENDAR_PERMISSION_DENIED", status: 409 };
  }
  if (body?.error?.status === "FAILED_PRECONDITION") {
    return { error: "GOOGLE_CALENDAR_UNAVAILABLE", status: 409 };
  }
  return { error: "CALENDAR_CREATE_FAILED", status: 502 };
}

function eventEnd(date: string, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const totalMinutes = hour * 60 + minute + 180;
  const dayOffset = Math.floor(totalMinutes / 1440);
  const endDate = new Date(`${date}T00:00:00+09:00`);
  endDate.setDate(endDate.getDate() + dayOffset);
  return {
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(endDate),
    time: `${String(Math.floor((totalMinutes % 1440) / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`,
  };
}

function explicitEventEnd(date: string, startTime: string, endTime: string) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const endDate = endHour * 60 + endMinute <= startHour * 60 + startMinute ? nextDate(date) : date;
  return { date: endDate, time: endTime };
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00+09:00`);
  value.setDate(value.getDate() + 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

async function verifyCalendarEvent(createUrl: string, eventId: string, accessToken: string) {
  const verifyUrl = new URL(`${createUrl}/${encodeURIComponent(eventId)}`);
  verifyUrl.searchParams.set("fields", "id,status,htmlLink");
  const delays = [0, 250, 750];
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(verifyUrl, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!response.ok) continue;
      const event = await response.json() as { id?: string; status?: string; htmlLink?: string };
      if (event.id === eventId && event.status !== "cancelled") return event;
    } catch {
      // A short Google propagation or network delay is retried below.
    }
  }
  return null;
}

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  htmlLink?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

function koreaDateTime(value: string) {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date),
    time: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date),
  };
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const requestedMonth = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(requestedMonth)) return NextResponse.json({ error: "INVALID_MONTH" }, { status: 400 });

  const db = getDb();
  const [connection] = await db.select().from(oauthConnections).where(and(eq(oauthConnections.userId, user.userId), eq(oauthConnections.provider, "google"))).limit(1);
  const scopes = connection ? JSON.parse(connection.scopes) as string[] : [];
  if (!connection || !scopes.includes("https://www.googleapis.com/auth/calendar.events")) return NextResponse.json({ error: "CALENDAR_PERMISSION_REQUIRED" }, { status: 409 });
  const nonces = JSON.parse(connection.tokenNonce ?? "{}") as { access?: string; refresh?: string };
  if (!connection.encryptedAccessToken || !nonces.access) return NextResponse.json({ error: "GOOGLE_NOT_CONNECTED" }, { status: 409 });

  let accessToken = await decryptToken(connection.encryptedAccessToken, nonces.access);
  if (connection.tokenExpiresAt && Date.parse(connection.tokenExpiresAt) <= Date.now() + 60_000) {
    if (!connection.encryptedRefreshToken || !nonces.refresh) return NextResponse.json({ error: "GOOGLE_RECONNECT_REQUIRED" }, { status: 409 });
    try {
      const refreshed = await refreshGoogleAccessToken(await decryptToken(connection.encryptedRefreshToken, nonces.refresh));
      accessToken = refreshed.access_token;
      const encrypted = await encryptToken(accessToken);
      await db.update(oauthConnections).set({ encryptedAccessToken: encrypted.ciphertext, tokenNonce: JSON.stringify({ ...nonces, access: encrypted.nonce }), tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString() }).where(eq(oauthConnections.id, connection.id));
    } catch {
      return NextResponse.json({ error: "GOOGLE_RECONNECT_REQUIRED" }, { status: 409 });
    }
  }

  const [requestedYear, requestedMonthNumber] = requestedMonth.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(requestedYear, requestedMonthNumber, 1));
  const nextMonthKey = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const listUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  listUrl.search = new URLSearchParams({
    timeMin: new Date(`${requestedMonth}-01T00:00:00+09:00`).toISOString(),
    timeMax: new Date(`${nextMonthKey}T00:00:00+09:00`).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    timeZone: "Asia/Seoul",
  }).toString();

  let response: Response;
  try {
    response = await fetch(listUrl, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  } catch {
    return NextResponse.json({ error: "GOOGLE_CALENDAR_UNREACHABLE" }, { status: 503 });
  }
  if (!response.ok) {
    const googleError = await response.json().catch(() => null) as GoogleApiError | null;
    const mapped = googleCalendarError(response, googleError);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  const data = await response.json() as { items?: GoogleCalendarEvent[] };
  const events = (data.items ?? []).filter((event) => event.status !== "cancelled" && event.start && event.end).map((event) => {
    const allDay = Boolean(event.start?.date);
    const start = allDay ? { date: event.start?.date ?? "", time: "" } : koreaDateTime(event.start?.dateTime ?? "");
    const end = allDay ? { date: event.end?.date ?? "", time: "" } : koreaDateTime(event.end?.dateTime ?? "");
    return { id: event.id, title: event.summary || "(제목 없음)", htmlLink: event.htmlLink ?? "", allDay, date: start.date, time: start.time, endDate: end.date, endTime: end.time };
  });
  return NextResponse.json({ events, calendar: "primary", timeZone: "Asia/Seoul", syncedAt: new Date().toISOString() }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const { candidateIds = [], candidates: submittedCandidates = [] } = await request.json() as {
    candidateIds?: number[];
    candidates?: Array<{ id: number; title: string; date: string; time: string; endTime: string; timeAmbiguous: boolean; needsReview: boolean }>;
  };
  if (!candidateIds.length) return NextResponse.json({ error: "NO_SELECTED_CANDIDATES" }, { status: 400 });
  const submittedById = new Map(submittedCandidates.map((item) => [item.id, item]));
  const db = getDb();
  const [connection] = await db.select().from(oauthConnections).where(and(eq(oauthConnections.userId, user.userId), eq(oauthConnections.provider, "google"))).limit(1);
  const scopes = connection ? JSON.parse(connection.scopes) as string[] : [];
  if (!connection || !scopes.includes("https://www.googleapis.com/auth/calendar.events")) return NextResponse.json({ error: "CALENDAR_PERMISSION_REQUIRED" }, { status: 409 });
  const nonces = JSON.parse(connection.tokenNonce ?? "{}") as { access?: string; refresh?: string };
  if (!connection.encryptedAccessToken || !nonces.access) return NextResponse.json({ error: "GOOGLE_NOT_CONNECTED" }, { status: 409 });
  let accessToken = await decryptToken(connection.encryptedAccessToken, nonces.access);
  if (connection.tokenExpiresAt && Date.parse(connection.tokenExpiresAt) <= Date.now() + 60_000) {
    if (!connection.encryptedRefreshToken || !nonces.refresh) return NextResponse.json({ error: "GOOGLE_RECONNECT_REQUIRED" }, { status: 409 });
    try {
      const refreshed = await refreshGoogleAccessToken(await decryptToken(connection.encryptedRefreshToken, nonces.refresh));
      accessToken = refreshed.access_token;
      const encrypted = await encryptToken(accessToken);
      await db.update(oauthConnections).set({ encryptedAccessToken: encrypted.ciphertext, tokenNonce: JSON.stringify({ ...nonces, access: encrypted.nonce }), tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString() }).where(eq(oauthConnections.id, connection.id));
    } catch {
      return NextResponse.json({ error: "GOOGLE_RECONNECT_REQUIRED" }, { status: 409 });
    }
  }
  const candidates = await db.select().from(scheduleCandidates).where(and(eq(scheduleCandidates.userId, user.userId), inArray(scheduleCandidates.id, candidateIds)));
  const registered: number[] = [];
  const createdEvents: Array<{ candidateId: number; eventId: string; htmlLink: string }> = [];
  let verificationPending = false;
  for (const item of candidates) {
    const submitted = submittedById.get(item.id);
    const title = submitted?.title.trim() || item.title;
    const date = submitted?.date || item.date;
    const time = submitted?.time || item.time;
    const endTime = submitted?.endTime ?? item.endTime;
    const timeAmbiguous = submitted ? submitted.timeAmbiguous : item.timeAmbiguous;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && !/^\d{2}:\d{2}$/.test(time)) || timeAmbiguous) continue;
    const eventTiming = time
      ? { start: { dateTime: `${date}T${time}:00`, timeZone: "Asia/Seoul" }, end: (() => { const end = /^\d{2}:\d{2}$/.test(endTime) ? explicitEventEnd(date, time, endTime) : eventEnd(date, time); return { dateTime: `${end.date}T${end.time}:00`, timeZone: "Asia/Seoul" }; })() }
      : { start: { date }, end: { date: nextDate(date) } };
    const eventPayload = {
      summary: title,
      description: [item.summary, `원본 메일: ${item.sourceUrl}`].filter(Boolean).join("\n\n"),
      ...(item.location ? { location: item.location } : {}),
      ...eventTiming,
    };
    const createUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    const updateUrl = item.calendarEventId ? `${createUrl}/${encodeURIComponent(item.calendarEventId)}` : createUrl;
    let response: Response;
    try {
      response = await fetch(updateUrl, {
        method: item.calendarEventId ? "PATCH" : "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(eventPayload),
      });
      if (item.calendarEventId && response.status === 404) {
        response = await fetch(createUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify(eventPayload),
        });
      }
    } catch {
      return NextResponse.json({ error: "GOOGLE_CALENDAR_UNREACHABLE" }, { status: 503 });
    }
    if (!response.ok) {
      const googleError = await response.json().catch(() => null) as GoogleApiError | null;
      const mapped = googleCalendarError(response, googleError);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const event = await response.json() as { id: string; htmlLink?: string; status?: string };
    if (!event.id) return NextResponse.json({ error: "CALENDAR_CREATE_FAILED" }, { status: 502 });
    const verifiedEvent = await verifyCalendarEvent(createUrl, event.id, accessToken);
    await db.update(scheduleCandidates).set({ title, date, time, endTime, selected: true, needsReview: false, calendarEventId: event.id, updatedAt: new Date().toISOString() }).where(eq(scheduleCandidates.id, item.id));
    registered.push(item.id);
    if (!verifiedEvent) verificationPending = true;
    createdEvents.push({ candidateId: item.id, eventId: event.id, htmlLink: verifiedEvent?.htmlLink ?? event.htmlLink ?? "" });
  }
  if (!registered.length) return NextResponse.json({ error: "CANDIDATE_DATE_TIME_REQUIRED" }, { status: 422 });
  return NextResponse.json({ registered, events: createdEvents, calendarEmail: connection.providerEmail, verificationPending });
}
