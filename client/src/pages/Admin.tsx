import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Users, Coins, Search, Settings, Plus, Minus, 
  RefreshCw, Shield, TrendingUp, Phone, DollarSign,
  LogOut, Target, LayoutDashboard, CreditCard, FileText,
  Database, AlertTriangle, CheckCircle, XCircle, Clock
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Admin() {
  const [, setLocation] = useLocation();
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [creditAmount, setCreditAmount] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  
  // 检查管理员登录状态
  const adminToken = localStorage.getItem("adminToken");
  
  useEffect(() => {
    if (!adminToken) {
      setLocation("/admin/login");
    }
  }, [adminToken, setLocation]);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.admin.stats.useQuery(
    undefined,
    { 
      enabled: !!adminToken,
      retry: false,
      onError: () => {
        localStorage.removeItem("adminToken");
        setLocation("/admin/login");
      }
    }
  );

  const { data: usersData, isLoading: usersLoading, refetch: refetchUsers } = trpc.admin.users.useQuery(
    undefined,
    { enabled: !!adminToken }
  );

  const users = usersData?.users || [];

  const adjustCreditsMutation = trpc.admin.adjustCredits.useMutation({
    onSuccess: () => {
      toast.success("积分调整成功");
      refetchUsers();
      refetchStats();
      setDialogOpen(false);
      setCreditAmount(0);
    },
    onError: (error) => {
      toast.error(error.message || "调整失败");
    },
  });

  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    toast.success("已退出管理后台");
    setLocation("/admin/login");
  };

  const handleAdjustCredits = (add: boolean) => {
    if (!selectedUser || creditAmount <= 0) return;
    adjustCreditsMutation.mutate({
      userId: selectedUser,
      amount: add ? creditAmount : -creditAmount,
      reason: add ? "管理员手动增加" : "管理员手动扣除",
    });
  };

  if (!adminToken) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* 侧边栏 */}
      <div className="w-64 bg-slate-900/50 border-r border-slate-800 p-4 flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 px-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-lg shadow-red-500/30">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <div>
            <span className="font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
              管理后台
            </span>
            <p className="text-xs text-slate-500">云端寻踪 Pro</p>
          </div>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 space-y-1">
          {[
            { id: "dashboard", label: "仪表盘", icon: LayoutDashboard },
            { id: "users", label: "用户管理", icon: Users },
            { id: "orders", label: "充值订单", icon: CreditCard },
            { id: "logs", label: "系统日志", icon: FileText },
            { id: "settings", label: "系统配置", icon: Settings },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                activeTab === item.id
                  ? "bg-gradient-to-r from-red-500/20 to-orange-500/20 text-orange-400 border border-orange-500/30"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-white"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>

        {/* 退出按钮 */}
        <Button
          variant="ghost"
          onClick={handleLogout}
          className="w-full justify-start text-red-400 hover:text-red-300 hover:bg-red-500/10"
        >
          <LogOut className="h-4 w-4 mr-2" />
          退出登录
        </Button>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 p-6 overflow-auto">
        {/* 背景装饰 */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-red-500/5 rounded-full blur-[100px]" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-orange-500/5 rounded-full blur-[100px]" />
        </div>

        {/* 仪表盘 */}
        {activeTab === "dashboard" && (
          <div className="relative space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <LayoutDashboard className="w-5 h-5 text-orange-400" />
                  <span className="text-sm text-orange-400">系统概览</span>
                </div>
                <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                  管理仪表盘
                </h1>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { refetchStats(); refetchUsers(); }}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                刷新数据
              </Button>
            </div>

            {/* 统计卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "总用户数", value: usersData?.total || 0, icon: Users, color: "cyan", loading: usersLoading },
                { label: "今日搜索", value: stats?.todaySearches || 0, icon: Search, color: "purple", loading: statsLoading },
                { label: "总搜索次数", value: stats?.totalSearches || 0, icon: TrendingUp, color: "green", loading: statsLoading },
                { label: "今日积分消耗", value: stats?.todayCreditsUsed || 0, icon: Coins, color: "yellow", loading: statsLoading },
              ].map((stat, index) => (
                <div
                  key={index}
                  className="relative p-5 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 overflow-hidden"
                >
                  <div className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${
                    stat.color === "cyan" ? "from-cyan-500 to-blue-500" :
                    stat.color === "purple" ? "from-purple-500 to-pink-500" :
                    stat.color === "green" ? "from-green-500 to-emerald-500" :
                    "from-yellow-500 to-orange-500"
                  }`} />
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-slate-400">{stat.label}</p>
                      {stat.loading ? (
                        <Skeleton className="h-8 w-20 mt-2" />
                      ) : (
                        <p className="text-3xl font-bold text-white mt-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                          {stat.value.toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      stat.color === "cyan" ? "bg-cyan-500/20" :
                      stat.color === "purple" ? "bg-purple-500/20" :
                      stat.color === "green" ? "bg-green-500/20" :
                      "bg-yellow-500/20"
                    }`}>
                      <stat.icon className={`h-6 w-6 ${
                        stat.color === "cyan" ? "text-cyan-400" :
                        stat.color === "purple" ? "text-purple-400" :
                        stat.color === "green" ? "text-green-400" :
                        "text-yellow-400"
                      }`} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 快速操作 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={() => setActiveTab("users")}
                className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 hover:border-cyan-500/30 transition-all group text-left"
              >
                <Users className="h-8 w-8 text-cyan-400 mb-3 group-hover:scale-110 transition-transform" />
                <h3 className="text-lg font-semibold text-white">用户管理</h3>
                <p className="text-sm text-slate-400 mt-1">查看和管理所有用户</p>
              </button>
              <button
                onClick={() => setActiveTab("orders")}
                className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 hover:border-yellow-500/30 transition-all group text-left"
              >
                <CreditCard className="h-8 w-8 text-yellow-400 mb-3 group-hover:scale-110 transition-transform" />
                <h3 className="text-lg font-semibold text-white">充值订单</h3>
                <p className="text-sm text-slate-400 mt-1">处理充值和异常订单</p>
              </button>
              <button
                onClick={() => setActiveTab("settings")}
                className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 hover:border-purple-500/30 transition-all group text-left"
              >
                <Settings className="h-8 w-8 text-purple-400 mb-3 group-hover:scale-110 transition-transform" />
                <h3 className="text-lg font-semibold text-white">系统配置</h3>
                <p className="text-sm text-slate-400 mt-1">配置收款地址和参数</p>
              </button>
            </div>
          </div>
        )}

        {/* 用户管理 */}
        {activeTab === "users" && (
          <div className="relative space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-5 h-5 text-cyan-400" />
                  <span className="text-sm text-cyan-400">用户管理</span>
                </div>
                <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                  用户列表
                </h1>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchUsers()}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                刷新
              </Button>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 overflow-hidden">
              {usersLoading ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 rounded-xl" />
                  ))}
                </div>
              ) : users && users.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-transparent">
                      <TableHead className="text-slate-400">ID</TableHead>
                      <TableHead className="text-slate-400">邮箱</TableHead>
                      <TableHead className="text-slate-400">姓名</TableHead>
                      <TableHead className="text-slate-400">积分</TableHead>
                      <TableHead className="text-slate-400">角色</TableHead>
                      <TableHead className="text-slate-400">注册时间</TableHead>
                      <TableHead className="text-slate-400">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u: any) => (
                      <TableRow key={u.id} className="border-slate-700/50 hover:bg-slate-800/30">
                        <TableCell className="font-mono text-slate-500">
                          {u.id}
                        </TableCell>
                        <TableCell className="text-white">
                          {u.email}
                        </TableCell>
                        <TableCell className="text-slate-400">
                          {u.name || "-"}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-yellow-400">
                            {u.credits?.toLocaleString() || 0}
                          </span>
                        </TableCell>
                        <TableCell>
                          {u.role === "admin" ? (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">管理员</Badge>
                          ) : (
                            <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">用户</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-500 text-sm">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Dialog open={dialogOpen && selectedUser === u.id} onOpenChange={(open) => {
                            setDialogOpen(open);
                            if (open) setSelectedUser(u.id);
                          }}>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10">
                                <Coins className="h-4 w-4 mr-1" />
                                调整积分
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="bg-slate-900 border-slate-700">
                              <DialogHeader>
                                <DialogTitle className="text-white">
                                  调整积分
                                </DialogTitle>
                                <DialogDescription className="text-slate-400">
                                  为用户 {u.email} 调整积分
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                  <Label className="text-slate-300">当前积分</Label>
                                  <p className="text-3xl font-bold text-yellow-400" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                                    {u.credits?.toLocaleString() || 0}
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-slate-300">调整数量</Label>
                                  <Input
                                    type="number"
                                    min={1}
                                    value={creditAmount}
                                    onChange={(e) => setCreditAmount(Number(e.target.value))}
                                    className="bg-slate-800 border-slate-700 text-white"
                                  />
                                </div>
                              </div>
                              <DialogFooter className="gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => handleAdjustCredits(false)}
                                  disabled={adjustCreditsMutation.isPending || creditAmount <= 0}
                                  className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                                >
                                  <Minus className="h-4 w-4 mr-1" />
                                  扣除
                                </Button>
                                <Button
                                  onClick={() => handleAdjustCredits(true)}
                                  disabled={adjustCreditsMutation.isPending || creditAmount <= 0}
                                  className="bg-gradient-to-r from-green-500 to-emerald-600 text-white border-0"
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  增加
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12">
                  <Users className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-500">暂无用户数据</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 充值订单 */}
        {activeTab === "orders" && (
          <div className="relative space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="w-5 h-5 text-yellow-400" />
                <span className="text-sm text-yellow-400">订单管理</span>
              </div>
              <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                充值订单
              </h1>
            </div>

            <div className="text-center py-12 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
              <CreditCard className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-500">订单管理功能开发中...</p>
            </div>
          </div>
        )}

        {/* 系统日志 */}
        {activeTab === "logs" && (
          <div className="relative space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-5 h-5 text-green-400" />
                <span className="text-sm text-green-400">系统日志</span>
              </div>
              <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                操作日志
              </h1>
            </div>

            <div className="text-center py-12 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
              <FileText className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-500">日志查看功能开发中...</p>
            </div>
          </div>
        )}

        {/* 系统配置 */}
        {activeTab === "settings" && (
          <div className="relative space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-5 h-5 text-purple-400" />
                <span className="text-sm text-purple-400">系统配置</span>
              </div>
              <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                配置管理
              </h1>
            </div>

            <div className="text-center py-12 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
              <Settings className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-500">配置管理功能开发中...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
