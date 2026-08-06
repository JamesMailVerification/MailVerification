CREATE TABLE `review_messages` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `user_id` text NOT NULL, `message_key` text NOT NULL, `provider` text NOT NULL,
 `subject` text NOT NULL, `sender` text DEFAULT '' NOT NULL, `snippet` text DEFAULT '' NOT NULL, `source_url` text NOT NULL,
 `received_at` text DEFAULT '' NOT NULL, `account_email` text DEFAULT '' NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
 FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_review_messages_user_key` ON `review_messages` (`user_id`,`message_key`);
