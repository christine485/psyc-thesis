CREATE TABLE `slots` (
	`mode` text NOT NULL,
	`id` integer NOT NULL,
	`token_hash` text,
	`expires` integer DEFAULT 0 NOT NULL,
	`plan` text,
	`submitted` integer DEFAULT 0 NOT NULL,
	`payload` text,
	PRIMARY KEY(`mode`, `id`)
);

CREATE UNIQUE INDEX `session_token` ON `slots` (`token_hash`);
