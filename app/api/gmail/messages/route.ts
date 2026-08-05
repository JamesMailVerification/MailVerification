import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { decryptToken, encryptToken } from "../../../lib/oauth-crypto";
import { refreshGoogleAccessToken } from "../../../lib/google-oauth";
import { getDb } from "../../../../db";
import { oauthConnections } from "../../../../db/schema";

export const dynamic = "force-dynamic";

type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  payload?: { headers?: Array<{ name: string; value: string }> };
};

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name)?.value ?? "";
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const db = getDb();
  const rows = await db.select().from(oauthConnections).where(and(
    eq(oauthConnections.userId, user.userId),
    eq(oauthConnections.provider, "google"),
  )).limit(1);
  const connection = rows[0];
  if (!connection || connection.status !== "connected" || !connection.encryptedAccessToken || !connection.tokenNonce) {
    return NextResponse.json({ error: "GMAIL_NOT_CONNECTED" }, { status: 409 });
  }

  try {
    const nonces = JSON.parse(connection.tokenNonce) as { access: string; refresh?: string | null };
    let accessToken = await decryptToken(connection.encryptedAccessToken, nonces.access);
    if (connection.tokenExpiresAt && Date.parse(connection.tokenExpiresAt) <= Date.now() + 60_000) {
      if (!connection.encryptedRefreshToken || !nonces.refresh) throw new Error("GOOGLE_REFRESH_TOKEN_MISSING");
      const refreshToken = await decryptToken(connection.encryptedRefreshToken, nonces.refresh);
      const refreshed = await refreshGoogleAccessToken(refreshToken);
      accessToken = refreshed.access_token;
      const encrypted = await encryptToken(accessToken);
      await db.update(oauthConnections).set({
        encryptedAccessToken: encrypted.ciphertext,
        tokenNonce: JSON.stringify({ ...nonces, access: encrypted.nonce }),
        tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(oauthConnections.id, connection.id));
    }

    const authHeaders = { authorization: `Bearer ${accessToken}` };
    const requestedDays = Number(new URL(request.url).searchParams.get("days"));
    const days = requestedDays === 30 ? 30 : 7;
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.search = new URLSearchParams({ maxResults: days === 30 ? "100" : "30", q: `newer_than:${days}d` }).toString();
    const listResponse = await fetch(listUrl, { headers: authHeaders });
    if (!listResponse.ok) throw new Error(`GMAIL_LIST_FAILED:${listResponse.status}`);
    const list = await listResponse.json() as { messages?: Array<{ id: string }> };
    const messages = await Promise.all((list.messages ?? []).map(async ({ id }) => {
      const detailUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      detailUrl.searchParams.set("format", "metadata");
      for (const value of ["From", "Subject", "Date"]) detailUrl.searchParams.append("metadataHeaders", value);
      const response = await fetch(detailUrl, { headers: authHeaders });
      if (!response.ok) return null;
      const message = await response.json() as GmailMessage;
      return {
        id: message.id,
        threadId: message.threadId,
        subject: header(message, "subject") || "(제목 없음)",
        from: header(message, "from"),
        receivedAt: header(message, "date"),
        accountEmail: connection.providerEmail ?? "",
        snippet: message.snippet ?? "",
        unread: message.labelIds?.includes("UNREAD") ?? false,
        sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${message.threadId}`,
      };
    }));
    return NextResponse.json({ messages: messages.filter(Boolean), range: days === 30 ? "최근 한 달" : "최근 7일", storedBody: false });
  } catch {
    await db.update(oauthConnections).set({ status: "error", lastErrorCode: "GMAIL_READ_FAILED", updatedAt: new Date().toISOString() }).where(eq(oauthConnections.id, connection.id));
    return NextResponse.json({ error: "GMAIL_READ_FAILED" }, { status: 502 });
  }
}
