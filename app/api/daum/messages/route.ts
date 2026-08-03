import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { imapConnections } from "../../../../db/schema";
import { readRecentDaumMessages } from "../../../lib/daum-imap";
import { decryptToken } from "../../../lib/oauth-crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const [connection] = await getDb().select().from(imapConnections).where(eq(imapConnections.userId, user.userId)).limit(1);
  if (!connection) return NextResponse.json({ error: "DAUM_CONNECTION_REQUIRED" }, { status: 409 });

  try {
    const appPassword = await decryptToken(connection.encryptedAppPassword, connection.passwordNonce);
    const messages = await readRecentDaumMessages(connection.loginId, appPassword);
    await getDb().update(imapConnections).set({ status: "connected", lastErrorCode: null, updatedAt: new Date().toISOString() }).where(eq(imapConnections.id, connection.id));
    return NextResponse.json({ provider: "daum", messages, storedBody: false });
  } catch {
    await getDb().update(imapConnections).set({ status: "error", lastErrorCode: "DAUM_READ_FAILED", updatedAt: new Date().toISOString() }).where(eq(imapConnections.id, connection.id));
    return NextResponse.json({ error: "DAUM_READ_FAILED" }, { status: 502 });
  }
}
