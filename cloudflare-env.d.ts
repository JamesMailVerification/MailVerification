declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    OAUTH_ENCRYPTION_KEY: string;
    APP_BASE_URL?: string;
  }
}
