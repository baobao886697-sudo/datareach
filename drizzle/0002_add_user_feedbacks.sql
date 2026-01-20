CREATE TABLE `user_feedbacks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('question','suggestion','business','custom_dev','other') NOT NULL,
	`title` varchar(200) NOT NULL,
	`content` text NOT NULL,
	`contactInfo` varchar(200) DEFAULT NULL,
	`status` enum('pending','processing','resolved','closed') NOT NULL DEFAULT 'pending',
	`adminReply` text,
	`repliedBy` varchar(50),
	`repliedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_feedbacks_id` PRIMARY KEY(`id`)
);
