ALTER TABLE `receipts` ADD `tool_class` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `receipts` ADD `irreversible` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `undo_actions` ADD `started_at` text;--> statement-breakpoint
ALTER TABLE `undo_actions` ADD `verification` text;--> statement-breakpoint
ALTER TABLE `undo_actions` ADD `summary` text;