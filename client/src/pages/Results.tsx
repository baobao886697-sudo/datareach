import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  ArrowLeft, Download, RefreshCw, CheckCircle, XCircle, 
  Clock, Phone, User, MapPin, Briefcase, Building
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
}

export default function Results() {
  const { taskId } = useParams<{ taskId: string }>();
  const { user } = useAuth();
  const [logs, setLogs] = useState<Array<{ timestamp: string; level: string; message: string }>>([]);

  const { data: task, isLoading, refetch } = trpc.search.taskStatus.useQuery(
    { taskId: taskId || "" },
    { 
      enabled: !!user && !!taskId,
      refetchInterval: 3000
    }
  );

  const { data: results } = trpc.search.results.useQuery(
    { taskId: taskId || "" },
    { enabled: !!user && !!taskId && task?.status === "completed" }
  );

  const exportMutation = trpc.search.exportCsv.useMutation({
    onSuccess: (data) => {
      // 创建下载链接
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
        const logData = task.logs as Array<{ timestamp: string; level: string; message: string }>;
        if (Array.isArray(logData)) {
          setLogs(logData);
        }
      } catch {
        setLogs([]);
      }
    }
  }, [task?.logs]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">已完成</Badge>;
      case "failed":
        return <Badge variant="destructive">失败</Badge>;
      case "running":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">处理中</Badge>;
      case "pending":
      default:
        return <Badge variant="secondary">等待中</Badge>;
    }
  };

  // 解析搜索参数
  const searchParams = task?.params as SearchParams | undefined;
  const searchName = searchParams?.name || "";
  const searchTitle = searchParams?.title || "";
  const searchState = searchParams?.state || "";

  // 计算进度
  const totalResults = task?.actualCount || 0;
  const progress = task?.progress || 0;

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
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-foreground">搜索结果</h1>
              <p className="text-muted-foreground">
                {searchName} · {searchTitle} · {searchState}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge(task.status)}
            {task.status === "completed" && results && results.length > 0 && (
              <Button
                onClick={() => exportMutation.mutate({ taskId: taskId || "" })}
                disabled={exportMutation.isPending}
              >
                <Download className="mr-2 h-4 w-4" />
                导出CSV
              </Button>
            )}
          </div>
        </div>

        {/* 进度卡片 */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-card-foreground">任务进度</CardTitle>
            <CardDescription>
              消耗积分：{task.creditsUsed || 0} · 创建时间：{new Date(task.createdAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">处理进度</span>
              <span className="text-foreground font-medium">
                {progress}%
              </span>
            </div>
            <Progress value={progress} className="h-2" />

            <div className="grid grid-cols-3 gap-4 pt-4">
              <div className="text-center p-4 rounded-lg bg-secondary/50">
                <div className="text-2xl font-bold text-foreground">{task.requestedCount}</div>
                <div className="text-xs text-muted-foreground">请求数量</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-green-500/10">
                <div className="text-2xl font-bold text-green-400">{totalResults}</div>
                <div className="text-xs text-muted-foreground">实际结果</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-primary/10">
                <div className="text-2xl font-bold text-primary">{task.creditsUsed || 0}</div>
                <div className="text-xs text-muted-foreground">消耗积分</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 处理日志 */}
        {(task.status === "pending" || task.status === "running") && (
          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-card-foreground">处理日志</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-48 rounded-lg bg-secondary/30 p-4">
                <div className="space-y-2 font-mono text-sm">
                  {logs.length > 0 ? (
                    logs.map((log, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <span className={`${log.level === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}>
                          [{log.timestamp}] {log.message}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-muted-foreground">等待处理...</div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* 结果表格 */}
        {task.status === "completed" && results && results.length > 0 && (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-card-foreground">搜索结果</CardTitle>
              <CardDescription>共 {results.length} 条记录，结果将保留7天</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/50">
                      <TableHead className="text-foreground">姓名</TableHead>
                      <TableHead className="text-foreground">职位</TableHead>
                      <TableHead className="text-foreground">公司</TableHead>
                      <TableHead className="text-foreground">位置</TableHead>
                      <TableHead className="text-foreground">电话</TableHead>
                      <TableHead className="text-foreground">验证状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((result) => {
                      const data = result.data as ResultData || {};
                      const fullName = data.fullName || data.name || `${data.firstName || data.first_name || ""} ${data.lastName || data.last_name || ""}`.trim() || "-";
                      const title = data.title || "-";
                      const company = data.company || data.organization_name || "-";
                      const city = data.city || "";
                      const state = data.state || "";
                      const phoneNumber = data.phoneNumber || data.phone || "-";
                      
                      return (
                        <TableRow key={result.id} className="hover:bg-secondary/30">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium text-foreground">{fullName}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Briefcase className="h-4 w-4 text-muted-foreground" />
                              <span className="text-muted-foreground">{title}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Building className="h-4 w-4 text-muted-foreground" />
                              <span className="text-muted-foreground">{company}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span className="text-muted-foreground">
                                {city ? `${city}, ` : ""}{state || "-"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4 text-green-400" />
                              <span className="font-mono text-foreground">{phoneNumber}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {result.verified ? (
                                <>
                                  <CheckCircle className="h-4 w-4 text-green-400" />
                                  <span className="text-green-400 text-sm">已验证</span>
                                </>
                              ) : (
                                <>
                                  <XCircle className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-muted-foreground text-sm">未验证</span>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 无结果提示 */}
        {task.status === "completed" && (!results || results.length === 0) && (
          <Card className="border-border bg-card">
            <CardContent className="py-12">
              <div className="text-center">
                <XCircle className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold text-foreground">未找到结果</h3>
                <p className="text-muted-foreground mt-2">
                  搜索已完成，但没有找到匹配的结果
                </p>
                <Link href="/search">
                  <Button className="mt-4">尝试新的搜索</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 错误提示 */}
        {task.status === "failed" && (
          <Card className="border-destructive bg-destructive/10">
            <CardContent className="py-8">
              <div className="text-center">
                <XCircle className="h-16 w-16 mx-auto text-destructive mb-4" />
                <h3 className="text-lg font-semibold text-foreground">任务失败</h3>
                <p className="text-muted-foreground mt-2">
                  {task.errorMessage || "搜索过程中发生错误，请稍后重试"}
                </p>
                <Link href="/search">
                  <Button className="mt-4">重新搜索</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
