import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  ArrowLeft, Download, RefreshCw, CheckCircle, XCircle, 
  Clock, Phone, User, MapPin, Briefcase, Building, Mail,
  Zap, Target, Activity, TrendingUp, AlertTriangle, Filter,
  Copy, ExternalLink, Trash2, CheckCircle2, Loader2, Coins,
  BarChart3, Users, PhoneCall, ShieldCheck, Ban, StopCircle,
  Play, Pause, Search, Database, Shield, FileDown, Eye,
  ChevronRight, Sparkles, Globe, Linkedin
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// 定义搜索结果数据类型
interface ResultData {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  company?: string;
  organization_name?: string;
  city?: string;
  state?: string;
  country?: string;
  phoneNumber?: string;
  phone?: string;
  phoneType?: string;
  phoneStatus?: 'pending' | 'received' | 'verified' | 'no_phone' | 'failed';
  carrier?: string;
  email?: string;
  linkedinUrl?: string;
  linkedin_url?: string;
  age?: number;
}

// 定义搜索参数类型
interface SearchParams {
  name?: string;
  title?: string;
  state?: string;
  limit?: number;
  ageMin?: number;
  ageMax?: number;
}

// 定义日志类型
interface LogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  step?: number;
  total?: number;
  message: string;
  details?: {
    name?: string;
    phone?: string;
    matchScore?: number;
    reason?: string;
  };
}

// 搜索阶段定义
const SEARCH_PHASES = [
  { id: 'init', label: '初始化', icon: Play, color: 'cyan' },
  { id: 'apollo', label: 'Apollo 数据获取', icon: Database, color: 'blue' },
  { id: 'verification', label: '电话验证', icon: Shield, color: 'purple' },
  { id: 'done', label: '完成', icon: CheckCircle, color: 'green' },
];

