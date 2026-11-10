CREATE TABLE `audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL
);
