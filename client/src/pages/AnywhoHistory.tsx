/**
 * Anywho 搜索历史页面 - 基于黄金模板 v2.0
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Download,
  Eye,
  ChevronLeft,
  ChevronRight,
  Star,
  Heart,
  History,
  Plus,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

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
  
  .rainbow-btn {
    background: linear-gradient(135deg, #f59e0b, #ff6b6b, #ff69b4, #9b59b6);
    background-size: 300% 300%;
    animation: rainbow-flow 3s ease infinite;
  }
  
  .rainbow-btn:hover {
    transform: scale(1.02);
    box-shadow: 0 0 30px rgba(245, 158, 11, 0.5);
  }
`;

export default function AnywhoHistory() {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  
  // 获取搜索历史
  const { data: history, isLoading } = trpc.anywho.getHistory.useQuery({
    page,
    pageSize,
  });
  
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
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            <Clock className="h-3 w-3 mr-1" />
            等待中
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            搜索中
          </Badge>
        );
      case "completed":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle className="h-3 w-3 mr-1" />
            已完成
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
      case "failed":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            <XCircle className="h-3 w-3 mr-1" />
            失败
          </Badge>
        );
      case "cancelled":
        return (
          <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
            <AlertCircle className="h-3 w-3 mr-1" />
            已取消
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };
  
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
                <History className="h-6 w-6 text-amber-500" />
                <span className="rainbow-text">搜索历史</span>
              </h1>
              <p className="text-muted-foreground mt-1">
                查看您的 Anywho 搜索记录
              </p>
            </div>
          </div>
          <Button
            onClick={() => setLocation("/anywho")}
            className="rainbow-btn text-white font-bold"
          >
            <Plus className="h-4 w-4 mr-2" />
            新建搜索
          </Button>
        </div>
        
        {/* 历史记录表格 */}
        <Card className="rainbow-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="h-5 w-5 text-amber-400" />
              搜索记录
              <Badge className="bg-pink-500/20 text-pink-400 border-pink-500/30 ml-2">
                <Heart className="h-3 w-3 mr-1" />
                含婚姻状况
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              </div>
            ) : history && history.tasks.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>任务ID</TableHead>
                      <TableHead>搜索模式</TableHead>
                      <TableHead>姓名数量</TableHead>
                      <TableHead>结果数</TableHead>
                      <TableHead>消耗积分</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.tasks.map((task: any) => (
                      <TableRow key={task.taskId} className="hover:bg-amber-500/5">
                        <TableCell className="font-mono text-sm">
                          {task.taskId.slice(0, 8)}...
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-400">
                            {task.mode === "nameOnly" ? "仅姓名" : "姓名+地点"}
                          </Badge>
                        </TableCell>
                        <TableCell>{task.names?.length || 0}</TableCell>
                        <TableCell className="font-medium text-amber-400">
                          {task.totalResults || 0}
                        </TableCell>
                        <TableCell className="text-purple-400">
                          {Number(task.creditsUsed || 0).toFixed(1)}
                        </TableCell>
                        <TableCell>{getStatusBadge(task.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(task.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setLocation(`/anywho/task/${task.taskId}`)}
                              className="hover:bg-amber-500/10 hover:text-amber-400"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              查看
                            </Button>
                            {(task.status === "completed" || task.status === "insufficient_credits" || task.status === "service_busy") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => exportMutation.mutate({ taskId: task.taskId })}
                                disabled={exportMutation.isPending}
                                className="hover:bg-green-500/10 hover:text-green-400"
                              >
                                {exportMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Download className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                
                {/* 分页 */}
                {history.total > pageSize && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      第 {page} 页，共 {Math.ceil(history.total / pageSize)} 页
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
                        disabled={page * pageSize >= history.total}
                        className="border-amber-500/30 hover:bg-amber-500/10"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <History className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground mb-4">暂无搜索记录</p>
                <Button
                  onClick={() => setLocation("/anywho")}
                  className="rainbow-btn text-white"
                >
                  <Search className="h-4 w-4 mr-2" />
                  开始第一次搜索
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
// Anywho History Golden Template v2.0
