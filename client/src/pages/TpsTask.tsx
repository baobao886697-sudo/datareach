/**
 * TruePeopleSearch 任务详情页面
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
} from "lucide-react";

export default function TpsTask() {
  const params = useParams();
  const taskId = params.taskId;
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  
  // 获取任务状态
  const { data: task, refetch: refetchTask } = trpc.tps.getTaskStatus.useQuery(
    { taskId: taskId! },
    {
      enabled: !!taskId,
      refetchInterval: (query) => {
        // 任务进行中时自动刷新
        const data = query.state.data;
        if (data?.status === "running" || data?.status === "pending") {
          return 2000;
        }
        return false;
      },
    }
  );
  
  // 获取搜索结果
  const { data: results, refetch: refetchResults } = trpc.tps.getTaskResults.useQuery(
    { taskId: taskId!, page, pageSize },
    { enabled: !!taskId && task?.status === "completed" }
  );
  
  // 导出 CSV
  const exportMutation = trpc.tps.exportResults.useMutation({
    onSuccess: (data) => {
      // 创建下载
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
        return <Badge variant="outline" className="border-yellow-500 text-yellow-500">等待中</Badge>;
      case "running":
        return <Badge variant="outline" className="border-blue-500 text-blue-500">搜索中</Badge>;
      case "completed":
        return <Badge variant="outline" className="border-green-500 text-green-500">已完成</Badge>;
      case "failed":
        return <Badge variant="outline" className="border-red-500 text-red-500">失败</Badge>;
      case "cancelled":
        return <Badge variant="outline" className="border-gray-500 text-gray-500">已取消</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };
  
  if (!taskId) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64">
          <XCircle className="h-12 w-12 text-red-500 mb-4" />
          <p className="text-gray-400">任务ID无效</p>
          <Button variant="outline" onClick={() => setLocation("/tps")} className="mt-4">
            返回搜索
          </Button>
        </div>
      </DashboardLayout>
    );
  }
  
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/tps")}
              className="hover:bg-gray-800"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <Search className="h-6 w-6 text-cyan-500" />
                搜索任务详情
              </h1>
              <p className="text-gray-400 mt-1 font-mono text-sm">
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
                className="border-gray-700 hover:bg-gray-800"
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
              className="border-gray-700 hover:bg-gray-800"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              刷新
            </Button>
          </div>
        </div>
        
        {/* 任务状态卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-[#0d1526] border-gray-800">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">任务状态</p>
                  <div className="mt-1">{task && getStatusBadge(task.status)}</div>
                </div>
                {task?.status === "running" ? (
                  <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                ) : task?.status === "completed" ? (
                  <CheckCircle className="h-8 w-8 text-green-500" />
                ) : task?.status === "failed" ? (
                  <XCircle className="h-8 w-8 text-red-500" />
                ) : (
                  <Clock className="h-8 w-8 text-yellow-500" />
                )}
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-[#0d1526] border-gray-800">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">搜索进度</p>
                  <p className="text-2xl font-bold text-white mt-1">
                    {task?.completedSubTasks || 0} / {task?.totalSubTasks || 0}
                  </p>
                </div>
                <FileText className="h-8 w-8 text-purple-500" />
              </div>
              <Progress value={task?.progress || 0} className="mt-3 h-2" />
            </CardContent>
          </Card>
          
          <Card className="bg-[#0d1526] border-gray-800">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">搜索结果</p>
                  <p className="text-2xl font-bold text-white mt-1">
                    {task?.totalResults || 0}
                  </p>
                </div>
                <User className="h-8 w-8 text-cyan-500" />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                缓存命中: {task?.cacheHits || 0}
              </p>
            </CardContent>
          </Card>
          
          <Card className="bg-[#0d1526] border-gray-800">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">消耗积分</p>
                  <p className="text-2xl font-bold text-cyan-400 mt-1">
                    {task?.creditsUsed?.toFixed(1) || 0}
                  </p>
                </div>
                <CreditCard className="h-8 w-8 text-green-500" />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                搜索页: {task?.searchPageRequests || 0} · 详情页: {task?.detailPageRequests || 0}
              </p>
            </CardContent>
          </Card>
        </div>
        
        {/* 任务日志 */}
        {task?.logs && task.logs.length > 0 && (
          <Card className="bg-[#0d1526] border-gray-800">
            <CardHeader>
              <CardTitle className="text-lg">任务日志</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-48">
                <div className="space-y-1 font-mono text-sm">
                  {task.logs.map((log: any, index: number) => (
                    <div key={index} className="flex gap-2">
                      <span className="text-gray-500 flex-shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="text-gray-300">{log.message}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
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
        {task?.status === "completed" && results && (
          <Card className="bg-[#0d1526] border-gray-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">搜索结果</CardTitle>
                <p className="text-sm text-gray-400">
                  共 {results.total} 条结果
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {results.results.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-gray-800">
                          <TableHead className="text-gray-400">姓名</TableHead>
                          <TableHead className="text-gray-400">年龄</TableHead>
                          <TableHead className="text-gray-400">地点</TableHead>
                          <TableHead className="text-gray-400">电话</TableHead>
                          <TableHead className="text-gray-400">类型</TableHead>
                          <TableHead className="text-gray-400">运营商</TableHead>
                          <TableHead className="text-gray-400">报告年份</TableHead>
                          <TableHead className="text-gray-400">房产价值</TableHead>
                          <TableHead className="text-gray-400">建造年份</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.results.map((result: any) => (
                          <TableRow key={result.id} className="border-gray-800">
                            <TableCell className="font-medium text-white">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-gray-500" />
                                {result.name}
                              </div>
                            </TableCell>
                            <TableCell>{result.age || "-"}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1 text-sm">
                                <MapPin className="h-3 w-3 text-gray-500" />
                                {result.city}, {result.state}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Phone className="h-3 w-3 text-cyan-500" />
                                <span className="font-mono">{result.phone}</span>
                                {result.isPrimary && (
                                  <Badge variant="outline" className="ml-1 text-xs border-green-500 text-green-500">
                                    主号
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {result.phoneType || "未知"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-gray-400">
                              {result.carrier || "-"}
                            </TableCell>
                            <TableCell>
                              {result.reportYear ? (
                                <div className="flex items-center gap-1 text-sm">
                                  <Calendar className="h-3 w-3 text-gray-500" />
                                  {result.reportYear}
                                </div>
                              ) : "-"}
                            </TableCell>
                            <TableCell>
                              {result.propertyValue > 0 ? (
                                <div className="flex items-center gap-1 text-sm text-green-400">
                                  <Home className="h-3 w-3" />
                                  ${result.propertyValue.toLocaleString()}
                                </div>
                              ) : "-"}
                            </TableCell>
                            <TableCell className="text-sm text-gray-400">
                              {result.yearBuilt || "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  
                  {/* 分页 */}
                  {results.totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <p className="text-sm text-gray-400">
                        第 {page} 页，共 {results.totalPages} 页
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={page === 1}
                          className="border-gray-700"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage(p => Math.min(results.totalPages, p + 1))}
                          disabled={page === results.totalPages}
                          className="border-gray-700"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12">
                  <Search className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-500">暂无搜索结果</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
