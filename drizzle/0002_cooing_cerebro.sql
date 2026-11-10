CREATE TABLE `inquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`shop` text NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inquiries_shop_date` ON `inquiries` (`shop`,`created_at`);