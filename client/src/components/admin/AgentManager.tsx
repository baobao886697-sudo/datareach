import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Crown, Users, Wallet, TrendingUp, RefreshCw, 
  CheckCircle, XCircle, Clock, DollarSign, Eye,
  Settings, Award, Loader2, Search
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// 代理等级配置
const AGENT_LEVELS = {
  founder: { label: '创始代理', badge: '👑', color: 'text-amber-400', bgColor: 'bg-amber-500/20' },
  gold: { label: '金牌代理', badge: '🥇', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  silver: { label: '银牌代理', badge: '🥈', color: 'text-slate-400', bgColor: 'bg-slate-400/20' },
  normal: { label: '普通代理', badge: '⭐', color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
};

export function AgentManager() {
  const [activeTab, setActiveTab] = useState('agents');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [levelDialogOpen, setLevelDialogOpen] = useState(false);
  const [newLevel, setNewLevel] = useState('');
  const [withdrawalDialogOpen, setWithdrawalDialogOpen] = useState(false);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState('');

  // 获取代理列表
  const { data: agentsData, isLoading: agentsLoading, refetch: refetchAgents } = trpc.admin.agent.list.useQuery({
    page: 1,
    limit: 50,
  });

  // 获取提现申请列表
  const { data: withdrawalsData, isLoading: withdrawalsLoading, refetch: refetchWithdrawals } = trpc.admin.agent.withdrawals.useQuery({
    status: 'pending',
    page: 1,
    limit: 50,
  });

  // 获取代理统计
  const { data: statsData, isLoading: statsLoading, refetch: refetchStats } = trpc.admin.agent.report.useQuery();

  // 获取代理配置
  const { data: settingsData, isLoading: settingsLoading, refetch: refetchSettings } = trpc.admin.agent.settings.useQuery();

  // 修改代理等级
  const setLevelMutation = trpc.admin.agent.setLevel.useMutation({
    onSuccess: () => {
      toast.success('代理等级已更新');
      setLevelDialogOpen(false);
      refetchAgents();
    },
    onError: (error) => {
      toast.error(error.message || '操作失败');
    },
  });

  // 处理提现申请
  const processWithdrawalMutation = trpc.admin.agent.processWithdrawal.useMutation({
    onSuccess: () => {
      toast.success('提现申请已处理');
      setWithdrawalDialogOpen(false);
      refetchWithdrawals();
      refetchAgents();
    },
    onError: (error) => {
      toast.error(error.message || '操作失败');
    },
  });

  // 更新代理配置
  const updateSettingMutation = trpc.admin.agent.updateSetting.useMutation({
    onSuccess: () => {
      toast.success('配置已更新');
      refetchSettings();
    },
    onError: (error) => {
      toast.error(error.message || '更新失败');
    },
  });

  // 处理等级修改
  const handleSetLevel = () => {
    if (!selectedAgent || !newLevel) return;
    setLevelMutation.mutate({
      agentId: selectedAgent.id,
      level: newLevel as any,
    });
  };

  // 处理提现审核
  const handleProcessWithdrawal = (action: 'approve' | 'reject' | 'paid') => {
    if (!selectedWithdrawal) return;
    processWithdrawalMutation.mutate({
      withdrawalId: selectedWithdrawal.id.toString(),
      action,
      adminNote: action === 'reject' ? rejectReason : undefined,
    });
  };

  // 过滤代理列表
  const filteredAgents = agentsData?.agents?.filter((agent: any) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      agent.email?.toLowerCase().includes(query) ||
      agent.name?.toLowerCase().includes(query) ||
      agent.inviteCode?.toLowerCase().includes(query)
    );
  }) || [];

  return (
    <div className="space-y-6">
      {/* 标题区域 */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Crown className="w-5 h-5 text-amber-400" />
            <span className="text-sm text-amber-400">代理系统</span>
          </div>
          <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
            代理管理
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { refetchAgents(); refetchWithdrawals(); refetchStats(); }}
          className="border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新数据
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-slate-900/80 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">总代理数</p>
                <p className="text-2xl font-bold text-white">
                  {statsLoading ? <Skeleton className="h-8 w-16" /> : statsData?.totalAgents || 0}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/20">
                <Crown className="w-6 h-6 text-amber-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/80 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">创始代理</p>
                <p className="text-2xl font-bold text-amber-400">
                  {statsLoading ? <Skeleton className="h-8 w-16" /> : statsData?.founderCount || 0}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/20">
                <Award className="w-6 h-6 text-amber-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/80 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">待审核提现</p>
                <p className="text-2xl font-bold text-yellow-400">
                  {withdrawalsLoading ? <Skeleton className="h-8 w-16" /> : withdrawalsData?.total || 0}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-yellow-500/20">
                <Clock className="w-6 h-6 text-yellow-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/80 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">金/银牌代理</p>
                <p className="text-2xl font-bold text-cyan-400">
                  {statsLoading ? <Skeleton className="h-8 w-16" /> : `${statsData?.goldCount || 0}/${statsData?.silverCount || 0}`}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-cyan-500/20">
                <Users className="w-6 h-6 text-cyan-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 标签页 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-900/80 border border-slate-800">
          <TabsTrigger value="agents" className="data-[state=active]:bg-slate-800">
            <Users className="w-4 h-4 mr-2" />
            代理列表
          </TabsTrigger>
          <TabsTrigger value="withdrawals" className="data-[state=active]:bg-slate-800">
            <Wallet className="w-4 h-4 mr-2" />
            提现审核
          </TabsTrigger>
          <TabsTrigger value="settings" className="data-[state=active]:bg-slate-800">
            <Settings className="w-4 h-4 mr-2" />
            佣金配置
          </TabsTrigger>
        </TabsList>

        {/* 代理列表 */}
        <TabsContent value="agents" className="mt-4">
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white">代理列表</CardTitle>
                  <CardDescription className="text-slate-400">
                    共 {agentsData?.total || 0} 名代理
                  </CardDescription>
                </div>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    placeholder="搜索邮箱/姓名/邀请码"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-slate-800 border-slate-700 text-white"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {agentsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16" />)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-800">
                      <TableHead className="text-slate-400">代理</TableHead>
                      <TableHead className="text-slate-400">等级</TableHead>
                      <TableHead className="text-slate-400">邀请码</TableHead>
                      <TableHead className="text-slate-400">团队人数</TableHead>
                      <TableHead className="text-slate-400">累计收益</TableHead>
                      <TableHead className="text-slate-400">可提现</TableHead>
                      <TableHead className="text-slate-400">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAgents.map((agent: any) => {
                      const levelConfig = AGENT_LEVELS[agent.agentLevel as keyof typeof AGENT_LEVELS] || AGENT_LEVELS.normal;
                      return (
                        <TableRow key={agent.id} className="border-slate-800">
                          <TableCell>
                            <div>
                              <p className="text-white font-medium">{agent.name || agent.email?.split('@')[0]}</p>
                              <p className="text-slate-500 text-sm">{agent.email}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${levelConfig.bgColor} ${levelConfig.color} border-0`}>
                              {levelConfig.badge} {levelConfig.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <code className="text-cyan-400 bg-slate-800 px-2 py-1 rounded text-sm">
                              {agent.inviteCode}
                            </code>
                          </TableCell>
                          <TableCell className="text-white">
                            {agent.teamCount || 0} 人
                          </TableCell>
                          <TableCell className="text-green-400 font-medium">
                            ${parseFloat(agent.agentTotalEarned || 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-cyan-400 font-medium">
                            ${parseFloat(agent.agentBalance || 0).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedAgent(agent);
                                setNewLevel(agent.agentLevel);
                                setLevelDialogOpen(true);
                              }}
                              className="border-slate-700 text-slate-300 hover:bg-slate-800"
                            >
                              修改等级
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 提现审核 */}
        <TabsContent value="withdrawals" className="mt-4">
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white">待审核提现申请</CardTitle>
              <CardDescription className="text-slate-400">
                共 {withdrawalsData?.total || 0} 条待处理
              </CardDescription>
            </CardHeader>
            <CardContent>
              {withdrawalsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
                </div>
              ) : withdrawalsData?.withdrawals && withdrawalsData.withdrawals.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-800">
                      <TableHead className="text-slate-400">代理</TableHead>
                      <TableHead className="text-slate-400">提现金额</TableHead>
                      <TableHead className="text-slate-400">钱包地址</TableHead>
                      <TableHead className="text-slate-400">申请时间</TableHead>
                      <TableHead className="text-slate-400">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {withdrawalsData.withdrawals.map((withdrawal: any) => (
                      <TableRow key={withdrawal.id} className="border-slate-800">
                        <TableCell>
                          <div>
                            <p className="text-white font-medium">{withdrawal.agentName || '未知'}</p>
                            <p className="text-slate-500 text-sm">{withdrawal.agentEmail}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-green-400 font-bold">
                          ${parseFloat(withdrawal.amount).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <code className="text-cyan-400 bg-slate-800 px-2 py-1 rounded text-xs truncate max-w-[200px] block">
                            {withdrawal.walletAddress}
                          </code>
                        </TableCell>
                        <TableCell className="text-slate-400">
                          {new Date(withdrawal.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedWithdrawal(withdrawal);
                                setWithdrawalDialogOpen(true);
                              }}
                              className="border-green-500/50 text-green-400 hover:bg-green-500/10"
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              审核
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12">
                  <Wallet className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">暂无待审核的提现申请</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 佣金配置 */}
        <TabsContent value="settings" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-slate-900/80 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Award className="w-5 h-5 text-amber-400" />
                  佣金比例配置
                </CardTitle>
              </CardHeader>
              <CardContent>
                {settingsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {[
                      { key: 'founder', label: '创始代理', badge: '👑' },
                      { key: 'gold', label: '金牌代理', badge: '🥇' },
                      { key: 'silver', label: '银牌代理', badge: '🥈' },
                      { key: 'normal', label: '普通代理', badge: '⭐' },
                    ].map((level) => (
                      <div key={level.key} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{level.badge}</span>
                          <span className="text-white">{level.label}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-sm">
                            <span className="text-slate-400">一级:</span>
                            <span className="text-green-400 ml-1 font-medium">
                              {settingsData?.[`${level.key}_level1_rate`] || '0'}%
                            </span>
                          </div>
                          <div className="text-sm">
                            <span className="text-slate-400">二级:</span>
                            <span className="text-cyan-400 ml-1 font-medium">
                              {settingsData?.[`${level.key}_level2_rate`] || '0'}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-900/80 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-cyan-400" />
                  其他配置
                </CardTitle>
              </CardHeader>
              <CardContent>
                {settingsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                      <span className="text-slate-400">创始代理名额</span>
                      <span className="text-white font-medium">{settingsData?.founder_limit || 100} 名</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                      <span className="text-slate-400">首充额外奖励</span>
                      <span className="text-green-400 font-medium">+{settingsData?.first_charge_bonus || 3}%</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                      <span className="text-slate-400">最低提现金额</span>
                      <span className="text-white font-medium">{settingsData?.min_withdrawal || 50} USDT</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                      <span className="text-slate-400">佣金冻结天数</span>
                      <span className="text-white font-medium">{settingsData?.settlement_days || 7} 天</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* 修改等级对话框 */}
      <Dialog open={levelDialogOpen} onOpenChange={setLevelDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">修改代理等级</DialogTitle>
            <DialogDescription className="text-slate-400">
              为 {selectedAgent?.email} 设置新的代理等级
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={newLevel} onValueChange={setNewLevel}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                <SelectValue placeholder="选择等级" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="founder">👑 创始代理</SelectItem>
                <SelectItem value="gold">🥇 金牌代理</SelectItem>
                <SelectItem value="silver">🥈 银牌代理</SelectItem>
                <SelectItem value="normal">⭐ 普通代理</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLevelDialogOpen(false)}>取消</Button>
            <Button 
              onClick={handleSetLevel}
              disabled={setLevelMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {setLevelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '确认修改'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 提现审核对话框 */}
      <Dialog open={withdrawalDialogOpen} onOpenChange={setWithdrawalDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">审核提现申请</DialogTitle>
            <DialogDescription className="text-slate-400">
              提现金额: ${selectedWithdrawal ? parseFloat(selectedWithdrawal.amount).toFixed(2) : '0.00'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="p-4 bg-slate-800/50 rounded-lg">
              <p className="text-slate-400 text-sm mb-1">收款地址 (TRC20)</p>
              <code className="text-cyan-400 text-sm break-all">
                {selectedWithdrawal?.walletAddress}
              </code>
            </div>
            <div>
              <p className="text-slate-400 text-sm mb-2">拒绝原因（可选）</p>
              <Input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="如需拒绝，请填写原因"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => handleProcessWithdrawal('reject')}
              disabled={processWithdrawalMutation.isPending}
              className="border-red-500/50 text-red-400 hover:bg-red-500/10"
            >
              <XCircle className="w-4 h-4 mr-1" />
              拒绝
            </Button>
            <Button 
              onClick={() => handleProcessWithdrawal('approve')}
              disabled={processWithdrawalMutation.isPending}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              <CheckCircle className="w-4 h-4 mr-1" />
              审核通过
            </Button>
            <Button 
              onClick={() => handleProcessWithdrawal('paid')}
              disabled={processWithdrawalMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {processWithdrawalMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <DollarSign className="w-4 h-4 mr-1" />
                  已打款
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
