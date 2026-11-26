ALTER TABLE `slips` ADD `rate_cap` integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `slips` ADD `rate_window_started_at` text;--> statement-breakpoint
ALTER TABLE `slips` ADD `rate_window_calls` integer DEFAULT 0 NOT NULL;