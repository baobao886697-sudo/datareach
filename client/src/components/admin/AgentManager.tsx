import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Settings, Award, Loader2, Search, UserPlus,
  FileText, Copy, ExternalLink
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

  const [withdrawalStatus, setWithdrawalStatus] = useState('pending');
  
  // 代理申请审核
  const [applicationDialogOpen, setApplicationDialogOpen] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<any>(null);
  const [approveLevel, setApproveLevel] = useState('normal');
  const [applicationNote, setApplicationNote] = useState('');
  
  // 直接发放代理
  const [grantAgentDialogOpen, setGrantAgentDialogOpen] = useState(false);
  const [grantUserId, setGrantUserId] = useState('');
  const [grantLevel, setGrantLevel] = useState('normal');
  
  // 调整佣金
  const [adjustBalanceDialogOpen, setAdjustBalanceDialogOpen] = useState(false);
  const [adjustType, setAdjustType] = useState<'add' | 'subtract' | 'set'>('add');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  
  // 查看佣金明细
  const [commissionsDialogOpen, setCommissionsDialogOpen] = useState(false);
  
  // 查看代理下属用户
  const [usersDialogOpen, setUsersDialogOpen] = useState(false);

  // 获取代理列表
  const { data: agentsData, isLoading: agentsLoading, refetch: refetchAgents } = trpc.admin.agent.list.useQuery({
    page: 1,
    limit: 50,
    search: searchQuery,
  });

  // 获取代理申请列表
  const { data: applicationsData, isLoading: applicationsLoading, refetch: refetchApplications } = trpc.admin.agent.applications.useQuery({
    status: 'pending',
    page: 1,
    limit: 50,
  });

  // 获取提现申请列表
  const { data: withdrawalsData, isLoading: withdrawalsLoading, refetch: refetchWithdrawals } = trpc.admin.agent.withdrawals.useQuery({
    status: withdrawalStatus,
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

  // 处理代理申请
  const processApplicationMutation = trpc.admin.agent.processApplication.useMutation({
    onSuccess: () => {
      toast.success('申请已处理');
      setApplicationDialogOpen(false);
      refetchApplications();
      refetchAgents();
      refetchStats();
    },
    onError: (error) => {
      toast.error(error.message || '操作失败');
    },
  });

  // 直接设置用户为代理
  const setUserAsAgentMutation = trpc.admin.agent.setUserAsAgent.useMutation({
    onSuccess: (data) => {
      toast.success(`已设置为代理，邀请码: ${data.inviteCode}`);
      setGrantAgentDialogOpen(false);
      setGrantUserId('');
      refetchAgents();
      refetchStats();
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

  // 初始化代理配置
  const initSettingsMutation = trpc.admin.agent.initSettings.useMutation({
    onSuccess: () => {
      toast.success('配置已初始化');
      refetchSettings();
    },
    onError: (error) => {
      toast.error(error.message || '初始化失败');
    },
  });

  // 调整佣金余额
  const adjustBalanceMutation = trpc.admin.agent.adjustBalance.useMutation({
    onSuccess: (data) => {
      toast.success(`佣金已调整: $${data.oldBalance} → $${data.newBalance}`);
      setAdjustBalanceDialogOpen(false);
      setAdjustAmount('');
      setAdjustReason('');
      refetchAgents();
    },
    onError: (error) => {
      toast.error(error.message || '调整失败');
    },
  });

  // 清除佣金
  const clearBalanceMutation = trpc.admin.agent.clearBalance.useMutation({
    onSuccess: (data) => {
      toast.success(`已清除佣金: 可提现$${data.clearedBalance}, 冻结$${data.clearedFrozen}`);
      setAdjustBalanceDialogOpen(false);
      setAdjustReason('');
      refetchAgents();
    },
    onError: (error) => {
      toast.error(error.message || '清除失败');
    },
  });

  // 获取代理佣金明细
  const { data: commissionsData, isLoading: commissionsLoading, refetch: refetchCommissions } = trpc.admin.agent.agentCommissions.useQuery(
    { agentId: selectedAgent?.id || 0, page: 1, limit: 50 },
    { enabled: !!selectedAgent && commissionsDialogOpen }
  );

  // 处理等级修改
  const handleSetLevel = () => {
    if (!selectedAgent || !newLevel) return;
    setLevelMutation.mutate({
      agentId: selectedAgent.id,
      level: newLevel as any,
    });
  };

  // 处理申请审核
  const handleProcessApplication = (action: 'approve' | 'reject') => {
    if (!selectedApplication) return;
    processApplicationMutation.mutate({
      applicationId: selectedApplication.id,
      action,
      level: action === 'approve' ? approveLevel as any : undefined,
      adminNote: applicationNote || undefined,
    });
  };

  // 处理直接发放代理
  const handleGrantAgent = () => {
    const userId = parseInt(grantUserId);
    if (isNaN(userId) || userId <= 0) {
      toast.error('请输入有效的用户ID');
      return;
    }
    setUserAsAgentMutation.mutate({
      userId,
      level: grantLevel as any,
    });
  };

  // 处理提现审核
  const handleProcessWithdrawal = (action: 'approve' | 'reject' | 'paid') => {
    console.log('handleProcessWithdrawal called:', action);
    console.log('selectedWithdrawal:', selectedWithdrawal);
    console.log('withdrawalId:', selectedWithdrawal?.withdrawal?.withdrawalId || selectedWithdrawal?.withdrawalId);
    if (!selectedWithdrawal) {
      console.log('selectedWithdrawal is null');
      return;
    }
    console.log('Calling mutation with:', {
      withdrawalId: selectedWithdrawal.withdrawal?.withdrawalId || selectedWithdrawal.withdrawalId,
      action,
      adminNote: action === 'reject' ? rejectReason : undefined,
    });
    processWithdrawalMutation.mutate({
      withdrawalId: selectedWithdrawal.withdrawal?.withdrawalId || selectedWithdrawal.withdrawalId,
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

  // 复制申请链接
  const copyApplyLink = () => {
    const link = `${window.location.origin}/apply-agent`;
    navigator.clipboard.writeText(link);
    toast.success('申请链接已复制');
  };

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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={copyApplyLink}
            className="border-amber-500/50 text-amber-400 hover:bg-amber-500/20"
          >
            <Copy className="h-4 w-4 mr-2" />
            复制申请链接
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setGrantAgentDialogOpen(true)}
            className="border-green-500/50 text-green-400 hover:bg-green-500/20"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            发放代理
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refetchAgents(); refetchWithdrawals(); refetchStats(); refetchApplications(); }}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            刷新数据
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
                <p className="text-slate-400 text-sm">待审核申请</p>
                <p className="text-2xl font-bold text-orange-400">
                  {applicationsLoading ? <Skeleton className="h-8 w-16" /> : applicationsData?.total || 0}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-orange-500/20">
                <FileText className="w-6 h-6 text-orange-400" />
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
          <TabsTrigger value="applications" className="data-[state=active]:bg-slate-800">
            <FileText className="w-4 h-4 mr-2" />
            申请审核
            {(applicationsData?.total || 0) > 0 && (
              <Badge className="ml-2 bg-orange-500/20 text-orange-400">{applicationsData?.total}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="withdrawals" className="data-[state=active]:bg-slate-800">
            <Wallet className="w-4 h-4 mr-2" />
            提现审核
            {(withdrawalsData?.total || 0) > 0 && (
              <Badge className="ml-2 bg-yellow-500/20 text-yellow-400">{withdrawalsData?.total}</Badge>
            )}
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
                      <TableHead className="text-slate-400">累计收益</TableHead>
                      <TableHead className="text-slate-400">可提现</TableHead>
                      <TableHead className="text-slate-400">冻结中</TableHead>
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
                              <p className="text-white font-medium">{agent.name || '-'}</p>
                              <p className="text-slate-400 text-sm">{agent.email}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${levelConfig.bgColor} ${levelConfig.color}`}>
                              {levelConfig.badge} {levelConfig.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <code className="text-cyan-400 bg-slate-800 px-2 py-1 rounded text-sm">
                              {agent.inviteCode || '-'}
                            </code>
                          </TableCell>
                          <TableCell className="text-green-400 font-medium">
                            ${parseFloat(agent.agentTotalEarned || '0').toFixed(2)}
                          </TableCell>
                          <TableCell className="text-white font-medium">
                            ${parseFloat(agent.agentBalance || '0').toFixed(2)}
                          </TableCell>
                          <TableCell className="text-yellow-400 font-medium">
                            ${parseFloat(agent.agentFrozenBalance || '0').toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedAgent(agent);
                                  setNewLevel(agent.agentLevel || 'normal');
                                  setLevelDialogOpen(true);
                                }}
                                className="text-slate-400 hover:text-white"
                              >
                                <Award className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedAgent(agent);
                                  setAdjustType('add');
                                  setAdjustAmount('');
                                  setAdjustReason('');
                                  setAdjustBalanceDialogOpen(true);
                                }}
                                className="text-green-400 hover:text-green-300"
                                title="调整佣金"
                              >
                                <DollarSign className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedAgent(agent);
                                  setCommissionsDialogOpen(true);
                                }}
                                className="text-blue-400 hover:text-blue-300"
                                title="查看佣金明细"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedAgent(agent);
                                  setUsersDialogOpen(true);
                                }}
                                className="text-purple-400 hover:text-purple-300"
                                title="查看下属用户"
                              >
                                <Users className="w-4 h-4" />
                              </Button>
                            </div>
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

        {/* 申请审核 */}
        <TabsContent value="applications" className="mt-4">
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white">代理申请审核</CardTitle>
              <CardDescription className="text-slate-400">
                待审核申请 {applicationsData?.total || 0} 条
              </CardDescription>
            </CardHeader>
            <CardContent>
              {applicationsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
                </div>
              ) : (applicationsData?.applications?.length || 0) === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>暂无待审核的申请</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {applicationsData?.applications?.map((app: any) => (
                    <div key={app.id} className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <span className="text-white font-medium text-lg">{app.name}</span>
                            <Badge className="bg-orange-500/20 text-orange-400">待审核</Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                            <p className="text-slate-400">邮箱: <span className="text-white">{app.email}</span></p>
                            <p className="text-slate-400">手机: <span className="text-white">{app.phone}</span></p>
                            {app.wechat && <p className="text-slate-400">微信: <span className="text-white">{app.wechat}</span></p>}
                            {app.company && <p className="text-slate-400">公司: <span className="text-white">{app.company}</span></p>}
                            {app.expectedUsers && <p className="text-slate-400">预期用户: <span className="text-white">{app.expectedUsers}</span></p>}
                          </div>
                          {app.experience && (
                            <p className="text-slate-400 text-sm">
                              推广经验: <span className="text-slate-300">{app.experience}</span>
                            </p>
                          )}
                          {app.channels && (
                            <p className="text-slate-400 text-sm">
                              推广渠道: <span className="text-slate-300">{app.channels}</span>
                            </p>
                          )}
                          <p className="text-slate-500 text-xs">
                            申请时间: {new Date(app.createdAt).toLocaleString('zh-CN')}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedApplication(app);
                              setApproveLevel('normal');
                              setApplicationNote('');
                              setApplicationDialogOpen(true);
                            }}
                            className="bg-green-500/20 text-green-400 hover:bg-green-500/30"
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            审核
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 提现审核 */}
        <TabsContent value="withdrawals" className="mt-4">
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white">提现申请审核</CardTitle>
                  <CardDescription className="text-slate-400">
                    {withdrawalStatus === 'pending' ? `待处理提现 ${withdrawalsData?.total || 0} 笔` : `提现记录 ${withdrawalsData?.total || 0} 笔`}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={withdrawalStatus} onValueChange={setWithdrawalStatus}>
                    <SelectTrigger className="w-32 bg-slate-800 border-slate-700 text-white">
                      <SelectValue placeholder="状态筛选" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800 text-white">
                      <SelectItem value="all">全部状态</SelectItem>
                      <SelectItem value="pending">待审核</SelectItem>
                      <SelectItem value="approved">已批准</SelectItem>
                      <SelectItem value="paid">已打款</SelectItem>
                      <SelectItem value="rejected">已拒绝</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {withdrawalsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
                </div>
              ) : (withdrawalsData?.withdrawals?.length || 0) === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>暂无符合条件的提现申请</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-800">
                      <TableHead className="text-slate-400">代理</TableHead>
                      <TableHead className="text-slate-400">金额</TableHead>
                      <TableHead className="text-slate-400">状态</TableHead>
                      <TableHead className="text-slate-400">钱包地址</TableHead>
                      <TableHead className="text-slate-400">申请时间</TableHead>
                      <TableHead className="text-slate-400">处理信息</TableHead>
                      <TableHead className="text-slate-400">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {withdrawalsData?.withdrawals?.map((item: any) => (
                      <TableRow key={item.withdrawal?.id || item.id} className="border-slate-800">
                        <TableCell>
                          <div>
                            <p className="text-white">{item.agentName || '-'}</p>
                            <p className="text-slate-400 text-sm">{item.agentEmail}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-green-400 font-bold">
                          ${parseFloat(item.withdrawal?.amount || item.amount || '0').toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {item.withdrawal?.status === 'pending' && <Badge className="bg-yellow-500/20 text-yellow-400">待审核</Badge>}
                          {item.withdrawal?.status === 'approved' && <Badge className="bg-blue-500/20 text-blue-400">已批准</Badge>}
                          {item.withdrawal?.status === 'paid' && <Badge className="bg-green-500/20 text-green-400">已打款</Badge>}
                          {item.withdrawal?.status === 'rejected' && <Badge className="bg-red-500/20 text-red-400">已拒绝</Badge>}
                        </TableCell>
                        <TableCell>
                          <code className="text-cyan-400 bg-slate-800 px-2 py-1 rounded text-xs break-all">
                            {item.withdrawal?.walletAddress || item.walletAddress}
                          </code>
                        </TableCell>
                        <TableCell className="text-slate-400 text-sm">
                          {new Date(item.withdrawal?.createdAt || item.createdAt).toLocaleString('zh-CN')}
                        </TableCell>
                        <TableCell className="text-slate-400 text-sm">
                          {item.withdrawal?.processedBy && (
                            <div>
                              <p>处理人: {item.withdrawal.processedBy}</p>
                              {item.withdrawal.processedAt && <p className="text-xs opacity-70">{new Date(item.withdrawal.processedAt).toLocaleString('zh-CN')}</p>}
                              {item.withdrawal.adminNote && <p className="text-xs text-orange-400 mt-1">备注: {item.withdrawal.adminNote}</p>}

                            </div>
                          )}
                          {!item.withdrawal?.processedBy && '-'}
                        </TableCell>
                        <TableCell>
                          {item.withdrawal?.status === 'pending' || item.withdrawal?.status === 'approved' ? (
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedWithdrawal(item);

                                setRejectReason(item.withdrawal?.adminNote || '');
                                setWithdrawalDialogOpen(true);
                              }}
                              className="bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              处理
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedWithdrawal(item);
                                setWithdrawalDialogOpen(true);
                              }}
                              className="text-slate-400 hover:text-white"
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              详情
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 佣金配置 */}
        <TabsContent value="settings" className="mt-4">
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white">佣金配置</CardTitle>
              <CardDescription className="text-slate-400">
                配置各等级代理的佣金比例和规则
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settingsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}
                </div>
              ) : Object.keys(settingsData || {}).length === 0 ? (
                <div className="text-center py-12">
                  <Settings className="w-12 h-12 mx-auto mb-4 text-slate-500" />
                  <p className="text-slate-400 mb-4">佣金配置未初始化</p>
                  <Button
                    onClick={() => initSettingsMutation.mutate()}
                    disabled={initSettingsMutation.isPending}
                    className="bg-amber-500 hover:bg-amber-600"
                  >
                    {initSettingsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    初始化配置
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4">
                  {Object.entries(settingsData || {}).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                      <div>
                        <p className="text-white font-medium">{key}</p>
                        <p className="text-slate-400 text-sm">{getSettingDescription(key)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          defaultValue={value as string}
                          className="w-32 bg-slate-900 border-slate-700 text-white text-right"
                          onBlur={(e) => {
                            if (e.target.value !== value) {
                              updateSettingMutation.mutate({ key, value: e.target.value });
                            }
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 修改等级对话框 */}
      <Dialog open={levelDialogOpen} onOpenChange={setLevelDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">修改代理等级</DialogTitle>
            <DialogDescription className="text-slate-400">
              修改 {selectedAgent?.email} 的代理等级
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-white">选择等级</Label>
              <Select value={newLevel} onValueChange={setNewLevel}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {Object.entries(AGENT_LEVELS).map(([key, config]) => (
                    <SelectItem key={key} value={key} className="text-white">
                      {config.badge} {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLevelDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleSetLevel}
              disabled={setLevelMutation.isPending}
              className="bg-amber-500 hover:bg-amber-600"
            >
              {setLevelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 申请审核对话框 */}
      <Dialog open={applicationDialogOpen} onOpenChange={setApplicationDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">审核代理申请</DialogTitle>
            <DialogDescription className="text-slate-400">
              申请人: {selectedApplication?.name} ({selectedApplication?.email})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-white">审批等级</Label>
              <Select value={approveLevel} onValueChange={setApproveLevel}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {Object.entries(AGENT_LEVELS).map(([key, config]) => (
                    <SelectItem key={key} value={key} className="text-white">
                      {config.badge} {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-white">备注 (可选)</Label>
              <Textarea
                value={applicationNote}
                onChange={(e) => setApplicationNote(e.target.value)}
                placeholder="审批备注..."
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => handleProcessApplication('reject')}
              disabled={processApplicationMutation.isPending}
            >
              <XCircle className="w-4 h-4 mr-2" />
              拒绝
            </Button>
            <Button
              onClick={() => handleProcessApplication('approve')}
              disabled={processApplicationMutation.isPending}
              className="bg-green-500 hover:bg-green-600"
            >
              {processApplicationMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
              通过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 直接发放代理对话框 */}
      <Dialog open={grantAgentDialogOpen} onOpenChange={setGrantAgentDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">直接发放代理</DialogTitle>
            <DialogDescription className="text-slate-400">
              将现有用户设置为代理
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-white">用户ID</Label>
              <Input
                type="number"
                value={grantUserId}
                onChange={(e) => setGrantUserId(e.target.value)}
                placeholder="输入用户ID"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white">代理等级</Label>
              <Select value={grantLevel} onValueChange={setGrantLevel}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {Object.entries(AGENT_LEVELS).map(([key, config]) => (
                    <SelectItem key={key} value={key} className="text-white">
                      {config.badge} {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGrantAgentDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleGrantAgent}
              disabled={setUserAsAgentMutation.isPending}
              className="bg-green-500 hover:bg-green-600"
            >
              {setUserAsAgentMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
              确认发放
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 提现处理对话框 */}
      <Dialog open={withdrawalDialogOpen} onOpenChange={setWithdrawalDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">
              {selectedWithdrawal?.withdrawal?.status === 'pending' || selectedWithdrawal?.withdrawal?.status === 'approved' ? '处理提现申请' : '提现申请详情'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              金额: ${parseFloat(selectedWithdrawal?.withdrawal?.amount || selectedWithdrawal?.amount || '0').toFixed(2)} USDT
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-slate-800/50 rounded-lg space-y-2">
              <p className="text-slate-400 text-sm">收款地址:</p>
              <code className="text-cyan-400 text-sm break-all">
                {selectedWithdrawal?.withdrawal?.walletAddress || selectedWithdrawal?.walletAddress}
              </code>
            </div>
            
            {selectedWithdrawal?.withdrawal?.status !== 'paid' && selectedWithdrawal?.withdrawal?.status !== 'rejected' ? (
              <>
                <div className="space-y-2">
                  <Label className="text-white">备注 (拒绝时必填)</Label>
                  <Textarea
                    placeholder="输入处理备注"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-3 py-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">处理状态:</span>
                  <span className="text-white font-medium">
                    {selectedWithdrawal?.withdrawal?.status === 'paid' ? '已打款' : '已拒绝'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">处理人:</span>
                  <span className="text-white">{selectedWithdrawal?.withdrawal?.processedBy}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">处理时间:</span>
                  <span className="text-white">
                    {selectedWithdrawal?.withdrawal?.processedAt ? new Date(selectedWithdrawal.withdrawal.processedAt).toLocaleString('zh-CN') : '-'}
                  </span>
                </div>

                {selectedWithdrawal?.withdrawal?.adminNote && (
                  <div className="space-y-1">
                    <p className="text-sm text-slate-400">备注:</p>
                    <p className="text-sm text-white bg-slate-800 p-2 rounded">
                      {selectedWithdrawal.withdrawal.adminNote}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            {selectedWithdrawal?.withdrawal?.status === 'pending' && (
              <>
                <Button
                  variant="destructive"
                  onClick={() => handleProcessWithdrawal('reject')}
                  disabled={processWithdrawalMutation.isPending}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  拒绝
                </Button>
                <Button
                  onClick={() => handleProcessWithdrawal('approve')}
                  disabled={processWithdrawalMutation.isPending}
                  className="bg-yellow-500 hover:bg-yellow-600"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  批准
                </Button>
              </>
            )}
            {selectedWithdrawal?.withdrawal?.status !== 'paid' && selectedWithdrawal?.withdrawal?.status !== 'rejected' && (
              <Button
                type="button"
                onClick={() => {
                  alert('按钮被点击!');
                  console.log('selectedWithdrawal:', selectedWithdrawal);
                  const withdrawalId = selectedWithdrawal?.withdrawal?.withdrawalId;
                  console.log('withdrawalId:', withdrawalId);
                  if (!withdrawalId) {
                    toast.error('提现ID不存在');
                    return;
                  }
                  processWithdrawalMutation.mutate({
                    withdrawalId,
                    action: 'paid',
                  });
                }}
                disabled={processWithdrawalMutation.isPending}
                className="bg-green-500 hover:bg-green-600"
              >
                {processWithdrawalMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <DollarSign className="w-4 h-4 mr-2" />}
                已打款
              </Button>
            )}
            {(selectedWithdrawal?.withdrawal?.status === 'paid' || selectedWithdrawal?.withdrawal?.status === 'rejected') && (
              <Button variant="outline" onClick={() => setWithdrawalDialogOpen(false)} className="border-slate-700 text-white">
                关闭
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 调整佣金弹窗 */}
      <Dialog open={adjustBalanceDialogOpen} onOpenChange={setAdjustBalanceDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">调整代理佣金</DialogTitle>
            <DialogDescription className="text-slate-400">
              代理: {selectedAgent?.email} | 当前可提现: ${parseFloat(selectedAgent?.agentBalance || '0').toFixed(2)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-white">操作类型</Label>
              <Select value={adjustType} onValueChange={(v) => setAdjustType(v as any)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="add" className="text-white">➕ 增加佣金</SelectItem>
                  <SelectItem value="subtract" className="text-white">➖ 扣除佣金</SelectItem>
                  <SelectItem value="set" className="text-white">📌 设置为指定金额</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-white">金额 (USDT)</Label>
              <Input
                type="number"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                placeholder="输入金额"
                className="bg-slate-800 border-slate-700 text-white"
                min="0"
                step="0.01"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white">调整原因 *</Label>
              <Textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="请填写调整原因..."
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                if (!adjustReason) {
                  toast.error('请填写清除原因');
                  return;
                }
                clearBalanceMutation.mutate({
                  agentId: selectedAgent?.id,
                  reason: adjustReason,
                });
              }}
              disabled={clearBalanceMutation.isPending}
              className="sm:mr-auto"
            >
              {clearBalanceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
              清除全部佣金
            </Button>
            <Button variant="ghost" onClick={() => setAdjustBalanceDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (!adjustAmount || !adjustReason) {
                  toast.error('请填写金额和原因');
                  return;
                }
                adjustBalanceMutation.mutate({
                  agentId: selectedAgent?.id,
                  type: adjustType,
                  amount: parseFloat(adjustAmount),
                  reason: adjustReason,
                });
              }}
              disabled={adjustBalanceMutation.isPending}
              className="bg-green-500 hover:bg-green-600"
            >
              {adjustBalanceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
              确认调整
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 查看代理下属用户弹窗 */}
      <AgentUsersDialog 
        open={usersDialogOpen} 
        onOpenChange={setUsersDialogOpen} 
        agent={selectedAgent} 
      />

      {/* 查看佣金明细弹窗 */}
      <Dialog open={commissionsDialogOpen} onOpenChange={setCommissionsDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-white">佣金明细</DialogTitle>
            <DialogDescription className="text-slate-400">
              代理: {selectedAgent?.email} | 累计收益: ${parseFloat(selectedAgent?.agentTotalEarned || '0').toFixed(2)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-auto">
            {commissionsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              </div>
            ) : commissionsData?.commissions?.length === 0 ? (
              <p className="text-center text-slate-400 py-8">暂无佣金记录</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700">
                    <TableHead className="text-slate-400">时间</TableHead>
                    <TableHead className="text-slate-400">类型</TableHead>
                    <TableHead className="text-slate-400">来源用户</TableHead>
                    <TableHead className="text-slate-400">订单金额</TableHead>
                    <TableHead className="text-slate-400">佣金比例</TableHead>
                    <TableHead className="text-slate-400">佣金</TableHead>
                    <TableHead className="text-slate-400">状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissionsData?.commissions?.map((c: any) => (
                    <TableRow key={c.id} className="border-slate-700">
                      <TableCell className="text-white text-xs">
                        {new Date(c.createdAt).toLocaleDateString('zh-CN')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={c.level === 'level1' ? 'text-cyan-400' : 'text-purple-400'}>
                          {c.level === 'level1' ? '一级' : '二级'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-300 text-xs">{c.fromUserEmail}</TableCell>
                      <TableCell className="text-white">${c.orderAmount}</TableCell>
                      <TableCell className="text-slate-300">{c.commissionRate}%</TableCell>
                      <TableCell className="text-green-400 font-medium">
                        ${(parseFloat(c.commissionAmount) + parseFloat(c.bonusAmount)).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          c.status === 'settled' ? 'text-green-400' :
                          c.status === 'pending' ? 'text-yellow-400' : 'text-slate-400'
                        }>
                          {c.status === 'settled' ? '已结算' : c.status === 'pending' ? '冻结中' : c.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCommissionsDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 代理下属用户弹窗组件
function AgentUsersDialog({ open, onOpenChange, agent }: { open: boolean; onOpenChange: (open: boolean) => void; agent: any }) {
  const { data: usersData, isLoading } = trpc.adminAgent.getAgentUsers.useQuery(
    { agentId: agent?.id, page: 1, limit: 50 },
    { enabled: !!agent?.id && open }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 max-w-4xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-400" />
            代理下属用户
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            代理: {agent?.email} | 直推: {usersData?.level1Total || 0}人 | 间推: {usersData?.level2Total || 0}人
          </DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
          </div>
        ) : (
          <Tabs defaultValue="level1" className="w-full">
            <TabsList className="bg-slate-800">
              <TabsTrigger value="level1">直推用户 ({usersData?.level1Total || 0})</TabsTrigger>
              <TabsTrigger value="level2">间推用户 ({usersData?.level2Total || 0})</TabsTrigger>
            </TabsList>
            
            <TabsContent value="level1" className="mt-4">
              {usersData?.level1Users?.length === 0 ? (
                <p className="text-center text-slate-400 py-8">暂无直推用户</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-400">ID</TableHead>
                      <TableHead className="text-slate-400">邮箱</TableHead>
                      <TableHead className="text-slate-400">姓名</TableHead>
                      <TableHead className="text-slate-400">积分</TableHead>
                      <TableHead className="text-slate-400">累计充值</TableHead>
                      <TableHead className="text-slate-400">贡献佣金</TableHead>
                      <TableHead className="text-slate-400">注册时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersData?.level1Users?.map((user: any) => (
                      <TableRow key={user.id} className="border-slate-700">
                        <TableCell className="text-slate-500">{user.id}</TableCell>
                        <TableCell className="text-white">{user.email}</TableCell>
                        <TableCell className="text-slate-300">{user.name || '-'}</TableCell>
                        <TableCell className="text-yellow-400">{user.credits}</TableCell>
                        <TableCell className="text-green-400">${user.totalRecharge}</TableCell>
                        <TableCell className="text-cyan-400">${user.totalCommission}</TableCell>
                        <TableCell className="text-slate-400 text-xs">
                          {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
            
            <TabsContent value="level2" className="mt-4">
              {usersData?.level2Users?.length === 0 ? (
                <p className="text-center text-slate-400 py-8">暂无间推用户</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-400">ID</TableHead>
                      <TableHead className="text-slate-400">邮箱</TableHead>
                      <TableHead className="text-slate-400">姓名</TableHead>
                      <TableHead className="text-slate-400">积分</TableHead>
                      <TableHead className="text-slate-400">上级邮箱</TableHead>
                      <TableHead className="text-slate-400">注册时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersData?.level2Users?.map((user: any) => (
                      <TableRow key={user.id} className="border-slate-700">
                        <TableCell className="text-slate-500">{user.id}</TableCell>
                        <TableCell className="text-white">{user.email}</TableCell>
                        <TableCell className="text-slate-300">{user.name || '-'}</TableCell>
                        <TableCell className="text-yellow-400">{user.credits}</TableCell>
                        <TableCell className="text-purple-400">{user.inviterEmail}</TableCell>
                        <TableCell className="text-slate-400 text-xs">
                          {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        )}
        
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 获取配置项描述
function getSettingDescription(key: string): string {
  const descriptions: Record<string, string> = {
    founder_limit: '创始代理名额限制',
    founder_level1_rate: '创始代理一级佣金比例 (%)',
    founder_level2_rate: '创始代理二级佣金比例 (%)',
    gold_level1_rate: '金牌代理一级佣金比例 (%)',
    gold_level2_rate: '金牌代理二级佣金比例 (%)',
    silver_level1_rate: '银牌代理一级佣金比例 (%)',
    silver_level2_rate: '银牌代理二级佣金比例 (%)',
    normal_level1_rate: '普通代理一级佣金比例 (%)',
    normal_level2_rate: '普通代理二级佣金比例 (%)',
    first_charge_bonus: '首充额外奖励比例 (%)',
    min_withdrawal: '最低提现金额 (USDT)',
    settlement_days: '佣金结算冻结天数',
    activity_bonus: '开业活动额外奖励 (%)',
    activity_end_date: '开业活动结束日期',
  };
  return descriptions[key] || key;
}
