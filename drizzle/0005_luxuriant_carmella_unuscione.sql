CREATE TABLE `schedule_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`sender` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`source_url` text NOT NULL,
	`date` text DEFAULT '' NOT NULL,
	`time` text DEFAULT '' NOT NULL,
	`deadline` text,
	`needs_review` integer DEFAULT false NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`calendar_event_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_schedule_candidates_user_source_title` ON `schedule_candidates` (`user_id`,`source_url`,`title`);