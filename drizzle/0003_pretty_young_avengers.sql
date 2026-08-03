DROP INDEX `idx_imap_connections_user_provider`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_imap_connections_user_email` ON `imap_connections` (`user_id`,`email_address`);