ALTER TABLE `tools` ADD `observed_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tools` ADD `observed_input_schema` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `tools` ADD `observed_annotations` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `tools` ADD `observed_class` text DEFAULT 'unknown' NOT NULL;