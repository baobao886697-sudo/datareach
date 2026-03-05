/**
 * 搜索历史页面 - 统一历史记录中心
 * 支持所有平台：LinkedIn / TruePeopleSearch / SPF / Anywho
 */

import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useWebSocketContext } from "@/contexts/WebSocketContext";
import { Link } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  History as HistoryIcon,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Plus,
  Filter,
  X,
  Linkedin,
  UserSearch,
  Globe,
  Phone,
} from "lucide-react";


// 动画样式
const rainbowStyles = `
  @keyframes rainbow-flow {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  
  @keyframes pulse-glow {
    0%, 100% {
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.4),
                  0 0 40px rgba(99, 102, 241, 0.3),
                  0 0 60px rgba(139, 92, 246, 0.2);
    }
    50% {
      box-shadow: 0 0 30px rgba(59, 130, 246, 0.6),
                  0 0 60px rgba(99, 102, 241, 0.5),
                  0 0 90px rgba(139, 92, 246, 0.4);
    }
  }
  
  @keyframes border-dance {
    0%, 100% { border-color: #3b82f6; }
    16% { border-color: #6366f1; }
    33% { border-color: #8b5cf6; }
    50% { border-color: #a855f7; }
    66% { border-color: #06b6d4; }
    83% { border-color: #10b981; }
  }
  
  .rainbow-text {
    background: linear-gradient(90deg, #3b82f6, #6366f1, #8b5cf6, #a855f7, #06b6d4, #10b981, #3b82f6);
    background-size: 200% auto;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer 3s linear infinite;
  }
  
  .rainbow-border {
    border: 2px solid transparent;
    animation: border-dance 4s linear infinite;
  }
  
  .rainbow-bg {
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1), rgba(168, 85, 247, 0.1), rgba(6, 182, 212, 0.1), rgba(16, 185, 129, 0.1));
    background-size: 400% 400%;
    animation: rainbow-flow 8s ease infinite;
  }
  
  .rainbow-btn {
    background: linear-gradient(135deg, #3b82f6, #6366f1, #8b5cf6, #06b6d4);
    background-size: 300% 300%;
    animation: rainbow-flow 3s ease infinite;
  }
`;

interface SearchParams {
  name?: string;
  title?: string;
  state?: string;
  limit?: number;
}

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
          <CheckCircle className="h-3 w-3 mr-1" />
          已完成
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
          <XCircle className="h-3 w-3 mr-1" />
          失败
        </Badge>
      );
    case "running":
    case "searching":
    case "fetching_details":
      return (
        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          运行中
        </Badge>
      );
    case "stopped":
    case "cancelled":
      return (
        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
          <AlertCircle className="h-3 w-3 mr-1" />
          已停止
        </Badge>
      );
    case "insufficient_credits":
      return (
        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
          <AlertCircle className="h-3 w-3 mr-1" />
          积分不足
        </Badge>
      );
    case "service_busy":
      return (
        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
          <AlertCircle className="h-3 w-3 mr-1" />
          服务繁忙
        </Badge>
      );
    case "pending":
    default:
      return (
        <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">
          <Clock className="h-3 w-3 mr-1" />
          等待中
        </Badge>
      );
  }
};

