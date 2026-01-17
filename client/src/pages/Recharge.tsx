import { useState } from "react";
import { useSearch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Coins, Copy, Clock, CheckCircle, XCircle, Loader2, QrCode, Wallet, Zap, ArrowRight, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const PRESET_AMOUNTS = [100, 500, 1000, 5000];

export default function Recharge() {
  const { user } = useAuth();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialAmount = params.get("amount");
  
  const [credits, setCredits] = useState(initialAmount ? Number(initialAmount) : 100);
  const [activeOrder, setActiveOrder] = useState<string | null>(null);

  const { data: profile } = trpc.user.profile.useQuery(undefined, { enabled: !!user });
  
  const { data: ordersData, isLoading: ordersLoading } = trpc.recharge.history.useQuery(
    { limit: 10 },
    { enabled: !!user }
  );

  const orders = ordersData?.orders || [];

  const createOrderMutation = trpc.recharge.create.useMutation({
    onSuccess: (data) => {
      toast.success("充值订单已创建");
      setActiveOrder(data.orderId);
    },
    onError: (error) => {
      toast.error(error.message || "创建订单失败");
    },
  });

  const { data: orderDetail } = trpc.recharge.status.useQuery(
    { orderId: activeOrder! },
    { 
      enabled: !!activeOrder,
      refetchInterval: 5000
    }
  );

  const usdtAmount = credits / 100;

  const handleCreateOrder = () => {
    if (credits < 100) {
      toast.error("最低充值100积分");
      return;
    }
    createOrderMutation.mutate({ credits, network: "TRC20" });
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    toast.success("地址已复制");
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
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">待支付</Badge>;
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
                  {usdtAmount} <span className="text-lg">USDT</span>
                </span>
              </div>
            </div>

            <Button
              size="lg"
              onClick={handleCreateOrder}
              disabled={createOrderMutation.isPending}
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
              <div className="flex items-center gap-3 mb-6">
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

              {orderDetail.status === "pending" ? (
                <>
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
                          onClick={() => copyAddress(orderDetail.walletAddress)}
                          className="shrink-0 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-slate-500 text-xs">支付金额</Label>
                      <p className="text-3xl font-bold text-cyan-400" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                        {Number(orderDetail.amount)} <span className="text-lg">USDT</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
                    <Clock className="h-4 w-4" />
                    <span>
                      订单将在 {new Date(orderDetail.expiresAt).toLocaleString()} 过期
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                    <div className="flex items-start gap-2">
                      <Sparkles className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
                      <p className="text-sm text-yellow-400">
                        请在过期前完成转账，系统将自动检测到账并充值积分
                      </p>
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
                    <span className="text-green-400 font-mono text-2xl">{orderDetail.credits}</span> 积分已到账
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
                </div>
              )}
            </div>
          )}
        </div>

        {/* 充值记录 */}
        <div className="relative p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
              <Clock className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">充值记录</h3>
              <p className="text-sm text-slate-400">最近的充值订单</p>
            </div>
          </div>

          {ordersLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : orders && orders.length > 0 ? (
            <div className="space-y-3">
              {orders.map((order: any) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-4 rounded-xl bg-slate-800/30 border border-slate-700/30 hover:border-slate-600/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      order.status === "paid" ? "bg-green-500/20" :
                      order.status === "expired" || order.status === "cancelled" ? "bg-red-500/20" :
                      "bg-yellow-500/20"
                    }`}>
                      {order.status === "paid" ? (
                        <CheckCircle className="h-6 w-6 text-green-400" />
                      ) : order.status === "expired" || order.status === "cancelled" ? (
                        <XCircle className="h-6 w-6 text-red-400" />
                      ) : (
                        <Clock className="h-6 w-6 text-yellow-400" />
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-white">
                        <span className="font-mono">{order.credits}</span> 积分
                      </p>
                      <p className="text-sm text-slate-500">
                        <span className="font-mono">{Number(order.amount)}</span> USDT · {order.network}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {getStatusBadge(order.status)}
                    <p className="text-xs text-slate-500 mt-1">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                <Wallet className="h-8 w-8 text-slate-600" />
              </div>
              <p className="text-slate-500">暂无充值记录</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
