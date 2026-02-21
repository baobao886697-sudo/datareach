import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useWebSocketContext } from "@/contexts/WebSocketContext";
import type { WsMessage } from "@/hooks/useWebSocket";
import { 
  Bell, Check, CheckCheck, Megaphone, MessageSquare,
  Info, AlertTriangle, Gift, X, ChevronDown, ChevronUp, Pin
} from "lucide-react";

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [expandedAnnouncements, setExpandedAnnouncements] = useState<Set<number>>(new Set());
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());
  const { subscribe } = useWebSocketContext();

  // 获取未读消息数量
  const { data: unreadData, refetch: refetchUnread } = trpc.notification.getUnreadCount.useQuery(
    undefined,
    { refetchInterval: 15000 } // 保留轮询作为兆底（15秒）
  );

  // 获取消息列表
  const { data: messagesData, refetch: refetchMessages } = trpc.notification.getMessages.useQuery(
    { limit: 20 },
    { enabled: open }
  );

  // 获取公告（移到useEffect之前，确保refetchAnnouncements可用）
  const { data: announcements, refetch: refetchAnnouncements } = trpc.notification.getAnnouncements.useQuery();
  
  // WebSocket 实时推送：收到新通知时立即刷新
  useEffect(() => {
    const unsub1 = subscribe("notification", (msg: WsMessage) => {
      refetchUnread();
      refetchMessages();
      // 显示浏览器通知（如果用户允许）
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(msg.data?.title || "DataReach 新消息", {
          body: msg.data?.content || "您有一条新消息",
          icon: "/favicon.ico",
        });
      }
      toast.info(msg.data?.title || "您有一条新消息", { duration: 5000 });
    });
    const unsub2 = subscribe("task_completed", (msg: WsMessage) => {
      refetchUnread();
      refetchMessages();
      // 任务完成时触发桌面弹窗通知（即使用户切换了标签页也能看到）
      const sourceLabel = msg.source?.toUpperCase() || "搜索";
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("DataReach 任务完成", {
          body: `${sourceLabel} 搜索任务已完成，共找到 ${msg.data?.totalResults || 0} 条结果`,
          icon: "/favicon.ico",
        });
      }
      toast.success(`${sourceLabel} 搜索任务已完成`, { duration: 5000 });
    });
    // 监听公告广播：收到新公告时立即刷新并提示
    const unsub3 = subscribe("announcement", (msg: WsMessage) => {
      refetchAnnouncements();
      refetchUnread();
      // 显示浏览器通知
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("📢 DataReach 系统公告", {
          body: msg.data?.title || "有新的系统公告",
          icon: "/favicon.ico",
        });
      }
      toast.info(`📢 新公告：${msg.data?.title || '有新的系统公告'}`, { duration: 6000 });
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [subscribe, refetchUnread, refetchMessages, refetchAnnouncements]);

  // 标记已读
  const markAsReadMutation = trpc.notification.markAsRead.useMutation({
    onSuccess: () => {
      refetchUnread();
      refetchMessages();
    },
  });

  // 标记全部已读
  const markAllAsReadMutation = trpc.notification.markAllAsRead.useMutation({
    onSuccess: () => {
      toast.success("已全部标记为已读");
      refetchUnread();
      refetchMessages();
    },
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "system":
        return <Info className="h-4 w-4 text-blue-400" />;
      case "support":
        return <MessageSquare className="h-4 w-4 text-green-400" />;
      case "notification":
        return <Bell className="h-4 w-4 text-orange-400" />;
      case "promotion":
        return <Gift className="h-4 w-4 text-purple-400" />;
      default:
        return <Bell className="h-4 w-4 text-slate-400" />;
    }
  };

  const getTypeBadge = (type: string) => {
    const styles: Record<string, string> = {
      system: "bg-blue-500/20 text-blue-400",
      support: "bg-green-500/20 text-green-400",
      notification: "bg-orange-500/20 text-orange-400",
      promotion: "bg-purple-500/20 text-purple-400",
    };
    const labels: Record<string, string> = {
      system: "系统",
      support: "客服",
      notification: "通知",
      promotion: "推广",
    };
    return (
      <Badge className={styles[type] || "bg-slate-500/20 text-slate-400"}>
        {labels[type] || type}
      </Badge>
    );
  };

  const getAnnouncementTypeIcon = (type: string) => {
    switch (type) {
      case "info":
        return <Info className="h-3.5 w-3.5 text-blue-400" />;
      case "success":
        return <Check className="h-3.5 w-3.5 text-green-400" />;
      case "warning":
        return <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />;
      case "error":
        return <AlertTriangle className="h-3.5 w-3.5 text-red-400" />;
      default:
        return <Info className="h-3.5 w-3.5 text-blue-400" />;
    }
  };

  const getAnnouncementTypeBadge = (type: string) => {
    const styles: Record<string, string> = {
      info: "bg-blue-500/20 text-blue-400 text-xs",
      success: "bg-green-500/20 text-green-400 text-xs",
      warning: "bg-orange-500/20 text-orange-400 text-xs",
      error: "bg-red-500/20 text-red-400 text-xs",
    };
    const labels: Record<string, string> = {
      info: "信息",
      success: "成功",
      warning: "警告",
      error: "紧急",
    };
    return (
      <Badge className={styles[type] || "bg-slate-500/20 text-slate-400 text-xs"}>
        {labels[type] || type}
      </Badge>
    );
  };

  const toggleAnnouncementExpand = (id: number) => {
    setExpandedAnnouncements(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleMessageExpand = (id: number) => {
    setExpandedMessages(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const unreadCount = unreadData?.count || 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`relative text-slate-400 hover:text-white ${unreadCount > 0 ? 'animate-bell-shake' : ''}`}
        >
          <Bell className={`h-5 w-5 ${unreadCount > 0 ? 'text-orange-400' : ''}`} />
          {unreadCount > 0 && (
            <>
              {/* 红色发光脉冲数字标记 */}
              <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold animate-badge-pulse">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[420px] p-0 bg-slate-900 border-slate-700 max-h-[70vh] flex flex-col"
        align="end"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Bell className="h-4 w-4 text-orange-400" />
            消息通知
            {unreadCount > 0 && (
              <Badge className="bg-red-500/20 text-red-400 text-xs ml-1">
                {unreadCount} 条未读
              </Badge>
            )}
          </h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllAsReadMutation.mutate()}
              className="text-xs text-slate-400 hover:text-white"
            >
              <CheckCheck className="h-4 w-4 mr-1" />
              全部已读
            </Button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin" style={{ scrollbarWidth: 'thin', scrollbarColor: '#475569 transparent' }}>
          {/* 公告区域 */}
          {announcements && announcements.length > 0 && (
            <div className="p-3 border-b border-slate-700 bg-orange-500/5">
              <div className="flex items-center gap-2 mb-2">
                <Megaphone className="h-4 w-4 text-orange-400" />
                <span className="text-sm font-medium text-orange-400">系统公告</span>
                <Badge className="bg-orange-500/20 text-orange-400 text-xs">
                  {announcements.length}
                </Badge>
              </div>
              {announcements.map((announcement: any) => {
                const isExpanded = expandedAnnouncements.has(announcement.id);
                const isLongContent = announcement.content && announcement.content.length > 80;
                return (
                  <div 
                    key={announcement.id}
                    className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 mb-2 last:mb-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        {getAnnouncementTypeIcon(announcement.type)}
                        <h4 className="font-medium text-white text-sm leading-snug break-words">{announcement.title}</h4>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {announcement.isPinned && (
                          <Pin className="h-3 w-3 text-orange-400" />
                        )}
                        {getAnnouncementTypeBadge(announcement.type)}
                      </div>
                    </div>
                    <p className={`text-slate-400 text-xs mt-2 whitespace-pre-line leading-relaxed ${!isExpanded && isLongContent ? "line-clamp-2" : ""}`}>
                      {announcement.content}
                    </p>
                    {isLongContent && (
                      <button
                        onClick={() => toggleAnnouncementExpand(announcement.id)}
                        className="text-cyan-400 text-xs mt-1.5 flex items-center gap-1 hover:text-cyan-300 transition-colors"
                      >
                        {isExpanded ? (
                          <>收起 <ChevronUp className="h-3 w-3" /></>
                        ) : (
                          <>展开全文 <ChevronDown className="h-3 w-3" /></>
                        )}
                      </button>
                    )}
                    <p className="text-slate-500 text-xs mt-2">
                      {new Date(announcement.createdAt).toLocaleString()}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* 消息列表 */}
          <div className="p-3">
            {messagesData?.messages && messagesData.messages.length > 0 ? (
              <div className="space-y-2">
                {messagesData.messages.map((message: any) => {
                  const isExpanded = expandedMessages.has(message.id);
                  const isLongContent = message.content && message.content.length > 80;
                  return (
                    <div
                      key={message.id}
                      className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                        message.isRead
                          ? "bg-slate-800/30 border-slate-700/30"
                          : "bg-slate-800/50 border-cyan-500/30 hover:bg-slate-800 hover:border-cyan-500/50"
                      }`}
                      onClick={() => {
                        if (!message.isRead) {
                          markAsReadMutation.mutate({ messageId: message.id });
                        }
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          {getTypeIcon(message.type)}
                          <h4 className={`text-sm ${message.isRead ? "text-slate-400" : "text-white font-medium"}`}>
                            {message.title}
                          </h4>
                        </div>
                        <div className="flex items-center gap-2">
                          {getTypeBadge(message.type)}
                          {!message.isRead && (
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500" />
                            </span>
                          )}
                        </div>
                      </div>
                      <p className={`text-slate-400 text-xs mt-1 whitespace-pre-line ${!isExpanded && isLongContent ? "line-clamp-2" : ""}`}>
                        {message.content}
                      </p>
                      {isLongContent && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMessageExpand(message.id);
                          }}
                          className="text-cyan-400 text-xs mt-1 flex items-center gap-1 hover:text-cyan-300 transition-colors"
                        >
                          {isExpanded ? (
                            <>收起 <ChevronUp className="h-3 w-3" /></>
                          ) : (
                            <>展开全文 <ChevronDown className="h-3 w-3" /></>
                          )}
                        </button>
                      )}
                      <p className="text-slate-500 text-xs mt-2">
                        {new Date(message.createdAt).toLocaleString()}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <Bell className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">暂无消息</p>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
