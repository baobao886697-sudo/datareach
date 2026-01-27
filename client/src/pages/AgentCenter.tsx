import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { 
  Crown, Users, Wallet, TrendingUp, Copy, Check, Gift, 
  Clock, ArrowUpRight, Shield, Star, Zap, Award,
  ChevronRight, Sparkles, DollarSign, UserPlus, History,
  AlertCircle, ExternalLink, Loader2
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ParticleNetwork } from "@/components/ParticleNetwork";
import { toast } from "sonner";

// 代理等级配置
const AGENT_LEVELS = {
  founder: { label: '创始代理', badge: '👑', color: 'from-amber-500 to-yellow-500', bgColor: 'bg-amber-500/20', borderColor: 'border-amber-500/30' },
  gold: { label: '金牌代理', badge: '🥇', color: 'from-yellow-500 to-orange-500', bgColor: 'bg-yellow-500/20', borderColor: 'border-yellow-500/30' },
  silver: { label: '银牌代理', badge: '🥈', color: 'from-slate-400 to-slate-500', bgColor: 'bg-slate-400/20', borderColor: 'border-slate-400/30' },
  normal: { label: '普通代理', badge: '⭐', color: 'from-cyan-500 to-blue-500', bgColor: 'bg-cyan-500/20', borderColor: 'border-cyan-500/30' },
};

