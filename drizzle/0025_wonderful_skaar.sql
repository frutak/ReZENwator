CREATE TABLE `historical_costs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`property` enum('Sadoles','Hacjenda') NOT NULL,
	`month` varchar(7) NOT NULL,
	`category` enum('cleaning','utilities','other') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`estimated` boolean NOT NULL DEFAULT false,
	`source` varchar(64) NOT NULL DEFAULT 'historia.csv',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `historical_costs_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_hist_cost_key` UNIQUE(`property`,`month`,`category`)
);
--> statement-breakpoint
CREATE TABLE `historical_revenue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`property` enum('Sadoles','Hacjenda') NOT NULL,
	`month` varchar(7) NOT NULL,
	`channel` enum('slowhop','airbnb','booking','alohacamp','direct') NOT NULL,
	`internal` boolean NOT NULL DEFAULT false,
	`totalPrice` decimal(10,2) NOT NULL,
	`commission` decimal(10,2) NOT NULL DEFAULT '0.00',
	`hostRevenue` decimal(10,2) NOT NULL,
	`commissionEstimated` boolean NOT NULL DEFAULT false,
	`source` varchar(64) NOT NULL DEFAULT 'historia.csv',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `historical_revenue_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_hist_rev_key` UNIQUE(`property`,`month`,`channel`,`internal`)
);