// ============================================================
// LinkedIn 历史记录 Tab
// ============================================================
function LinkedInHistoryTab() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const pageSize = 10;

  const { subscribe } = useWebSocketContext();
  const { data: tasksData, isLoading, refetch: refetchTasks } = trpc.search.tasks.useQuery(
    { limit: 50 },
    { enabled: !!user }
  );

  useEffect(() => {
    const unsub1 = subscribe("task_completed", () => refetchTasks());
    const unsub2 = subscribe("task_failed", () => refetchTasks());
    const unsub3 = subscribe("task_progress", () => refetchTasks());
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [subscribe, refetchTasks]);

  const tasks = tasksData?.tasks || [];

  const filteredTasks = useMemo(() => {
    return tasks.filter((task: any) => {
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (searchKeyword.trim()) {
        const keyword = searchKeyword.trim().toLowerCase();
        const params = task.params as SearchParams || {};
        const name = (params.name || "").toLowerCase();
        const title = (params.title || "").toLowerCase();
        const state = (params.state || "").toLowerCase();
        if (!name.includes(keyword) && !title.includes(keyword) && !state.includes(keyword)) return false;
      }
      return true;
    });
  }, [tasks, statusFilter, searchKeyword]);

  const totalPages = Math.ceil(filteredTasks.length / pageSize);
  const paginatedTasks = filteredTasks.slice((page - 1) * pageSize, page * pageSize);

  const hasActiveFilter = statusFilter !== "all" || searchKeyword.trim() !== "";

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-slate-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
          <Linkedin className="h-10 w-10 text-blue-400" />
        </div>
        <h3 className="text-xl font-semibold text-white">暂无 LinkedIn 搜索记录</h3>
        <p className="text-slate-400 mt-2">开始您的第一次 LinkedIn 搜索</p>
        <Link href="/search">
          <Button className="mt-6 rainbow-btn text-white border-0 shadow-lg shadow-blue-500/25">
            <Plus className="h-4 w-4 mr-2" />
            开始搜索
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 筛选栏 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="搜索姓名、职位、地区..."
            value={searchKeyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearchKeyword(e.target.value); setPage(1); }}
            className="pl-8 bg-slate-800/50 border-slate-700 text-sm placeholder:text-slate-500 focus:border-blue-500/50"
          />
          {searchKeyword && (
            <button onClick={() => { setSearchKeyword(""); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-28 bg-slate-800/50 border-slate-700 text-sm">
            <Filter className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="completed">已完成</SelectItem>
            <SelectItem value="running">运行中</SelectItem>
            <SelectItem value="failed">失败</SelectItem>
          </SelectContent>
        </Select>
        {hasActiveFilter && (
          <Button variant="ghost" size="sm" onClick={() => { setStatusFilter("all"); setSearchKeyword(""); setPage(1); }} className="text-slate-400 hover:text-white text-xs px-2">
            清除筛选
          </Button>
        )}
      </div>

      {/* 表格 */}
      <div className="rounded-lg border border-slate-700/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-800/50 hover:bg-slate-800/50">
              <TableHead className="text-slate-400">搜索条件</TableHead>
              <TableHead className="text-slate-400">状态</TableHead>
              <TableHead className="text-slate-400 text-center">请求数量</TableHead>
              <TableHead className="text-slate-400 text-center">有效结果</TableHead>
              <TableHead className="text-slate-400 text-center">消耗积分</TableHead>
              <TableHead className="text-slate-400">创建时间</TableHead>
              <TableHead className="text-slate-400 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedTasks.map((task: any) => {
              const params = task.params as SearchParams || {};
              return (
                <TableRow
                  key={task.id}
                  className="hover:bg-slate-800/30 border-slate-700/30 cursor-pointer"
                  onClick={() => {
                    if (task.status === "completed" || task.status === "failed" || task.status === "stopped") {
                      setLocation(`/results/${task.taskId}`);
                    } else {
                      setLocation(`/progress/${task.taskId}`);
                    }
                  }}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium text-white">{params.name || "未知搜索"}</p>
                      <p className="text-sm text-slate-400">{params.title || "-"} · {params.state || "-"}</p>
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(task.status)}</TableCell>
                  <TableCell className="text-center">
                    <span className="font-mono text-slate-300">{task.requestedCount || params.limit || 0}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-mono text-green-400">{task.actualCount || 0}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-mono text-yellow-400">{Number(task.creditsUsed)?.toFixed(1) || 0}</span>
                  </TableCell>
                  <TableCell className="text-slate-400">{formatDate(task.createdAt)}</TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="sm" className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10">
                      <Eye className="h-4 w-4 mr-1" />
                      查看
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">第 {page} 页，共 {totalPages} 页（{filteredTasks.length} 条记录）</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="border-slate-700 hover:bg-slate-800">
              <ChevronLeft className="h-4 w-4" /> 上一页
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="border-slate-700 hover:bg-slate-800">
              下一页 <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 通用的人员搜索平台历史 Tab（TPS / SPF / Anywho 共用）
// 数据格式：
//   TPS: { tasks: [{ taskId, mode, names, locations, totalSubTasks, completedSubTasks, totalResults, creditsUsed, status, createdAt }], total }
//   SPF: { tasks: [{ taskId, status, mode, names, locations, totalResults, creditsUsed, createdAt, completedAt }], total }
//   Anywho: { tasks: [{ taskId, mode, names, locations, totalSubTasks, completedSubTasks, totalResults, creditsUsed, status, createdAt }], total }
// ============================================================
function PeopleSearchHistoryTab({ 
  platform, 
  colorClass, 
  icon: Icon, 
  newSearchPath,
  taskDetailPath,
}: { 
  platform: "tps" | "spf" | "anywho";
  colorClass: { text: string; border: string; hover: string; hoverBg: string; activeBg: string };
  icon: React.ElementType;
  newSearchPath: string;
  taskDetailPath: string;
}) {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // 根据平台选择不同的 tRPC 查询
  const tpsQuery = trpc.tps.getHistory.useQuery(
    { page, pageSize },
    { enabled: platform === "tps" }
  );
  const spfQuery = trpc.spf.getHistory.useQuery(
    { page, pageSize },
    { enabled: platform === "spf" }
  );
  const anywhoQuery = trpc.anywho.getHistory.useQuery(
    { page, pageSize },
    { enabled: platform === "anywho" }
  );

  const query = platform === "tps" ? tpsQuery : platform === "spf" ? spfQuery : anywhoQuery;
  const { data: history, isLoading } = query;

  const platformNames: Record<string, string> = {
    tps: "TruePeopleSearch",
    spf: "SearchPeopleFree",
    anywho: "Anywho",
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-slate-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  const tasks = history?.tasks || [];
  const total = history?.total || 0;

  if (tasks.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
          <Icon className={`h-10 w-10 ${colorClass.text}`} />
        </div>
        <h3 className="text-xl font-semibold text-white">暂无 {platformNames[platform]} 搜索记录</h3>
        <p className="text-slate-400 mt-2">开始您的第一次 {platformNames[platform]} 搜索</p>
        <Link href={newSearchPath}>
          <Button className="mt-6 rainbow-btn text-white border-0 shadow-lg">
            <Plus className="h-4 w-4 mr-2" />
            开始搜索
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-700/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-800/50 hover:bg-slate-800/50">
              <TableHead className="text-slate-400">任务ID</TableHead>
              <TableHead className="text-slate-400">搜索姓名</TableHead>
              <TableHead className="text-slate-400">搜索模式</TableHead>
              <TableHead className="text-slate-400 text-center">子任务进度</TableHead>
              <TableHead className="text-slate-400 text-center">结果数</TableHead>
              <TableHead className="text-slate-400 text-center">消耗积分</TableHead>
              <TableHead className="text-slate-400">状态</TableHead>
              <TableHead className="text-slate-400">创建时间</TableHead>
              <TableHead className="text-slate-400 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task: any) => {
              // 兼容不同平台的字段名
              const names: string[] = task.names || [];
              const namesDisplay = names.length > 2 
                ? `${names.slice(0, 2).join(", ")}... (+${names.length - 2})`
                : names.join(", ");
              const mode = task.mode || "nameOnly";
              const completedSubs = task.completedSubTasks ?? task.completedNames ?? 0;
              const totalSubs = task.totalSubTasks ?? task.totalNames ?? names.length;
              const totalResults = task.totalResults || 0;
              const creditsUsed = parseFloat(String(task.creditsUsed)) || 0;

              return (
                <TableRow key={task.taskId} className="hover:bg-slate-800/30 border-slate-700/30">
                  <TableCell className="font-mono text-sm text-slate-300">
                    {task.taskId?.substring(0, 8)}...
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[200px]">
                      <p className="font-medium text-white truncate" title={names.join(", ")}>
                        {namesDisplay || "未知"}
                      </p>
                      {task.locations && (task.locations as string[]).length > 0 && (
                        <p className="text-xs text-slate-400 truncate">
                          {(task.locations as string[]).join(", ")}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`${colorClass.text} ${colorClass.border}`}>
                      {mode === "nameOnly" || mode === "name_only" ? "仅姓名" : "姓名+地点"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-slate-300">
                    {completedSubs} / {totalSubs}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-mono text-green-400">{totalResults}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-mono text-yellow-400">{creditsUsed.toFixed(1)}</span>
                  </TableCell>
                  <TableCell>{getStatusBadge(task.status)}</TableCell>
                  <TableCell className="text-slate-400">{formatDate(task.createdAt)}</TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`${colorClass.text} ${colorClass.hover} ${colorClass.hoverBg}`}
                      onClick={() => setLocation(`${taskDetailPath}/${task.taskId}`)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      查看
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* 分页 */}
      {total > pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            第 {page} 页，共 {Math.ceil(total / pageSize)} 页（{total} 条记录）
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="border-slate-700 hover:bg-slate-800">
              <ChevronLeft className="h-4 w-4" /> 上一页
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * pageSize >= total} className="border-slate-700 hover:bg-slate-800">
              下一页 <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 主页面
// ============================================================
export default function History() {
  const [activeTab, setActiveTab] = useState("tps");

  return (
    <DashboardLayout>
      <style>{rainbowStyles}</style>
      <div className="p-6 space-y-6">
        {/* 顶部横幅 */}
        <div className="relative overflow-hidden rounded-2xl rainbow-bg p-6 rainbow-border">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 via-indigo-600/20 to-purple-600/20" />
          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <HistoryIcon className="h-5 w-5 text-blue-400" />
                <span className="text-sm text-blue-400">统一历史中心</span>
              </div>
              <h1 className="text-2xl font-bold rainbow-text flex items-center gap-2">
                <HistoryIcon className="h-6 w-6 text-blue-500" />
                搜索历史
              </h1>
              <p className="text-slate-400 mt-1">
                查看所有平台的搜索任务记录
              </p>
            </div>
          </div>
        </div>

        {/* 平台标签页 */}
        <Card className="rainbow-border bg-gradient-to-br from-slate-900/80 to-slate-800/50">
          <CardContent className="pt-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4 bg-slate-800/50 mb-6">
                <TabsTrigger value="tps" className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400 flex items-center gap-1.5 text-xs sm:text-sm">
                  <UserSearch className="h-4 w-4" />
                  <span className="hidden sm:inline">TruePeopleSearch</span>
                  <span className="sm:hidden">TPS</span>
                </TabsTrigger>
                <TabsTrigger value="spf" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400 flex items-center gap-1.5 text-xs sm:text-sm">
                  <Globe className="h-4 w-4" />
                  <span className="hidden sm:inline">SearchPeopleFree</span>
                  <span className="sm:hidden">SPF</span>
                </TabsTrigger>
                <TabsTrigger value="anywho" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400 flex items-center gap-1.5 text-xs sm:text-sm">
                  <Phone className="h-4 w-4" />
                  Anywho
                </TabsTrigger>
                <TabsTrigger value="linkedin" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-400 flex items-center gap-1.5 text-xs sm:text-sm">
                  <Linkedin className="h-4 w-4" />
                  LinkedIn
                </TabsTrigger>
              </TabsList>

              <TabsContent value="tps">
                <PeopleSearchHistoryTab
                  platform="tps"
                  colorClass={{
                    text: "text-amber-400",
                    border: "border-amber-500/30",
                    hover: "hover:text-amber-300",
                    hoverBg: "hover:bg-amber-500/10",
                    activeBg: "bg-amber-500/20",
                  }}
                  icon={UserSearch}
                  newSearchPath="/tps"
                  taskDetailPath="/tps/task"
                />
              </TabsContent>
              <TabsContent value="spf">
                <PeopleSearchHistoryTab
                  platform="spf"
                  colorClass={{
                    text: "text-emerald-400",
                    border: "border-emerald-500/30",
                    hover: "hover:text-emerald-300",
                    hoverBg: "hover:bg-emerald-500/10",
                    activeBg: "bg-emerald-500/20",
                  }}
                  icon={Globe}
                  newSearchPath="/spf/search"
                  taskDetailPath="/spf/task"
                />
              </TabsContent>
              <TabsContent value="anywho">
                <PeopleSearchHistoryTab
                  platform="anywho"
                  colorClass={{
                    text: "text-purple-400",
                    border: "border-purple-500/30",
                    hover: "hover:text-purple-300",
                    hoverBg: "hover:bg-purple-500/10",
                    activeBg: "bg-purple-500/20",
                  }}
                  icon={Phone}
                  newSearchPath="/anywho"
                  taskDetailPath="/anywho/task"
                />
              </TabsContent>
              <TabsContent value="linkedin">
                <LinkedInHistoryTab />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