export default function AgentCenter() {
  const { user, loading } = useAuth();
  const [copied, setCopied] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // 获取代理信息
  const { data: agentInfo, isLoading: agentLoading, refetch: refetchAgent } = trpc.agent.info.useQuery(undefined, {
    enabled: !!user,
  });

  // 获取代理规则
  const { data: rules, isLoading: rulesLoading } = trpc.agent.rules.useQuery();

  // 获取邀请链接
  const { data: inviteData } = trpc.agent.inviteLink.useQuery(undefined, {
    enabled: !!user && agentInfo?.isAgent,
  });

  // 获取团队用户
  const { data: teamData, isLoading: teamLoading } = trpc.agent.teamUsers.useQuery(
    { page: 1, limit: 20 },
    { enabled: !!user && agentInfo?.isAgent }
  );

  // 获取佣金明细
  const { data: commissionsData, isLoading: commissionsLoading } = trpc.agent.commissions.useQuery(
    { page: 1, limit: 20 },
    { enabled: !!user && agentInfo?.isAgent }
  );

  // 获取提现记录
  const { data: withdrawalsData, isLoading: withdrawalsLoading } = trpc.agent.withdrawals.useQuery(
    { page: 1, limit: 20 },
    { enabled: !!user && agentInfo?.isAgent }
  );

  // 申请成为代理
  const applyMutation = trpc.agent.apply.useMutation({
    onSuccess: () => {
      toast.success('恭喜！您已成功成为代理');
      refetchAgent();
    },
    onError: (error) => {
      toast.error(error.message || '申请失败');
    },
  });

  // 提现申请
  const withdrawMutation = trpc.agent.withdraw.useMutation({
    onSuccess: () => {
      toast.success('提现申请已提交，请等待审核');
      setShowWithdrawDialog(false);
      setWithdrawAmount('');
      setWalletAddress('');
      refetchAgent();
    },
    onError: (error) => {
      toast.error(error.message || '提现失败');
    },
  });

  // 复制邀请链接
  const copyInviteLink = () => {
    if (inviteData?.inviteLink) {
      navigator.clipboard.writeText(inviteData.inviteLink);
      setCopied(true);
      toast.success('邀请链接已复制');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 处理提现
  const handleWithdraw = () => {
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('请输入有效的提现金额');
      return;
    }
    if (!walletAddress.trim()) {
      toast.error('请输入钱包地址');
      return;
    }
    withdrawMutation.mutate({ amount, walletAddress: walletAddress.trim() });
  };

  if (loading || agentLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // 未成为代理时显示申请页面
  if (!agentInfo?.isAgent) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-8 relative min-h-screen">
          {/* 动态粒子网络背景 */}
          <div className="fixed inset-0 z-0 pointer-events-none">
            <ParticleNetwork 
              particleCount={35}
              connectionDistance={120}
              speed={0.15}
              particleColor="rgba(6, 182, 212, 0.5)"
              lineColor="rgba(6, 182, 212, 0.08)"
            />
          </div>
          
          {/* 渐变光晕装饰 */}
          <div className="fixed inset-0 pointer-events-none overflow-hidden z-[1]">
            <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-[100px]" />
            <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[100px]" />
          </div>

          <div className="relative z-10 max-w-4xl mx-auto">
            {/* 标题区域 */}
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/30 mb-6">
                <Crown className="w-5 h-5 text-amber-400" />
                <span className="text-amber-400 font-medium">代理招募计划</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-white mb-4" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                成为 DataReach 代理
              </h1>
              <p className="text-xl text-slate-400 max-w-2xl mx-auto">
                推广即赚钱，佣金实时到账，最高可享 <span className="text-amber-400 font-bold">15%</span> 返佣
              </p>
            </div>

            {/* 创始代理名额提示 */}
            {rules && rules.founderSlots.remaining > 0 && (
              <div className="mb-8 p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border border-amber-500/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-amber-500/20">
                      <Sparkles className="w-6 h-6 text-amber-400" />
                    </div>
                    <div>
                      <p className="text-amber-400 font-semibold">🔥 创始代理限时招募中</p>
                      <p className="text-slate-400 text-sm">前 {rules.founderSlots.total} 名代理永久享受最高佣金比例</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-amber-400">{rules.founderSlots.remaining}</p>
                    <p className="text-slate-500 text-sm">剩余名额</p>
                  </div>
                </div>
              </div>
            )}

            {/* 佣金比例卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {rules && Object.entries(rules.commissionRates).map(([key, rate]) => {
                const level = AGENT_LEVELS[key as keyof typeof AGENT_LEVELS];
                return (
                  <Card key={key} className={`bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-all ${key === 'founder' ? 'ring-2 ring-amber-500/50' : ''}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-2xl">{level.badge}</span>
                        <span className="text-white font-medium">{level.label}</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 text-sm">一级佣金</span>
                          <span className={`font-bold bg-gradient-to-r ${level.color} bg-clip-text text-transparent`}>{rate.level1}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 text-sm">二级佣金</span>
                          <span className={`font-bold bg-gradient-to-r ${level.color} bg-clip-text text-transparent`}>{rate.level2}%</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* 额外奖励 */}
            {rules && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <Card className="bg-slate-900/50 border-slate-800">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-green-500/20">
                      <Gift className="w-6 h-6 text-green-400" />
                    </div>
                    <div>
                      <p className="text-white font-medium">首充奖励</p>
                      <p className="text-slate-400 text-sm">下级用户首次充值，额外 +{rules.bonuses.firstCharge}% 奖励</p>
                    </div>
                  </CardContent>
                </Card>
                {rules.isActivityPeriod && (
                  <Card className="bg-slate-900/50 border-slate-800 ring-1 ring-cyan-500/30">
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="p-3 rounded-xl bg-cyan-500/20">
                        <Zap className="w-6 h-6 text-cyan-400" />
                      </div>
                      <div>
                        <p className="text-white font-medium">🎉 开业活动</p>
                        <p className="text-slate-400 text-sm">活动期间所有佣金 +{rules.bonuses.activity}%（截止 {rules.bonuses.activityEndDate}）</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* 收益示例 */}
            <Card className="bg-slate-900/50 border-slate-800 mb-8">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-cyan-400" />
                  收益示例
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="text-left py-3 text-slate-400 font-medium">场景</th>
                        <th className="text-right py-3 text-slate-400 font-medium">充值金额</th>
                        <th className="text-right py-3 text-slate-400 font-medium">一级佣金</th>
                        <th className="text-right py-3 text-slate-400 font-medium">二级佣金</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-800/50">
                        <td className="py-3 text-white">创始代理（首充）</td>
                        <td className="py-3 text-right text-slate-300">1,000 USDT</td>
                        <td className="py-3 text-right text-green-400 font-medium">180 USDT</td>
                        <td className="py-3 text-right text-cyan-400 font-medium">50 USDT</td>
                      </tr>
                      <tr className="border-b border-slate-800/50">
                        <td className="py-3 text-white">金牌代理</td>
                        <td className="py-3 text-right text-slate-300">1,000 USDT</td>
                        <td className="py-3 text-right text-green-400 font-medium">120 USDT</td>
                        <td className="py-3 text-right text-cyan-400 font-medium">40 USDT</td>
                      </tr>
                      <tr>
                        <td className="py-3 text-white">普通代理</td>
                        <td className="py-3 text-right text-slate-300">1,000 USDT</td>
                        <td className="py-3 text-right text-green-400 font-medium">80 USDT</td>
                        <td className="py-3 text-right text-cyan-400 font-medium">20 USDT</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-slate-500 text-sm mt-4">
                  * 一级佣金：您直接邀请的用户充值产生的佣金<br />
                  * 二级佣金：您邀请的代理发展的用户充值产生的佣金
                </p>
              </CardContent>
            </Card>

            {/* 申请按钮 */}
            <div className="text-center">
              <Button 
                size="lg" 
                onClick={() => applyMutation.mutate()}
                disabled={applyMutation.isPending}
                className="gap-2 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-black font-bold shadow-lg shadow-amber-500/25 border-0 rounded-xl px-12 py-6 text-lg"
              >
                {applyMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Crown className="w-5 h-5" />
                )}
                立即成为代理
              </Button>
              <p className="text-slate-500 text-sm mt-4">
                申请即刻生效，无需审核
              </p>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // 已是代理，显示代理中心
  const levelConfig = AGENT_LEVELS[agentInfo.agentLevel as keyof typeof AGENT_LEVELS] || AGENT_LEVELS.normal;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 relative">
        {/* 动态粒子网络背景 */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <ParticleNetwork 
            particleCount={35}
            connectionDistance={120}
            speed={0.15}
            particleColor="rgba(6, 182, 212, 0.5)"
            lineColor="rgba(6, 182, 212, 0.08)"
          />
        </div>

        {/* 头部区域 */}
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r ${levelConfig.bgColor} border ${levelConfig.borderColor}`}>
                <span className="text-lg">{levelConfig.badge}</span>
                <span className={`text-sm font-medium bg-gradient-to-r ${levelConfig.color} bg-clip-text text-transparent`}>
                  {levelConfig.label}
                </span>
              </div>
            </div>
            <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
              代理中心
            </h1>
            <p className="text-slate-400">管理您的团队和佣金收益</p>
          </div>
          <Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700">
                <Wallet className="w-4 h-4" />
                申请提现
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-900 border-slate-800">
              <DialogHeader>
                <DialogTitle className="text-white">申请提现</DialogTitle>
                <DialogDescription className="text-slate-400">
                  最低提现金额：{rules?.settlement.minWithdrawal || 50} USDT
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <label className="text-sm text-slate-400 mb-2 block">提现金额 (USDT)</label>
                  <Input
                    type="number"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="输入提现金额"
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">可提现余额：{agentInfo.balance?.toFixed(2)} USDT</p>
                </div>
                <div>
                  <label className="text-sm text-slate-400 mb-2 block">收款地址 (TRC20)</label>
                  <Input
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    placeholder="输入 USDT-TRC20 钱包地址"
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowWithdrawDialog(false)}>取消</Button>
                <Button 
                  onClick={handleWithdraw}
                  disabled={withdrawMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {withdrawMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '确认提现'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 数据概览卡片 */}
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-slate-900/80 border-slate-800 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">可提现余额</p>
                  <p className="text-2xl font-bold text-green-400">${agentInfo.balance?.toFixed(2)}</p>
                </div>
                <div className="p-3 rounded-xl bg-green-500/20">
                  <Wallet className="w-6 h-6 text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/80 border-slate-800 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">冻结中佣金</p>
                  <p className="text-2xl font-bold text-amber-400">${agentInfo.frozenBalance?.toFixed(2)}</p>
                  <p className="text-xs text-slate-500">{rules?.settlement.days || 7}天后可提现</p>
                </div>
                <div className="p-3 rounded-xl bg-amber-500/20">
                  <Clock className="w-6 h-6 text-amber-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/80 border-slate-800 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">累计收益</p>
                  <p className="text-2xl font-bold text-cyan-400">${agentInfo.totalEarned?.toFixed(2)}</p>
                </div>
                <div className="p-3 rounded-xl bg-cyan-500/20">
                  <TrendingUp className="w-6 h-6 text-cyan-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/80 border-slate-800 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">团队成员</p>
                  <p className="text-2xl font-bold text-white">{agentInfo.teamUsers || 0}</p>
                  <p className="text-xs text-slate-500">其中代理 {agentInfo.teamAgents || 0} 人</p>
                </div>
                <div className="p-3 rounded-xl bg-purple-500/20">
                  <Users className="w-6 h-6 text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 邀请链接卡片 */}
        <Card className="relative z-10 bg-gradient-to-r from-slate-900/90 to-slate-800/90 border-slate-700 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <UserPlus className="w-5 h-5 text-cyan-400" />
                  <span className="text-white font-medium">我的邀请链接</span>
                </div>
                <div className="flex items-center gap-3">
                  <code className="flex-1 px-4 py-2 bg-slate-800 rounded-lg text-cyan-400 text-sm truncate">
                    {inviteData?.inviteLink || '加载中...'}
                  </code>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={copyInviteLink}
                    className="gap-2 border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? '已复制' : '复制'}
                  </Button>
                </div>
                <p className="text-slate-500 text-sm mt-2">
                  邀请码：<span className="text-cyan-400 font-mono">{inviteData?.inviteCode || agentInfo.inviteCode}</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 标签页内容 */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="relative z-10">
          <TabsList className="bg-slate-900/80 border border-slate-800">
            <TabsTrigger value="overview" className="data-[state=active]:bg-slate-800">
              <TrendingUp className="w-4 h-4 mr-2" />
              佣金规则
            </TabsTrigger>
            <TabsTrigger value="team" className="data-[state=active]:bg-slate-800">
              <Users className="w-4 h-4 mr-2" />
              团队成员
            </TabsTrigger>
            <TabsTrigger value="commissions" className="data-[state=active]:bg-slate-800">
              <DollarSign className="w-4 h-4 mr-2" />
              佣金明细
            </TabsTrigger>
            <TabsTrigger value="withdrawals" className="data-[state=active]:bg-slate-800">
              <History className="w-4 h-4 mr-2" />
              提现记录
            </TabsTrigger>
          </TabsList>

          {/* 佣金规则 */}
          <TabsContent value="overview" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 当前佣金比例 */}
              <Card className="bg-slate-900/80 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Award className="w-5 h-5 text-amber-400" />
                    您的佣金比例
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-green-500/20">
                          <ArrowUpRight className="w-5 h-5 text-green-400" />
                        </div>
                        <div>
                          <p className="text-white font-medium">一级佣金</p>
                          <p className="text-slate-400 text-sm">直接邀请用户充值</p>
                        </div>
                      </div>
                      <span className="text-2xl font-bold text-green-400">{agentInfo.commissionRates?.level1}%</span>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-cyan-500/20">
                          <Users className="w-5 h-5 text-cyan-400" />
                        </div>
                        <div>
                          <p className="text-white font-medium">二级佣金</p>
                          <p className="text-slate-400 text-sm">下级代理发展的用户充值</p>
                        </div>
                      </div>
                      <span className="text-2xl font-bold text-cyan-400">{agentInfo.commissionRates?.level2}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 结算规则 */}
              <Card className="bg-slate-900/80 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Shield className="w-5 h-5 text-cyan-400" />
                    结算规则
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
                      <Clock className="w-5 h-5 text-amber-400 mt-0.5" />
                      <div>
                        <p className="text-white font-medium">佣金冻结期</p>
                        <p className="text-slate-400 text-sm">充值确认后 {rules?.settlement.days || 7} 天自动解冻到可提现余额</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
                      <Wallet className="w-5 h-5 text-green-400 mt-0.5" />
                      <div>
                        <p className="text-white font-medium">最低提现</p>
                        <p className="text-slate-400 text-sm">单次提现最低 {rules?.settlement.minWithdrawal || 50} USDT</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
                      <Zap className="w-5 h-5 text-cyan-400 mt-0.5" />
                      <div>
                        <p className="text-white font-medium">提现方式</p>
                        <p className="text-slate-400 text-sm">支持 USDT-TRC20，24小时内到账</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 团队成员 */}
          <TabsContent value="team" className="mt-4">
            <Card className="bg-slate-900/80 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white">团队成员列表</CardTitle>
                <CardDescription className="text-slate-400">
                  共 {teamData?.total || 0} 名成员
                </CardDescription>
              </CardHeader>
              <CardContent>
                {teamLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
                  </div>
                ) : teamData?.users && teamData.users.length > 0 ? (
                  <div className="space-y-3">
                    {teamData.users.map((member: any) => (
                      <div key={member.id} className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 flex items-center justify-center text-white font-bold">
                            {member.name?.[0] || member.email?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <p className="text-white font-medium">{member.name || member.email?.split('@')[0]}</p>
                            <p className="text-slate-400 text-sm">{member.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {member.isAgent && (
                            <Badge variant="outline" className="border-amber-500/50 text-amber-400">
                              代理
                            </Badge>
                          )}
                          <span className="text-slate-500 text-sm">
                            {new Date(member.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Users className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-400">暂无团队成员</p>
                    <p className="text-slate-500 text-sm mt-2">分享您的邀请链接，开始发展团队</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 佣金明细 */}
          <TabsContent value="commissions" className="mt-4">
            <Card className="bg-slate-900/80 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white">佣金明细</CardTitle>
                <CardDescription className="text-slate-400">
                  共 {commissionsData?.total || 0} 条记录
                </CardDescription>
              </CardHeader>
              <CardContent>
                {commissionsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
                  </div>
                ) : commissionsData?.commissions && commissionsData.commissions.length > 0 ? (
                  <div className="space-y-3">
                    {commissionsData.commissions.map((commission: any) => (
                      <div key={commission.id} className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${commission.commissionLevel === 'level1' ? 'bg-green-500/20' : 'bg-cyan-500/20'}`}>
                            <DollarSign className={`w-5 h-5 ${commission.commissionLevel === 'level1' ? 'text-green-400' : 'text-cyan-400'}`} />
                          </div>
                          <div>
                            <p className="text-white font-medium">
                              {commission.commissionLevel === 'level1' ? '一级佣金' : '二级佣金'}
                            </p>
                            <p className="text-slate-400 text-sm">
                              订单金额 ${parseFloat(commission.orderAmount).toFixed(2)} · {commission.commissionRate}%
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-green-400 font-bold">+${parseFloat(commission.commissionAmount).toFixed(2)}</p>
                          <Badge variant="outline" className={
                            commission.status === 'settled' ? 'border-green-500/50 text-green-400' :
                            commission.status === 'pending' ? 'border-amber-500/50 text-amber-400' :
                            'border-slate-500/50 text-slate-400'
                          }>
                            {commission.status === 'settled' ? '已结算' : commission.status === 'pending' ? '冻结中' : '已提现'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <DollarSign className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-400">暂无佣金记录</p>
                    <p className="text-slate-500 text-sm mt-2">邀请用户充值后将产生佣金</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 提现记录 */}
          <TabsContent value="withdrawals" className="mt-4">
            <Card className="bg-slate-900/80 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white">提现记录</CardTitle>
                <CardDescription className="text-slate-400">
                  共 {withdrawalsData?.total || 0} 条记录
                </CardDescription>
              </CardHeader>
              <CardContent>
                {withdrawalsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
                  </div>
                ) : withdrawalsData?.withdrawals && withdrawalsData.withdrawals.length > 0 ? (
                  <div className="space-y-3">
                    {withdrawalsData.withdrawals.map((withdrawal: any) => (
                      <div key={withdrawal.id} className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-purple-500/20">
                            <Wallet className="w-5 h-5 text-purple-400" />
                          </div>
                          <div>
                            <p className="text-white font-medium">提现申请</p>
                            <p className="text-slate-400 text-sm truncate max-w-[200px]">
                              {withdrawal.walletAddress}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-white font-bold">${parseFloat(withdrawal.amount).toFixed(2)}</p>
                          <Badge variant="outline" className={
                            withdrawal.status === 'paid' ? 'border-green-500/50 text-green-400' :
                            withdrawal.status === 'approved' ? 'border-cyan-500/50 text-cyan-400' :
                            withdrawal.status === 'pending' ? 'border-amber-500/50 text-amber-400' :
                            'border-red-500/50 text-red-400'
                          }>
                            {withdrawal.status === 'paid' ? '已打款' : 
                             withdrawal.status === 'approved' ? '已审核' :
                             withdrawal.status === 'pending' ? '待审核' : '已拒绝'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <History className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-400">暂无提现记录</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
