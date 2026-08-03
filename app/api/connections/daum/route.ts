import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { imapConnections, users } from "../../../../db/schema";
import { testDaumImapConnection } from "../../../lib/daum-imap";
import { encryptToken } from "../../../lib/oauth-crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const [connection] = await getDb().select({
    emailAddress: imapConnections.emailAddress,
    status: imapConnections.status,
    lastErrorCode: imapConnections.lastErrorCode,
  }).from(imapConnections).where(eq(imapConnections.userId, user.userId)).limit(1);

  return NextResponse.json({ connection: connection ?? null });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const body = await request.json() as { emailAddress?: string; loginId?: string; appPassword?: string };
  const emailAddress = body.emailAddress?.trim() ?? "";
  const loginId = body.loginId?.trim() ?? "";
  const appPassword = body.appPassword ?? "";
  if (!emailAddress.includes("@") || !loginId || !appPassword) {
    return NextResponse.json({ error: "INVALID_CONNECTION_INPUT" }, { status: 400 });
  }

  try {
    await testDaumImapConnection(loginId, appPassword);
    const encrypted = await encryptToken(appPassword);
    const db = getDb();
    const now = new Date().toISOString();

    await db.insert(users).values({
      id: user.userId,
      email: user.email,
      displayName: user.displayName,
    }).onConflictDoUpdate({
      target: users.id,
      set: { email: user.email, displayName: user.displayName, updatedAt: now },
    });

    await db.insert(imapConnections).values({
      userId: user.userId,
      provider: "daum",
      emailAddress,
      loginId,
      encryptedAppPassword: encrypted.ciphertext,
      passwordNonce: encrypted.nonce,
      status: "connected",
      lastErrorCode: null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [imapConnections.userId, imapConnections.provider],
      set: {
        emailAddress,
        loginId,
        encryptedAppPassword: encrypted.ciphertext,
        passwordNonce: encrypted.nonce,
        status: "connected",
        lastErrorCode: null,
        updatedAt: now,
      },
    });

    return NextResponse.json({ connected: true, emailAddress });
  } catch {
    return NextResponse.json({ error: "DAUM_IMAP_CONNECTION_FAILED" }, { status: 422 });
  }
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  await getDb().delete(imapConnections).where(eq(imapConnections.userId, user.userId));
  return NextResponse.json({ disconnected: true });
}
