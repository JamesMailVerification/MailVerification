import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { decryptToken, encryptToken } from "../../../lib/oauth-crypto";
import { refreshMicrosoftAccessToken } from "../../../lib/microsoft-oauth";
import { getDb } from "../../../../db";
import { oauthConnections } from "../../../../db/schema";

export const dynamic = "force-dynamic";

type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  receivedDateTime: string;
  bodyPreview?: string;
  isRead?: boolean;
  webLink?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
};

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const db = getDb();
  const [connection] = await db.select().from(oauthConnections).where(and(
    eq(oauthConnections.userId, user.userId),
    eq(oauthConnections.provider, "microsoft"),
  )).limit(1);
  if (!connection || connection.status !== "connected" || !connection.encryptedAccessToken || !connection.tokenNonce) {
    return NextResponse.json({ error: "OUTLOOK_NOT_CONNECTED" }, { status: 409 });
  }

  try {
    const nonces = JSON.parse(connection.tokenNonce) as { access: string; refresh?: string | null };
    let accessToken = await decryptToken(connection.encryptedAccessToken, nonces.access);
    if (connection.tokenExpiresAt && Date.parse(connection.tokenExpiresAt) <= Date.now() + 60_000) {
      if (!connection.encryptedRefreshToken || !nonces.refresh) throw new Error("MICROSOFT_REFRESH_TOKEN_MISSING");
      const refreshToken = await decryptToken(connection.encryptedRefreshToken, nonces.refresh);
      const refreshed = await refreshMicrosoftAccessToken(refreshToken);
      accessToken = refreshed.access_token;
      const encrypted = await encryptToken(accessToken);
      const refreshedRefresh = refreshed.refresh_token ? await encryptToken(refreshed.refresh_token) : null;
      await db.update(oauthConnections).set({
        encryptedAccessToken: encrypted.ciphertext,
        encryptedRefreshToken: refreshedRefresh?.ciphertext ?? connection.encryptedRefreshToken,
        tokenNonce: JSON.stringify({ ...nonces, access: encrypted.nonce, refresh: refreshedRefresh?.nonce ?? nonces.refresh }),
        tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(oauthConnections.id, connection.id));
    }

    const requestedDays = Number(new URL(request.url).searchParams.get("days"));
    const days = requestedDays === 30 ? 30 : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const graphUrl = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages");
    graphUrl.searchParams.set("$select", "id,conversationId,subject,from,receivedDateTime,bodyPreview,isRead,webLink");
    graphUrl.searchParams.set("$filter", `receivedDateTime ge ${since}`);
    graphUrl.searchParams.set("$orderby", "receivedDateTime desc");
    graphUrl.searchParams.set("$top", days === 30 ? "100" : "30");
    const response = await fetch(graphUrl, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`OUTLOOK_LIST_FAILED:${response.status}`);
    const payload = await response.json() as { value?: GraphMessage[] };
    return NextResponse.json({
      messages: (payload.value ?? []).map((message) => ({
        id: message.id,
        threadId: message.conversationId ?? message.id,
        subject: message.subject || "(제목 없음)",
        from: message.from?.emailAddress?.name || message.from?.emailAddress?.address || "",
        receivedAt: message.receivedDateTime,
        accountEmail: connection.providerEmail ?? "",
        snippet: message.bodyPreview ?? "",
        unread: !message.isRead,
        sourceUrl: message.webLink ?? "https://outlook.office.com/mail/",
      })),
      range: days === 30 ? "최근 30일" : "최근 7일",
      storedBody: false,
    });
  } catch {
    await db.update(oauthConnections).set({ status: "error", lastErrorCode: "OUTLOOK_READ_FAILED", updatedAt: new Date().toISOString() }).where(eq(oauthConnections.id, connection.id));
    return NextResponse.json({ error: "OUTLOOK_READ_FAILED" }, { status: 502 });
  }
}
