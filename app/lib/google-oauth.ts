import { env } from "cloudflare:workers";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export function googleConfig() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth credentials are not configured");
  }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

export function appBaseUrl(request: Request): string {
  return env.APP_BASE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
}

export function googleRedirectUri(request: Request): string {
  return `${appBaseUrl(request)}/api/auth/google/callback`;
}

export async function exchangeGoogleCode(request: Request, code: string) {
  const { clientId, clientSecret } = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(request),
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error(`GOOGLE_TOKEN_EXCHANGE_FAILED:${response.status}`);
  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  }>;
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`GOOGLE_TOKEN_REFRESH_FAILED:${response.status}`);
  return response.json() as Promise<{ access_token: string; expires_in: number }>;
}
