import { useState, useEffect, useCallback, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Coins, Copy, Clock, CheckCircle, XCircle, Loader2, QrCode, Wallet, Zap, AlertTriangle, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const PRESET_AMOUNTS = [100, 500, 1000, 5000];

// 倒计时Hook
function useCountdown(targetDate: Date | null) {
  const [timeLeft, setTimeLeft] = useState<{ minutes: number; seconds: number } | null>(null);

  useEffect(() => {
    if (!targetDate) {
      setTimeLeft(null);
      return;
    }

    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const target = new Date(targetDate).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft(null);
        return;
      }

      setTimeLeft({
        minutes: Math.floor((diff / 1000 / 60) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, [targetDate]);

  return timeLeft;
}

export default function Recharge() {
  const { user } = useAuth();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const initialAmount = params.get("amount");
  
  const [credits, setCredits] = useState(initialAmount ? Number(initialAmount) : 100);
  const [activeOrder, setActiveOrder] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  
  // 使用ref来追踪是否已经显示过成功提示，避免重复触发
  const paidToastShownRef = useRef<Set<string>>(new Set());
  // 使用ref来追踪组件是否已挂载
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { data: profile, refetch: refetchProfile } = trpc.user.profile.useQuery(undefined, { 
    enabled: !!user,
    refetchOnWindowFocus: false,
  });
  
  const { data: ordersData, isLoading: ordersLoading, refetch: refetchOrders } = trpc.recharge.history.useQuery(
    { limit: 10 },
    { 
      enabled: !!user,
      refetchOnWindowFocus: false,
    }
  );

  const orders = ordersData?.orders || [];

  // 创建订单mutation - 不使用onSuccess/onError回调，避免在渲染过程中触发状态更新
  const createOrderMutation = trpc.recharge.create.useMutation();

  // 使用单独的状态来控制订单查询
  const orderQueryEnabled = Boolean(activeOrder && activeOrder.length > 0);
  
  const { data: orderDetail } = trpc.recharge.status.useQuery(
    { orderId: activeOrder || "" },
    { 
      enabled: orderQueryEnabled,
      refetchInterval: orderQueryEnabled ? 5000 : false,
      refetchOnWindowFocus: false,
    }
  );

  // 当订单状态变为paid时，刷新用户积分
  useEffect(() => {
    if (!orderDetail || !activeOrder) return;
    if (orderDetail.status !== "paid") return;
    if (paidToastShownRef.current.has(activeOrder)) return;
    
    paidToastShownRef.current.add(activeOrder);
    
    // 使用setTimeout延迟执行，避免在渲染过程中触发状态更新
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        refetchProfile();
        toast.success("充值成功！积分已到账");
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [orderDetail?.status, activeOrder, refetchProfile]);

  const countdown = useCountdown(orderDetail?.expiresAt ? new Date(orderDetail.expiresAt) : null);

  const usdtAmount = credits / 100;

  const handleCreateOrder = useCallback(async () => {
    if (credits < 100) {
      toast.error("最低充值100积分");
      return;
    }
    
    if (createOrderMutation.isPending) return;
    
    setCreateError(null);
    
    try {
      const result = await createOrderMutation.mutateAsync({ credits, network: "TRC20" });
      
      if (!isMountedRef.current) return;
      
      // 使用setTimeout延迟状态更新，避免在mutation回调中直接触发
      setTimeout(() => {
        if (isMountedRef.current) {
          toast.success("充值订单已创建");
          setActiveOrder(result.orderId);
          refetchOrders();
        }
      }, 50);
    } catch (error: any) {
      if (!isMountedRef.current) return;
      
      // 使用setTimeout延迟错误处理
      setTimeout(() => {
        if (!isMountedRef.current) return;
        
        const errorMessage = error?.message || "创建订单失败";
        setCreateError(errorMessage);
        
        // 检查是否是认证错误
        if (errorMessage.includes("login") || errorMessage.includes("10001") || errorMessage.includes("unauthorized")) {
          toast.error("登录已过期，请重新登录");
          setTimeout(() => {
            if (isMountedRef.current) {
              setLocation("/login");
            }
          }, 1000);
        } else {
          toast.error(errorMessage);
        }
      }, 50);
    }
  }, [credits, createOrderMutation, refetchOrders, setLocation]);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label}已复制`);
  }, []);

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

  const handleClearActiveOrder = useCallback(() => {
    setActiveOrder(null);
  }, []);

  const handleSelectOrder = useCallback((orderId: string) => {
    setActiveOrder(orderId);
  }, []);

  const handleRefreshOrders = useCallback(() => {
    refetchOrders();
  }, [refetchOrders]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-8 relative">
        {/* 背景装饰 */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
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
            使用USDT充值积分，1 USDT = 100 积分
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative">
          {/* 左侧：充值表单 */}
          <div className="space-y-6">
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-yellow-500/10 rounded-lg">
                  <Coins className="w-5 h-5 text-yellow-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">充值积分</h2>
                  <p className="text-sm text-slate-400">当前余额：{profile?.credits || 0} 积分</p>
                </div>
              </div>

              {/* 预设金额 */}
              <div className="grid grid-cols-4 gap-3 mb-6">
                {PRESET_AMOUNTS.map((amount) => (
                  <Button
                    key={amount}
                    variant={credits === amount ? "default" : "outline"}
                    className={`h-12 ${
                      credits === amount
                        ? "bg-gradient-to-r from-yellow-500 to-orange-500 text-black border-0"
                        : "border-slate-700 text-slate-300 hover:border-yellow-500/50"
                    }`}
                    onClick={() => setCredits(amount)}
                  >
                    {amount}
                  </Button>
                ))}
              </div>

              {/* 自定义金额 */}
              <div className="space-y-2 mb-6">
                <Label className="text-slate-400">自定义积分数量</Label>
                <Input
                  type="number"
                  value={credits}
                  onChange={(e) => setCredits(Math.max(100, parseInt(e.target.value) || 100))}
                  min={100}
                  step={100}
                  className="bg-slate-800/50 border-slate-700 text-white h-12"
                />
              </div>

              {/* 费用明细 */}
              <div className="bg-slate-800/30 rounded-xl p-4 space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">积分数量</span>
                  <span className="text-white font-medium">{credits}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">兑换比例</span>
                  <span className="text-white">1 USDT = 100 积分</span>
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
                disabled={createOrderMutation.isPending || credits < 100}
                className="w-full h-14 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-black font-bold text-lg"
              >
                {createOrderMutation.isPending ? (
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

          {/* 右侧：订单详情或说明 */}
          <div className="space-y-6">
            {activeOrder && orderDetail ? (
              <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-white">订单详情</h2>
                  {getStatusBadge(orderDetail.status)}
                </div>

                {orderDetail.status === "pending" && (
                  <>
                    {/* 倒计时 */}
                    {countdown && (
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-6">
                        <div className="flex items-center gap-2 text-yellow-400 mb-2">
                          <Clock className="w-4 h-4" />
                          <span className="text-sm">订单有效时间</span>
                        </div>
                        <div className="text-3xl font-bold text-white font-mono">
                          {String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                        </div>
                      </div>
                    )}

                    {/* 支付金额 - 突出显示 */}
                    <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 rounded-xl p-6 mb-6">
                      <div className="text-center">
                        <p className="text-slate-400 text-sm mb-2">请精确转账以下金额</p>
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-4xl font-bold text-yellow-400 font-mono">{orderDetail.usdtAmount}</span>
                          <span className="text-xl text-yellow-400">USDT</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">* 金额包含唯一尾数，请勿修改</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-4 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                        onClick={() => copyToClipboard(orderDetail.usdtAmount, "支付金额")}
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        复制金额
                      </Button>
                    </div>

                    {/* 钱包地址 */}
                    <div className="bg-slate-800/30 rounded-xl p-4 mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-slate-400 text-sm">收款地址 ({orderDetail.network})</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-cyan-400 hover:text-cyan-300"
                          onClick={() => copyToClipboard(orderDetail.walletAddress, "钱包地址")}
                        >
                          <Copy className="w-4 h-4 mr-1" />
                          复制
                        </Button>
                      </div>
                      <p className="text-white font-mono text-sm break-all">{orderDetail.walletAddress}</p>
                    </div>

                    {/* 注意事项 */}
                    <div className="bg-slate-800/30 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-orange-400 mb-3">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-sm font-medium">注意事项</span>
                      </div>
                      <ul className="text-xs text-slate-400 space-y-2">
                        <li>• 请使用 TRC20 网络转账 USDT</li>
                        <li>• 请确保转账金额与显示金额完全一致</li>
                        <li>• 转账后系统将自动检测并发放积分</li>
                        <li>• 订单过期后请重新创建</li>
                      </ul>
                    </div>
                  </>
                )}

                {orderDetail.status === "paid" && (
                  <div className="text-center py-8">
                    <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-white mb-2">充值成功！</h3>
                    <p className="text-slate-400">已到账 {orderDetail.credits} 积分</p>
                    <Button
                      variant="outline"
                      className="mt-6"
                      onClick={handleClearActiveOrder}
                    >
                      创建新订单
                    </Button>
                  </div>
                )}

                {(orderDetail.status === "expired" || orderDetail.status === "cancelled") && (
                  <div className="text-center py-8">
                    <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-white mb-2">
                      {orderDetail.status === "expired" ? "订单已过期" : "订单已取消"}
                    </h3>
                    <p className="text-slate-400">请重新创建充值订单</p>
                    <Button
                      variant="outline"
                      className="mt-6"
                      onClick={handleClearActiveOrder}
                    >
                      创建新订单
                    </Button>
                  </div>
                )}
              </div>
            ) : (
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
            )}
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
                  onClick={() => handleSelectOrder(order.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-yellow-500/10 rounded-lg">
                      <Coins className="w-5 h-5 text-yellow-400" />
                    </div>
                    <div>
                      <p className="text-white font-medium">{order.credits} 积分</p>
                      <p className="text-sm text-slate-400">{order.usdtAmount} USDT</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {getStatusBadge(order.status)}
                    <p className="text-xs text-slate-500 mt-1">
                      {new Date(order.createdAt).toLocaleString()}
                    </p>
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
