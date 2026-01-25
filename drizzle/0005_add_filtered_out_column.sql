-- 添加 filteredOut 字段到 tps_search_tasks 表
-- 用于记录被过滤排除的结果数量

ALTER TABLE `tps_search_tasks` ADD COLUMN `filteredOut` int NOT NULL DEFAULT 0;
