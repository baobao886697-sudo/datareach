/**
 * SearchPeopleFree 搜索历史页面 - 七彩鎏金风格
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
import {
  Search,
  History,
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
  Sparkles,
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
  
  .rainbow-bg {
    background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(255, 179, 71, 0.1), rgba(255, 107, 107, 0.1), rgba(255, 105, 180, 0.1), rgba(155, 89, 182, 0.1), rgba(52, 152, 219, 0.1), rgba(46, 204, 113, 0.1));
    background-size: 400% 400%;
    animation: rainbow-flow 8s ease infinite;
  }
  
  .rainbow-btn {
    background: linear-gradient(135deg, #ffd700, #ff6b6b, #ff69b4, #9b59b6);
    background-size: 300% 300%;
    animation: rainbow-flow 3s ease infinite;
  }
`;

export default function SpfHistory() {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  
  const { data, isLoading } = trpc.spf.getHistory.useQuery({ page, pageSize });
  
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
              onClick={() => setLocation("/spf/search")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Star className="h-6 w-6 text-yellow-400" />
                <span className="rainbow-text">SPF 搜索历史</span>
              </h1>
              <p className="text-muted-foreground mt-1">
                查看您的 SearchPeopleFree 搜索记录
              </p>
            </div>
          </div>
          <Button
            onClick={() => setLocation("/spf/search")}
            className="rainbow-btn text-white border-0"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            新建搜索
          </Button>
        </div>
        
        {/* 历史记录表格 */}
        <Card className="rainbow-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="h-5 w-5 text-yellow-400" />
              搜索记录
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
              </div>
            ) : data?.tasks && data.tasks.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>任务ID</TableHead>
                      <TableHead>搜索模式</TableHead>
                      <TableHead>子任务数</TableHead>
                      <TableHead>结果数</TableHead>
                      <TableHead>消耗积分</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.tasks.map((task: any) => (
                      <TableRow key={task.id}>
                        <TableCell className="font-mono text-sm">
                          {task.taskId.slice(0, 8)}...
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs border-yellow-500/30 text-yellow-400">
                            {task.mode === "nameOnly" ? "仅姓名" : "姓名+地点"}
                          </Badge>
                        </TableCell>
                        <TableCell>{task.totalSubTasks}</TableCell>
                        <TableCell className="font-medium text-green-400">
                          {task.totalResults}
                        </TableCell>
                        <TableCell className="rainbow-text font-bold">
                          {task.creditsUsed?.toFixed(1) || 0}
                        </TableCell>
                        <TableCell>{getStatusBadge(task.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(task.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLocation(`/spf/task/${task.taskId}`)}
                            className="hover:bg-yellow-500/10"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            查看
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                
                {/* 分页 */}
                {data.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      第 {page} / {data.totalPages} 页，共 {data.total} 条记录
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
                        onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                        disabled={page === data.totalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">暂无搜索记录</h3>
                <p className="text-muted-foreground mb-4">
                  开始您的第一次 SearchPeopleFree 搜索
                </p>
                <Button
                  onClick={() => setLocation("/spf/search")}
                  className="rainbow-btn text-white border-0"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  开始搜索
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
