import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { imapConnections } from "../../../../db/schema";
import { readDaumMessagePreview } from "../../../lib/daum-imap";
import { decryptToken } from "../../../lib/oauth-crypto";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid") ?? "";
  const accountEmail = url.searchParams.get("accountEmail") ?? "";
  if (!/^\d+$/.test(uid) || !accountEmail.includes("@")) return NextResponse.json({ error: "INVALID_MESSAGE" }, { status: 400 });
  const [connection] = await getDb().select().from(imapConnections).where(and(
    eq(imapConnections.userId, user.userId),
    eq(imapConnections.emailAddress, accountEmail),
  )).limit(1);
  if (!connection) return NextResponse.json({ error: "DAUM_CONNECTION_REQUIRED" }, { status: 404 });
  try {
    const password = await decryptToken(connection.encryptedAppPassword, connection.passwordNonce);
    return NextResponse.json(await readDaumMessagePreview(connection.loginId, password, connection.mailboxName, uid));
  } catch {
    return NextResponse.json({ error: "DAUM_PREVIEW_FAILED" }, { status: 502 });
  }
}
