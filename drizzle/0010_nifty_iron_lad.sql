CREATE TABLE `portal_analytics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` timestamp NOT NULL,
	`page` varchar(64) NOT NULL,
	`ipHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `portal_analytics_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_date_page_ip` UNIQUE(`date`,`page`,`ipHash`)
);
--> statement-breakpoint
CREATE TABLE `price_audits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`property` enum('Sadoles','Hacjenda') NOT NULL,
	`checkIn` datetime NOT NULL,
	`checkOut` datetime NOT NULL,
	`dateScraped` timestamp NOT NULL DEFAULT (now()),
	`bookingPrice` decimal(10,2),
	`bookingStatus` varchar(64),
	`airbnbPrice` decimal(10,2),
	`airbnbStatus` varchar(64),
	`slowhopPrice` decimal(10,2),
	`slowhopStatus` varchar(64),
	`alohacampPrice` decimal(10,2),
	`alohacampStatus` varchar(64),
	`isMinStayTest` int NOT NULL DEFAULT 0,
	CONSTRAINT `price_audits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_audit_property_dates` ON `price_audits` (`property`,`checkIn`,`checkOut`);--> statement-breakpoint
CREATE INDEX `idx_audit_date_scraped` ON `price_audits` (`dateScraped`);