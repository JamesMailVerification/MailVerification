import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_users_email").on(table.email)]);

export const oauthConnections = sqliteTable("oauth_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["google", "microsoft"] }).notNull(),
  providerAccountId: text("provider_account_id"),
  providerEmail: text("provider_email"),
  status: text("status", { enum: ["pending", "connected", "expired", "revoked", "error"] }).notNull().default("pending"),
  scopes: text("scopes").notNull().default("[]"),
  encryptedAccessToken: text("encrypted_access_token"),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  tokenNonce: text("token_nonce"),
  tokenExpiresAt: text("token_expires_at"),
  lastErrorCode: text("last_error_code"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_oauth_connections_user_provider").on(table.userId, table.provider)]);

export const imapConnections = sqliteTable("imap_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["daum"] }).notNull().default("daum"),
  emailAddress: text("email_address").notNull(),
  loginId: text("login_id").notNull(),
  mailboxName: text("mailbox_name").notNull().default("Collie"),
  encryptedAppPassword: text("encrypted_app_password").notNull(),
  passwordNonce: text("password_nonce").notNull(),
  status: text("status", { enum: ["connected", "error"] }).notNull().default("connected"),
  lastErrorCode: text("last_error_code"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_imap_connections_user_email").on(table.userId, table.emailAddress)]);
