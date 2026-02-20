/**
 * 搜索历史页面 - 黄金模板 v2.0
 * 统一七彩鍯金风格
 */

import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Star,
  Plus,
  Target,
  Zap,
  Users,
  Filter,
  X,
} from "lucide-react";


// 七彩鍯金动画样式 - 蓝色主题
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
  
  .rainbow-glow {
    animation: pulse-glow 2s ease-in-out infinite;
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

export default function History() {
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
  
  // WebSocket 实时更新：任务状态变化时自动刷新列表
  useEffect(() => {
    const unsub1 = subscribe("task_completed", () => refetchTasks());
    const unsub2 = subscribe("task_failed", () => refetchTasks());
    const unsub3 = subscribe("task_progress", () => refetchTasks());
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [subscribe, refetchTasks]);

  const tasks = tasksData?.tasks || [];

  // 纯前端筛选 - 不影响原始数据
  const filteredTasks = useMemo(() => {
    return tasks.filter((task: any) => {
      // 状态筛选
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      // 关键词搜索（搜索条件中的姓名、职位、地区）
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

  // 筛选变化时重置页码
  const handleFilterChange = (newStatus: string) => {
    setStatusFilter(newStatus);
    setPage(1);
  };
  const handleSearchChange = (value: string) => {
    setSearchKeyword(value);
    setPage(1);
  };

  const hasActiveFilter = statusFilter !== "all" || searchKeyword.trim() !== "";

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
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            运行中
          </Badge>
        );
      case "stopped":
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

  return (
    <DashboardLayout>
      <style>{rainbowStyles}</style>
      <div className="p-6 space-y-6">
        {/* 顶部横幅 */}
        <div className="relative overflow-hidden rounded-2xl rainbow-bg p-6 rainbow-border">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 via-indigo-600/20 to-purple-600/20" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation("/search")}
                className="text-slate-400 hover:text-white hover:bg-slate-800/50"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <HistoryIcon className="h-5 w-5 text-blue-400" />
                  <span className="text-sm text-blue-400">任务记录</span>
                </div>
                <h1 className="text-2xl font-bold rainbow-text flex items-center gap-2">
                  <HistoryIcon className="h-6 w-6 text-blue-500" />
                  搜索历史
                </h1>
                <p className="text-slate-400 mt-1">
                  查看您的搜索任务记录，结果保留180天
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/20 border border-blue-500/30">
                <Star className="h-4 w-4 text-blue-400" />
                <span className="text-sm text-blue-400">专业人士数据库</span>
              </div>
              <Link href="/search">
                <Button className="rainbow-btn text-white border-0 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-shadow">
                  <Plus className="h-4 w-4 mr-2" />
                  新建搜索
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="rainbow-border bg-gradient-to-br from-slate-900/80 to-slate-800/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">总任务数</p>
                  <p className="text-2xl font-bold rainbow-text mt-1">
                    {tasks.length}
                  </p>
                </div>
                <Target className="h-8 w-8 text-blue-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="rainbow-border bg-gradient-to-br from-slate-900/80 to-slate-800/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">已完成</p>
                  <p className="text-2xl font-bold text-green-400 mt-1">
                    {tasks.filter((t: any) => t.status === "completed").length}
                  </p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="rainbow-border bg-gradient-to-br from-slate-900/80 to-slate-800/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">总结果数</p>
                  <p className="text-2xl font-bold text-cyan-400 mt-1">
                    {tasks.reduce((sum: number, t: any) => sum + (t.actualCount || 0), 0)}
                  </p>
                </div>
                <Users className="h-8 w-8 text-cyan-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="rainbow-border bg-gradient-to-br from-slate-900/80 to-slate-800/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">消耗积分</p>
                  <p className="text-2xl font-bold text-yellow-400 mt-1">
                    {tasks.reduce((sum: number, t: any) => sum + (Number(t.creditsUsed) || 0), 0).toFixed(1)}
                  </p>
                </div>
                <Zap className="h-8 w-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 任务列表 */}
        <Card className="rainbow-border bg-gradient-to-br from-slate-900/80 to-slate-800/50">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <HistoryIcon className="h-5 w-5 text-blue-400" />
                <span className="rainbow-text">任务列表</span>
                {hasActiveFilter && (
                  <Badge variant="outline" className="ml-2 text-xs text-blue-400 border-blue-500/30">
                    {filteredTasks.length} 条结果
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="搜索姓名、职位、地区..."
                    value={searchKeyword}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearchChange(e.target.value)}
                    className="pl-8 w-48 bg-slate-800/50 border-slate-700 text-sm placeholder:text-slate-500 focus:border-blue-500/50"
                  />
                  {searchKeyword && (
                    <button
                      onClick={() => handleSearchChange("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Select value={statusFilter} onValueChange={handleFilterChange}>
                  <SelectTrigger className="w-28 bg-slate-800/50 border-slate-700 text-sm">
                    <Filter className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="completed">已完成</SelectItem>
                    <SelectItem value="running">运行中</SelectItem>
                    <SelectItem value="failed">失败</SelectItem>
                    <SelectItem value="stopped">已停止</SelectItem>
                    <SelectItem value="pending">等待中</SelectItem>
                  </SelectContent>
                </Select>
                {hasActiveFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setStatusFilter("all"); setSearchKeyword(""); setPage(1); }}
                    className="text-slate-400 hover:text-white text-xs px-2"
                  >
                    清除筛选
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-slate-800/50 animate-pulse" />
                ))}
              </div>
            ) : paginatedTasks.length > 0 ? (
              <>
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
                                <p className="font-medium text-white">
                                  {params.name || "未知搜索"}
                                </p>
                                <p className="text-sm text-slate-400">
                                  {params.title || "-"} · {params.state || "-"}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>{getStatusBadge(task.status)}</TableCell>
                            <TableCell className="text-center">
                              <span className="font-mono text-slate-300">
                                {task.requestedCount || params.limit || 0}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="font-mono text-green-400">
                                {task.actualCount || 0}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="font-mono text-yellow-400">
                                {Number(task.creditsUsed)?.toFixed(1) || 0}
                              </span>
                            </TableCell>
                            <TableCell className="text-slate-400">
                              {formatDate(task.createdAt)}
                            </TableCell>
                            <TableCell className="text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
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
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      第 {page} 页，共 {totalPages} 页（{filteredTasks.length} 条记录）
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(Math.max(1, page - 1))}
                        disabled={page === 1}
                        className="border-slate-700 hover:bg-slate-800"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        上一页
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(Math.min(totalPages, page + 1))}
                        disabled={page === totalPages}
                        className="border-slate-700 hover:bg-slate-800"
                      >
                        下一页
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : hasActiveFilter ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                  <Filter className="h-8 w-8 text-slate-500" />
                </div>
                <h3 className="text-lg font-semibold text-white">未找到匹配的任务</h3>
                <p className="text-slate-400 mt-2 text-sm">
                  请尝试调整筛选条件或清除筛选
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setStatusFilter("all"); setSearchKeyword(""); setPage(1); }}
                  className="mt-4 border-slate-700 hover:bg-slate-800"
                >
                  清除筛选
                </Button>
              </div>
            ) : (
              <div className="text-center py-16">
                <div className="w-20 h-20 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4 rainbow-glow">
                  <HistoryIcon className="h-10 w-10 text-blue-400" />
                </div>
                <h3 className="text-xl font-semibold text-white">暂无搜索记录</h3>
                <p className="text-slate-400 mt-2">
                  开始您的第一次搜索
                </p>
                <Link href="/search">
                  <Button className="mt-6 rainbow-btn text-white border-0 shadow-lg shadow-blue-500/25">
                    <Plus className="h-4 w-4 mr-2" />
                    开始搜索
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
