-- 同步 tps_search_tasks 表结构
-- 添加缺失的字段

-- 添加 searchPageRequests 字段
ALTER TABLE `tps_search_tasks` ADD COLUMN IF NOT EXISTS `searchPageRequests` int NOT NULL DEFAULT 0;

-- 添加 detailPageRequests 字段
ALTER TABLE `tps_search_tasks` ADD COLUMN IF NOT EXISTS `detailPageRequests` int NOT NULL DEFAULT 0;

-- 添加 cacheHits 字段
ALTER TABLE `tps_search_tasks` ADD COLUMN IF NOT EXISTS `cacheHits` int NOT NULL DEFAULT 0;

-- 添加 logs 字段
ALTER TABLE `tps_search_tasks` ADD COLUMN IF NOT EXISTS `logs` json;

-- 添加 startedAt 字段
ALTER TABLE `tps_search_tasks` ADD COLUMN IF NOT EXISTS `startedAt` timestamp;
