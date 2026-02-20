# DataReach 修复报告：API 耗尽状态区分

## 问题描述

当 Scrape.do API 积分耗尽时，系统将任务状态设置为 `insufficient_credits`（积分不足），前端显示"积分不足"。这对用户造成了误导，因为用户的积分实际上是充足的，问题出在第三方 API 服务额度耗尽。

## 修复方案

引入新的任务状态 `service_busy`（服务繁忙），将 **API 服务额度耗尽** 与 **用户积分不足** 两种场景完全区分开来。

| 场景 | 修复前状态 | 修复后状态 | 前端显示 |
|------|-----------|-----------|---------|
| 用户积分不足 | `insufficient_credits` | `insufficient_credits` | 橙色 Badge "积分不足" |
| API 服务额度耗尽 | `insufficient_credits` | `service_busy` | 琥珀色 Badge "服务繁忙" |
| 正常完成 | `completed` | `completed` | 绿色 Badge "已完成" |

## 修改文件清单（15 个文件）

### 数据库层（2 个文件）

| 文件 | 修改内容 |
|------|---------|
| `drizzle/schema.ts` | 4 个任务表（tps_search_tasks, spf_search_tasks, anywho_search_tasks, search_tasks）的 status ENUM 增加 `service_busy` 值 |
| `server/_core/index.ts` | 4 个 CREATE TABLE 的 ENUM 定义同步增加 `service_busy` |

### 后端路由层（3 个文件）

| 文件 | 修改内容 |
|------|---------|
| `server/tps/router.ts` | 新增 `stoppedDueToApiExhausted` 标志；搜索/详情阶段 API 耗尽时设置该标志；最终状态判断优先级：API 耗尽 → service_busy，用户积分不足 → insufficient_credits，正常 → completed；CSV 导出允许 service_busy 状态 |
| `server/spf/router.ts` | 同上逻辑；同时修改 `completeSpfSearchTask` 调用传递新参数 |
| `server/spf/db.ts` | `completeSpfSearchTask` 函数增加 `stoppedDueToApiExhausted` 参数支持 |
| `server/anywho/router.ts` | 同 TPS 逻辑；搜索阶段和详情阶段均处理 API 耗尽标志；CSV 导出允许 service_busy 状态 |

### 前端页面层（9 个文件）

| 文件 | 修改内容 |
|------|---------|
| `client/src/pages/TpsTask.tsx` | 结果查询条件、状态 Badge、CSV 导出按钮均增加 service_busy 支持 |
| `client/src/pages/TpsHistory.tsx` | 状态 Badge 增加 insufficient_credits 和 service_busy |
| `client/src/pages/SpfTask.tsx` | 结果查询条件、状态 Badge、图标、CSV 导出、结果表格、无结果提示均增加 service_busy 支持 |
| `client/src/pages/SpfHistory.tsx` | 状态 Badge 增加 service_busy |
| `client/src/pages/AnywhoTask.tsx` | 结果查询条件、状态 Badge、图标、CSV 导出、结果表格、无结果提示均增加 service_busy 支持 |
| `client/src/pages/AnywhoHistory.tsx` | 状态 Badge 和 CSV 导出按钮增加 service_busy 支持 |
| `client/src/pages/Results.tsx` | 状态 Badge 增加 service_busy |
| `client/src/pages/SearchProgress.tsx` | 状态 Badge 增加 service_busy |
| `client/src/pages/History.tsx` | 状态 Badge 增加 insufficient_credits 和 service_busy |

## 核心逻辑变更

### 后端状态判断逻辑（以 TPS 为例）

```typescript
// 修复前
if (stoppedDueToCredits) {
  status = "insufficient_credits";  // API 耗尽也走这里，误导用户
} else {
  status = "completed";
}

// 修复后
let stoppedDueToApiExhausted = false;  // 新增标志

// 搜索/详情阶段检测到 API 耗尽时：
if (apiCreditsExhausted) {
  stoppedDueToApiExhausted = true;
  stoppedDueToCredits = true;  // 仍用于控制流停止
}

// 最终状态判断：API 耗尽优先级最高
const finalStatus = stoppedDueToApiExhausted 
  ? "service_busy" 
  : (stoppedDueToCredits ? "insufficient_credits" : "completed");
```

### 前端显示样式

- **积分不足**：橙色 Badge `bg-orange-500/20 text-orange-400`
- **服务繁忙**：琥珀色 Badge `bg-amber-500/20 text-amber-400`

## 部署注意事项

1. **数据库迁移**：部署后需要执行 `drizzle-kit push` 或 Railway 自动构建时会自动执行（build 脚本已包含），将 ENUM 列新增 `service_busy` 值
2. **向后兼容**：已有的 `insufficient_credits` 状态数据不受影响，只有新产生的 API 耗尽任务会使用 `service_busy` 状态
3. **CSV 导出**：三个模块的 CSV 导出均已允许 `service_busy` 状态导出

## Git 提交信息

```
commit c793a1c
feat: 区分 API 耗尽(service_busy)和用户积分不足(insufficient_credits)状态
```
