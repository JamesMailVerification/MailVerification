import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { oauthConnections } from "../../../db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const connections = await getDb().select({
    provider: oauthConnections.provider,
    status: oauthConnections.status,
    scopes: oauthConnections.scopes,
    tokenExpiresAt: oauthConnections.tokenExpiresAt,
    lastErrorCode: oauthConnections.lastErrorCode,
  }).from(oauthConnections).where(eq(oauthConnections.userId, user.userId));
  return NextResponse.json({ connections });
}
