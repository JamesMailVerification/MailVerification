import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { GOOGLE_SCOPES, googleRedirectUri } from "../../../../lib/google-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.redirect(new URL("/signin-with-chatgpt?return_to=%2F", request.url));
  if (!env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: "GOOGLE_OAUTH_NOT_CONFIGURED" }, { status: 503 });
  }

  const state = crypto.randomUUID();
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(request),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
