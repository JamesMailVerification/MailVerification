import { and, eq } from "drizzle-orm";
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

  const connections = await getDb().select({
    id: imapConnections.id,
    emailAddress: imapConnections.emailAddress,
    status: imapConnections.status,
    lastErrorCode: imapConnections.lastErrorCode,
  }).from(imapConnections).where(eq(imapConnections.userId, user.userId));

  return NextResponse.json({ connections });
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
      target: [imapConnections.userId, imapConnections.emailAddress],
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

    const [saved] = await db.select({ id: imapConnections.id, emailAddress: imapConnections.emailAddress, status: imapConnections.status })
      .from(imapConnections)
      .where(and(eq(imapConnections.userId, user.userId), eq(imapConnections.emailAddress, emailAddress)))
      .limit(1);
    return NextResponse.json({ connected: true, connection: saved });
  } catch {
    return NextResponse.json({ error: "DAUM_IMAP_CONNECTION_FAILED" }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "INVALID_CONNECTION_ID" }, { status: 400 });
  await getDb().delete(imapConnections).where(and(eq(imapConnections.userId, user.userId), eq(imapConnections.id, id)));
  return NextResponse.json({ disconnected: true });
}
