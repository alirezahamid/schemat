-- MySQL mysqldump-style fixture.
CREATE TABLE `users` (
  `id` bigint NOT NULL,
  `email` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_key` (`email`),
  KEY `users_email_idx` (`email`),
  INDEX `users_id_idx` (`id`),
  FULLTEXT KEY `users_email_fulltext` (`email`),
  SPATIAL INDEX `users_location_spatial` (`id`)
);
CREATE TABLE `posts` (
  `id` bigint NOT NULL,
  `author_id` bigint NOT NULL,
  `slug` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `posts_slug_key` (`slug`),
  KEY `posts_author_idx` (`author_id`),
  CONSTRAINT `posts_author_fkey` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`)
);
