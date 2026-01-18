import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Coins, Copy, Clock, CheckCircle, XCircle, Loader2, QrCode, Wallet, Zap, ArrowRight, Sparkles, AlertTriangle, RefreshCw } from "lucide-react";
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
  const params = new URLSearchParams(search);
  const initialAmount = params.get("amount");
  
  const [credits, setCredits] = useState(initialAmount ? Number(initialAmount) : 100);
  const [activeOrder, setActiveOrder] = useState<string | null>(null);

  const { data: profile, refetch: refetchProfile } = trpc.user.profile.useQuery(undefined, { enabled: !!user });
  
  const { data: ordersData, isLoading: ordersLoading, refetch: refetchOrders } = trpc.recharge.history.useQuery(
    { limit: 10 },
    { enabled: !!user }
  );

  const orders = ordersData?.orders || [];

  const createOrderMutation = trpc.recharge.create.useMutation({
    onSuccess: (data) => {
      toast.success("充值订单已创建");
      setActiveOrder(data.orderId);
      refetchOrders();
    },
    onError: (error) => {
      toast.error(error.message || "创建订单失败");
    },
  });

  const { data: orderDetail, refetch: refetchOrderDetail } = trpc.recharge.status.useQuery(
    { orderId: activeOrder! },
    { 
      enabled: !!activeOrder,
      refetchInterval: 5000 // 每5秒检查一次状态
    }
  );

  // 当订单状态变为paid时，刷新用户积分
  useEffect(() => {
    if (orderDetail?.status === "paid") {
      refetchProfile();
      toast.success("充值成功！积分已到账");
    }
  }, [orderDetail?.status, refetchProfile]);

  const countdown = useCountdown(orderDetail?.expiresAt ? new Date(orderDetail.expiresAt) : null);

  const usdtAmount = credits / 100;

  const handleCreateOrder = () => {
    if (credits < 100) {
      toast.error("最低充值100积分");
      return;
    }
    createOrderMutation.mutate({ credits, network: "TRC20" });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label}已复制`);
  };

  const getStatusBadge = (status: string) => {
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
  };

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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative">
          {/* 充值表单 */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-yellow-500/20">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex items-center justify-center">
                <Coins className="h-6 w-6 text-yellow-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">充值积分</h3>
                <p className="text-sm text-slate-400">
                  当前余额：<span className="text-yellow-400 font-mono">{profile?.credits?.toLocaleString() || 0}</span> 积分
                </p>
              </div>
            </div>

            {/* 预设金额 */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              {PRESET_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  variant={credits === amount ? "default" : "outline"}
                  onClick={() => setCredits(amount)}
                  className={credits === amount 
                    ? "bg-gradient-to-r from-yellow-500 to-orange-500 text-black border-0 font-semibold" 
                    : "border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-yellow-500/50"
                  }
                >
                  <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{amount}</span>
                </Button>
              ))}
            </div>

            {/* 自定义金额 */}
            <div className="space-y-2 mb-6">
              <Label className="text-slate-300">自定义积分数量</Label>
              <Input
                type="number"
                min={100}
                step={100}
                value={credits}
                onChange={(e) => setCredits(Math.max(100, Number(e.target.value)))}
                className="h-12 bg-slate-800/50 border-slate-700 focus:border-yellow-500 text-white rounded-xl"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              />
            </div>

            {/* 费用计算 */}
            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 space-y-3 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">积分数量</span>
                <span className="text-white font-mono">{credits.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">兑换比例</span>
                <span className="text-slate-300">1 USDT = 100 积分</span>
              </div>
              <div className="border-t border-slate-700 my-2" />
              <div className="flex justify-between items-center">
                <span className="text-white font-medium">应付金额</span>
                <span className="text-3xl font-bold text-yellow-400" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                  ~{usdtAmount} <span className="text-lg">USDT</span>
                </span>
              </div>
              <p className="text-xs text-slate-500">* 实际金额将包含唯一尾数以便自动识别</p>
            </div>

            <Button
              size="lg"
              onClick={handleCreateOrder}
              disabled={createOrderMutation.isPending || !!(activeOrder && orderDetail?.status === "pending")}
              className="w-full h-14 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-black font-bold shadow-lg shadow-yellow-500/25 rounded-xl border-0 text-lg"
            >
              {createOrderMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  创建订单中...
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-5 w-5" />
                  创建充值订单
                </>
              )}
            </Button>
          </div>

          {/* 支付信息 */}
          {activeOrder && orderDetail && (
            <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-cyan-500/30">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                    <QrCode className="h-6 w-6 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">支付信息</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500 font-mono">{orderDetail.orderId}</span>
                      {getStatusBadge(orderDetail.status)}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refetchOrderDetail()}
                  className="text-slate-400 hover:text-white"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              {orderDetail.status === "pending" ? (
                <>
                  {/* 倒计时 */}
                  {countdown && (
                    <div className="p-4 rounded-xl bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/20 mb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="h-5 w-5 text-red-400" />
                          <span className="text-sm text-red-400">订单即将过期</span>
                        </div>
                        <div className="text-2xl font-bold text-red-400" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                          {String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 space-y-4 mb-4">
                    <div>
                      <Label className="text-slate-500 text-xs">网络</Label>
                      <p className="text-white font-medium flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        {orderDetail.network}
                      </p>
                    </div>
                    <div>
                      <Label className="text-slate-500 text-xs">收款地址</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="flex-1 text-sm bg-slate-900/50 p-3 rounded-lg text-cyan-400 break-all font-mono border border-slate-700">
                          {orderDetail.walletAddress}
                        </code>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => copyToClipboard(orderDetail.walletAddress, "地址")}
                          className="shrink-0 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-slate-500 text-xs flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-yellow-400" />
                        精确支付金额（含唯一尾数）
                      </Label>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-4xl font-bold text-cyan-400" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                          {Number(orderDetail.amount).toFixed(2)} <span className="text-xl">USDT</span>
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(Number(orderDetail.amount).toFixed(2), "金额")}
                          className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          复制
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                      <div className="flex items-start gap-2">
                        <Sparkles className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
                        <div className="text-sm text-yellow-400">
                          <p className="font-medium mb-1">重要提示</p>
                          <ul className="list-disc list-inside space-y-1 text-yellow-400/80">
                            <li>请务必转账 <strong>{Number(orderDetail.amount).toFixed(2)}</strong> USDT（含尾数）</li>
                            <li>金额不符将导致自动到账失败</li>
                            <li>系统每30秒自动检测到账</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : orderDetail.status === "paid" ? (
                <div className="text-center py-12">
                  <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="h-10 w-10 text-green-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white">充值成功</h3>
                  <p className="text-slate-400 mt-2">
                    {orderDetail.credits?.toLocaleString()} 积分已到账
                  </p>
                  <Button
                    variant="outline"
                    className="mt-6 border-green-500/30 text-green-400 hover:bg-green-500/10"
                    onClick={() => setActiveOrder(null)}
                  >
                    创建新订单
                  </Button>
                </div>
              ) : orderDetail.status === "mismatch" ? (
                <div className="text-center py-12">
                  <div className="w-20 h-20 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="h-10 w-10 text-orange-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white">金额不匹配</h3>
                  <p className="text-slate-400 mt-2">
                    检测到转账金额与订单金额不符，请联系客服处理
                  </p>
                  <p className="text-sm text-slate-500 mt-1">
                    订单金额: {orderDetail.amount} USDT | 实际收到: {orderDetail.receivedAmount || "未知"} USDT
                  </p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                    <XCircle className="h-10 w-10 text-red-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white">订单已过期</h3>
                  <p className="text-slate-400 mt-2">
                    请创建新的充值订单
                  </p>
                  <Button
                    variant="outline"
                    className="mt-6 border-slate-700 text-slate-300 hover:bg-slate-800"
                    onClick={() => setActiveOrder(null)}
                  >
                    创建新订单
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* 无活跃订单时显示说明 */}
          {!activeOrder && (
            <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
              <div className="text-center py-12">
                <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                  <Wallet className="h-10 w-10 text-slate-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-400">创建订单开始充值</h3>
                <p className="text-slate-500 mt-2 text-sm">
                  选择充值金额后点击"创建充值订单"
                </p>
                <div className="mt-6 p-4 rounded-xl bg-slate-800/30 border border-slate-700/30 text-left">
                  <h4 className="text-sm font-medium text-slate-300 mb-3">充值流程</h4>
                  <ol className="space-y-2 text-sm text-slate-400">
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs shrink-0">1</span>
                      <span>选择充值金额并创建订单</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs shrink-0">2</span>
                      <span>按照显示的精确金额转账USDT</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs shrink-0">3</span>
                      <span>系统自动检测到账并发放积分</span>
                    </li>
                  </ol>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 充值记录 */}
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">充值记录</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchOrders()}
              className="text-slate-400 hover:text-white"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              刷新
            </Button>
          </div>
          
          <div className="rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 overflow-hidden">
            {ordersLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : orders.length > 0 ? (
              <div className="divide-y divide-slate-800">
                {orders.map((order: any) => (
                  <div
                    key={order.id}
                    className="p-4 hover:bg-slate-800/30 transition-colors cursor-pointer"
                    onClick={() => setActiveOrder(order.orderId)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          order.status === "paid" ? "bg-green-500/20" :
                          order.status === "pending" ? "bg-yellow-500/20" :
                          "bg-slate-800"
                        }`}>
                          {order.status === "paid" ? (
                            <CheckCircle className="h-5 w-5 text-green-400" />
                          ) : order.status === "pending" ? (
                            <Clock className="h-5 w-5 text-yellow-400" />
                          ) : (
                            <XCircle className="h-5 w-5 text-slate-500" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-medium">
                              {order.credits?.toLocaleString()} 积分
                            </span>
                            {getStatusBadge(order.status)}
                          </div>
                          <p className="text-sm text-slate-500 mt-0.5">
                            {new Date(order.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-mono text-cyan-400">
                          {Number(order.amount).toFixed(2)} USDT
                        </p>
                        <p className="text-xs text-slate-500">{order.network}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Coins className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-500">暂无充值记录</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
