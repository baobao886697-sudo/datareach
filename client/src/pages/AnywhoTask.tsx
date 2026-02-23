/**
 * Anywho 任务详情页面 - 黄金模板 v2.0
 * 整合实时日志终端功能
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useWebSocketContext } from "@/contexts/WebSocketContext";
import type { WsMessage } from "@/hooks/useWebSocket";
import {
  ArrowLeft,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Download,
  RefreshCw,
  Phone,
  MapPin,
  User,
  Home,
  Calendar,
  CreditCard,
  FileText,
  ChevronLeft,
  ChevronRight,
  Heart,
  Star,
  Building,
  Users,
  Terminal,
  Activity,
  Zap,
  AlertCircle,
  AlertTriangle,
  Info,
  DollarSign,
  Wifi,
} from "lucide-react";

// 七彩鎏金动画样式
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
      box-shadow: 0 0 20px rgba(245, 158, 11, 0.4),
                  0 0 40px rgba(255, 165, 0, 0.3),
                  0 0 60px rgba(255, 105, 180, 0.2);
    }
    50% {
      box-shadow: 0 0 30px rgba(245, 158, 11, 0.6),
                  0 0 60px rgba(255, 165, 0, 0.5),
                  0 0 90px rgba(255, 105, 180, 0.4);
    }
  }
  
  @keyframes border-dance {
    0%, 100% { border-color: #f59e0b; }
    16% { border-color: #ff6b6b; }
    33% { border-color: #ff69b4; }
    50% { border-color: #9b59b6; }
    66% { border-color: #3498db; }
    83% { border-color: #2ecc71; }
  }
  
  .rainbow-text {
    background: linear-gradient(90deg, #f59e0b, #ffb347, #ff6b6b, #ff69b4, #9b59b6, #3498db, #2ecc71, #f59e0b);
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
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(255, 179, 71, 0.1), rgba(255, 107, 107, 0.1), rgba(255, 105, 180, 0.1), rgba(155, 89, 182, 0.1), rgba(52, 152, 219, 0.1), rgba(46, 204, 113, 0.1));
    background-size: 400% 400%;
    animation: rainbow-flow 8s ease infinite;
  }
  
  .terminal-log {
    font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.6;
  }
  
  .log-entry {
    padding: 4px 8px;
    border-radius: 4px;
    margin-bottom: 2px;
    transition: background-color 0.2s;
  }
  
  .log-entry:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }
  
  .log-time {
    color: #6b7280;
    margin-right: 8px;
  }
  
  .log-info { color: #60a5fa; }
  .log-success { color: #34d399; }
  .log-warning { color: #fbbf24; }
  .log-error { color: #f87171; }
  .log-progress { color: #a78bfa; }
  .log-config { color: #f472b6; }
  .log-cost { color: #fcd34d; }
  
  @keyframes new-log-flash {
    0% { background-color: rgba(245, 158, 11, 0.3); }
    100% { background-color: transparent; }
  }
  
  .log-new {
    animation: new-log-flash 1s ease-out;
  }
`;

export default function AnywhoTask() {
  const params = useParams();
  const taskId = params.taskId;
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [prevLogCount, setPrevLogCount] = useState(0);
  
  // WebSocket 实时推送
  const { subscribe, isConnected } = useWebSocketContext();
  
  // 获取任务状态
  const { data: task, refetch: refetchTask } = trpc.anywho.getTaskStatus.useQuery(
    { taskId: taskId! },
    {
      enabled: !!taskId,
      refetchInterval: (query) => {
        const data = query.state.data;
        if (data?.status === "running" || data?.status === "pending") {
          return 2000;
        }
        return false;
      },
    }
  );
  
  // 获取搜索结果
  const { data: results, refetch: refetchResults } = trpc.anywho.getTaskResults.useQuery(
    { taskId: taskId!, page, pageSize },
    { enabled: !!taskId && (task?.status === "completed" || task?.status === "insufficient_credits" || task?.status === "service_busy") }
  );
  
  // v9.0: 任务超时检测
  const [lastProgressTime, setLastProgressTime] = useState<number>(Date.now());
  const [isStale, setIsStale] = useState(false);
  
  useEffect(() => {
    if (task?.status === 'running') {
      setLastProgressTime(Date.now());
      setIsStale(false);
    }
  }, [task?.progress, task?.totalResults, task?.logs?.length]);
  
  useEffect(() => {
    if (task?.status !== 'running') {
      setIsStale(false);
      return;
    }
    const checkInterval = setInterval(() => {
      if (Date.now() - lastProgressTime > 5 * 60 * 1000) {
        setIsStale(true);
      }
    }, 30000);
    return () => clearInterval(checkInterval);
  }, [task?.status, lastProgressTime]);
  
  // WebSocket 实时订阅：收到推送时立即刷新数据
  useEffect(() => {
    if (!taskId) return;
    
    const unsub1 = subscribe("task_progress", (msg: WsMessage) => {
      if (msg.taskId === taskId && msg.source === "anywho") {
        refetchTask();
      }
    });
    const unsub2 = subscribe("task_completed", (msg: WsMessage) => {
      if (msg.taskId === taskId && msg.source === "anywho") {
        refetchTask();
        refetchResults();
        const status = msg.data?.status;
        if (status === "insufficient_credits") {
          toast.warning(`⚠️ 积分不足，Anywho 任务提前结束。已找到 ${msg.data?.totalResults || 0} 条结果`, {
            duration: 8000,
          });
        } else if (status === "service_busy") {
          toast.warning(`⚠️ 服务繁忙，Anywho 任务提前结束。已找到 ${msg.data?.totalResults || 0} 条结果`, {
            duration: 8000,
          });
        } else {
          toast.success(`✅ Anywho 搜索任务已完成！共找到 ${msg.data?.totalResults || 0} 条结果`, {
            duration: 8000,
          });
        }
      }
    });
    const unsub3 = subscribe("task_failed", (msg: WsMessage) => {
      if (msg.taskId === taskId && msg.source === "anywho") {
        refetchTask();
        toast.error(`❌ Anywho 搜索任务失败: ${msg.data?.error || "未知错误"}`, {
          duration: 8000,
        });
      }
    });
    
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [taskId, subscribe, refetchTask, refetchResults]);
  
  // 自动滚动到最新日志
  useEffect(() => {
    if (autoScroll && logContainerRef.current && task?.logs) {
      const container = logContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
    if (task?.logs) {
      setPrevLogCount(task.logs.length);
    }
  }, [task?.logs, autoScroll]);
  
  // 解析日志类型
  const getLogType = (message: string): string => {
    if (message.includes('[成功]') || message.includes('✅') || message.includes('完成')) return 'success';
    if (message.includes('[错误]') || message.includes('失败') || message.includes('❌')) return 'error';
    if (message.includes('[警告]') || message.includes('⚠️') || message.includes('重试')) return 'warning';
    if (message.includes('进度') || message.includes('📥') || message.includes('%')) return 'progress';
    if (message.includes('[配置]') || message.includes('[并发]') || message.includes('•')) return 'config';
    if (message.includes('[费用]') || message.includes('积分') || message.includes('💰')) return 'cost';
    return 'info';
  };
  
  // 格式化时间
  const formatLogTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  // 获取日志图标
  const getLogIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle className="h-3 w-3 text-green-400" />;
      case 'error': return <AlertCircle className="h-3 w-3 text-red-400" />;
      case 'warning': return <AlertCircle className="h-3 w-3 text-yellow-400" />;
      case 'progress': return <Activity className="h-3 w-3 text-purple-400" />;
      case 'config': return <Info className="h-3 w-3 text-pink-400" />;
      case 'cost': return <DollarSign className="h-3 w-3 text-yellow-400" />;
      default: return <Zap className="h-3 w-3 text-blue-400" />;
    }
  };
  
  // 导出 CSV
  const exportMutation = trpc.anywho.exportResults.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    },
    onError: (error: any) => {
      toast.error("导出失败", { description: error.message });
    },
  });
  
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">等待中</Badge>;
      case "running":
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">搜索中</Badge>;
      case "completed":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">已完成</Badge>;
      case "insufficient_credits":
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">积分不足</Badge>;
      case "service_busy":
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">服务繁忙</Badge>;
      case "failed":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">失败</Badge>;
      case "cancelled":
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">已取消</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getMarriageStatusBadge = (status: string | null | undefined) => {
    if (!status) return <span className="text-gray-500">-</span>;
    switch (status.toLowerCase()) {
      case "single":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">单身</Badge>;
      case "married":
        return <Badge className="bg-pink-500/20 text-pink-400 border-pink-500/30">已婚</Badge>;
      case "divorced":
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">离异</Badge>;
      case "widowed":
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">丧偶</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };
  
  if (!taskId) {
    return (
      <DashboardLayout>
        <style>{rainbowStyles}</style>
        <div className="flex flex-col items-center justify-center h-64">
          <XCircle className="h-12 w-12 text-red-500 mb-4" />
          <p className="text-muted-foreground">任务ID无效</p>
          <Button variant="outline" onClick={() => setLocation("/anywho")} className="mt-4">
            返回搜索
          </Button>
        </div>
      </DashboardLayout>
    );
  }
  
  return (
    <DashboardLayout>
      <style>{rainbowStyles}</style>
      
      <div className="p-6 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/anywho")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Star className="h-6 w-6 text-amber-400 fill-amber-400" />
                <span className="rainbow-text">Anywho 搜索任务</span>
              </h1>
              <p className="text-muted-foreground mt-1 font-mono text-sm">
                {taskId}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(task?.status === "completed" || task?.status === "insufficient_credits" || task?.status === "service_busy") && (
              <Button
                variant="outline"
                onClick={() => exportMutation.mutate({ taskId: taskId! })}
                disabled={exportMutation.isPending}
                className="rainbow-border"
              >
                {exportMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                导出 CSV
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                refetchTask();
                refetchResults();
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              刷新
            </Button>
          </div>
        </div>
        
        {/* 任务状态卡片 - 4个状态卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="rainbow-bg rainbow-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">任务状态</p>
                  <div className="mt-1">{task && getStatusBadge(task.status)}</div>
                </div>
                {task?.status === "running" ? (
                  <Loader2 className="h-8 w-8 text-amber-500 animate-spin" />
                ) : task?.status === "completed" ? (
                  <CheckCircle className="h-8 w-8 text-green-500" />
                ) : task?.status === "insufficient_credits" ? (
                  <AlertTriangle className="h-8 w-8 text-orange-500" />
                ) : task?.status === "service_busy" ? (
                  <AlertTriangle className="h-8 w-8 text-amber-500" />
                ) : task?.status === "failed" ? (
                  <XCircle className="h-8 w-8 text-red-500" />
                ) : (
                  <Clock className="h-8 w-8 text-yellow-500" />
                )}
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-purple-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">搜索进度</p>
                  <p className="text-2xl font-bold mt-1">
                    {task?.completedSubTasks || 0} / {task?.totalSubTasks || 0}
                  </p>
                </div>
                <FileText className="h-8 w-8 text-purple-500" />
              </div>
              <Progress value={task?.progress || 0} className="mt-3 h-2" />
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">搜索结果</p>
                  <p className="text-2xl font-bold text-amber-400 mt-1">
                    {task?.totalResults || 0}
                  </p>
                </div>
                <User className="h-8 w-8 text-amber-500" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                缓存命中: {task?.cacheHits || 0}
              </p>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">消耗积分</p>
                  <p className="text-2xl font-bold text-green-400 mt-1">
                    {task?.creditsUsed != null ? Number(task.creditsUsed).toFixed(1) : '0.0'}
                  </p>
                </div>
                <CreditCard className="h-8 w-8 text-green-500" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                搜索页: {task?.searchPageRequests || 0} · 详情页: {task?.detailPageRequests || 0}
              </p>
            </CardContent>
          </Card>
        </div>
        
        {/* v9.0: 任务超时提示 */}
        {isStale && task?.status === "running" && (
          <Card className="border-amber-500/50 bg-amber-500/10">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0" />
                <div>
                  <p className="text-amber-300 font-medium">任务可能已停滞</p>
                  <p className="text-amber-400/70 text-sm mt-1">该任务已超过 5 分钟未有新的进度更新。系统正在自动检测并尝试恢复，如问题持续请联系客服。已获取的结果已实时保存，不会丢失。</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* 实时日志终端 - 黄金模板核心功能 */}
        {(task?.status === "running" || task?.status === "pending" || (task?.logs && task.logs.length > 0)) && (
          <Card className="rainbow-border overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-slate-900 to-slate-800 border-b border-slate-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  </div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Terminal className="h-5 w-5 text-amber-400" />
                    实时日志终端
                    {task?.status === "running" && (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 animate-pulse">
                        <Activity className="h-3 w-3 mr-1" />
                        运行中
                      </Badge>
                    )}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAutoScroll(!autoScroll)}
                    className={autoScroll ? "text-amber-400" : "text-muted-foreground"}
                  >
                    {autoScroll ? "自动滚动: 开" : "自动滚动: 关"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {/* 进度概览 */}
              <div className="grid grid-cols-4 gap-px bg-slate-800">
                <div className="bg-slate-900 p-3 text-center">
                  <p className="text-xs text-muted-foreground">搜索页请求</p>
                  <p className="text-lg font-bold text-blue-400">{task?.searchPageRequests || 0}</p>
                </div>
                <div className="bg-slate-900 p-3 text-center">
                  <p className="text-xs text-muted-foreground">详情页请求</p>
                  <p className="text-lg font-bold text-purple-400">{task?.detailPageRequests || 0}</p>
                </div>
                <div className="bg-slate-900 p-3 text-center">
                  <p className="text-xs text-muted-foreground">缓存命中</p>
                  <p className="text-lg font-bold text-green-400">{task?.cacheHits || 0}</p>
                </div>
                <div className="bg-slate-900 p-3 text-center">
                  <p className="text-xs text-muted-foreground">当前费用</p>
                  <p className="text-lg font-bold text-amber-400">{task?.creditsUsed != null ? Number(task.creditsUsed).toFixed(1) : '0.0'}</p>
                </div>
              </div>
              
              {/* 日志内容 */}
              <div 
                ref={logContainerRef}
                className="h-64 overflow-y-auto bg-slate-950 p-4 terminal-log"
              >
                {task?.logs && task.logs.length > 0 ? (
                  task.logs.map((log: any, index: number) => {
                    const logType = getLogType(log.message);
                    const isNew = index >= prevLogCount;
                    return (
                      <div 
                        key={index} 
                        className={`log-entry flex items-start gap-2 ${isNew ? 'log-new' : ''}`}
                      >
                        <span className="log-time flex-shrink-0">
                          [{formatLogTime(log.timestamp)}]
                        </span>
                        {getLogIcon(logType)}
                        <span className={`log-${logType}`}>
                          {log.message}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    等待日志...
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* 错误信息 */}
        {task?.errorMessage && (
          <Card className="bg-red-900/20 border-red-800/30">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-400">任务失败</p>
                  <p className="text-sm text-red-300 mt-1">{task.errorMessage}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* 搜索结果表格 */}
        {(task?.status === "completed" || task?.status === "insufficient_credits" || task?.status === "service_busy") && results && (
          <Card className="rainbow-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-amber-400" />
                搜索结果
                <Badge className="bg-pink-500/20 text-pink-400 border-pink-500/30 ml-2">
                  <Heart className="h-3 w-3 mr-1" />
                  含婚姻状况
                </Badge>
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                  <Wifi className="h-3 w-3 mr-1" />
                  含运营商
                </Badge>
              </CardTitle>
              <CardDescription>
                共 {results.total || 0} 条结果
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>年龄</TableHead>
                    <TableHead>地址</TableHead>
                    <TableHead>电话</TableHead>
                    <TableHead>运营商</TableHead>
                    <TableHead>婚姻状况</TableHead>
                    <TableHead>缓存</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.results?.map((result: any, index: number) => (
                    <TableRow key={index} className="hover:bg-amber-500/5">
                      <TableCell className="font-medium">{result.name || '-'}</TableCell>
                      <TableCell>{result.age || '-'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {result.currentAddress || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {result.phone || '-'}
                      </TableCell>
                      <TableCell>
                        {result.carrier ? (
                          <Badge variant="outline" className="text-xs">
                            {result.carrier}
                          </Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>{getMarriageStatusBadge(result.marriageStatus)}</TableCell>
                      <TableCell>
                        {result.fromCache ? (
                          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            命中
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {/* 分页 */}
              {results.total > pageSize && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    第 {page} 页，共 {Math.ceil(results.total / pageSize)} 页
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="border-amber-500/30 hover:bg-amber-500/10"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => p + 1)}
                      disabled={page * pageSize >= results.total}
                      className="border-amber-500/30 hover:bg-amber-500/10"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        
        {/* 无结果提示 */}
        {(task?.status === "completed" || task?.status === "insufficient_credits" || task?.status === "service_busy") && (!results || !results.results || results.results.length === 0) && (
          <Card className="rainbow-border">
            <CardContent className="py-12 text-center">
              <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">暂无搜索结果</h3>
              <p className="text-muted-foreground">
                {task?.status === "insufficient_credits" 
                  ? "任务因积分不足提前停止，未获取到有效数据"
                  : task?.status === "service_busy"
                  ? "当前使用人数过多，服务繁忙，请稍后重试或联系客服"
                  : "未找到符合条件的数据，请尝试其他搜索条件"}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
// Anywho Task Golden Template v2.0
