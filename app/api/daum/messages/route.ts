import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { imapConnections } from "../../../../db/schema";
import { DAUM_MAILBOX, readRecentDaumMessages } from "../../../lib/daum-imap";
import { decryptToken } from "../../../lib/oauth-crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const connections = await getDb().select().from(imapConnections).where(eq(imapConnections.userId, user.userId));
  if (!connections.length) return NextResponse.json({ error: "DAUM_CONNECTION_REQUIRED" }, { status: 409 });

  const results = await Promise.allSettled(connections.map(async (connection) => {
    try {
      const appPassword = await decryptToken(connection.encryptedAppPassword, connection.passwordNonce);
      const messages = await readRecentDaumMessages(connection.loginId, appPassword);
      await getDb().update(imapConnections).set({ status: "connected", lastErrorCode: null, updatedAt: new Date().toISOString() }).where(eq(imapConnections.id, connection.id));
      return messages.map((message) => ({ ...message, id: `${connection.id}-${message.id}`, accountEmail: connection.emailAddress }));
    } catch (error) {
      const errorCode = error instanceof Error && error.message === "IMAP_MAILBOX_FAILED" ? "DAUM_COLLIE_MAILBOX_NOT_FOUND" : "DAUM_READ_FAILED";
      await getDb().update(imapConnections).set({ status: "error", lastErrorCode: errorCode, updatedAt: new Date().toISOString() }).where(eq(imapConnections.id, connection.id));
      throw new Error(errorCode);
    }
  }));
  const messages = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const failedConnections = results.filter((result) => result.status === "rejected").length;
  if (!messages.length && failedConnections) return NextResponse.json({ error: "DAUM_READ_FAILED", failedConnections }, { status: 502 });
  return NextResponse.json({ provider: "daum", mailbox: DAUM_MAILBOX, messages, failedConnections, storedBody: false });
}
