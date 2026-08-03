import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { users } from "../../../db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await getChatGPTUser();

  if (!identity) {
    return NextResponse.json(
      { authenticated: false, error: "AUTHENTICATION_REQUIRED" },
      { status: 401 },
    );
  }

  const db = getDb();
  await db.insert(users).values({
    id: identity.userId,
    email: identity.email,
    displayName: identity.displayName,
  }).onConflictDoUpdate({
    target: users.id,
    set: {
      email: identity.email,
      displayName: identity.displayName,
      updatedAt: new Date().toISOString(),
    },
  });

  return NextResponse.json({
    authenticated: true,
    user: {
      id: identity.userId,
      email: identity.email,
      displayName: identity.displayName,
    },
  });
}
