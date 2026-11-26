ALTER TABLE `tools` ADD `agent_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tools` ADD `annotations` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `tools` ADD `observed_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tools` ADD `state` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `tools` ADD `changed_at` text;--> statement-breakpoint
ALTER TABLE `tools` ADD `removed_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tools_user_id_agent_name_idx` ON `tools` (`user_id`,`agent_name`);