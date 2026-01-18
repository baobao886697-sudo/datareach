import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Copy, Download, ArrowLeft, Clock, CheckCircle, XCircle, 
  Loader2, QrCode, Wallet, AlertTriangle, RefreshCw
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toPng } from "html-to-image";
import QRCode from "qrcode";

export default function PaymentDetail() {
  const { user } = useAuth();
  const { orderId } = useParams<{ orderId: string }>();
  const [, setLocation] = useLocation();
  const invoiceRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [countdown, setCountdown] = useState<{ minutes: number; seconds: number } | null>(null);

  // 获取订单详情
  const { data: orderDetail, isLoading } = trpc.recharge.status.useQuery(
    { orderId: orderId || "" },
    { 
      enabled: !!orderId && !!user,
    }
  );

  // 倒计时
  useEffect(() => {
    if (!orderDetail?.expiresAt) {
      setCountdown(null);
      return;
    }

    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const target = new Date(orderDetail.expiresAt).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setCountdown(null);
        return;
      }

      setCountdown({
        minutes: Math.floor((diff / 1000 / 60) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(timer);
  }, [orderDetail?.expiresAt]);

  // 生成二维码
  useEffect(() => {
    if (orderDetail?.walletAddress) {
      QRCode.toDataURL(orderDetail.walletAddress, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      }).then(setQrCodeUrl).catch(console.error);
    }
  }, [orderDetail?.walletAddress]);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label}已复制`);
  }, []);

  // 导出账单为图片
  const handleExportImage = useCallback(async () => {
    if (!invoiceRef.current) return;
    setIsExporting(true);
    try {
      const dataUrl = await toPng(invoiceRef.current, {
        quality: 1,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });
      const link = document.createElement('a');
      link.download = `云端寻踪-账单-${orderId}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("账单图片已下载");
    } catch (error) {
      console.error('导出失败:', error);
      toast.error("导出失败，请重试");
    } finally {
      setIsExporting(false);
    }
  }, [orderId]);

  // 复制账单文本
  const handleCopyText = useCallback(() => {
    if (!orderDetail) return;
    const date = new Date(orderDetail.createdAt).toLocaleDateString("zh-CN");
    const statusText = orderDetail.status === "paid" ? "已付款" : 
                       orderDetail.status === "pending" ? "待付款" : 
                       orderDetail.status === "expired" ? "已过期" : "已取消";
    
    const text = `云端寻踪搜索助手 - 支付账单
订单编号: ${orderId}
订单日期: ${date}
订单状态: ${statusText}
积分数量: ${orderDetail.credits}
支付金额: $${orderDetail.amount} USDT
支付网络: ${orderDetail.network}
收款地址: ${orderDetail.walletAddress}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("账单文本已复制");
    setTimeout(() => setCopied(false), 2000);
  }, [orderDetail, orderId]);

  // 加载中状态
  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid lg:grid-cols-2 gap-6">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // 订单不存在
  if (!orderDetail) {
    return (
      <DashboardLayout>
        <div className="p-6 text-center">
          <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">订单不存在</h2>
          <p className="text-slate-400 mb-4">找不到该订单信息</p>
          <Button onClick={() => setLocation("/recharge")}>返回充值页面</Button>
        </div>
      </DashboardLayout>
    );
  }

  const date = new Date(orderDetail.createdAt).toLocaleDateString("zh-CN");
  const isPending = orderDetail.status === "pending";
  const isPaid = orderDetail.status === "paid";
  const isExpiredOrCancelled = orderDetail.status === "expired" || orderDetail.status === "cancelled";

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/recharge")} className="text-slate-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-white">订单详情</h1>
              <p className="text-slate-400 text-sm">订单号: {orderId}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isPending && (
              <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-full border border-amber-500/30">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>正在检测到账...</span>
              </div>
            )}
            <Badge className={
              isPaid ? "bg-green-500/20 text-green-400 border-green-500/30" :
              isPending ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
              "bg-red-500/20 text-red-400 border-red-500/30"
            }>
              {isPaid ? "已确认" : isPending ? "待支付" : orderDetail.status === "expired" ? "已过期" : "已取消"}
            </Badge>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* 左侧：支付信息 */}
          <div className="space-y-6">
            {isPending && (
              <>
                {/* 倒计时 */}
                {countdown && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-6">
                    <div className="flex items-center gap-2 text-yellow-400 mb-3">
                      <Clock className="w-5 h-5" />
                      <span className="font-medium">订单有效时间</span>
                    </div>
                    <div className="text-4xl font-bold text-white font-mono">
                      {String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                    </div>
                    <p className="text-sm text-slate-400 mt-2">请在倒计时结束前完成支付</p>
                  </div>
                )}

                {/* 支付金额 */}
                <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 rounded-2xl p-6">
                  <div className="text-center">
                    <p className="text-slate-400 text-sm mb-2">请精确转账以下金额</p>
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-5xl font-bold text-yellow-400 font-mono">{orderDetail.amount}</span>
                      <span className="text-2xl text-yellow-400">USDT</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-3">* 金额包含唯一尾数，请勿修改</p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full mt-4 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                    onClick={() => copyToClipboard(orderDetail.amount, "支付金额")}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    复制金额
                  </Button>
                </div>

                {/* 二维码和地址 */}
                <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6">
                  <div className="flex flex-col items-center mb-6">
                    {qrCodeUrl ? (
                      <div className="p-4 bg-white rounded-xl">
                        <img src={qrCodeUrl} alt="收款地址二维码" className="w-48 h-48" />
                      </div>
                    ) : (
                      <div className="w-48 h-48 bg-slate-800 rounded-xl flex items-center justify-center">
                        <QrCode className="w-12 h-12 text-slate-600" />
                      </div>
                    )}
                    <p className="text-sm text-slate-400 mt-3">扫码获取收款地址</p>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-sm">收款地址 ({orderDetail.network})</span>
                      <Button variant="ghost" size="sm" className="h-8 text-cyan-400 hover:text-cyan-300"
                        onClick={() => copyToClipboard(orderDetail.walletAddress, "钱包地址")}>
                        <Copy className="w-4 h-4 mr-1" />复制
                      </Button>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3">
                      <p className="text-white font-mono text-sm break-all">{orderDetail.walletAddress}</p>
                    </div>
                  </div>
                </div>

                {/* 注意事项 */}
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-slate-400">
                      <p className="font-medium text-amber-400 mb-2">重要提示</p>
                      <ul className="space-y-1 list-disc list-inside">
                        <li>请确保转账金额与显示金额完全一致</li>
                        <li>仅支持 {orderDetail.network} 网络转账</li>
                        <li>转账完成后系统将自动检测到账</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </>
            )}

            {isPaid && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-6 text-center">
                <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">支付成功</h3>
                <p className="text-slate-400 mb-2">已到账 {orderDetail.credits.toLocaleString()} 积分</p>
                {orderDetail.txId && (
                  <p className="text-xs text-slate-500">交易哈希: {orderDetail.txId.slice(0, 16)}...</p>
                )}
              </div>
            )}

            {isExpiredOrCancelled && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center">
                <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">
                  {orderDetail.status === "expired" ? "订单已过期" : "订单已取消"}
                </h3>
                <p className="text-slate-400 mb-4">请重新创建充值订单</p>
                <Button onClick={() => setLocation("/recharge")}>创建新订单</Button>
              </div>
            )}
          </div>

          {/* 右侧：账单预览 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">账单预览</h3>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleExportImage} disabled={isExporting}
                  className="border-slate-700 text-slate-300 hover:bg-slate-800">
                  {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                  导出图片
                </Button>
                <Button variant="outline" size="sm" onClick={handleCopyText}
                  className="border-slate-700 text-slate-300 hover:bg-slate-800">
                  <Copy className="w-4 h-4 mr-2" />
                  {copied ? "已复制" : "复制文本"}
                </Button>
              </div>
            </div>

            {/* 账单卡片 */}
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-2xl p-6 overflow-hidden">
              <div ref={invoiceRef} style={{ 
                width: "380px", minWidth: "380px", margin: "0 auto",
                fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
                backgroundColor: "#ffffff", borderRadius: "12px", overflow: "hidden",
                boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)"
              }}>
                {/* Header */}
                <div style={{ 
                  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                  padding: "24px 20px", textAlign: "center", color: "#ffffff"
                }}>
                  <h2 style={{ fontSize: "20px", fontWeight: "600", margin: "0 0 6px 0", letterSpacing: "1px" }}>
                    云端寻踪搜索助手
                  </h2>
                  <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.8)", margin: 0, letterSpacing: "2px" }}>
                    PAYMENT INVOICE
                  </p>
                </div>

                {/* Content */}
                <div style={{ padding: "16px", backgroundColor: "#ffffff" }}>
                  {/* Order Info */}
                  <div style={{ 
                    display: "flex", justifyContent: "space-between", marginBottom: "14px",
                    padding: "12px", background: "#f8fafc", borderRadius: "6px"
                  }}>
                    <div>
                      <p style={{ color: "#94a3b8", marginBottom: "4px", fontSize: "12px" }}>订单编号</p>
                      <p style={{ fontWeight: "600", color: "#1e293b", fontSize: "13px" }}>{orderId}</p>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <p style={{ color: "#94a3b8", marginBottom: "4px", fontSize: "12px" }}>订单日期</p>
                      <p style={{ fontWeight: "600", color: "#1e293b", fontSize: "13px" }}>{date}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ color: "#94a3b8", marginBottom: "4px", fontSize: "12px" }}>订单状态</p>
                      <p style={{ 
                        fontWeight: "600", fontSize: "13px", display: "inline-flex", alignItems: "center",
                        padding: "2px 8px", borderRadius: "4px",
                        background: isPaid ? "#dcfce7" : isPending ? "#fef3c7" : "#fee2e2",
                        color: isPaid ? "#166534" : isPending ? "#92400e" : "#991b1b"
                      }}>
                        {isPaid ? "✓ 已付款" : isPending ? "○ 待付款" : "× 已取消"}
                      </p>
                    </div>
                  </div>

                  {/* Items */}
                  <div style={{ marginBottom: "14px" }}>
                    <p style={{ fontWeight: "600", marginBottom: "8px", fontSize: "13px", color: "#1e293b" }}>
                      购买明细
                    </p>
                    <div style={{ 
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "12px", background: "#f8fafc", borderRadius: "6px"
                    }}>
                      <div>
                        <p style={{ fontWeight: "500", color: "#1e293b", fontSize: "14px" }}>
                          {orderDetail.credits >= 10000 ? `${orderDetail.credits / 10000}万` : orderDetail.credits.toLocaleString()} 积分套餐
                        </p>
                        <p style={{ color: "#94a3b8", fontSize: "12px" }}>{orderDetail.credits.toLocaleString()} 积分</p>
                      </div>
                      <p style={{ fontWeight: "600", color: "#667eea", fontSize: "16px" }}>${orderDetail.amount}</p>
                    </div>
                  </div>

                  {/* Payment Info */}
                  <div style={{ marginBottom: "14px" }}>
                    <p style={{ fontWeight: "600", marginBottom: "8px", fontSize: "13px", color: "#1e293b" }}>
                      支付信息
                    </p>
                    <div style={{ padding: "12px", background: "#f8fafc", borderRadius: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                        <span style={{ color: "#94a3b8", fontSize: "12px" }}>支付网络</span>
                        <span style={{ color: "#1e293b", fontSize: "12px", fontWeight: "500" }}>{orderDetail.network}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#94a3b8", fontSize: "12px" }}>支付金额</span>
                        <span style={{ color: "#667eea", fontSize: "14px", fontWeight: "600" }}>${orderDetail.amount} USDT</span>
                      </div>
                    </div>
                  </div>

                  {/* Wallet Address */}
                  <div style={{ marginBottom: "14px" }}>
                    <p style={{ fontWeight: "600", marginBottom: "8px", fontSize: "13px", color: "#1e293b" }}>
                      收款地址
                    </p>
                    <div style={{ 
                      padding: "10px", background: "#f8fafc", borderRadius: "6px",
                      wordBreak: "break-all", fontSize: "11px", color: "#64748b", fontFamily: "monospace"
                    }}>
                      {orderDetail.walletAddress}
                    </div>
                  </div>

                  {/* Total */}
                  <div style={{ 
                    borderTop: "2px dashed #e2e8f0", paddingTop: "14px",
                    display: "flex", justifyContent: "space-between", alignItems: "center"
                  }}>
                    <span style={{ color: "#64748b", fontSize: "14px" }}>应付总额</span>
                    <span style={{ fontSize: "24px", fontWeight: "700", color: "#667eea" }}>
                      ${orderDetail.amount} USDT
                    </span>
                  </div>
                </div>

                {/* Footer */}
                <div style={{ background: "#f8fafc", padding: "12px 20px", textAlign: "center", borderTop: "1px solid #e2e8f0" }}>
                  <p style={{ color: "#94a3b8", fontSize: "11px", margin: 0 }}>
                    感谢您的支持！如有问题请联系客服
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
