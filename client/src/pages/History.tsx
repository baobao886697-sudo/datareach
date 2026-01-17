import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Search, Clock, CheckCircle, XCircle, ArrowRight, Loader2, History as HistoryIcon, Target, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface SearchParams {
  name?: string;
  title?: string;
  state?: string;
}

export default function History() {
  const { user } = useAuth();
  
  const { data: tasksData, isLoading } = trpc.search.tasks.useQuery(
    { limit: 50 },
    { enabled: !!user }
  );

  const tasks = tasksData?.tasks || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">已完成</Badge>;
      case "failed":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">失败</Badge>;
      case "running":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">处理中</Badge>;
      case "pending":
      default:
        return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">等待中</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-6 w-6 text-green-400" />;
      case "failed":
        return <XCircle className="h-6 w-6 text-red-400" />;
      case "running":
        return <Loader2 className="h-6 w-6 text-yellow-400 animate-spin" />;
      case "pending":
      default:
        return <Clock className="h-6 w-6 text-slate-400" />;
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 relative">
        {/* 背景装饰 */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[100px]" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[100px]" />
        </div>

        {/* 标题区域 */}
        <div className="relative flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <HistoryIcon className="w-5 h-5 text-purple-400" />
              <span className="text-sm text-purple-400">任务记录</span>
            </div>
            <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
              搜索历史
            </h1>
            <p className="text-slate-400 mt-2">
              查看您的搜索任务记录，结果保留7天
            </p>
          </div>
          <Link href="/search">
            <Button className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white border-0 shadow-lg shadow-cyan-500/25">
              <Search className="h-4 w-4 mr-2" />
              新搜索
            </Button>
          </Link>
        </div>

        {/* 任务列表 */}
        <div className="relative p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
              <Target className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">任务列表</h3>
              <p className="text-sm text-slate-400">共 <span className="text-purple-400 font-mono">{tasksData?.total || 0}</span> 个任务</p>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : tasks && tasks.length > 0 ? (
            <div className="space-y-3">
              {tasks.map((task: any) => {
                const params = task.params as SearchParams || {};
                return (
                  <Link key={task.id} href={`/results/${task.taskId}`}>
                    <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/30 border border-slate-700/30 hover:border-purple-500/30 transition-all cursor-pointer group">
                      <div className="flex items-center gap-4">
                        <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                          task.status === "completed" ? "bg-green-500/20" :
                          task.status === "failed" ? "bg-red-500/20" :
                          task.status === "running" ? "bg-yellow-500/20" :
                          "bg-slate-700/50"
                        }`}>
                          {getStatusIcon(task.status)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-white">
                              {params.name || "未知搜索"}
                            </h3>
                            {getStatusBadge(task.status)}
                          </div>
                          <p className="text-sm text-slate-400 mt-1">
                            {params.title || "-"} · {params.state || "-"}
                          </p>
                          <div className="flex items-center gap-4 mt-2">
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <Target className="h-3 w-3" />
                              请求：<span className="text-slate-300 font-mono">{task.requestedCount || 0}</span>
                            </span>
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" />
                              结果：<span className="text-green-400 font-mono">{task.actualCount || 0}</span>
                            </span>
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <Zap className="h-3 w-3" />
                              消耗：<span className="text-yellow-400 font-mono">{task.creditsUsed || 0}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm text-slate-400">
                            {new Date(task.createdAt).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(task.createdAt).toLocaleTimeString()}
                          </p>
                        </div>
                        <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-purple-400 transition-colors" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="w-20 h-20 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                <Search className="h-10 w-10 text-slate-600" />
              </div>
              <h3 className="text-xl font-semibold text-white">暂无搜索记录</h3>
              <p className="text-slate-400 mt-2">
                开始您的第一次搜索
              </p>
              <Link href="/search">
                <Button className="mt-6 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white border-0 shadow-lg shadow-purple-500/25">
                  开始搜索
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
