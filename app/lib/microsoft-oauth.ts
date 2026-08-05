import { env } from "cloudflare:workers";
import { appBaseUrl } from "./google-oauth";

export const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Calendars.ReadWrite",
] as const;

function tenantId(): string {
  return env.MICROSOFT_TENANT_ID || "common";
}

export function microsoftConfig() {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new Error("Microsoft OAuth credentials are not configured");
  }
  return { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET };
}

export function microsoftAuthorizationEndpoint(): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId())}/oauth2/v2.0/authorize`;
}

function microsoftTokenEndpoint(): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId())}/oauth2/v2.0/token`;
}

export function microsoftRedirectUri(request: Request): string {
  return `${appBaseUrl(request)}/api/auth/microsoft/callback`;
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch(microsoftTokenEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`MICROSOFT_TOKEN_FAILED:${response.status}`);
  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  }>;
}

export async function exchangeMicrosoftCode(request: Request, code: string) {
  const { clientId, clientSecret } = microsoftConfig();
  return tokenRequest(new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: microsoftRedirectUri(request),
    grant_type: "authorization_code",
    scope: MICROSOFT_SCOPES.join(" "),
  }));
}

export async function refreshMicrosoftAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = microsoftConfig();
  return tokenRequest(new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MICROSOFT_SCOPES.join(" "),
  }));
}
