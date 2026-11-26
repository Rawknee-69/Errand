CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slip_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`tool` text NOT NULL,
	`tool_class` text NOT NULL,
	`arguments` text DEFAULT '{}' NOT NULL,
	`capability` text NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`release_at` text,
	`expires_at` text NOT NULL,
	`call_id` text,
	`reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`slip_id`) REFERENCES `slips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `outbox_user_id_idx` ON `outbox` (`user_id`);--> statement-breakpoint
CREATE INDEX `outbox_state_release_at_idx` ON `outbox` (`state`,`release_at`);