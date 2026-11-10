CREATE TABLE `alibaba_connections` (
	`slot` text PRIMARY KEY NOT NULL,
	`app_key` text NOT NULL,
	`secret` text NOT NULL,
	`expected_account` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`tokens` text,
	`pending` text,
	`identity` text,
	`expires_at` integer,
	`refresh_until` integer,
	`diagnosis` text,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alibaba_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`slot` text NOT NULL,
	`actor` text NOT NULL,
	`config_version` integer NOT NULL,
	`account_id` text NOT NULL,
	`data` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alibaba_states` (
	`hash` text PRIMARY KEY NOT NULL,
	`slot` text NOT NULL,
	`actor` text NOT NULL,
	`config_version` integer NOT NULL,
	`expires_at` integer NOT NULL
);