export default function SearchProgress() {
  const { taskId } = useParams<{ taskId: string }>();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState("progress");
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // 获取任务状态
  const { data: task, isLoading, refetch } = trpc.search.taskStatus.useQuery(
    { taskId: taskId || "" },
    { 
      enabled: !!user && !!taskId,
      refetchInterval: (data) => {
        if (data?.status === 'completed' || data?.status === 'failed' || data?.status === 'stopped') {
          return false;
        }
        return 2000;
      }
    }
  );

  // 获取搜索结果
  const { data: results, refetch: refetchResults } = trpc.search.results.useQuery(
    { taskId: taskId || "" },
    { 
      enabled: !!user && !!taskId,
      // 如果任务已完成且有待获取的电话号码，每5秒刷新一次
      refetchInterval: (data) => {
        if (!data || data.length === 0) return false;
        const hasPendingPhones = data.some((r: any) => {
          const d = r.data as ResultData;
          return d?.phoneStatus === 'pending';
        });
        return hasPendingPhones ? 5000 : false;
      }
    }
  );

  // 停止搜索
  const stopMutation = trpc.search.stop.useMutation({
    onSuccess: () => {
      toast.success("搜索任务已停止");
      setShowStopDialog(false);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "停止失败");
    },
  });

  // 导出CSV
  const exportMutation = trpc.search.exportCsv.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.content], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    },
    onError: (error) => {
      toast.error(error.message || "导出失败");
    },
  });

  // 解析任务日志
  useEffect(() => {
    if (task?.logs) {
      try {
        const logData = task.logs as LogEntry[];
        if (Array.isArray(logData)) {
          setLogs(logData);
        }
      } catch {
        setLogs([]);
      }
    }
  }, [task?.logs]);

  // 自动滚动到最新日志
  useEffect(() => {
    if (autoScroll && logsEndRef.current && isRunning) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // 检测用户手动滚动
  const handleScroll = () => {
    if (logsContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setAutoScroll(isAtBottom);
    }
  };

  // 任务完成时自动切换到结果标签
  useEffect(() => {
    if ((task?.status === 'completed' || task?.status === 'stopped') && results && results.length > 0) {
      setTimeout(() => setActiveTab('results'), 1000);
    }
  }, [task?.status, results]);

  // 解析搜索参数
  const searchParams = task?.params as SearchParams | undefined;
  const searchName = searchParams?.name || "";
  const searchTitle = searchParams?.title || "";
  const searchState = searchParams?.state || "";
  const searchLimit = searchParams?.limit || 50;
  const ageMin = searchParams?.ageMin;
  const ageMax = searchParams?.ageMax;

  // 计算进度和统计
  const progress = task?.progress || 0;
  const creditsUsed = task?.creditsUsed || 0;
  const actualCount = task?.actualCount || 0;
  const isRunning = task?.status === 'running' || task?.status === 'pending';
  const isCompleted = task?.status === 'completed';
  const isStopped = task?.status === 'stopped';
  const isFailed = task?.status === 'failed';

  // 确定当前阶段
  const currentPhase = useMemo(() => {
    if (!task) return 'init';
    switch (task.status) {
      case 'pending': return 'init';
      case 'running': return 'verification';
      case 'completed':
      case 'stopped':
      case 'failed': return 'done';
      default: return 'init';
    }
  }, [task?.status]);

  // 从日志中提取统计信息
  const stats = useMemo(() => {
    const result = {
      apolloCalls: 0,
      phonesFound: 0,
      phonesVerified: 0,
      verifyFailed: 0,
      excludedNoPhone: 0,
      excludedAgeFilter: 0,
      cacheHits: 0,
      processedCount: 0,
    };
    
    logs.forEach(log => {
      if (log.message.includes('Apollo')) result.apolloCalls++;
      if (log.message.includes('找到电话')) result.phonesFound++;
      if (log.message.includes('验证通过')) result.phonesVerified++;
      if (log.message.includes('验证失败')) result.verifyFailed++;
      if (log.message.includes('未找到电话')) result.excludedNoPhone++;
      if (log.message.includes('年龄') && log.message.includes('不在')) result.excludedAgeFilter++;
      if (log.message.includes('缓存命中')) result.cacheHits++;
      if (log.step) result.processedCount = Math.max(result.processedCount, log.step);
    });
    
    return result;
  }, [logs]);

  // 验证成功率
  const verifySuccessRate = stats.phonesFound > 0 
    ? Math.round((stats.phonesVerified / stats.phonesFound) * 100) 
    : 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1 px-3 py-1">
            <CheckCircle className="h-3.5 w-3.5" />
            已完成
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1 px-3 py-1">
            <XCircle className="h-3.5 w-3.5" />
            失败
          </Badge>
        );
      case "stopped":
        return (
          <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 gap-1 px-3 py-1">
            <StopCircle className="h-3.5 w-3.5" />
            已停止
          </Badge>
        );
      case "running":
      case "fetching":
      case "verifying":
        return (
          <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 gap-1 px-3 py-1 animate-pulse">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            搜索中
          </Badge>
        );
      case "insufficient_credits":
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1 px-3 py-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            积分不足
          </Badge>
        );
      case "pending":
      default:
        return (
          <Badge variant="secondary" className="gap-1 px-3 py-1">
            <Clock className="h-3.5 w-3.5" />
            等待中
          </Badge>
        );
    }
  };

  const getLogIcon = (level: string, message: string) => {
    // 根据消息内容返回更具体的图标
    if (message.includes('Apollo')) return <Database className="h-4 w-4 text-blue-400" />;
    if (message.includes('验证通过')) return <ShieldCheck className="h-4 w-4 text-green-400" />;
    if (message.includes('验证失败')) return <Ban className="h-4 w-4 text-red-400" />;
    if (message.includes('找到电话')) return <Phone className="h-4 w-4 text-cyan-400" />;
    if (message.includes('未找到电话')) return <Phone className="h-4 w-4 text-yellow-400" />;
    if (message.includes('积分')) return <Coins className="h-4 w-4 text-yellow-400" />;
    if (message.includes('缓存')) return <Zap className="h-4 w-4 text-purple-400" />;
    if (message.includes('开始') || message.includes('初始化')) return <Play className="h-4 w-4 text-cyan-400" />;
    if (message.includes('完成')) return <CheckCircle2 className="h-4 w-4 text-green-400" />;
    if (message.includes('错误') || message.includes('失败')) return <XCircle className="h-4 w-4 text-red-400" />;
    
    switch (level) {
      case 'success': return <CheckCircle2 className="h-4 w-4 text-green-400" />;
      case 'warning': return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
      case 'error': return <XCircle className="h-4 w-4 text-red-400" />;
      default: return <Activity className="h-4 w-4 text-cyan-400" />;
    }
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case 'success': return 'text-green-400';
      case 'warning': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-slate-300';
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64" />
        </div>
      </DashboardLayout>
    );
  }

  if (!task) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="text-center py-12">
            <XCircle className="h-16 w-16 mx-auto text-destructive mb-4" />
            <h2 className="text-xl font-semibold text-foreground">任务不存在</h2>
            <p className="text-muted-foreground mt-2">该搜索任务可能已过期或不存在</p>
            <Link href="/history">
              <Button className="mt-4">返回历史记录</Button>
            </Link>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* 背景装饰 */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[100px]" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[100px]" />
        </div>

        {/* 头部 */}
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/history">
              <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white hover:bg-slate-800">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                  搜索任务
                </h1>
                {getStatusBadge(task.status)}
              </div>
              <p className="text-slate-400 mt-1 flex items-center gap-2">
                <User className="h-4 w-4" />
                {searchName}
                <span className="text-slate-600">•</span>
                <Briefcase className="h-4 w-4" />
                {searchTitle}
                <span className="text-slate-600">•</span>
                <MapPin className="h-4 w-4" />
                {searchState}
                {ageMin && ageMax && (
                  <>
                    <span className="text-slate-600">•</span>
                    <span>{ageMin}-{ageMax}岁</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => refetch()} 
                  className="border-slate-700 text-slate-400 hover:bg-slate-800"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  刷新
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setShowStopDialog(true)}
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                >
                  <StopCircle className="h-4 w-4 mr-2" />
                  停止搜索
                </Button>
              </>
            )}
            {(isCompleted || isStopped) && results && results.length > 0 && (
              <Button
                onClick={() => exportMutation.mutate({ taskId: taskId || "" })}
                disabled={exportMutation.isPending}
                className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
              >
                <Download className="mr-2 h-4 w-4" />
                导出CSV
              </Button>
            )}
          </div>
        </div>

        {/* 阶段指示器 */}
        <div className="relative p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
          <div className="flex items-center justify-between">
            {SEARCH_PHASES.map((phase, index) => {
              const PhaseIcon = phase.icon;
              const isActive = currentPhase === phase.id;
              const isPast = SEARCH_PHASES.findIndex(p => p.id === currentPhase) > index;
              const isLast = index === SEARCH_PHASES.length - 1;
              
              return (
                <div key={phase.id} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div className={`
                      w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300
                      ${isActive ? `bg-${phase.color}-500/20 border-2 border-${phase.color}-500 shadow-lg shadow-${phase.color}-500/20` : ''}
                      ${isPast ? 'bg-green-500/20 border-2 border-green-500' : ''}
                      ${!isActive && !isPast ? 'bg-slate-800/50 border border-slate-700' : ''}
                    `}>
                      {isPast ? (
                        <CheckCircle className="h-6 w-6 text-green-400" />
                      ) : (
                        <PhaseIcon className={`h-6 w-6 ${isActive ? `text-${phase.color}-400` : 'text-slate-500'} ${isActive && isRunning ? 'animate-pulse' : ''}`} />
                      )}
                    </div>
                    <span className={`mt-2 text-sm font-medium ${isActive ? 'text-white' : isPast ? 'text-green-400' : 'text-slate-500'}`}>
                      {phase.label}
                    </span>
                  </div>
                  {!isLast && (
                    <div className={`flex-1 h-0.5 mx-4 ${isPast ? 'bg-green-500' : 'bg-slate-700'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 主要内容区域 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：进度和日志 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 进度卡片 */}
            <Card className="border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/50 overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                      <Target className="h-5 w-5 text-cyan-400" />
                    </div>
                    <div>
                      <CardTitle className="text-white">任务进度</CardTitle>
                      <CardDescription>
                        创建于 {new Date(task.createdAt).toLocaleString()}
                      </CardDescription>
                    </div>
                  </div>
                  {isRunning && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                      </span>
                      <span className="text-sm text-cyan-400">处理中...</span>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 进度条 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">处理进度</span>
                    <span className="text-cyan-400 font-mono font-bold text-lg">{progress}%</span>
                  </div>
                  <div className="relative h-4 rounded-full bg-slate-800 overflow-hidden">
                    <div 
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                    {isRunning && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                    )}
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>已处理 {stats.processedCount} 条</span>
                    <span>共 {searchLimit} 条</span>
                  </div>
                </div>

                {/* 统计卡片 */}
                <div className="grid grid-cols-5 gap-3 pt-2">
                  <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-center">
                    <div className="text-2xl font-bold text-white font-mono">{searchLimit}</div>
                    <div className="text-xs text-slate-500 mt-1">请求数量</div>
                  </div>
                  <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-center">
                    <div className="text-2xl font-bold text-green-400 font-mono">{actualCount}</div>
                    <div className="text-xs text-slate-500 mt-1">有效结果</div>
                  </div>
                  <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-center">
                    <div className="text-2xl font-bold text-cyan-400 font-mono">
                      {results?.filter((r: any) => (r.data as ResultData)?.phone).length || 0}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">已获取电话</div>
                  </div>
                  <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-center">
                    <div className="text-2xl font-bold text-yellow-400 font-mono">
                      {results?.filter((r: any) => (r.data as ResultData)?.phoneStatus === 'pending').length || 0}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">电话获取中</div>
                  </div>
                  <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-center">
                    <div className="text-2xl font-bold text-purple-400 font-mono">{creditsUsed}</div>
                    <div className="text-xs text-slate-500 mt-1">消耗积分</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 标签页：日志/结果 */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-slate-800/50 border border-slate-700/50 p-1">
                <TabsTrigger 
                  value="progress" 
                  className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 px-4"
                >
                  <Activity className="h-4 w-4 mr-2" />
                  实时日志
                  {isRunning && <span className="ml-2 w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />}
                </TabsTrigger>
                <TabsTrigger 
                  value="results" 
                  className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 px-4"
                >
                  <Users className="h-4 w-4 mr-2" />
                  搜索结果
                  {results && results.length > 0 && (
                    <Badge variant="secondary" className="ml-2 bg-slate-700">{results.length}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* 实时日志 */}
              <TabsContent value="progress" className="mt-4">
                <Card className="border-slate-700/50 bg-slate-900/50">
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-white text-base">搜索日志</CardTitle>
                      {!autoScroll && isRunning && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => {
                            setAutoScroll(true);
                            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                          }}
                          className="text-cyan-400 hover:text-cyan-300 text-xs"
                        >
                          <ChevronRight className="h-3 w-3 mr-1 rotate-90" />
                          跳转到最新
                        </Button>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">{logs.length} 条日志</span>
                  </CardHeader>
                  <CardContent>
                    <div 
                      ref={logsContainerRef}
                      onScroll={handleScroll}
                      className="h-[400px] overflow-y-auto rounded-lg bg-slate-950/50 border border-slate-800 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent"
                    >
                      <div className="p-4 space-y-1 font-mono text-sm">
                        {logs.length > 0 ? (
                          logs.map((log, i) => {
                            const isSeparator = log.message.includes('───');
                            if (isSeparator) {
                              return (
                                <div key={i} className="py-1 text-slate-700 text-center text-xs">
                                  ─────────────────────────────────────
                                </div>
                              );
                            }
                            return (
                              <div 
                                key={i} 
                                className="flex items-start gap-3 py-1.5 px-2 rounded hover:bg-slate-800/50 transition-colors group"
                              >
                                <span className="text-slate-600 shrink-0 text-xs">[{log.timestamp}]</span>
                                <span className="shrink-0">{getLogIcon(log.level, log.message)}</span>
                                <span className={`${getLogColor(log.level)} flex-1`}>
                                  {log.message}
                                </span>
                                {log.details?.matchScore && (
                                  <Badge 
                                    variant="outline" 
                                    className={`text-xs shrink-0 ${log.details.matchScore >= 70 ? 'border-green-500/30 text-green-400' : 'border-yellow-500/30 text-yellow-400'}`}
                                  >
                                    {log.details.matchScore}%
                                  </Badge>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-slate-500 text-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                            等待任务开始...
                          </div>
                        )}
                        <div ref={logsEndRef} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 搜索结果 */}
              <TabsContent value="results" className="mt-4">
                <Card className="border-slate-700/50 bg-slate-900/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-white text-base">搜索结果</CardTitle>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-400">
                          共 {results?.length || 0} 条记录
                        </span>
                        {results && results.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => exportMutation.mutate({ taskId: taskId || "" })}
                            disabled={exportMutation.isPending}
                            className="text-cyan-400 hover:text-cyan-300"
                          >
                            <FileDown className="h-4 w-4 mr-1" />
                            导出
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {results && results.length > 0 ? (
                      <div className="rounded-lg border border-slate-700/50 overflow-hidden">
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-slate-800/50 hover:bg-slate-800/50">
                                <TableHead className="text-slate-400 w-12">#</TableHead>
                                <TableHead className="text-slate-400">姓名</TableHead>
                                <TableHead className="text-slate-400">职位</TableHead>
                                <TableHead className="text-slate-400">公司</TableHead>
                                <TableHead className="text-slate-400">电话</TableHead>
                                <TableHead className="text-slate-400">验证</TableHead>
                                <TableHead className="text-slate-400 w-12"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {results.map((result, index) => {
                                const data = result.data as ResultData || {};
                                const fullName = data.fullName || data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim() || "-";
                                const title = data.title || "-";
                                const company = data.company || data.organization_name || "-";
                                const phone = data.phone || data.phoneNumber || "-";
                                const linkedinUrl = data.linkedinUrl || data.linkedin_url;
                                
                                return (
                                  <TableRow key={result.id} className="hover:bg-slate-800/30 border-slate-700/30">
                                    <TableCell className="text-slate-500 font-mono">{index + 1}</TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                                          <User className="h-4 w-4 text-slate-400" />
                                        </div>
                                        <div>
                                          <span className="font-medium text-white">{fullName}</span>
                                          {data.age && (
                                            <span className="ml-2 text-xs text-slate-500">{data.age}岁</span>
                                          )}
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-slate-400">{title}</TableCell>
                                    <TableCell className="text-slate-400">{company}</TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2">
                                        {data.phoneStatus === 'pending' ? (
                                          <>
                                            <Loader2 className="h-4 w-4 text-yellow-400 animate-spin" />
                                            <span className="text-yellow-400 text-sm">获取中...</span>
                                          </>
                                        ) : data.phoneStatus === 'no_phone' ? (
                                          <>
                                            <Phone className="h-4 w-4 text-slate-500" />
                                            <span className="text-slate-500 text-sm">无电话</span>
                                          </>
                                        ) : phone && phone !== '-' ? (
                                          <>
                                            <Phone className="h-4 w-4 text-slate-500" />
                                            <span className="text-cyan-400 font-mono">{phone}</span>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 text-slate-500 hover:text-white"
                                              onClick={() => {
                                                navigator.clipboard.writeText(phone);
                                                toast.success("已复制电话号码");
                                              }}
                                            >
                                              <Copy className="h-3 w-3" />
                                            </Button>
                                          </>
                                        ) : (
                                          <>
                                            <Phone className="h-4 w-4 text-slate-500" />
                                            <span className="text-slate-500 text-sm">-</span>
                                          </>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      {result.verified ? (
                                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
                                          <ShieldCheck className="h-3 w-3" />
                                          {result.verificationScore}%
                                        </Badge>
                                      ) : (
                                        <Badge variant="secondary" className="gap-1">
                                          <XCircle className="h-3 w-3" />
                                          未验证
                                        </Badge>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {linkedinUrl && (
                                        <a 
                                          href={linkedinUrl} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="text-blue-400 hover:text-blue-300"
                                        >
                                          <Linkedin className="h-4 w-4" />
                                        </a>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-12 text-slate-500">
                        {isRunning ? (
                          <>
                            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
                            <p>搜索进行中，请稍候...</p>
                          </>
                        ) : (
                          <>
                            <Users className="h-8 w-8 mx-auto mb-3 opacity-50" />
                            <p>暂无搜索结果</p>
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* 右侧：统计面板 */}
          <div className="space-y-6">
            {/* 搜索统计 */}
            <Card className="border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/50">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <BarChart3 className="h-4 w-4 text-purple-400" />
                  </div>
                  <CardTitle className="text-white text-base">搜索统计</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                  <span className="text-slate-400 text-sm flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Apollo 请求
                  </span>
                  <span className="text-white font-mono">{stats.apolloCalls}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                  <span className="text-slate-400 text-sm flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    找到电话
                  </span>
                  <span className="text-cyan-400 font-mono">{stats.phonesFound}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                  <span className="text-slate-400 text-sm flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    验证通过
                  </span>
                  <span className="text-green-400 font-mono">{stats.phonesVerified}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                  <span className="text-slate-400 text-sm flex items-center gap-2">
                    <Ban className="h-4 w-4" />
                    验证失败
                  </span>
                  <span className="text-red-400 font-mono">{stats.verifyFailed}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-slate-400 text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    验证成功率
                  </span>
                  <span className={`font-mono font-bold ${verifySuccessRate >= 70 ? 'text-green-400' : verifySuccessRate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {verifySuccessRate}%
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* 排除统计 */}
            <Card className="border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/50">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                    <Filter className="h-4 w-4 text-orange-400" />
                  </div>
                  <CardTitle className="text-white text-base">排除统计</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                  <span className="text-slate-400 text-sm">无电话号码</span>
                  <span className="text-yellow-400 font-mono">{stats.excludedNoPhone}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                  <span className="text-slate-400 text-sm">验证失败</span>
                  <span className="text-red-400 font-mono">{stats.verifyFailed}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-slate-400 text-sm">年龄不符</span>
                  <span className="text-orange-400 font-mono">{stats.excludedAgeFilter}</span>
                </div>
              </CardContent>
            </Card>

            {/* 积分消耗 */}
            <Card className="border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/50">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                    <Coins className="h-4 w-4 text-yellow-400" />
                  </div>
                  <CardTitle className="text-white text-base">积分消耗</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                  <span className="text-slate-400 text-sm">已消耗</span>
                  <span className="text-yellow-400 font-mono font-bold">{creditsUsed} 积分</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                  <span className="text-slate-400 text-sm">预计总消耗</span>
                  <span className="text-slate-300 font-mono">~{1 + searchLimit * 2} 积分</span>
                </div>
                {stats.cacheHits > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                    <span className="text-slate-400 text-sm flex items-center gap-2">
                      <Zap className="h-4 w-4 text-purple-400" />
                      缓存命中
                    </span>
                    <span className="text-purple-400 font-mono">{stats.cacheHits}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 快速操作 */}
            <Card className="border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/50">
              <CardContent className="pt-6 space-y-3">
                <Button 
                  variant="outline" 
                  className="w-full border-slate-700 text-slate-400 hover:bg-slate-800 justify-start"
                  onClick={() => setLocation('/search')}
                >
                  <Search className="h-4 w-4 mr-2" />
                  新建搜索
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full border-slate-700 text-slate-400 hover:bg-slate-800 justify-start"
                  onClick={() => setLocation('/history')}
                >
                  <Clock className="h-4 w-4 mr-2" />
                  历史记录
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* 停止搜索确认对话框 */}
      <Dialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <StopCircle className="h-5 w-5 text-red-400" />
              停止搜索
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              确定要停止当前搜索任务吗？
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
                <div className="text-sm text-slate-300">
                  <p>停止后：</p>
                  <ul className="mt-2 space-y-1 text-slate-400">
                    <li>• 已获取的结果将被保留</li>
                    <li>• 已消耗的积分不会退还</li>
                    <li>• 可以随时查看已有结果</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowStopDialog(false)}
              className="border-slate-700 text-slate-400 hover:bg-slate-800"
            >
              取消
            </Button>
            <Button
              onClick={() => stopMutation.mutate({ taskId: taskId || "" })}
              disabled={stopMutation.isPending}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {stopMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  停止中...
                </>
              ) : (
                <>
                  <StopCircle className="mr-2 h-4 w-4" />
                  确认停止
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
