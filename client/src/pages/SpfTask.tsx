/**
 * SearchPeopleFree 任务详情页面 - 七彩鎏金风格
 */

import { useState } from "react";
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
  Mail,
  Heart,
  Briefcase,
  Star,
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
      box-shadow: 0 0 20px rgba(255, 215, 0, 0.4),
                  0 0 40px rgba(255, 165, 0, 0.3),
                  0 0 60px rgba(255, 105, 180, 0.2);
    }
    50% {
      box-shadow: 0 0 30px rgba(255, 215, 0, 0.6),
                  0 0 60px rgba(255, 165, 0, 0.5),
                  0 0 90px rgba(255, 105, 180, 0.4);
    }
  }
  
  @keyframes border-dance {
    0%, 100% { border-color: #ffd700; }
    16% { border-color: #ff6b6b; }
    33% { border-color: #ff69b4; }
    50% { border-color: #9b59b6; }
    66% { border-color: #3498db; }
    83% { border-color: #2ecc71; }
  }
  
  .rainbow-text {
    background: linear-gradient(90deg, #ffd700, #ffb347, #ff6b6b, #ff69b4, #9b59b6, #3498db, #2ecc71, #ffd700);
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
    background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(255, 179, 71, 0.1), rgba(255, 107, 107, 0.1), rgba(255, 105, 180, 0.1), rgba(155, 89, 182, 0.1), rgba(52, 152, 219, 0.1), rgba(46, 204, 113, 0.1));
    background-size: 400% 400%;
    animation: rainbow-flow 8s ease infinite;
  }
`;

export default function SpfTask() {
  const params = useParams();
  const taskId = params.taskId;
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  
  // 获取任务状态
  const { data: task, refetch: refetchTask } = trpc.spf.getTaskStatus.useQuery(
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
  const { data: results, refetch: refetchResults } = trpc.spf.getResults.useQuery(
    { taskId: taskId!, page, pageSize },
    { enabled: !!taskId && task?.status === "completed" }
  );
  
  // 导出 CSV
  const exportMutation = trpc.spf.exportCsv.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.content], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.fileName;
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
      case "failed":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">失败</Badge>;
      case "cancelled":
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">已取消</Badge>;
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
          <Button variant="outline" onClick={() => setLocation("/spf/search")} className="mt-4">
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
              onClick={() => setLocation("/spf/search")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Star className="h-6 w-6 text-yellow-400" />
                <span className="rainbow-text">SPF 搜索任务</span>
              </h1>
              <p className="text-muted-foreground mt-1 font-mono text-sm">
                {taskId}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {task?.status === "completed" && (
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
        
        {/* 任务状态卡片 - 七彩鎏金风格 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="rainbow-border rainbow-bg">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">任务状态</p>
                  <div className="mt-1">{task && getStatusBadge(task.status)}</div>
                </div>
                {task?.status === "running" ? (
                  <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
                ) : task?.status === "completed" ? (
                  <CheckCircle className="h-8 w-8 text-green-400" />
                ) : task?.status === "failed" ? (
                  <XCircle className="h-8 w-8 text-red-400" />
                ) : (
                  <Clock className="h-8 w-8 text-yellow-400" />
                )}
              </div>
            </CardContent>
          </Card>
          
          <Card className="rainbow-border rainbow-bg">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">搜索进度</p>
                  <p className="text-2xl font-bold mt-1">
                    {task?.completedSubTasks || 0} / {task?.totalSubTasks || 0}
                  </p>
                </div>
                <FileText className="h-8 w-8 text-purple-400" />
              </div>
              <Progress value={task?.progress || 0} className="mt-3 h-2" />
            </CardContent>
          </Card>
          
          <Card className="rainbow-border rainbow-bg">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">搜索结果</p>
                  <p className="text-2xl font-bold mt-1">
                    {task?.totalResults || 0}
                  </p>
                </div>
                <User className="h-8 w-8 text-cyan-400" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                缓存命中: {task?.cacheHits || 0}
              </p>
            </CardContent>
          </Card>
          
          <Card className="rainbow-border rainbow-glow">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">消耗积分</p>
                  <p className="text-2xl font-bold rainbow-text mt-1">
                    {task?.creditsUsed?.toFixed(1) || 0}
                  </p>
                </div>
                <CreditCard className="h-8 w-8 text-green-400" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                搜索: {task?.searchPageRequests || 0} · 详情: {task?.detailPageRequests || 0}
              </p>
            </CardContent>
          </Card>
        </div>
        
        {/* 搜索结果表格 */}
        {task?.status === "completed" && results && results.results.length > 0 && (
          <Card className="rainbow-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-yellow-400" />
                搜索结果
              </CardTitle>
              <CardDescription>
                共 {results.total} 条结果，当前显示第 {page} 页
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>姓名</TableHead>
                      <TableHead>年龄</TableHead>
                      <TableHead>电话</TableHead>
                      <TableHead>电话类型</TableHead>
                      <TableHead>邮箱</TableHead>
                      <TableHead>婚姻状态</TableHead>
                      <TableHead>地址</TableHead>
                      <TableHead>确认日期</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.results.map((result: any, index: number) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-yellow-400" />
                            {result.name}
                          </div>
                        </TableCell>
                        <TableCell>{result.age || "-"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-green-400" />
                            {result.phone || "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {result.phoneType && (
                            <Badge variant="outline" className={
                              result.phoneType === "Wireless" 
                                ? "border-blue-500 text-blue-400" 
                                : "border-gray-500 text-gray-400"
                            }>
                              {result.phoneType}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {result.email && (
                            <div className="flex items-center gap-2">
                              <Mail className="h-4 w-4 text-pink-400" />
                              <span className="text-xs">{result.email}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {result.maritalStatus && (
                            <div className="flex items-center gap-2">
                              <Heart className="h-4 w-4 text-red-400" />
                              <span className="text-xs">{result.maritalStatus}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-purple-400" />
                            <span className="text-xs max-w-[200px] truncate">
                              {result.address || "-"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {result.confirmedDate && (
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-cyan-400" />
                              <span className="text-xs">{result.confirmedDate}</span>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
              
              {/* 分页 */}
              {results.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    第 {page} / {results.totalPages} 页
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.min(results.totalPages, p + 1))}
                      disabled={page === results.totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        
        {/* 任务进行中提示 */}
        {(task?.status === "running" || task?.status === "pending") && (
          <Card className="rainbow-border rainbow-glow">
            <CardContent className="py-12 text-center">
              <Loader2 className="h-12 w-12 text-yellow-400 animate-spin mx-auto mb-4" />
              <h3 className="text-xl font-bold rainbow-text mb-2">搜索进行中</h3>
              <p className="text-muted-foreground">
                正在搜索 SearchPeopleFree 数据，请稍候...
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                进度: {task?.progress || 0}%
              </p>
            </CardContent>
          </Card>
        )}
        
        {/* 无结果提示 */}
        {task?.status === "completed" && (!results || results.results.length === 0) && (
          <Card className="rainbow-border">
            <CardContent className="py-12 text-center">
              <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">暂无搜索结果</h3>
              <p className="text-muted-foreground">
                未找到符合条件的数据，请尝试其他搜索条件
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
