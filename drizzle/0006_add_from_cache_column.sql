-- 添加 fromCache 字段到 tps_search_results 表
ALTER TABLE `tps_search_results` ADD COLUMN `fromCache` boolean NOT NULL DEFAULT false;
