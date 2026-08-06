ALTER TABLE `schedule_candidates` ADD `end_date` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `schedule_candidates` SET `end_date` = `date` WHERE `end_date` = '';
