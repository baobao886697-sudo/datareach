import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Coins, Clock, CheckCircle, XCircle, Loader2, QrCode, Wallet, Zap, RefreshCw, Gift } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ParticleNetwork } from "@/components/ParticleNetwork";

// 预设积分选项：5000/10000/20000/50000 积分（对应 50/100/200/500 USDT）
const PRESET_AMOUNTS = [5000, 10000, 20000, 50000];

// 阶梯优惠规则显示配置（用于横幅展示）
const BONUS_DISPLAY_TIERS = [
  { label: '100+', percent: 2 },
  { label: '200+', percent: 4 },
  { label: '500+', percent: 8 },
  { label: '1000+', percent: 10 },
];

export default function Recharge() {
  const { user } = useAuth();
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const initialAmount = params.get("amount");
  
  const [credits, setCredits] = useState(initialAmount ? Number(initialAmount) : 5000);
  const [customUsdt, setCustomUsdt] = useState<string>("");  // 自定义USDT金额输入
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  
  const isMountedRef = useRef(true);
  const pendingRedirectRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (pendingRedirectRef.current) {
      const orderId = pendingRedirectRef.current;
      pendingRedirectRef.current = null;
      window.location.href = `/payment/${orderId}`;
    }
  }, []);

  const { data: profile } = trpc.user.profile.useQuery(undefined, { 
    enabled: !!user,
    refetchOnWindowFocus: false,
  });

  const { data: rechargeConfig } = trpc.recharge.config.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  
  const creditsPerUsdt = rechargeConfig?.creditsPerUsdt || 100;
  const minRechargeCredits = rechargeConfig?.minRechargeCredits || 5000;
  const bonusTiers = rechargeConfig?.bonusTiers || [
    { minUsdt: 10000, bonusPercent: 15 },
    { minUsdt: 5000, bonusPercent: 14 },
    { minUsdt: 3000, bonusPercent: 12 },
    { minUsdt: 1000, bonusPercent: 10 },
    { minUsdt: 500, bonusPercent: 8 },
    { minUsdt: 300, bonusPercent: 6 },
    { minUsdt: 200, bonusPercent: 4 },
    { minUsdt: 100, bonusPercent: 2 },
    { minUsdt: 0, bonusPercent: 0 },
  ];
  
  const { data: ordersData, isLoading: ordersLoading, refetch: refetchOrders } = trpc.recharge.history.useQuery(
    { limit: 10 },
    { 
      enabled: !!user,
      refetchOnWindowFocus: false,
    }
  );

  const orders = ordersData?.orders || [];
  const createOrderMutation = trpc.recharge.create.useMutation();
  const usdtAmount = credits / creditsPerUsdt;

  // 计算当前选择的赠送积分
  const bonusInfo = useMemo(() => {
    const applicableTier = bonusTiers.find((tier: any) => usdtAmount >= tier.minUsdt) || { bonusPercent: 0 };
    const bonusPercent = applicableTier.bonusPercent;
    const bonusCredits = Math.floor(credits * bonusPercent / 100);
    const totalCredits = credits + bonusCredits;
    return { bonusPercent, bonusCredits, totalCredits };
  }, [credits, usdtAmount, bonusTiers]);

  const handleCreateOrder = useCallback(async () => {
    if (isCreating || createOrderMutation.isPending) {
      return;
    }
    
    if (credits < minRechargeCredits) {
      toast.error(`最低充值${minRechargeCredits}积分`);
      return;
    }
    
    setIsCreating(true);
    setCreateError(null);
    
    try {
      const result = await createOrderMutation.mutateAsync({ credits, network: "TRC20" });
      
      if (!isMountedRef.current) {
        return;
      }
      
      window.location.href = `/payment/${result.orderId}`;
      
    } catch (error: any) {
      if (!isMountedRef.current) return;
      
      setIsCreating(false);
      
      const errorMessage = error?.message || "创建订单失败";
      setCreateError(errorMessage);
      
      if (errorMessage.includes("login") || errorMessage.includes("10001") || errorMessage.includes("unauthorized")) {
        toast.error("登录已过期，请重新登录");
        setTimeout(() => {
          window.location.href = "/login";
        }, 1000);
      } else {
        toast.error(errorMessage);
      }
    }
  }, [credits, createOrderMutation, isCreating, minRechargeCredits]);

  const getStatusBadge = useCallback((status: string) => {
    switch (status) {
      case "paid":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">已确认</Badge>;
      case "expired":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">已过期</Badge>;
      case "cancelled":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">已取消</Badge>;
      case "mismatch":
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">金额不符</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 animate-pulse">待支付</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  }, []);

  const handleRefreshOrders = useCallback(() => {
    refetchOrders();
  }, [refetchOrders]);

  const handleViewOrder = useCallback((orderId: string) => {
    window.location.href = `/payment/${orderId}`;
  }, []);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-8 relative">
        {/* 动态粒子网络背景 */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <ParticleNetwork 
            particleCount={30}
            connectionDistance={100}
            speed={0.12}
            particleColor="rgba(234, 179, 8, 0.5)"
            lineColor="rgba(234, 179, 8, 0.08)"
          />
        </div>
        
        {/* 渐变光晕装饰 */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-[1]">
          <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-yellow-500/5 rounded-full blur-[100px]" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[100px]" />
        </div>

        {/* 标题区域 */}
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-5 h-5 text-yellow-400" />
            <span className="text-sm text-yellow-400">USDT-TRC20</span>
          </div>
          <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
            积分充值
          </h1>
          <p className="text-slate-400 mt-2">
            使用USDT充值积分，1 USDT = {creditsPerUsdt} 积分
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative">
          {/* 左侧：充值表单 */}
          <div className="space-y-6">
            {/* 优惠活动横幅 */}
            <div className="bg-gradient-to-r from-orange-500/20 via-yellow-500/20 to-orange-500/20 border border-yellow-500/30 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-yellow-500/20 rounded-lg">
                  <Gift className="w-5 h-5 text-yellow-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-yellow-400">充值优惠活动</h3>
                  <p className="text-sm text-slate-300">充得越多，送得越多！</p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {BONUS_DISPLAY_TIERS.map((tier) => (
                  <div key={tier.label} className="bg-slate-900/50 rounded-lg p-2">
                    <p className="text-xs text-slate-400">{tier.label} USDT</p>
                    <p className="text-lg font-bold text-green-400">+{tier.percent}%</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-2 text-center">*最高可享15%赠送，详情请查看完整优惠规则</p>
            </div>

            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-yellow-500/10 rounded-lg">
                  <Coins className="w-5 h-5 text-yellow-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">充值积分</h2>
                  <p className="text-sm text-slate-400">当前余额：{profile?.credits?.toLocaleString() || 0} 积分</p>
                </div>
              </div>

              {/* 预设金额 - 显示对应USDT和赠送 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {PRESET_AMOUNTS.map((amount) => {
                  const usdt = amount / creditsPerUsdt;
                  const tier = bonusTiers.find((t: any) => usdt >= t.minUsdt) || { bonusPercent: 0 };
                  const bonus = Math.floor(amount * tier.bonusPercent / 100);
                  return (
                    <Button
                      key={amount}
                      variant={credits === amount ? "default" : "outline"}
                      className={`h-auto py-3 flex flex-col ${
                        credits === amount
                          ? "bg-gradient-to-r from-yellow-500 to-orange-500 text-black border-0"
                          : "border-slate-700 text-slate-300 hover:border-yellow-500/50"
                      }`}
                      onClick={() => setCredits(amount)}
                      disabled={isCreating}
                    >
                      <span className="font-bold">{usdt} USDT</span>
                      <span className="text-xs opacity-80">{amount.toLocaleString()} 积分</span>
                      {bonus > 0 && (
                        <span className={`text-xs mt-1 ${credits === amount ? 'text-black/70' : 'text-green-400'}`}>
                          +{bonus.toLocaleString()} 赠送
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>

              {/* 自定义USDT金额 */}
              <div className="space-y-2 mb-6">
                <Label className="text-slate-400">自定义充值金额（最低 50 USDT）</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={customUsdt}
                    placeholder="输入USDT金额"
                    onFocus={() => setCustomUsdt("")}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCustomUsdt(value);
                      const usdtValue = parseFloat(value) || 0;
                      if (usdtValue >= 50) {
                        setCredits(Math.floor(usdtValue * creditsPerUsdt));
                      }
                    }}
                    onBlur={() => {
                      const usdtValue = parseFloat(customUsdt) || 0;
                      if (usdtValue > 0 && usdtValue < 50) {
                        setCustomUsdt("50");
                        setCredits(50 * creditsPerUsdt);
                      }
                    }}
                    min={50}
                    step={10}
                    className="bg-slate-800/50 border-slate-700 text-white h-12 pr-16"
                    disabled={isCreating}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-yellow-400 font-medium">USDT</span>
                </div>
              </div>

              {/* 费用明细 */}
              <div className="bg-slate-800/30 rounded-xl p-4 space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">基础积分</span>
                  <span className="text-white font-medium">{credits.toLocaleString()}</span>
                </div>
                {bonusInfo.bonusCredits > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">赠送积分 <span className="text-green-400">({bonusInfo.bonusPercent}%)</span></span>
                    <span className="text-green-400 font-medium">+{bonusInfo.bonusCredits.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t border-slate-700 pt-3">
                  <span className="text-slate-400">实际获得</span>
                  <span className="text-yellow-400 font-bold text-lg">{bonusInfo.totalCredits.toLocaleString()} 积分</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">兑换比例</span>
                  <span className="text-white">1 USDT = {creditsPerUsdt} 积分</span>
                </div>
                <div className="border-t border-slate-700 pt-3 flex justify-between">
                  <span className="text-slate-400">应付金额</span>
                  <span className="text-2xl font-bold text-yellow-400">~{usdtAmount} <span className="text-sm">USDT</span></span>
                </div>
                <p className="text-xs text-slate-500">* 实际金额将包含唯一尾数以便自动识别</p>
              </div>

              {/* 创建订单按钮 */}
              <Button
                onClick={handleCreateOrder}
                disabled={isCreating || createOrderMutation.isPending || credits < minRechargeCredits}
                className="w-full h-14 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-black font-bold text-lg"
              >
                {isCreating || createOrderMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    创建中...
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5 mr-2" />
                    创建充值订单
                  </>
                )}
              </Button>
              
              {createError && (
                <p className="text-red-400 text-sm mt-2 text-center">{createError}</p>
              )}
            </div>
          </div>

          {/* 右侧：说明 */}
          <div className="space-y-6">
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
              <div className="flex items-center justify-center mb-6">
                <QrCode className="w-16 h-16 text-slate-600" />
              </div>
              <h3 className="text-lg font-semibold text-white text-center mb-2">创建订单开始充值</h3>
              <p className="text-slate-400 text-center text-sm mb-6">
                选择充值金额后点击"创建充值订单"
              </p>
              
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-slate-300">充值流程</h4>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-xs shrink-0">1</div>
                    <p className="text-sm text-slate-400">选择充值金额并创建订单</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-xs shrink-0">2</div>
                    <p className="text-sm text-slate-400">按照显示的精确金额转账USDT</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-xs shrink-0">3</div>
                    <p className="text-sm text-slate-400">系统自动检测到账并发放积分</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 充值记录 */}
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">充值记录</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefreshOrders}
              className="text-slate-400 hover:text-white"
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              刷新
            </Button>
          </div>

          {ordersLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 bg-slate-800/50" />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-8 text-center">
              <Wallet className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">暂无充值记录</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((order: any) => (
                <div
                  key={order.id}
                  className="bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:border-slate-700/50 transition-colors"
                  onClick={() => handleViewOrder(order.orderId)}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-yellow-500/10 rounded-lg">
                      <Coins className="w-5 h-5 text-yellow-400" />
                    </div>
                    <div>
                      <p className="text-white font-medium">{order.credits?.toLocaleString()} 积分</p>
                      <p className="text-sm text-slate-400">{order.amount} USDT</p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div>
                      {getStatusBadge(order.status)}
                      <p className="text-xs text-slate-500 mt-1">
                        {new Date(order.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewOrder(order.orderId);
                      }}
                      className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                    >
                      查看账单
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
