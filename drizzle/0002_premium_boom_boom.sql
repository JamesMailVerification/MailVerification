CREATE TABLE `imap_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`provider` text DEFAULT 'daum' NOT NULL,
	`email_address` text NOT NULL,
	`login_id` text NOT NULL,
	`encrypted_app_password` text NOT NULL,
	`password_nonce` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_imap_connections_user_provider` ON `imap_connections` (`user_id`,`provider`);