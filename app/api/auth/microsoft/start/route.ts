import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { MICROSOFT_SCOPES, microsoftAuthorizationEndpoint, microsoftRedirectUri } from "../../../../lib/microsoft-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.redirect(new URL("/signin-with-chatgpt?return_to=%2F", request.url));
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    return NextResponse.json({ error: "MICROSOFT_OAUTH_NOT_CONFIGURED" }, { status: 503 });
  }

  const state = crypto.randomUUID();
  const authorizationUrl = new URL(microsoftAuthorizationEndpoint());
  authorizationUrl.search = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    redirect_uri: microsoftRedirectUri(request),
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
  }).toString();

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set("microsoft_oauth_state", state, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
