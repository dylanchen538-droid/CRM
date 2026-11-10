CREATE TABLE `mail_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`party` text NOT NULL,
	`customer_id` text,
	`label` text NOT NULL,
	`channel` text NOT NULL,
	`evidence` text NOT NULL,
	`happened_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_party_time` ON `mail_messages` (`party`,`happened_at`);--> statement-breakpoint
CREATE INDEX `mail_customer_time` ON `mail_messages` (`customer_id`,`happened_at`);