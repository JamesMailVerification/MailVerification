import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { oauthConnections } from "../../../db/schema";
import { decryptToken } from "../../lib/oauth-crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const connections = await getDb().select({
    provider: oauthConnections.provider,
    providerEmail: oauthConnections.providerEmail,
    status: oauthConnections.status,
    scopes: oauthConnections.scopes,
    tokenExpiresAt: oauthConnections.tokenExpiresAt,
    lastErrorCode: oauthConnections.lastErrorCode,
  }).from(oauthConnections).where(eq(oauthConnections.userId, user.userId));
  return NextResponse.json({ connections });
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const requestedProvider = new URL(request.url).searchParams.get("provider");
  const provider = requestedProvider === "microsoft" ? "microsoft" : "google";

  const [connection] = await getDb().select().from(oauthConnections).where(and(
    eq(oauthConnections.userId, user.userId),
    eq(oauthConnections.provider, provider),
  )).limit(1);

  if (connection) {
    const nonce = connection.tokenNonce ? JSON.parse(connection.tokenNonce) as { access?: string; refresh?: string } : {};
    const encryptedToken = connection.encryptedRefreshToken ?? connection.encryptedAccessToken;
    const tokenNonce = connection.encryptedRefreshToken ? nonce.refresh : nonce.access;
    if (encryptedToken && tokenNonce) {
      try {
        const token = await decryptToken(encryptedToken, tokenNonce);
        if (provider === "google") {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
          });
        }
      } catch {
        // Local connection data is still removed if Google is temporarily unavailable.
      }
    }
    await getDb().delete(oauthConnections).where(eq(oauthConnections.id, connection.id));
  }

  return NextResponse.json({ disconnected: true });
}
