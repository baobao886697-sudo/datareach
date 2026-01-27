import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  User, Coins, Search, RefreshCw, Key, Ban, UserCheck,
  Clock, Mail, Calendar, Activity, CreditCard, History,
  AlertTriangle, CheckCircle, XCircle, Send, Eye,
  Download, Filter, TrendingUp, TrendingDown, ArrowUpDown,
  Crown, Link, Unlink
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface UserDetailDialogProps {
  userId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh?: () => void;
}

export function UserDetailDialog({ userId, open, onOpenChange, onRefresh }: UserDetailDialogProps) {
  const [activeTab, setActiveTab] = useState("info");
  const [creditAmount, setCreditAmount] = useState(0);
  const [creditReason, setCreditReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [messageTitle, setMessageTitle] = useState("");
  const [messageContent, setMessageContent] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  
  // 积分报表筛选状态（新增）
  const [creditFilterType, setCreditFilterType] = useState<string>("all");
  const [creditStartDate, setCreditStartDate] = useState<string>("");
  const [creditEndDate, setCreditEndDate] = useState<string>("");
  const [creditPage, setCreditPage] = useState(1);

  // 获取用户详情
  const { data: userDetail, isLoading, refetch } = trpc.admin.getUserDetail.useQuery(
    { userId: userId! },
    { enabled: !!userId && open }
  );

  // 获取用户搜索历史
  const { data: searchHistory, isLoading: searchLoading } = trpc.admin.getUserSearchHistory.useQuery(
    { userId: userId!, limit: 10 },
    { enabled: !!userId && open && activeTab === "searches" }
  );

  // 获取用户积分记录（保留原有查询作为备用）
  const { data: creditHistory, isLoading: creditLoading } = trpc.admin.getUserCreditHistory.useQuery(
    { userId: userId!, limit: 20 },
    { enabled: !!userId && open && activeTab === "credits" }
  );

  // 高级积分查询（新增）- 支持筛选
  const { data: advancedCreditData, isLoading: advancedCreditLoading, refetch: refetchAdvancedCredit } = trpc.admin.getAdvancedCreditLogs.useQuery(
    { 
      userId: userId!, 
      page: creditPage,
      limit: 20,
      type: creditFilterType !== 'all' ? creditFilterType : undefined,
      startDate: creditStartDate || undefined,
      endDate: creditEndDate || undefined,
    },
    { enabled: !!userId && open && activeTab === "credits" }
  );

  // 用户积分统计概览（新增）
  const { data: creditStats, isLoading: creditStatsLoading } = trpc.admin.getUserCreditStats.useQuery(
    { userId: userId! },
    { enabled: !!userId && open && activeTab === "credits" }
  );

  // 导出积分记录（新增）
  const { refetch: fetchExportData } = trpc.admin.exportUserCreditLogs.useQuery(
    { 
      userId: userId!,
      type: creditFilterType !== 'all' ? creditFilterType : undefined,
      startDate: creditStartDate || undefined,
      endDate: creditEndDate || undefined,
    },
    { enabled: false } // 手动触发
  );

  // 获取用户登录记录
  const { data: loginHistory, isLoading: loginLoading } = trpc.admin.getUserLoginHistory.useQuery(
    { userId: userId!, limit: 20 },
    { enabled: !!userId && open && activeTab === "logins" }
  );

  // 获取用户活动日志
  const { data: activityLogs, isLoading: activityLoading } = trpc.admin.getUserActivityLogs.useQuery(
    { userId: userId!, limit: 30 },
    { enabled: !!userId && open && activeTab === "activity" }
  );

  // Mutations
  const adjustCreditsMutation = trpc.admin.adjustCredits.useMutation({
    onSuccess: () => {
      toast.success("积分调整成功");
      setCreditAmount(0);
      setCreditReason("");
      refetch();
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(error.message || "积分调整失败");
    },
  });

  const resetPasswordMutation = trpc.admin.resetUserPassword.useMutation({
    onSuccess: () => {
      toast.success("密码重置成功");
      setNewPassword("");
    },
    onError: (error) => {
      toast.error(error.message || "密码重置失败");
    },
  });

  const updateStatusMutation = trpc.admin.updateUserStatus.useMutation({
    onSuccess: () => {
      toast.success("状态更新成功");
      refetch();
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(error.message || "状态更新失败");
    },
  });

  const forceLogoutMutation = trpc.admin.forceLogout.useMutation({
    onSuccess: () => {
      toast.success("已强制用户下线");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "操作失败");
    },
  });

  // 获取代理列表（用于分配代理）
  const { data: agentsList } = trpc.adminAgent.list.useQuery(
    { page: 1, limit: 100 },
    { enabled: !!userId && open && activeTab === "info" }
  );

  const sendMessageMutation = trpc.admin.sendMessage.useMutation({
    onSuccess: () => {
      toast.success("消息发送成功");
      setMessageTitle("");
      setMessageContent("");
    },
    onError: (error) => {
      toast.error(error.message || "发送失败");
    },
  });

  const handleAdjustCredits = () => {
    if (!userId || creditAmount === 0) return;
    adjustCreditsMutation.mutate({
      userId,
      amount: creditAmount,
      reason: creditReason || (creditAmount > 0 ? "管理员增加积分" : "管理员扣除积分"),
    });
  };

  const handleResetPassword = () => {
    if (!userId || !newPassword || newPassword.length < 6) {
      toast.error("密码至少6位");
      return;
    }
    resetPasswordMutation.mutate({ userId, newPassword });
  };

  const handleSendMessage = () => {
    if (!userId || !messageTitle || !messageContent) {
      toast.error("请填写标题和内容");
      return;
    }
    sendMessageMutation.mutate({
      userId,
      title: messageTitle,
      content: messageContent,
      type: "support",
    });
  };

  // 导出积分记录为 CSV（新增）
  const handleExportCredits = async () => {
    try {
      const result = await fetchExportData();
      if (result.data?.csv) {
        // 创建 Blob 并下载
        const blob = new Blob(["\uFEFF" + result.data.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `积分记录_用户${userId}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success("导出成功");
      }
    } catch (error) {
      toast.error("导出失败");
    }
  };

  // 积分类型标签映射（新增）
  const creditTypeLabels: Record<string, string> = {
    'recharge': '充值',
    'search': '搜索消费',
    'admin_add': '管理员增加',
    'admin_deduct': '管理员扣除',
    'refund': '退款',
    'admin_adjust': '管理员调整',
    'bonus': '赠送'
  };

  // 积分类型颜色映射（新增）
  const creditTypeColors: Record<string, string> = {
    'recharge': 'bg-green-500/20 text-green-400 border-green-500/30',
    'search': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'admin_add': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    'admin_deduct': 'bg-red-500/20 text-red-400 border-red-500/30',
    'refund': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'admin_adjust': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    'bonus': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
  };

  const user = userDetail?.user;
  const stats = userDetail?.stats;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <User className="h-5 w-5 text-orange-400" />
            用户详情
          </DialogTitle>
          <DialogDescription>
            查看和管理用户信息
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : user ? (
          <div className="space-y-4">
            {/* 用户基本信息卡片 */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-white">{user.email}</span>
                      <Badge className={user.status === "active" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}>
                        {user.status === "active" ? "正常" : "已禁用"}
                      </Badge>
                      {user.role === "admin" && (
                        <Badge className="bg-purple-500/20 text-purple-400">管理员</Badge>
                      )}
                    </div>
                    <div className="text-sm text-slate-400 space-y-1">
                      <p>ID: {user.id} | OpenID: {user.openId?.slice(0, 8)}...</p>
                      <p>注册时间: {new Date(user.createdAt).toLocaleString()}</p>
                      <p>最后登录: {new Date(user.lastSignedIn).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-orange-400">{user.credits}</div>
                    <div className="text-sm text-slate-400">当前积分</div>
                  </div>
                </div>

                {/* 统计信息 */}
                {stats && (
                  <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-700">
                    <div className="text-center">
                      <div className="text-xl font-semibold text-white">{stats.totalOrders}</div>
                      <div className="text-xs text-slate-400">充值次数</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-semibold text-green-400">${stats.totalSpent}</div>
                      <div className="text-xs text-slate-400">累计充值</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-semibold text-blue-400">{stats.totalSearches}</div>
                      <div className="text-xs text-slate-400">搜索次数</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-semibold text-purple-400">{stats.loginCount}</div>
                      <div className="text-xs text-slate-400">登录次数</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 操作Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-slate-800 border-slate-700">
                <TabsTrigger value="info">操作</TabsTrigger>
                <TabsTrigger value="credits">积分记录</TabsTrigger>
                <TabsTrigger value="searches">搜索历史</TabsTrigger>
                <TabsTrigger value="logins">登录记录</TabsTrigger>
                <TabsTrigger value="activity">活动日志</TabsTrigger>
              </TabsList>

              {/* 操作Tab */}
              <TabsContent value="info" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {/* 积分调整 */}
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Coins className="h-4 w-4 text-orange-400" />
                        积分调整
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <Label className="text-slate-400">调整数量</Label>
                        <Input
                          type="number"
                          value={creditAmount}
                          onChange={(e) => setCreditAmount(parseInt(e.target.value) || 0)}
                          placeholder="正数增加，负数扣除"
                          className="bg-slate-900 border-slate-600"
                        />
                      </div>
                      <div>
                        <Label className="text-slate-400">调整原因</Label>
                        <Input
                          value={creditReason}
                          onChange={(e) => setCreditReason(e.target.value)}
                          placeholder="请填写原因"
                          className="bg-slate-900 border-slate-600"
                        />
                      </div>
                      <Button
                        onClick={handleAdjustCredits}
                        disabled={creditAmount === 0 || adjustCreditsMutation.isPending}
                        className="w-full bg-orange-500 hover:bg-orange-600"
                      >
                        {adjustCreditsMutation.isPending ? "处理中..." : "确认调整"}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* 密码重置 */}
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Key className="h-4 w-4 text-blue-400" />
                        密码重置
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <Label className="text-slate-400">新密码</Label>
                        <Input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="至少6位"
                          className="bg-slate-900 border-slate-600"
                        />
                      </div>
                      <Button
                        onClick={handleResetPassword}
                        disabled={!newPassword || newPassword.length < 6 || resetPasswordMutation.isPending}
                        className="w-full bg-blue-500 hover:bg-blue-600"
                      >
                        {resetPasswordMutation.isPending ? "处理中..." : "重置密码"}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* 发送消息 */}
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Send className="h-4 w-4 text-green-400" />
                        发送消息
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <Label className="text-slate-400">标题</Label>
                        <Input
                          value={messageTitle}
                          onChange={(e) => setMessageTitle(e.target.value)}
                          placeholder="消息标题"
                          className="bg-slate-900 border-slate-600"
                        />
                      </div>
                      <div>
                        <Label className="text-slate-400">内容</Label>
                        <Textarea
                          value={messageContent}
                          onChange={(e) => setMessageContent(e.target.value)}
                          placeholder="消息内容"
                          className="bg-slate-900 border-slate-600"
                          rows={2}
                        />
                      </div>
                      <Button
                        onClick={handleSendMessage}
                        disabled={!messageTitle || !messageContent || sendMessageMutation.isPending}
                        className="w-full bg-green-500 hover:bg-green-600"
                      >
                        {sendMessageMutation.isPending ? "发送中..." : "发送消息"}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* 账户操作 */}
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Activity className="h-4 w-4 text-purple-400" />
                        账户操作
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Button
                        onClick={() => updateStatusMutation.mutate({
                          userId: user.id,
                          status: user.status === "active" ? "disabled" : "active"
                        })}
                        disabled={updateStatusMutation.isPending}
                        variant="outline"
                        className={`w-full ${user.status === "active" ? "border-red-500 text-red-400 hover:bg-red-500/10" : "border-green-500 text-green-400 hover:bg-green-500/10"}`}
                      >
                        {user.status === "active" ? (
                          <><Ban className="h-4 w-4 mr-2" />禁用账户</>
                        ) : (
                          <><UserCheck className="h-4 w-4 mr-2" />启用账户</>
                        )}
                      </Button>
                      <Button
                        onClick={() => forceLogoutMutation.mutate({ userId: user.id })}
                        disabled={forceLogoutMutation.isPending}
                        variant="outline"
                        className="w-full border-yellow-500 text-yellow-400 hover:bg-yellow-500/10"
                      >
                        强制下线
                      </Button>
                    </CardContent>
                  </Card>

                  {/* 代理分配 */}
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Crown className="h-4 w-4 text-yellow-400" />
                        代理分配
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {user.inviterId ? (
                        <div className="space-y-2">
                          <div className="text-sm text-slate-400">
                            当前上级代理: <span className="text-purple-400">{(user as any).agentEmail || `ID: ${user.inviterId}`}</span>
                          </div>
                          <Button
                            onClick={() => {
                              if (confirm('确定要移除该用户的代理关联吗？')) {
                                // 调用移除代理API
                                fetch('/api/trpc/adminAgent.removeUserFromAgent', {
                                  method: 'POST',
                                  headers: { 
                                    'Content-Type': 'application/json',
                                    'x-admin-token': localStorage.getItem('adminToken') || ''
                                  },
                                  body: JSON.stringify({ json: { userId: user.id } })
                                }).then(res => res.json()).then(data => {
                                  if (data.result?.data?.json?.success) {
                                    toast.success('已移除代理关联');
                                    refetch();
                                    onRefresh?.();
                                  } else {
                                    toast.error(data.error?.json?.message || '操作失败');
                                  }
                                });
                              }
                            }}
                            variant="outline"
                            className="w-full border-red-500 text-red-400 hover:bg-red-500/10"
                          >
                            <Unlink className="h-4 w-4 mr-2" />移除代理关联
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="text-sm text-slate-400">当前无上级代理</div>
                          <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                            <SelectTrigger className="bg-slate-900 border-slate-600">
                              <SelectValue placeholder="选择代理" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-700">
                              {agentsList?.agents?.map((agent: any) => (
                                <SelectItem key={agent.id} value={agent.id.toString()}>
                                  {agent.email} ({agent.agentLevel})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            onClick={() => {
                              if (!selectedAgentId) {
                                toast.error('请选择代理');
                                return;
                              }
                              fetch('/api/trpc/adminAgent.assignUserToAgent', {
                                method: 'POST',
                                headers: { 
                                  'Content-Type': 'application/json',
                                  'x-admin-token': localStorage.getItem('adminToken') || ''
                                },
                                body: JSON.stringify({ json: { userId: user.id, agentId: parseInt(selectedAgentId) } })
                              }).then(res => res.json()).then(data => {
                                if (data.result?.data?.json?.success) {
                                  toast.success('已分配代理');
                                  setSelectedAgentId('');
                                  refetch();
                                  onRefresh?.();
                                } else {
                                  toast.error(data.error?.json?.message || '操作失败');
                                }
                              });
                            }}
                            disabled={!selectedAgentId}
                            className="w-full bg-purple-500 hover:bg-purple-600"
                          >
                            <Link className="h-4 w-4 mr-2" />分配代理
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* 积分记录Tab - 增强版 */}
              <TabsContent value="credits" className="space-y-4">
                {/* 积分统计概览卡片 */}
                {creditStatsLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : creditStats && (
                  <div className="grid grid-cols-4 gap-3">
                    <Card className="bg-slate-800/50 border-slate-700">
                      <CardContent className="pt-3 pb-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-slate-400">累计充值</p>
                            <p className="text-lg font-bold text-green-400">+{creditStats.totalRecharge}</p>
                          </div>
                          <TrendingUp className="h-5 w-5 text-green-400/50" />
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-slate-800/50 border-slate-700">
                      <CardContent className="pt-3 pb-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-slate-400">累计消费</p>
                            <p className="text-lg font-bold text-blue-400">-{creditStats.totalSearch}</p>
                          </div>
                          <TrendingDown className="h-5 w-5 text-blue-400/50" />
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-slate-800/50 border-slate-700">
                      <CardContent className="pt-3 pb-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-slate-400">累计退款</p>
                            <p className="text-lg font-bold text-yellow-400">+{creditStats.totalRefund}</p>
                          </div>
                          <ArrowUpDown className="h-5 w-5 text-yellow-400/50" />
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-slate-800/50 border-slate-700">
                      <CardContent className="pt-3 pb-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-slate-400">交易次数</p>
                            <p className="text-lg font-bold text-slate-300">{creditStats.transactionCount}</p>
                          </div>
                          <History className="h-5 w-5 text-slate-400/50" />
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* 筛选和导出工具栏 */}
                <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-800/30 rounded-lg border border-slate-700">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-slate-400" />
                    <span className="text-sm text-slate-400">筛选:</span>
                  </div>
                  
                  {/* 类型筛选 */}
                  <Select value={creditFilterType} onValueChange={(v) => { setCreditFilterType(v); setCreditPage(1); }}>
                    <SelectTrigger className="w-[130px] h-8 bg-slate-900 border-slate-600 text-sm">
                      <SelectValue placeholder="类型" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700">
                      <SelectItem value="all">全部类型</SelectItem>
                      <SelectItem value="recharge">充值</SelectItem>
                      <SelectItem value="search">搜索消费</SelectItem>
                      <SelectItem value="refund">退款</SelectItem>
                      <SelectItem value="admin_add">管理员增加</SelectItem>
                      <SelectItem value="admin_deduct">管理员扣除</SelectItem>
                      <SelectItem value="bonus">赠送</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* 时间范围 */}
                  <Input
                    type="date"
                    value={creditStartDate}
                    onChange={(e) => { setCreditStartDate(e.target.value); setCreditPage(1); }}
                    className="w-[130px] h-8 bg-slate-900 border-slate-600 text-sm"
                    placeholder="开始日期"
                  />
                  <span className="text-slate-500">-</span>
                  <Input
                    type="date"
                    value={creditEndDate}
                    onChange={(e) => { setCreditEndDate(e.target.value); setCreditPage(1); }}
                    className="w-[130px] h-8 bg-slate-900 border-slate-600 text-sm"
                    placeholder="结束日期"
                  />

                  {/* 清除筛选 */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCreditFilterType('all');
                      setCreditStartDate('');
                      setCreditEndDate('');
                      setCreditPage(1);
                    }}
                    className="h-8 text-slate-400 hover:text-white"
                  >
                    清除
                  </Button>

                  {/* 导出按钮 */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCredits}
                    className="h-8 ml-auto border-green-500/50 text-green-400 hover:bg-green-500/10"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    导出 CSV
                  </Button>
                </div>

                {/* 筛选统计 */}
                {advancedCreditData?.stats && (
                  <div className="flex items-center gap-4 text-sm text-slate-400 px-1">
                    <span>共 <span className="text-white font-medium">{advancedCreditData.total}</span> 条记录</span>
                    <span>收入: <span className="text-green-400">+{advancedCreditData.stats.totalIn}</span></span>
                    <span>支出: <span className="text-red-400">-{advancedCreditData.stats.totalOut}</span></span>
                    <span>净变动: <span className={advancedCreditData.stats.netChange >= 0 ? "text-green-400" : "text-red-400"}>
                      {advancedCreditData.stats.netChange >= 0 ? "+" : ""}{advancedCreditData.stats.netChange}
                    </span></span>
                  </div>
                )}

                {/* 积分记录表格 */}
                {advancedCreditLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <div className="rounded-lg border border-slate-700 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700 bg-slate-800/50">
                          <TableHead className="text-slate-400">时间</TableHead>
                          <TableHead className="text-slate-400">类型</TableHead>
                          <TableHead className="text-slate-400">变动</TableHead>
                          <TableHead className="text-slate-400">余额</TableHead>
                          <TableHead className="text-slate-400">说明</TableHead>
                          <TableHead className="text-slate-400">关联</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {advancedCreditData?.logs.map((log: any) => (
                          <TableRow key={log.id} className="border-slate-700 hover:bg-slate-800/50">
                            <TableCell className="text-slate-300 text-sm">
                              {new Date(log.createdAt).toLocaleString('zh-CN')}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-xs ${creditTypeColors[log.type] || ''}`}>
                                {creditTypeLabels[log.type] || log.type}
                              </Badge>
                            </TableCell>
                            <TableCell className={`font-medium ${log.amount > 0 ? "text-green-400" : "text-red-400"}`}>
                              {log.amount > 0 ? "+" : ""}{log.amount}
                            </TableCell>
                            <TableCell className="text-slate-300">{log.balanceAfter}</TableCell>
                            <TableCell className="text-slate-400 text-sm max-w-[180px] truncate" title={log.description}>
                              {log.description}
                            </TableCell>
                            <TableCell className="text-slate-500 text-xs">
                              {log.relatedOrderId && <span className="mr-2">订单:{log.relatedOrderId.slice(0,8)}...</span>}
                              {log.relatedTaskId && <span>任务:{log.relatedTaskId.slice(0,8)}...</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                        {(!advancedCreditData?.logs || advancedCreditData.logs.length === 0) && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                              暂无积分记录
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* 分页控件 */}
                {advancedCreditData && advancedCreditData.total > 20 && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-sm text-slate-400">
                      第 {creditPage} 页，共 {Math.ceil(advancedCreditData.total / 20)} 页
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCreditPage(p => Math.max(1, p - 1))}
                        disabled={creditPage <= 1}
                        className="border-slate-600"
                      >
                        上一页
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCreditPage(p => p + 1)}
                        disabled={creditPage >= Math.ceil(advancedCreditData.total / 20)}
                        className="border-slate-600"
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* 搜索历史Tab */}
              <TabsContent value="searches">
                {searchLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <div className="rounded-lg border border-slate-700 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700 bg-slate-800/50">
                          <TableHead className="text-slate-400">时间</TableHead>
                          <TableHead className="text-slate-400">任务ID</TableHead>
                          <TableHead className="text-slate-400">请求数量</TableHead>
                          <TableHead className="text-slate-400">实际数量</TableHead>
                          <TableHead className="text-slate-400">消耗积分</TableHead>
                          <TableHead className="text-slate-400">状态</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {searchHistory?.searches.map((search: any) => (
                          <TableRow key={search.id} className="border-slate-700">
                            <TableCell className="text-slate-300 text-sm">
                              {new Date(search.createdAt).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-slate-400 font-mono text-xs">
                              {search.taskId?.slice(0, 8)}...
                            </TableCell>
                            <TableCell className="text-slate-300">{search.requestedCount}</TableCell>
                            <TableCell className="text-slate-300">{search.actualCount}</TableCell>
                            <TableCell className="text-orange-400">{search.creditsUsed}</TableCell>
                            <TableCell>
                              <Badge className={
                                search.status === "completed" ? "bg-green-500/20 text-green-400" :
                                search.status === "failed" ? "bg-red-500/20 text-red-400" :
                                "bg-yellow-500/20 text-yellow-400"
                              }>
                                {search.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                        {(!searchHistory?.searches || searchHistory.searches.length === 0) && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                              暂无搜索记录
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* 登录记录Tab */}
              <TabsContent value="logins">
                {loginLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <div className="rounded-lg border border-slate-700 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700 bg-slate-800/50">
                          <TableHead className="text-slate-400">时间</TableHead>
                          <TableHead className="text-slate-400">IP地址</TableHead>
                          <TableHead className="text-slate-400">设备ID</TableHead>
                          <TableHead className="text-slate-400">状态</TableHead>
                          <TableHead className="text-slate-400">失败原因</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loginHistory?.logs.map((log: any) => (
                          <TableRow key={log.id} className="border-slate-700">
                            <TableCell className="text-slate-300 text-sm">
                              {new Date(log.createdAt).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-slate-400 font-mono text-xs">
                              {log.ipAddress || "-"}
                            </TableCell>
                            <TableCell className="text-slate-400 font-mono text-xs">
                              {log.deviceId?.slice(0, 8) || "-"}...
                            </TableCell>
                            <TableCell>
                              {log.success ? (
                                <Badge className="bg-green-500/20 text-green-400">成功</Badge>
                              ) : (
                                <Badge className="bg-red-500/20 text-red-400">失败</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-slate-400 text-sm">
                              {log.failReason || "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                        {(!loginHistory?.logs || loginHistory.logs.length === 0) && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                              暂无登录记录
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* 活动日志Tab */}
              <TabsContent value="activity">
                {activityLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <div className="rounded-lg border border-slate-700 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700 bg-slate-800/50">
                          <TableHead className="text-slate-400">时间</TableHead>
                          <TableHead className="text-slate-400">操作</TableHead>
                          <TableHead className="text-slate-400">IP地址</TableHead>
                          <TableHead className="text-slate-400">详情</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activityLogs?.logs.map((log: any) => (
                          <TableRow key={log.id} className="border-slate-700">
                            <TableCell className="text-slate-300 text-sm">
                              {new Date(log.createdAt).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{log.action}</Badge>
                            </TableCell>
                            <TableCell className="text-slate-400 font-mono text-xs">
                              {log.ipAddress || "-"}
                            </TableCell>
                            <TableCell className="text-slate-400 text-sm max-w-[200px] truncate">
                              {log.details ? JSON.stringify(log.details) : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                        {(!activityLogs?.logs || activityLogs.logs.length === 0) && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-slate-500 py-8">
                              暂无活动日志
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="text-center text-slate-500 py-8">
            用户不存在
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
