import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db";
import { oauthConnections, users } from "../../../../../db/schema";
import { encryptToken } from "../../../../lib/oauth-crypto";
import { appBaseUrl, exchangeGoogleCode } from "../../../../lib/google-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await getChatGPTUser();
  const stateCookie = request.headers.get("cookie")?.match(/(?:^|; )google_oauth_state=([^;]+)/)?.[1];
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const failure = url.searchParams.get("error");
  const destination = new URL("/?view=inbox", appBaseUrl(request));

  if (!user || failure || !code || !state || !stateCookie || decodeURIComponent(stateCookie) !== state) {
    destination.searchParams.set("google", failure ?? "invalid_oauth_callback");
    return NextResponse.redirect(destination);
  }

  try {
    const tokens = await exchangeGoogleCode(request, code);
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileResponse.ok) throw new Error(`GOOGLE_PROFILE_FAILED:${profileResponse.status}`);
    const profile = await profileResponse.json() as { sub: string; email?: string };
    const access = await encryptToken(tokens.access_token);
    const refresh = tokens.refresh_token ? await encryptToken(tokens.refresh_token) : null;
    const db = getDb();

    await db.insert(users).values({
      id: user.userId,
      email: user.email,
      displayName: user.displayName,
    }).onConflictDoUpdate({
      target: users.id,
      set: { email: user.email, displayName: user.displayName, updatedAt: new Date().toISOString() },
    });

    const existing = await db.select().from(oauthConnections).where(and(
      eq(oauthConnections.userId, user.userId),
      eq(oauthConnections.provider, "google"),
    )).limit(1);
    const previousNonces = existing[0]?.tokenNonce
      ? JSON.parse(existing[0].tokenNonce) as { refresh?: string | null }
      : null;
    const values = {
      providerAccountId: profile.sub,
      status: "connected" as const,
      scopes: JSON.stringify(tokens.scope.split(" ")),
      encryptedAccessToken: access.ciphertext,
      encryptedRefreshToken: refresh?.ciphertext ?? existing[0]?.encryptedRefreshToken ?? null,
      tokenNonce: JSON.stringify({ access: access.nonce, refresh: refresh?.nonce ?? previousNonces?.refresh ?? null }),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      lastErrorCode: null,
      updatedAt: new Date().toISOString(),
    };
    if (existing[0]) {
      await db.update(oauthConnections).set(values).where(eq(oauthConnections.id, existing[0].id));
    } else {
      await db.insert(oauthConnections).values({ userId: user.userId, provider: "google", ...values });
    }
    destination.searchParams.set("google", "connected");
  } catch {
    destination.searchParams.set("google", "connection_failed");
  }

  const response = NextResponse.redirect(destination);
  response.cookies.delete("google_oauth_state");
  return response;
}
