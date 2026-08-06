CREATE TABLE `dismissed_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`source_url` text NOT NULL,
	`dismissed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dismissed_candidates_user_source` ON `dismissed_candidates` (`user_id`,`source_url`);
