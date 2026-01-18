import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Users, Coins, Search, Settings, Plus, Minus, 
  RefreshCw, Shield, TrendingUp, Phone, DollarSign,
  LogOut, Target, LayoutDashboard, CreditCard, FileText,
  Database, AlertTriangle, CheckCircle, XCircle, Clock,
  Eye, Edit, Ban, UserCheck, Wallet, Copy, ExternalLink,
  Save, Trash2, Activity, Server, Zap, Megaphone, Mail,
  BarChart3, MessageSquare
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { UserDetailDialog } from "@/components/admin/UserDetailDialog";
import { AnnouncementManager } from "@/components/admin/AnnouncementManager";
import { SystemMonitor } from "@/components/admin/SystemMonitor";
import { OrderDetailDialog } from "@/components/admin/OrderDetailDialog";
import { BulkMessageDialog } from "@/components/admin/BulkMessageDialog";

export default function Admin() {
  const [, setLocation] = useLocation();
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [creditAmount, setCreditAmount] = useState(0);
  const [creditReason, setCreditReason] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [orderFilter, setOrderFilter] = useState<string>("all");
  const [logType, setLogType] = useState<string>("api");
  
  // 订单确认对话框
  const [confirmOrderDialog, setConfirmOrderDialog] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [txId, setTxId] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  
  // 配置编辑
  const [editingConfig, setEditingConfig] = useState<{ key: string; value: string; description?: string } | null>(null);
  const [newConfigKey, setNewConfigKey] = useState("");
  const [newConfigValue, setNewConfigValue] = useState("");
  const [newConfigDesc, setNewConfigDesc] = useState("");
  
  // 新增对话框状态
  const [userDetailDialogOpen, setUserDetailDialogOpen] = useState(false);
  const [orderDetailDialogOpen, setOrderDetailDialogOpen] = useState(false);
  const [bulkMessageDialogOpen, setBulkMessageDialogOpen] = useState(false);
  const [orderSearchQuery, setOrderSearchQuery] = useState("");
  
  // 检查管理员登录状态
  const adminToken = localStorage.getItem("adminToken");
  
  useEffect(() => {
    if (!adminToken) {
      setLocation("/admin/login");
    }
  }, [adminToken, setLocation]);

  // ============ 数据查询 ============
  
  const { data: dashboardStats, isLoading: statsLoading, refetch: refetchStats, error: statsError } = trpc.admin.dashboardStats.useQuery(
    undefined,
    { enabled: !!adminToken, retry: false }
  );

  useEffect(() => {
    if (statsError) {
      localStorage.removeItem("adminToken");
      setLocation("/admin/login");
    }
  }, [statsError, setLocation]);

  const { data: usersData, isLoading: usersLoading, refetch: refetchUsers } = trpc.admin.users.useQuery(
    undefined,
    { enabled: !!adminToken }
  );

  const { data: ordersData, isLoading: ordersLoading, refetch: refetchOrders } = trpc.admin.orders.useQuery(
    { status: orderFilter === "all" ? undefined : orderFilter },
    { enabled: !!adminToken }
  );

  const { data: configsData, isLoading: configsLoading, refetch: refetchConfigs } = trpc.admin.configs.useQuery(
    undefined,
    { enabled: !!adminToken }
  );

  const { data: apiLogsData, isLoading: apiLogsLoading, refetch: refetchApiLogs } = trpc.admin.apiLogs.useQuery(
    undefined,
    { enabled: !!adminToken && logType === "api" }
  );

  const { data: adminLogsData, isLoading: adminLogsLoading, refetch: refetchAdminLogs } = trpc.admin.adminLogs.useQuery(
    undefined,
    { enabled: !!adminToken && logType === "admin" }
  );

  const users = usersData?.users || [];
  const orders = ordersData?.orders || [];
  const configs = configsData || [];

  // ============ Mutations ============

  const adjustCreditsMutation = trpc.admin.adjustCredits.useMutation({
    onSuccess: () => {
      toast.success("积分调整成功");
      refetchUsers();
      refetchStats();
      setDialogOpen(false);
      setCreditAmount(0);
      setCreditReason("");
    },
    onError: (error) => {
      toast.error(error.message || "调整失败");
    },
  });

  const updateUserStatusMutation = trpc.admin.updateUserStatus.useMutation({
    onSuccess: () => {
      toast.success("用户状态已更新");
      refetchUsers();
    },
    onError: (error) => {
      toast.error(error.message || "更新失败");
    },
  });

  const confirmOrderMutation = trpc.admin.confirmOrder.useMutation({
    onSuccess: () => {
      toast.success("订单已确认到账");
      refetchOrders();
      refetchStats();
      setConfirmOrderDialog(false);
      setTxId("");
      setReceivedAmount("");
    },
    onError: (error) => {
      toast.error(error.message || "确认失败");
    },
  });

  const cancelOrderMutation = trpc.admin.cancelOrder.useMutation({
    onSuccess: () => {
      toast.success("订单已取消");
      refetchOrders();
    },
    onError: (error) => {
      toast.error(error.message || "取消失败");
    },
  });

  const setConfigMutation = trpc.admin.setConfig.useMutation({
    onSuccess: () => {
      toast.success("配置已保存");
      refetchConfigs();
      setEditingConfig(null);
      setNewConfigKey("");
      setNewConfigValue("");
      setNewConfigDesc("");
    },
    onError: (error) => {
      toast.error(error.message || "保存失败");
    },
  });

  const deleteConfigMutation = trpc.admin.deleteConfig.useMutation({
    onSuccess: () => {
      toast.success("配置已删除");
      refetchConfigs();
    },
    onError: (error) => {
      toast.error(error.message || "删除失败");
    },
  });

  const initDefaultConfigsMutation = trpc.admin.initDefaultConfigs.useMutation({
    onSuccess: () => {
      toast.success("默认配置已初始化");
      refetchConfigs();
    },
    onError: (error) => {
      toast.error(error.message || "初始化失败");
    },
  });

  // ============ 事件处理 ============

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
      reason: creditReason || (add ? "管理员手动增加" : "管理员手动扣除"),
    });
  };

  const handleConfirmOrder = () => {
    if (!selectedOrder || !txId) return;
    confirmOrderMutation.mutate({
      orderId: selectedOrder.orderId,
      txId,
      receivedAmount: receivedAmount || selectedOrder.amount,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "paid":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">已支付</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">待支付</Badge>;
      case "cancelled":
        return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">已取消</Badge>;
      case "expired":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">已过期</Badge>;
      case "mismatch":
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">金额不匹配</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
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
            { id: "wallet", label: "钱包监控", icon: Wallet },
            { id: "announcements", label: "公告管理", icon: Megaphone },
            { id: "monitor", label: "系统监控", icon: BarChart3 },
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

        {/* ============ 仪表盘 ============ */}
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
                onClick={() => { refetchStats(); refetchUsers(); refetchOrders(); }}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                刷新数据
              </Button>
            </div>

            {/* 统计卡片 - 第一行 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "总用户数", value: dashboardStats?.users?.total || 0, icon: Users, color: "cyan", sub: `今日新增 ${dashboardStats?.users?.newToday || 0}` },
                { label: "活跃用户", value: dashboardStats?.users?.active || 0, icon: UserCheck, color: "green", sub: `本周新增 ${dashboardStats?.users?.newThisWeek || 0}` },
                { label: "待处理订单", value: dashboardStats?.orders?.pendingCount || 0, icon: Clock, color: "yellow", sub: `今日 ${dashboardStats?.orders?.todayCount || 0} 笔` },
                { label: "本月收入", value: `$${dashboardStats?.orders?.monthAmount || 0}`, icon: DollarSign, color: "purple", sub: `今日 $${dashboardStats?.orders?.todayAmount || 0}` },
              ].map((stat, index) => (
                <div
                  key={index}
                  className="relative p-5 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 overflow-hidden"
                >
                  <div className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${
                    stat.color === "cyan" ? "from-cyan-500 to-blue-500" :
                    stat.color === "green" ? "from-green-500 to-emerald-500" :
                    stat.color === "yellow" ? "from-yellow-500 to-orange-500" :
                    "from-purple-500 to-pink-500"
                  }`} />
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-slate-400">{stat.label}</p>
                      {statsLoading ? (
                        <Skeleton className="h-8 w-20 mt-2" />
                      ) : (
                        <>
                          <p className="text-3xl font-bold text-white mt-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                            {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">{stat.sub}</p>
                        </>
                      )}
                    </div>
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      stat.color === "cyan" ? "bg-cyan-500/20" :
                      stat.color === "green" ? "bg-green-500/20" :
                      stat.color === "yellow" ? "bg-yellow-500/20" :
                      "bg-purple-500/20"
                    }`}>
                      <stat.icon className={`h-6 w-6 ${
                        stat.color === "cyan" ? "text-cyan-400" :
                        stat.color === "green" ? "text-green-400" :
                        stat.color === "yellow" ? "text-yellow-400" :
                        "text-purple-400"
                      }`} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 统计卡片 - 第二行 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "今日搜索", value: dashboardStats?.searches?.todaySearches || 0, icon: Search, color: "blue" },
                { label: "总搜索次数", value: dashboardStats?.searches?.totalSearches || 0, icon: TrendingUp, color: "indigo" },
                { label: "今日积分消耗", value: dashboardStats?.searches?.todayCreditsUsed || 0, icon: Coins, color: "amber" },
                { label: "缓存条目", value: dashboardStats?.cache?.totalEntries || 0, icon: Database, color: "teal" },
              ].map((stat, index) => (
                <div
                  key={index}
                  className="relative p-5 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 overflow-hidden"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-slate-400">{stat.label}</p>
                      {statsLoading ? (
                        <Skeleton className="h-8 w-20 mt-2" />
                      ) : (
                        <p className="text-2xl font-bold text-white mt-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                          {stat.value.toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-slate-800/50`}>
                      <stat.icon className="h-5 w-5 text-slate-400" />
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

        {/* ============ 用户管理 ============ */}
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
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkMessageDialogOpen(true)}
                  className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  批量发消息
                </Button>
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
                      <TableHead className="text-slate-400">状态</TableHead>
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
                          {u.status === "active" ? (
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">正常</Badge>
                          ) : (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">禁用</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-500 text-sm">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Dialog open={dialogOpen && selectedUser === u.id} onOpenChange={(open) => {
                              setDialogOpen(open);
                              if (open) setSelectedUser(u.id);
                            }}>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10">
                                  <Coins className="h-4 w-4 mr-1" />
                                  积分
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="bg-slate-900 border-slate-700">
                                <DialogHeader>
                                  <DialogTitle className="text-white">调整积分</DialogTitle>
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
                                  <div className="space-y-2">
                                    <Label className="text-slate-300">原因说明</Label>
                                    <Input
                                      value={creditReason}
                                      onChange={(e) => setCreditReason(e.target.value)}
                                      placeholder="请输入调整原因"
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
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedUser(u.id);
                                setUserDetailDialogOpen(true);
                              }}
                              className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => updateUserStatusMutation.mutate({
                                userId: u.id,
                                status: u.status === "active" ? "disabled" : "active"
                              })}
                              className={u.status === "active" 
                                ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                : "text-green-400 hover:text-green-300 hover:bg-green-500/10"
                              }
                            >
                              {u.status === "active" ? <Ban className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                            </Button>
                          </div>
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

        {/* ============ 充值订单 ============ */}
        {activeTab === "orders" && (
          <div className="relative space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CreditCard className="w-5 h-5 text-yellow-400" />
                  <span className="text-sm text-yellow-400">订单管理</span>
                </div>
                <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                  充值订单
                </h1>
              </div>
              <div className="flex items-center gap-3">
                <Select value={orderFilter} onValueChange={setOrderFilter}>
                  <SelectTrigger className="w-32 bg-slate-800 border-slate-700 text-white">
                    <SelectValue placeholder="筛选状态" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="pending">待支付</SelectItem>
                    <SelectItem value="paid">已支付</SelectItem>
                    <SelectItem value="cancelled">已取消</SelectItem>
                    <SelectItem value="expired">已过期</SelectItem>
                    <SelectItem value="mismatch">金额不匹配</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchOrders()}
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  刷新
                </Button>
              </div>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 overflow-hidden">
              {ordersLoading ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 rounded-xl" />
                  ))}
                </div>
              ) : orders && orders.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-transparent">
                      <TableHead className="text-slate-400">订单号</TableHead>
                      <TableHead className="text-slate-400">用户ID</TableHead>
                      <TableHead className="text-slate-400">金额(USDT)</TableHead>
                      <TableHead className="text-slate-400">积分</TableHead>
                      <TableHead className="text-slate-400">网络</TableHead>
                      <TableHead className="text-slate-400">状态</TableHead>
                      <TableHead className="text-slate-400">创建时间</TableHead>
                      <TableHead className="text-slate-400">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order: any) => (
                      <TableRow key={order.id} className="border-slate-700/50 hover:bg-slate-800/30">
                        <TableCell className="font-mono text-slate-300 text-sm">
                          {order.orderId}
                        </TableCell>
                        <TableCell className="text-slate-400">
                          {order.userId}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-green-400">
                            ${order.amount}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-yellow-400">
                            {order.credits?.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-slate-400 border-slate-600">
                            {order.network}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(order.status)}
                        </TableCell>
                        <TableCell className="text-slate-500 text-sm">
                          {new Date(order.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {order.status === "pending" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedOrder(order);
                                    setConfirmOrderDialog(true);
                                  }}
                                  className="text-green-400 hover:text-green-300 hover:bg-green-500/10"
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  确认
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => cancelOrderMutation.mutate({ orderId: order.orderId })}
                                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {order.txId && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(order.txId)}
                                className="text-slate-400 hover:text-slate-300"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12">
                  <CreditCard className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-500">暂无订单数据</p>
                </div>
              )}
            </div>

            {/* 确认订单对话框 */}
            <Dialog open={confirmOrderDialog} onOpenChange={setConfirmOrderDialog}>
              <DialogContent className="bg-slate-900 border-slate-700">
                <DialogHeader>
                  <DialogTitle className="text-white">确认订单到账</DialogTitle>
                  <DialogDescription className="text-slate-400">
                    订单号: {selectedOrder?.orderId}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-slate-400">订单金额</Label>
                      <p className="text-2xl font-bold text-green-400">${selectedOrder?.amount}</p>
                    </div>
                    <div>
                      <Label className="text-slate-400">积分数量</Label>
                      <p className="text-2xl font-bold text-yellow-400">{selectedOrder?.credits}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">交易哈希 (TxID) *</Label>
                    <Input
                      value={txId}
                      onChange={(e) => setTxId(e.target.value)}
                      placeholder="请输入区块链交易哈希"
                      className="bg-slate-800 border-slate-700 text-white font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">实际到账金额 (可选)</Label>
                    <Input
                      value={receivedAmount}
                      onChange={(e) => setReceivedAmount(e.target.value)}
                      placeholder={selectedOrder?.amount}
                      className="bg-slate-800 border-slate-700 text-white"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmOrderDialog(false)}
                    className="border-slate-700 text-slate-300"
                  >
                    取消
                  </Button>
                  <Button
                    onClick={handleConfirmOrder}
                    disabled={!txId || confirmOrderMutation.isPending}
                    className="bg-gradient-to-r from-green-500 to-emerald-600 text-white border-0"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    确认到账
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* ============ 钱包监控 ============ */}
        {activeTab === "wallet" && (
          <WalletMonitorTab />
        )}

        {/* ============ 公告管理 ============ */}
        {activeTab === "announcements" && (
          <AnnouncementManager />
        )}

        {/* ============ 系统监控 ============ */}
        {activeTab === "monitor" && (
          <SystemMonitor />
        )}

        {/* ============ 系统日志 ============ */}
        {activeTab === "logs" && (
          <div className="relative space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-green-400">系统日志</span>
                </div>
                <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                  操作日志
                </h1>
              </div>
              <div className="flex items-center gap-3">
                <Select value={logType} onValueChange={setLogType}>
                  <SelectTrigger className="w-32 bg-slate-800 border-slate-700 text-white">
                    <SelectValue placeholder="日志类型" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="api">API日志</SelectItem>
                    <SelectItem value="admin">管理员日志</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => logType === "api" ? refetchApiLogs() : refetchAdminLogs()}
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  刷新
                </Button>
              </div>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 overflow-hidden">
              {(logType === "api" ? apiLogsLoading : adminLogsLoading) ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-12 rounded-xl" />
                  ))}
                </div>
              ) : logType === "api" ? (
                apiLogsData?.logs && apiLogsData.logs.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700 hover:bg-transparent">
                        <TableHead className="text-slate-400">时间</TableHead>
                        <TableHead className="text-slate-400">类型</TableHead>
                        <TableHead className="text-slate-400">端点</TableHead>
                        <TableHead className="text-slate-400">状态</TableHead>
                        <TableHead className="text-slate-400">响应时间</TableHead>
                        <TableHead className="text-slate-400">结果</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {apiLogsData.logs.map((log: any) => (
                        <TableRow key={log.id} className="border-slate-700/50 hover:bg-slate-800/30">
                          <TableCell className="text-slate-500 text-sm">
                            {new Date(log.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-slate-400 border-slate-600">
                              {log.apiType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-300 text-sm font-mono max-w-xs truncate">
                            {log.endpoint}
                          </TableCell>
                          <TableCell className="text-slate-400">
                            {log.responseStatus}
                          </TableCell>
                          <TableCell className="text-slate-400">
                            {log.responseTime}ms
                          </TableCell>
                          <TableCell>
                            {log.success ? (
                              <CheckCircle className="h-4 w-4 text-green-400" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-400" />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-12">
                    <Activity className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-500">暂无API日志</p>
                  </div>
                )
              ) : (
                adminLogsData?.logs && adminLogsData.logs.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700 hover:bg-transparent">
                        <TableHead className="text-slate-400">时间</TableHead>
                        <TableHead className="text-slate-400">管理员</TableHead>
                        <TableHead className="text-slate-400">操作</TableHead>
                        <TableHead className="text-slate-400">目标类型</TableHead>
                        <TableHead className="text-slate-400">目标ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adminLogsData.logs.map((log: any) => (
                        <TableRow key={log.id} className="border-slate-700/50 hover:bg-slate-800/30">
                          <TableCell className="text-slate-500 text-sm">
                            {new Date(log.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-cyan-400">
                            {log.adminUsername}
                          </TableCell>
                          <TableCell className="text-slate-300">
                            {log.action}
                          </TableCell>
                          <TableCell className="text-slate-400">
                            {log.targetType || "-"}
                          </TableCell>
                          <TableCell className="text-slate-400 font-mono">
                            {log.targetId || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-500">暂无管理员日志</p>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* ============ 系统配置 ============ */}
        {activeTab === "settings" && (
          <div className="relative space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Settings className="w-5 h-5 text-purple-400" />
                  <span className="text-sm text-purple-400">系统配置</span>
                </div>
                <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                  配置管理
                </h1>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => initDefaultConfigsMutation.mutate()}
                  disabled={initDefaultConfigsMutation.isPending}
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  <Zap className="h-4 w-4 mr-2" />
                  初始化默认配置
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchConfigs()}
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  刷新
                </Button>
              </div>
            </div>

            {/* 配置分组 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 充值配置 */}
              <Card className="bg-gradient-to-br from-slate-900/80 to-slate-800/50 border-slate-700/50">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-yellow-400" />
                    充值配置
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    USDT收款地址和充值参数
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {['USDT_WALLET_TRC20', 'USDT_WALLET_ERC20', 'USDT_WALLET_BEP20', 'MIN_RECHARGE_CREDITS', 'CREDITS_PER_USDT', 'ORDER_EXPIRE_MINUTES'].map((key) => {
                    const config = configs.find((c: any) => c.key === key);
                    return (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-slate-300">{key}</Label>
                          {config && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingConfig({ key, value: config.value, description: config.description || undefined })}
                              className="text-slate-400 hover:text-white"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        <Input
                          value={config?.value || ''}
                          readOnly
                          className="bg-slate-800 border-slate-700 text-white font-mono"
                          placeholder="未配置"
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* 搜索配置 */}
              <Card className="bg-gradient-to-br from-slate-900/80 to-slate-800/50 border-slate-700/50">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Search className="h-5 w-5 text-cyan-400" />
                    搜索配置
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    搜索和缓存相关参数
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {['SEARCH_CREDITS_PER_PERSON', 'PREVIEW_CREDITS', 'CACHE_TTL_DAYS'].map((key) => {
                    const config = configs.find((c: any) => c.key === key);
                    return (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-slate-300">{key}</Label>
                          {config && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingConfig({ key, value: config.value, description: config.description || undefined })}
                              className="text-slate-400 hover:text-white"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        <Input
                          value={config?.value || ''}
                          readOnly
                          className="bg-slate-800 border-slate-700 text-white font-mono"
                          placeholder="未配置"
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>

            {/* 添加新配置 */}
            <Card className="bg-gradient-to-br from-slate-900/80 to-slate-800/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Plus className="h-5 w-5 text-green-400" />
                  添加配置
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-slate-300">配置键</Label>
                    <Input
                      value={newConfigKey}
                      onChange={(e) => setNewConfigKey(e.target.value)}
                      placeholder="CONFIG_KEY"
                      className="bg-slate-800 border-slate-700 text-white font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">配置值</Label>
                    <Input
                      value={newConfigValue}
                      onChange={(e) => setNewConfigValue(e.target.value)}
                      placeholder="value"
                      className="bg-slate-800 border-slate-700 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">描述</Label>
                    <div className="flex gap-2">
                      <Input
                        value={newConfigDesc}
                        onChange={(e) => setNewConfigDesc(e.target.value)}
                        placeholder="配置说明"
                        className="bg-slate-800 border-slate-700 text-white"
                      />
                      <Button
                        onClick={() => {
                          if (newConfigKey && newConfigValue) {
                            setConfigMutation.mutate({
                              key: newConfigKey,
                              value: newConfigValue,
                              description: newConfigDesc,
                            });
                          }
                        }}
                        disabled={!newConfigKey || !newConfigValue || setConfigMutation.isPending}
                        className="bg-gradient-to-r from-green-500 to-emerald-600 text-white border-0"
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 所有配置列表 */}
            <Card className="bg-gradient-to-br from-slate-900/80 to-slate-800/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Database className="h-5 w-5 text-slate-400" />
                  所有配置
                </CardTitle>
              </CardHeader>
              <CardContent>
                {configsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 rounded-xl" />
                    ))}
                  </div>
                ) : configs.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700 hover:bg-transparent">
                        <TableHead className="text-slate-400">键</TableHead>
                        <TableHead className="text-slate-400">值</TableHead>
                        <TableHead className="text-slate-400">描述</TableHead>
                        <TableHead className="text-slate-400">更新者</TableHead>
                        <TableHead className="text-slate-400">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {configs.map((config: any) => (
                        <TableRow key={config.id} className="border-slate-700/50 hover:bg-slate-800/30">
                          <TableCell className="font-mono text-cyan-400">
                            {config.key}
                          </TableCell>
                          <TableCell className="text-white max-w-xs truncate">
                            {config.value}
                          </TableCell>
                          <TableCell className="text-slate-400 text-sm">
                            {config.description || "-"}
                          </TableCell>
                          <TableCell className="text-slate-500 text-sm">
                            {config.updatedBy || "-"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingConfig({ key: config.key, value: config.value, description: config.description })}
                                className="text-slate-400 hover:text-white"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (confirm(`确定删除配置 ${config.key}？`)) {
                                    deleteConfigMutation.mutate({ key: config.key });
                                  }
                                }}
                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8">
                    <Settings className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-500">暂无配置，点击"初始化默认配置"开始</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 编辑配置对话框 */}
            <Dialog open={!!editingConfig} onOpenChange={(open) => !open && setEditingConfig(null)}>
              <DialogContent className="bg-slate-900 border-slate-700">
                <DialogHeader>
                  <DialogTitle className="text-white">编辑配置</DialogTitle>
                  <DialogDescription className="text-slate-400 font-mono">
                    {editingConfig?.key}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label className="text-slate-300">配置值</Label>
                    <Textarea
                      value={editingConfig?.value || ''}
                      onChange={(e) => setEditingConfig(prev => prev ? { ...prev, value: e.target.value } : null)}
                      className="bg-slate-800 border-slate-700 text-white font-mono min-h-[100px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">描述</Label>
                    <Input
                      value={editingConfig?.description || ''}
                      onChange={(e) => setEditingConfig(prev => prev ? { ...prev, description: e.target.value } : null)}
                      className="bg-slate-800 border-slate-700 text-white"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setEditingConfig(null)}
                    className="border-slate-700 text-slate-300"
                  >
                    取消
                  </Button>
                  <Button
                    onClick={() => {
                      if (editingConfig) {
                        setConfigMutation.mutate({
                          key: editingConfig.key,
                          value: editingConfig.value,
                          description: editingConfig.description,
                        });
                      }
                    }}
                    disabled={setConfigMutation.isPending}
                    className="bg-gradient-to-r from-purple-500 to-pink-600 text-white border-0"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    保存
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>
    </div>
  );
}

// 钱包监控Tab组件
function WalletMonitorTab() {
  const [checkingOrder, setCheckingOrder] = useState<string | null>(null);
  
  // 获取钱包余额
  const { data: walletBalance, isLoading: balanceLoading, refetch: refetchBalance } = trpc.admin.getWalletBalance.useQuery(
    undefined,
    { refetchInterval: 30000 } // 每30秒自动刷新
  );
  
  // 获取最近交易
  const { data: recentTransfers, isLoading: transfersLoading, refetch: refetchTransfers } = trpc.admin.getRecentTransfers.useQuery(
    { limit: 20 },
    { refetchInterval: 30000 }
  );
  
  // 获取待处理订单
  const { data: pendingOrders, refetch: refetchOrders } = trpc.admin.orders.useQuery(
    { status: 'pending' }
  );
  
  // 手动检查支付
  const checkPaymentMutation = trpc.admin.checkPaymentManually.useMutation({
    onSuccess: (result) => {
      if (result.found) {
        toast.success(`检测到支付！交易哈希: ${result.transactionId?.slice(0, 16)}...`);
        refetchOrders();
        refetchTransfers();
      } else {
        toast.info(result.message || result.error || '未找到匹配的转账记录');
      }
      setCheckingOrder(null);
    },
    onError: (error) => {
      toast.error('检查失败: ' + error.message);
      setCheckingOrder(null);
    },
  });
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  };
  
  const handleCheckPayment = (orderId: string) => {
    setCheckingOrder(orderId);
    checkPaymentMutation.mutate({ orderId });
  };
  
  return (
    <div className="relative space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-5 h-5 text-green-400" />
            <span className="text-sm text-green-400">钱包监控</span>
          </div>
          <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
            TRC20 钱包监控
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { refetchBalance(); refetchTransfers(); refetchOrders(); }}
          className="border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新数据
        </Button>
      </div>
      
      {/* 钱包余额卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">USDT 余额</span>
            <DollarSign className="h-5 w-5 text-green-400" />
          </div>
          {balanceLoading ? (
            <Skeleton className="h-10 w-32" />
          ) : (
            <p className="text-3xl font-bold text-green-400" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {walletBalance?.usdtBalance?.toFixed(2) || '0.00'}
            </p>
          )}
        </div>
        
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">TRX 余额</span>
            <Zap className="h-5 w-5 text-orange-400" />
          </div>
          {balanceLoading ? (
            <Skeleton className="h-10 w-32" />
          ) : (
            <p className="text-3xl font-bold text-orange-400" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {walletBalance?.trxBalance?.toFixed(2) || '0.00'}
            </p>
          )}
        </div>
        
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">待处理订单</span>
            <Clock className="h-5 w-5 text-yellow-400" />
          </div>
          <p className="text-3xl font-bold text-yellow-400" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {pendingOrders?.orders?.length || 0}
          </p>
        </div>
      </div>
      
      {/* 收款地址 */}
      {walletBalance?.walletAddress && (
        <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-slate-400">收款地址 (TRC20)</span>
              <p className="text-white font-mono text-sm mt-1 break-all">{walletBalance.walletAddress}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(walletBalance.walletAddress!)}
              className="text-slate-400 hover:text-white"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      
      {/* 待处理订单列表 */}
      {pendingOrders?.orders && pendingOrders.orders.length > 0 && (
        <div className="rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 overflow-hidden">
          <div className="p-4 border-b border-slate-700/50">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              待处理订单
            </h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700 hover:bg-transparent">
                <TableHead className="text-slate-400">订单号</TableHead>
                <TableHead className="text-slate-400">金额(USDT)</TableHead>
                <TableHead className="text-slate-400">积分</TableHead>
                <TableHead className="text-slate-400">创建时间</TableHead>
                <TableHead className="text-slate-400">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingOrders.orders.map((order: any) => (
                <TableRow key={order.id} className="border-slate-700/50 hover:bg-slate-800/30">
                  <TableCell className="font-mono text-slate-300 text-sm">
                    {order.orderId}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-green-400">${order.amount}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-yellow-400">{order.credits}</span>
                  </TableCell>
                  <TableCell className="text-slate-500 text-sm">
                    {new Date(order.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCheckPayment(order.orderId)}
                      disabled={checkingOrder === order.orderId}
                      className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                    >
                      {checkingOrder === order.orderId ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                          检测中...
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4 mr-1" />
                          检测支付
                        </>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      
      {/* 最近交易记录 */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 overflow-hidden">
        <div className="p-4 border-b border-slate-700/50">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-cyan-400" />
            最近交易记录
          </h3>
        </div>
        {transfersLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : recentTransfers?.transfers && recentTransfers.transfers.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700 hover:bg-transparent">
                <TableHead className="text-slate-400">时间</TableHead>
                <TableHead className="text-slate-400">类型</TableHead>
                <TableHead className="text-slate-400">金额</TableHead>
                <TableHead className="text-slate-400">地址</TableHead>
                <TableHead className="text-slate-400">交易哈希</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentTransfers.transfers.map((tx: any, index: number) => (
                <TableRow key={index} className="border-slate-700/50 hover:bg-slate-800/30">
                  <TableCell className="text-slate-500 text-sm">
                    {new Date(tx.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge className={tx.type === 'in' 
                      ? "bg-green-500/20 text-green-400 border-green-500/30" 
                      : "bg-red-500/20 text-red-400 border-red-500/30"
                    }>
                      {tx.type === 'in' ? '收入' : '转出'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className={`font-mono ${tx.type === 'in' ? 'text-green-400' : 'text-red-400'}`}>
                      {tx.type === 'in' ? '+' : '-'}{tx.amount.toFixed(2)} USDT
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-slate-400 text-xs">
                    {tx.type === 'in' ? tx.from?.slice(0, 8) + '...' + tx.from?.slice(-6) : tx.to?.slice(0, 8) + '...' + tx.to?.slice(-6)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-400 text-xs">
                        {tx.transactionId?.slice(0, 12)}...
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(tx.transactionId)}
                        className="h-6 w-6 p-0 text-slate-500 hover:text-white"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <a
                        href={`https://tronscan.org/#/transaction/${tx.transactionId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-500 hover:text-cyan-400"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-12">
            <Activity className="h-12 w-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-500">暂无交易记录</p>
            {recentTransfers?.error && (
              <p className="text-red-400 text-sm mt-2">{recentTransfers.error}</p>
            )}
          </div>
        )}
      </div>

      {/* 用户详情对话框 */}
      <UserDetailDialog
        userId={selectedUser}
        open={userDetailDialogOpen && selectedUser !== null}
        onOpenChange={(open) => {
          setUserDetailDialogOpen(open);
          if (!open) setSelectedUser(null);
        }}
        onRefresh={() => refetchUsers()}
      />

      {/* 订单详情对话框 */}
      <OrderDetailDialog
        order={selectedOrder}
        open={orderDetailDialogOpen && selectedOrder !== null}
        onOpenChange={(open) => {
          setOrderDetailDialogOpen(open);
          if (!open) setSelectedOrder(null);
        }}
        onRefresh={() => refetchOrders()}
      />

      {/* 批量消息对话框 */}
      <BulkMessageDialog
        open={bulkMessageDialogOpen}
        onOpenChange={setBulkMessageDialogOpen}
        users={users || []}
      />
    </div>
  );
}
