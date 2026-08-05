declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    MICROSOFT_CLIENT_ID: string;
    MICROSOFT_CLIENT_SECRET: string;
    MICROSOFT_TENANT_ID?: string;
    OAUTH_ENCRYPTION_KEY: string;
    APP_BASE_URL?: string;
    LOCAL_DEV_AUTH?: string;
    LOCAL_DEV_USER_ID?: string;
    LOCAL_DEV_USER_EMAIL?: string;
    LOCAL_DEV_USER_NAME?: string;
  }
}
