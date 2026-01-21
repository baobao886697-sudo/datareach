import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Search, Coins, History, TrendingUp, Users, Phone, Clock, ArrowRight, Zap, Database, Shield, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// 定义搜索参数类型
interface SearchParams {
  name?: string;
  title?: string;
  state?: string;
}

export default function Dashboard() {
  const { user, loading } = useAuth();
  const { data: profile, isLoading: profileLoading } = trpc.user.profile.useQuery(undefined, {
    enabled: !!user,
  });
  
  // 获取充值配置（积分价格等）
  const { data: rechargeConfig } = trpc.recharge.config.useQuery();
  // 积分兑换比例（默认 1 USDT = 100 积分）
  const creditsPerUsdt = rechargeConfig?.creditsPerUsdt || 100;
  const { data: tasksData, isLoading: tasksLoading } = trpc.search.tasks.useQuery(
    { limit: 5 },
    { enabled: !!user }
  );

  // 从返回的对象中提取tasks数组
  const tasks = tasksData?.tasks || [];

  if (loading || !user) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-8 relative">
        {/* 背景装饰 */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[100px]" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[100px]" />
        </div>

        {/* 欢迎区域 */}
        <div className="relative flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              <span className="text-sm text-cyan-400">欢迎回来</span>
            </div>
            <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
              {profile?.name || profile?.email?.split("@")[0] || "用户"}
            </h1>
            <p className="text-slate-400 mt-2">
              开始搜索LinkedIn专业人士的联系方式
            </p>
          </div>
          <Link href="/search">
            <Button size="lg" className="gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg shadow-cyan-500/25 border-0 rounded-xl px-8">
              <Search className="h-5 w-5" />
              开始搜索
            </Button>
          </Link>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* 积分余额 */}
          <div className="group relative p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-cyan-500/20 hover:border-cyan-500/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-cyan-500/10">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-slate-400">积分余额</span>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex items-center justify-center">
                <Coins className="h-5 w-5 text-yellow-400" />
              </div>
            </div>
            {profileLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <>
                <div className="text-4xl font-bold text-white mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {profile?.credits?.toLocaleString() || 0}
                </div>
                <p className="text-xs text-slate-500">
                  1 USDT = {creditsPerUsdt} 积分
                </p>
              </>
            )}
            {/* 装饰线 */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-yellow-500/50 via-orange-500/50 to-transparent rounded-b-2xl" />
          </div>

          {/* 搜索任务 */}
          <div className="group relative p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-blue-500/20 hover:border-blue-500/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-500/10">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-slate-400">搜索任务</span>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center">
                <Database className="h-5 w-5 text-blue-400" />
              </div>
            </div>
            {tasksLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <>
                <div className="text-4xl font-bold text-white mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {tasksData?.total || 0}
                </div>
                <p className="text-xs text-slate-500">
                  历史搜索任务总数
                </p>
              </>
            )}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500/50 via-indigo-500/50 to-transparent rounded-b-2xl" />
          </div>

          {/* 获取结果 */}
          <div className="group relative p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-green-500/20 hover:border-green-500/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-green-500/10">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-slate-400">获取结果</span>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                <Phone className="h-5 w-5 text-green-400" />
              </div>
            </div>
            {tasksLoading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <>
                <div className="text-4xl font-bold text-white mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {tasks?.reduce((sum: number, t: any) => sum + (t.actualCount || 0), 0) || 0}
                </div>
                <p className="text-xs text-slate-500">
                  已获取的联系人数量
                </p>
              </>
            )}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-green-500/50 via-emerald-500/50 to-transparent rounded-b-2xl" />
          </div>
        </div>

        {/* 快捷操作 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative">
          {/* 快速充值 */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                <Zap className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">快速充值</h3>
                <p className="text-sm text-slate-400">使用USDT-TRC20充值积分</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[100, 500, 1000].map((amount) => (
                <Link key={amount} href={`/recharge?amount=${amount}`}>
                  <Button 
                    variant="outline" 
                    className="w-full h-12 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500/50 rounded-xl"
                  >
                    <span className="font-semibold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{amount}</span>
                    <span className="ml-1 text-slate-400">积分</span>
                  </Button>
                </Link>
              ))}
            </div>
            <Link href="/recharge">
              <Button variant="ghost" className="w-full gap-2 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10">
                自定义金额
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          {/* 最近任务 */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                  <History className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">最近任务</h3>
                  <p className="text-sm text-slate-400">您最近的搜索任务</p>
                </div>
              </div>
              <Link href="/history">
                <Button variant="ghost" size="sm" className="gap-1 text-slate-400 hover:text-purple-400 hover:bg-purple-500/10">
                  查看全部
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
            
            {tasksLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            ) : tasks && tasks.length > 0 ? (
              <div className="space-y-3">
                {tasks.slice(0, 3).map((task: any) => {
                  const params = task.params as SearchParams || {};
                  return (
                    <Link key={task.id} href={`/results/${task.taskId}`}>
                      <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-purple-500/30 transition-all cursor-pointer group">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${
                            task.status === "completed" ? "bg-green-500 shadow-lg shadow-green-500/50" :
                            task.status === "failed" ? "bg-red-500 shadow-lg shadow-red-500/50" :
                            "bg-yellow-500 animate-pulse shadow-lg shadow-yellow-500/50"
                          }`} />
                          <div>
                            <p className="text-sm font-medium text-white group-hover:text-purple-300 transition-colors">
                              {params.name || "未知"} - {params.title || "未知"}
                            </p>
                            <p className="text-xs text-slate-500">
                              {params.state || "未知"} · {task.actualCount || 0} 个结果
                            </p>
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-purple-400 transition-colors" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                  <History className="h-8 w-8 text-slate-600" />
                </div>
                <p className="text-slate-500 mb-4">暂无搜索记录</p>
                <Link href="/search">
                  <Button variant="outline" className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10">
                    开始第一次搜索
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* 使用指南 */}
        <div className="relative p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
              <Shield className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">使用指南</h3>
              <p className="text-sm text-slate-400">快速了解如何使用云端寻踪 Pro</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { step: 1, title: "充值积分", desc: "使用USDT购买积分", color: "cyan" },
              { step: 2, title: "输入搜索条件", desc: "姓名+职位+州", color: "blue" },
              { step: 3, title: "等待验证", desc: "系统自动验证电话", color: "purple" },
              { step: 4, title: "导出结果", desc: "下载CSV文件", color: "green" },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-4 p-4 rounded-xl bg-slate-800/30 border border-slate-700/30 hover:border-slate-600/50 transition-colors">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br from-${item.color}-500/20 to-${item.color}-600/20 flex items-center justify-center shrink-0`}>
                  <span className={`text-${item.color}-400 font-bold`} style={{ fontFamily: 'Orbitron, sans-serif' }}>
                    {item.step}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-white">{item.title}</p>
                  <p className="text-sm text-slate-500">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
