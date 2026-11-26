CREATE TABLE `agent_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_keys_key_hash_unique` ON `agent_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `agent_keys_user_id_idx` ON `agent_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slip_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`tool` text NOT NULL,
	`arguments` text DEFAULT '{}' NOT NULL,
	`result` text,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`slip_id`) REFERENCES `slips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `calls_user_id_idx` ON `calls` (`user_id`);--> statement-breakpoint
CREATE INDEX `calls_slip_id_idx` ON `calls` (`slip_id`);--> statement-breakpoint
CREATE TABLE `connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`transport` text NOT NULL,
	`auth_type` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `connectors_user_id_idx` ON `connectors` (`user_id`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connector_id` text,
	`service_id` text NOT NULL,
	`kind` text NOT NULL,
	`ciphertext` text NOT NULL,
	`nonce` text NOT NULL,
	`auth_tag` text NOT NULL,
	`wrapped_data_key` text NOT NULL,
	`key_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `credentials_user_id_idx` ON `credentials` (`user_id`);--> statement-breakpoint
CREATE INDEX `credentials_service_id_idx` ON `credentials` (`service_id`);--> statement-breakpoint
CREATE TABLE `journal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seq` integer NOT NULL,
	`user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_seq_unique` ON `journal` (`seq`);--> statement-breakpoint
CREATE INDEX `journal_user_id_idx` ON `journal` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`state` text NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_attempts_state_unique` ON `oauth_attempts` (`state`);--> statement-breakpoint
CREATE INDEX `oauth_attempts_user_id_idx` ON `oauth_attempts` (`user_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slip_id` text NOT NULL,
	`call_id` text,
	`errand_type` text NOT NULL,
	`verification` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`slip_id`) REFERENCES `slips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `receipts_user_id_idx` ON `receipts` (`user_id`);--> statement-breakpoint
CREATE TABLE `slips` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`errand_type` text NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`state` text NOT NULL,
	`tier` text NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`constraints` text DEFAULT '{}' NOT NULL,
	`call_cap` integer DEFAULT 0 NOT NULL,
	`calls_used` integer DEFAULT 0 NOT NULL,
	`spend_cap_cents` integer DEFAULT 0 NOT NULL,
	`spend_used_cents` integer DEFAULT 0 NOT NULL,
	`capability_hash` text,
	`signature` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`approved_at` text,
	`burned_at` text,
	`burned_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `slips_user_id_idx` ON `slips` (`user_id`);--> statement-breakpoint
CREATE TABLE `tools` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`input_schema` text DEFAULT '{}' NOT NULL,
	`class` text DEFAULT 'unknown' NOT NULL,
	`definition_hash` text NOT NULL,
	`requestable` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tools_user_id_idx` ON `tools` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tools_connector_id_name_idx` ON `tools` (`connector_id`,`name`);--> statement-breakpoint
CREATE TABLE `trust` (
	`user_id` text NOT NULL,
	`errand_type` text NOT NULL,
	`tier` text NOT NULL,
	`clean_runs` integer DEFAULT 0 NOT NULL,
	`caps` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `errand_type`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `undo_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`receipt_id` text,
	`call_id` text,
	`inverse` text NOT NULL,
	`applied_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `undo_actions_user_id_idx` ON `undo_actions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
