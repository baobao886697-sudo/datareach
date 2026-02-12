import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Bell, Check, CheckCheck, Megaphone, MessageSquare,
  Info, AlertTriangle, Gift, X, ChevronDown, ChevronUp, Pin
} from "lucide-react";

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [expandedAnnouncements, setExpandedAnnouncements] = useState<Set<number>>(new Set());
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());

  // 获取未读消息数量
  const { data: unreadData, refetch: refetchUnread } = trpc.notification.getUnreadCount.useQuery(
    undefined,
    { refetchInterval: 30000 } // 每30秒刷新一次
  );

  // 获取消息列表
  const { data: messagesData, refetch: refetchMessages } = trpc.notification.getMessages.useQuery(
    { limit: 20 },
    { enabled: open }
  );

  // 获取公告
  const { data: announcements } = trpc.notification.getAnnouncements.useQuery();

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

  const getAnnouncementTypeBadge = (type: string) => {
    const styles: Record<string, string> = {
      info: "bg-blue-500/20 text-blue-400",
      success: "bg-green-500/20 text-green-400",
      warning: "bg-orange-500/20 text-orange-400",
      error: "bg-red-500/20 text-red-400",
    };
    const labels: Record<string, string> = {
      info: "信息",
      success: "成功",
      warning: "警告",
      error: "紧急",
    };
    return (
      <Badge className={styles[type] || "bg-slate-500/20 text-slate-400"}>
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
          className="relative text-slate-400 hover:text-white"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-96 p-0 bg-slate-900 border-slate-700"
        align="end"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Bell className="h-4 w-4 text-orange-400" />
            消息通知
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

        <ScrollArea className="max-h-[400px]">
          {/* 公告区域 */}
          {announcements && announcements.length > 0 && (
            <div className="p-3 border-b border-slate-700 bg-orange-500/5">
              <div className="flex items-center gap-2 mb-2">
                <Megaphone className="h-4 w-4 text-orange-400" />
                <span className="text-sm font-medium text-orange-400">系统公告</span>
              </div>
              {announcements.map((announcement: any) => {
                const isExpanded = expandedAnnouncements.has(announcement.id);
                const isLongContent = announcement.content && announcement.content.length > 80;
                return (
                  <div 
                    key={announcement.id}
                    className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 mb-2 last:mb-0"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <h4 className="font-medium text-white text-sm truncate">{announcement.title}</h4>
                      </div>
                      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                        {announcement.isPinned && (
                          <Pin className="h-3 w-3 text-orange-400" />
                        )}
                        {(announcement.type === "error" || announcement.type === "warning") && (
                          <Badge className={
                            announcement.type === "error" 
                              ? "bg-red-500/20 text-red-400 text-xs" 
                              : "bg-orange-500/20 text-orange-400 text-xs"
                          }>
                            {announcement.type === "error" ? "紧急" : "警告"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className={`text-slate-400 text-xs mt-1 whitespace-pre-line ${!isExpanded && isLongContent ? "line-clamp-2" : ""}`}>
                      {announcement.content}
                    </p>
                    {isLongContent && (
                      <button
                        onClick={() => toggleAnnouncementExpand(announcement.id)}
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
                          : "bg-slate-800/50 border-slate-700/50 hover:bg-slate-800"
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
                            <span className="h-2 w-2 rounded-full bg-blue-500" />
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
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
