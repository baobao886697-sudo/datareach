import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  ArrowLeft, Download, RefreshCw, CheckCircle, XCircle, 
  Clock, Phone, User, MapPin, Briefcase, Building, Mail,
  Zap, Target, Activity, TrendingUp, AlertTriangle, Filter,
  Copy, ExternalLink, Trash2, CheckCircle2, Loader2, Coins,
  BarChart3, Users, PhoneCall, ShieldCheck, Ban
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

export default function Results() {
  const { taskId } = useParams<{ taskId: string }>();
  const { user } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState("progress");
  const [filterVerified, setFilterVerified] = useState<'all' | 'verified' | 'unverified'>('all');
  const logsEndRef = useRef<HTMLDivElement>(null);

  // 复制到剪贴板
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(`已复制${label}`);
    }).catch(() => {
      toast.error('复制失败');
    });
  };

  const { data: task, isLoading, refetch } = trpc.search.taskStatus.useQuery(
    { taskId: taskId || "" },
    { 
      enabled: !!user && !!taskId,
      refetchInterval: (data) => {
        // 任务完成或失败后停止轮询
        if (data?.status === 'completed' || data?.status === 'failed') {
          return false;
        }
        return 2000; // 2秒轮询
      }
    }
  );

  const { data: results } = trpc.search.results.useQuery(
    { taskId: taskId || "" },
    { enabled: !!user && !!taskId && (task?.status === "completed" || task?.status === "failed") }
  );

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
    if (logsEndRef.current && (task?.status === 'running' || task?.status === 'pending')) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, task?.status]);

  // 任务完成时自动切换到结果标签
  useEffect(() => {
    if (task?.status === 'completed' && results && results.length > 0) {
      setActiveTab('results');
    }
  }, [task?.status, results]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
            <CheckCircle className="h-3 w-3" />
            已完成
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            失败
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 gap-1 animate-pulse">
            <Loader2 className="h-3 w-3 animate-spin" />
            搜索中
          </Badge>
        );
      case "insufficient_credits":
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1">
            <AlertTriangle className="h-3 w-3" />
            积分不足
          </Badge>
        );
      case "pending":
      default:
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            等待中
          </Badge>
        );
    }
  };

  const getLogIcon = (level: string) => {
    switch (level) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-400" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-400" />;
      default:
        return <Activity className="h-4 w-4 text-cyan-400" />;
    }
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case 'success':
        return 'text-green-400';
      case 'warning':
        return 'text-yellow-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-slate-300';
    }
  };

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

  // 从结果数据中直接统计电话数量（优先），同时也从日志中提取
  const extractStats = () => {
    const stats = {
      phonesFound: 0,
      phonesVerified: 0,
      excludedNoPhone: 0,
      excludedVerifyFailed: 0,
      excludedAgeFilter: 0,
    };
    
    // 优先从 results 数据中统计电话数量
    if (results && Array.isArray(results)) {
      results.forEach(result => {
        const data = result.data as ResultData;
        const phone = data?.phone || data?.phoneNumber;
        if (phone) {
          stats.phonesFound++;
          if (result.verified) {
            stats.phonesVerified++;
          }
        }
      });
    }
    
    // 如果从 results 没有统计到，则从日志中统计（兼容旧版本）
    if (stats.phonesFound === 0) {
      logs.forEach(log => {
        if (log.message.includes('找到电话') || log.message.includes('获取到电话')) stats.phonesFound++;
        if (log.message.includes('验证通过')) stats.phonesVerified++;
      });
    }
    
    // 排除统计仍然从日志中获取
    logs.forEach(log => {
      if (log.message.includes('未找到电话') || log.message.includes('无电话')) stats.excludedNoPhone++;
      if (log.message.includes('验证失败')) stats.excludedVerifyFailed++;
      if (log.message.includes('年龄') && log.message.includes('不在')) stats.excludedAgeFilter++;
    });
    
    return stats;
  };

  const stats = extractStats();

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
      <div className="p-6 space-y-6">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/history">
              <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-white">搜索任务</h1>
                {getStatusBadge(task.status)}
              </div>
              <p className="text-slate-400 mt-1">
                {searchName} · {searchTitle} · {searchState}
                {ageMin && ageMax && ` · ${ageMin}-${ageMax}岁`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-400">
                <RefreshCw className="h-4 w-4 mr-2" />
                刷新
              </Button>
            )}
            {task.status === "completed" && results && results.length > 0 && (
              <Button
                onClick={() => exportMutation.mutate({ taskId: taskId || "" })}
                disabled={exportMutation.isPending}
                className="bg-gradient-to-r from-cyan-500 to-blue-600"
              >
                <Download className="mr-2 h-4 w-4" />
                导出CSV
              </Button>
            )}
          </div>
        </div>

        {/* 进度和统计面板 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：进度面板 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 任务进度卡片 */}
            <Card className="border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/50">
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
                    <div className="flex items-center gap-2 text-cyan-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">处理中...</span>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 进度条 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">处理进度</span>
                    <span className="text-cyan-400 font-mono font-bold">{progress}%</span>
                  </div>
                  <div className="relative">
                    <Progress value={progress} className="h-3 bg-slate-800" />
                    {isRunning && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
                    )}
                  </div>
                </div>

                {/* 统计卡片 */}
                <div className="grid grid-cols-4 gap-3 pt-2">
                  <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-center">
                    <div className="text-2xl font-bold text-white font-mono">{searchLimit}</div>
                    <div className="text-xs text-slate-500 mt-1">请求数量</div>
                  </div>
                  <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-center">
                    <div className="text-2xl font-bold text-green-400 font-mono">{actualCount}</div>
                    <div className="text-xs text-slate-500 mt-1">有效结果</div>
                  </div>
                  <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-center">
                    <div className="text-2xl font-bold text-cyan-400 font-mono">{stats.phonesFound}</div>
                    <div className="text-xs text-slate-500 mt-1">找到电话</div>
                  </div>
                  <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-center">
                    <div className="text-2xl font-bold text-yellow-400 font-mono">{creditsUsed}</div>
                    <div className="text-xs text-slate-500 mt-1">消耗积分</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 标签页：日志/结果 */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-slate-800/50 border border-slate-700/50">
                <TabsTrigger value="progress" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400">
                  <Activity className="h-4 w-4 mr-2" />
                  实时日志
                  {isRunning && <span className="ml-2 w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />}
                </TabsTrigger>
                <TabsTrigger value="results" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400">
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
                    <CardTitle className="text-white text-base">搜索日志</CardTitle>
                    <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px] rounded-lg bg-slate-950/50 border border-slate-800">
                      <div className="p-4 space-y-1 font-mono text-sm">
                        {logs.length > 0 ? (
                          logs.map((log, i) => (
                            <div 
                              key={i} 
                              className={`flex items-start gap-3 py-1.5 px-2 rounded hover:bg-slate-800/50 transition-colors ${
                                log.message.includes('───') ? 'opacity-30' : ''
                              }`}
                            >
                              <span className="text-slate-600 shrink-0">[{log.timestamp}]</span>
                              {!log.message.includes('───') && (
                                <span className="shrink-0">{getLogIcon(log.level)}</span>
                              )}
                              <span className={getLogColor(log.level)}>
                                {log.message}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="text-slate-500 text-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                            等待任务开始...
                          </div>
                        )}
                        <div ref={logsEndRef} />
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 搜索结果 */}
              <TabsContent value="results" className="mt-4">
                <Card className="border-slate-700/50 bg-slate-900/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <CardTitle className="text-white text-base">搜索结果</CardTitle>
                        {/* 筛选按钮 */}
                        <div className="flex items-center gap-1 bg-slate-800/50 rounded-lg p-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-3 text-xs ${filterVerified === 'all' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white'}`}
                            onClick={() => setFilterVerified('all')}
                          >
                            全部
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-3 text-xs ${filterVerified === 'verified' ? 'bg-green-500/20 text-green-400' : 'text-slate-400 hover:text-white'}`}
                            onClick={() => setFilterVerified('verified')}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" />
                            已验证
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-3 text-xs ${filterVerified === 'unverified' ? 'bg-yellow-500/20 text-yellow-400' : 'text-slate-400 hover:text-white'}`}
                            onClick={() => setFilterVerified('unverified')}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            未验证
                          </Button>
                        </div>
                      </div>
                      <span className="text-sm text-slate-400">
                        共 {results?.filter(r => 
                          filterVerified === 'all' ? true : 
                          filterVerified === 'verified' ? r.verified : !r.verified
                        ).length || 0} 条记录
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {results && results.length > 0 ? (
                      <div className="rounded-lg border border-slate-700/50 overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-slate-800/50 hover:bg-slate-800/50">
                              <TableHead className="text-slate-400 w-12">#</TableHead>
                              <TableHead className="text-slate-400">姓名</TableHead>
                              <TableHead className="text-slate-400">职位</TableHead>
                              <TableHead className="text-slate-400">公司</TableHead>
                              <TableHead className="text-slate-400">电话</TableHead>
                              <TableHead className="text-slate-400">邮箱</TableHead>
                              <TableHead className="text-slate-400">验证</TableHead>
                              <TableHead className="text-slate-400 w-20">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {results
                              .filter(r => 
                                filterVerified === 'all' ? true : 
                                filterVerified === 'verified' ? r.verified : !r.verified
                              )
                              .map((result, index) => {
                              const data = result.data as ResultData || {};
                              const fullName = data.fullName || data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim() || "-";
                              const title = data.title || "-";
                              const company = data.company || data.organization_name || "-";
                              const phone = data.phone || data.phoneNumber || "-";
                              const email = data.email || "-";
                              const linkedinUrl = data.linkedinUrl || data.linkedin_url;
                              
                              return (
                                <TableRow key={result.id} className="hover:bg-slate-800/30 border-slate-700/30">
                                  <TableCell className="text-slate-500 font-mono">{index + 1}</TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <User className="h-4 w-4 text-slate-500" />
                                      <span className="font-medium text-white">{fullName}</span>
                                      {data.age && (
                                        <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                                          {data.age}岁
                                        </Badge>
                                      )}
                                    </div>
                                    {data.city && data.state && (
                                      <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                                        <MapPin className="h-3 w-3" />
                                        {data.city}, {data.state}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-slate-400">{title}</TableCell>
                                  <TableCell className="text-slate-400 max-w-[150px] truncate" title={company}>{company}</TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <Phone className="h-4 w-4 text-slate-500" />
                                      <span className="text-cyan-400 font-mono text-sm">{phone}</span>
                                      {phone !== '-' && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 w-6 p-0 hover:bg-cyan-500/20"
                                          onClick={() => copyToClipboard(phone, '电话号码')}
                                        >
                                          <Copy className="h-3 w-3 text-slate-400 hover:text-cyan-400" />
                                        </Button>
                                      )}
                                    </div>
                                    {data.carrier && (
                                      <div className="text-xs text-slate-500 mt-1">运营商: {data.carrier}</div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {email !== '-' ? (
                                      <div className="flex items-center gap-2">
                                        <Mail className="h-4 w-4 text-slate-500" />
                                        <span className="text-slate-400 text-sm truncate max-w-[120px]" title={email}>{email}</span>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 w-6 p-0 hover:bg-purple-500/20"
                                          onClick={() => copyToClipboard(email, '邮箱')}
                                        >
                                          <Copy className="h-3 w-3 text-slate-400 hover:text-purple-400" />
                                        </Button>
                                      </div>
                                    ) : (
                                      <span className="text-slate-500">-</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {result.verified ? (
                                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
                                        <CheckCircle className="h-3 w-3" />
                                        {result.matchScore}%
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary" className="gap-1">
                                        <XCircle className="h-3 w-3" />
                                        未验证
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      {linkedinUrl && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 p-0 hover:bg-blue-500/20"
                                          onClick={() => window.open(linkedinUrl, '_blank')}
                                          title="打开 LinkedIn"
                                        >
                                          <ExternalLink className="h-4 w-4 text-blue-400" />
                                        </Button>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 hover:bg-slate-700"
                                        onClick={() => {
                                          const copyText = `${fullName}\n${title}\n${company}\n${phone}\n${email}`;
                                          copyToClipboard(copyText, '联系人信息');
                                        }}
                                        title="复制全部信息"
                                      >
                                        <Copy className="h-4 w-4 text-slate-400" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
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
            {/* 请求统计 */}
            <Card className="border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/50">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <BarChart3 className="h-4 w-4 text-purple-400" />
                  </div>
                  <CardTitle className="text-white text-base">请求统计</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-700/30">
                  <span className="text-slate-400 text-sm">Apollo API</span>
                  <span className="text-white font-mono">1</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700/30">
                  <span className="text-slate-400 text-sm">电话获取</span>
                  <span className="text-white font-mono">{stats.phonesFound + stats.excludedNoPhone}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-slate-400 text-sm">电话验证</span>
                  <span className="text-white font-mono">{stats.phonesFound}</span>
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
                <div className="flex justify-between items-center py-2 border-b border-slate-700/30">
                  <span className="text-slate-400 text-sm">搜索费用</span>
                  <span className="text-white font-mono">1</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700/30">
                  <span className="text-slate-400 text-sm">电话获取</span>
                  <span className="text-white font-mono">{creditsUsed - 1}</span>
                </div>
                <div className="flex justify-between items-center py-2 bg-yellow-500/10 rounded-lg px-3 -mx-3">
                  <span className="text-yellow-400 font-medium">总消耗</span>
                  <span className="text-yellow-400 font-mono font-bold">{creditsUsed}</span>
                </div>
              </CardContent>
            </Card>

            {/* 结果统计 */}
            <Card className="border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/50">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <TrendingUp className="h-4 w-4 text-green-400" />
                  </div>
                  <CardTitle className="text-white text-base">结果统计</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-700/30">
                  <span className="text-slate-400 text-sm">找到电话</span>
                  <span className="text-cyan-400 font-mono">{stats.phonesFound}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700/30">
                  <span className="text-slate-400 text-sm">验证通过</span>
                  <span className="text-green-400 font-mono">{stats.phonesVerified}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-slate-400 text-sm">验证成功率</span>
                  <span className="text-green-400 font-mono">
                    {stats.phonesFound > 0 ? Math.round((stats.phonesVerified / stats.phonesFound) * 100) : 0}%
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* 排除统计 */}
            {(stats.excludedNoPhone > 0 || stats.excludedVerifyFailed > 0 || stats.excludedAgeFilter > 0) && (
              <Card className="border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/50">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
                      <Ban className="h-4 w-4 text-red-400" />
                    </div>
                    <CardTitle className="text-white text-base">排除统计</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {stats.excludedNoPhone > 0 && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-700/30">
                      <span className="text-slate-400 text-sm">无电话号码</span>
                      <span className="text-red-400 font-mono">{stats.excludedNoPhone}</span>
                    </div>
                  )}
                  {stats.excludedVerifyFailed > 0 && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-700/30">
                      <span className="text-slate-400 text-sm">验证失败</span>
                      <span className="text-red-400 font-mono">{stats.excludedVerifyFailed}</span>
                    </div>
                  )}
                  {stats.excludedAgeFilter > 0 && (
                    <div className="flex justify-between items-center py-2">
                      <span className="text-slate-400 text-sm">年龄不符</span>
                      <span className="text-red-400 font-mono">{stats.excludedAgeFilter}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
