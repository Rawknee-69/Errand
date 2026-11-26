ALTER TABLE `connectors` ADD `auth_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `connectors` ADD `last_auth_error` text;--> statement-breakpoint
ALTER TABLE `oauth_attempts` DROP COLUMN `code_verifier`;