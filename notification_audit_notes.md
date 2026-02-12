# 公告通知系统后端审查笔记

## 数据库表结构

### announcements 表
- id, title(200), content(text), type(enum: info/warning/success/error), isPinned(bool), isActive(bool)
- startTime, endTime (timestamp, 可选 - 定时发布)
- createdBy(50), createdAt, updatedAt

### user_messages 表
- id, userId, title(200), content(text), type(enum: system/support/notification/promotion)
- isRead(bool, default false), createdBy(50), createdAt

## 后端 API 路由

### 管理员端 (admin router)
1. `admin.getAnnouncements` - 分页获取公告列表（按置顶+时间排序）
2. `admin.createAnnouncement` - 创建公告（支持定时、置顶、类型）
3. `admin.updateAnnouncement` - 更新公告（支持启用/禁用、修改内容）
4. `admin.deleteAnnouncement` - 删除公告
5. `admin.sendMessage` - 发送消息给单个用户
6. `admin.sendBulkMessage` - 批量发送消息给多个用户

### 用户端 (notification router)
1. `notification.getAnnouncements` - 获取活跃公告（publicProcedure，无需登录）
2. `notification.getMessages` - 获取用户消息（分页）
3. `notification.markAsRead` - 标记单条消息已读
4. `notification.markAllAsRead` - 标记所有消息已读
5. `notification.getUnreadCount` - 获取未读消息数量

## 后端发现的问题

### 问题1: getActiveAnnouncements 时间过滤逻辑
- 使用 `lte(startTime, now)` 和 `gte(endTime, now)` - 逻辑正确
- 但 startTime 和 endTime 都可以为 NULL，使用 OR 处理 - 正确

### 问题2: getUnreadCount 效率问题
- 调用 `getUserMessages(userId, 1, 1)` 获取完整消息列表（虽然只取1条），然后返回 unreadCount
- 这意味着每次获取未读数量都会执行3个SQL查询（messages + count + unreadCount）
- 应该只执行 unreadCount 查询即可，浪费了2个SQL查询

### 问题3: sendMessageToUsers 批量插入无错误处理
- 如果某个 userId 无效，整个批量插入会失败
- 没有返回实际成功的数量，直接返回 userIds.length

### 问题4: updateAnnouncement 缺少存在性检查
- 直接执行 update，不检查公告是否存在
- 如果 id 不存在也返回 true

### 问题5: deleteAnnouncement 缺少存在性检查
- 同上，直接执行 delete，不检查是否存在

### 问题6: getAnnouncements 是 publicProcedure
- 公告获取不需要登录，这是合理的（公告面向所有人）
- 但如果有敏感公告可能需要权限控制 - 目前设计合理

### 问题7: markAsRead 缺少消息存在性验证
- 如果 messageId 不存在或不属于该用户，也返回 true
- 应该检查是否实际更新了记录
