import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Crown, CheckCircle, Users, Wallet, TrendingUp, Shield, AlertCircle, Info } from "lucide-react";

export default function AgentApply() {
  const [, setLocation] = useLocation();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  
  const [formData, setFormData] = useState({
    email: "",
    walletAddress: "",
  });

  const submitApplication = trpc.agent.submitApplication.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("申请已提交，请等待管理员审核");
    },
    onError: (error) => {
      toast.error(error.message || "提交失败");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email) {
      toast.error("请填写您的用户端邮箱");
      return;
    }
    if (!formData.walletAddress) {
      toast.error("请填写您的USDT收款地址");
      return;
    }
    setIsSubmitting(true);
    try {
      await submitApplication.mutateAsync({
        name: "",
        email: formData.email,
        phone: "",
        walletAddress: formData.walletAddress,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-slate-800/50 border-slate-700">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">申请已提交</h2>
            <p className="text-slate-400 mb-6">
              感谢您的申请！管理员会尽快审核您的资料。
              审核通过后，您可以使用用户端账号登录代理后台。
            </p>
            <div className="space-y-3">
              <Button onClick={() => setLocation("/agent-portal/login")} className="w-full bg-gradient-to-r from-purple-500 to-pink-500">
                前往代理登录
              </Button>
              <Button onClick={() => setLocation("/")} variant="outline" className="w-full">
                返回首页
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown className="w-8 h-8 text-yellow-500" />
            <span className="text-xl font-bold text-white">DataReach 代理计划</span>
          </div>
          <Button variant="ghost" onClick={() => setLocation("/")}>
            返回首页
          </Button>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="grid lg:grid-cols-2 gap-12 items-start">
          {/* Left: Benefits */}
          <div className="space-y-8">
            <div>
              <h1 className="text-4xl font-bold text-white mb-4">
                成为 DataReach 代理
              </h1>
              <p className="text-xl text-slate-400">
                加入我们的代理计划，共享数据服务市场红利，获得丰厚佣金回报
              </p>
            </div>

            <div className="grid gap-6">
              <div className="flex gap-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="w-12 h-12 bg-yellow-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-6 h-6 text-yellow-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">高额佣金</h3>
                  <p className="text-slate-400 text-sm">
                    最高 15% 一级佣金 + 5% 二级佣金，创始代理享受最高比例
                  </p>
                </div>
              </div>

              <div className="flex gap-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Users className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">二级分销</h3>
                  <p className="text-slate-400 text-sm">
                    您邀请的用户再邀请新用户，您也能获得佣金，躺赚被动收入
                  </p>
                </div>
              </div>

              <div className="flex gap-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Wallet className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">USDT 结算</h3>
                  <p className="text-slate-400 text-sm">
                    佣金以 USDT 结算，7天自动解冻，随时提现到您的钱包
                  </p>
                </div>
              </div>

              <div className="flex gap-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Shield className="w-6 h-6 text-purple-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">专属后台</h3>
                  <p className="text-slate-400 text-sm">
                    独立的代理管理后台，实时查看团队数据、佣金明细、提现记录
                  </p>
                </div>
              </div>
            </div>

            {/* Commission Table */}
            <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-6">
              <h3 className="font-semibold text-white mb-4">代理等级与佣金</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left py-2">等级</th>
                    <th className="text-center py-2">一级佣金</th>
                    <th className="text-center py-2">二级佣金</th>
                  </tr>
                </thead>
                <tbody className="text-white">
                  <tr className="border-b border-slate-700/50">
                    <td className="py-2">
                      <span className="text-yellow-500">👑 创始代理</span>
                    </td>
                    <td className="text-center">15%</td>
                    <td className="text-center">5%</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="py-2">
                      <span className="text-amber-500">🥇 金牌代理</span>
                    </td>
                    <td className="text-center">12%</td>
                    <td className="text-center">4%</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="py-2">
                      <span className="text-slate-300">🥈 银牌代理</span>
                    </td>
                    <td className="text-center">10%</td>
                    <td className="text-center">3%</td>
                  </tr>
                  <tr>
                    <td className="py-2">
                      <span className="text-cyan-400">⭐ 普通代理</span>
                    </td>
                    <td className="text-center">8%</td>
                    <td className="text-center">2%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Application Form */}
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white text-2xl">代理申请</CardTitle>
              <CardDescription className="text-base">
                填写以下信息，提交后等待管理员审核
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* 重要提示 */}
              <Alert className="mb-6 bg-amber-500/10 border-amber-500/50">
                <Info className="h-4 w-4 text-amber-500" />
                <AlertDescription className="text-amber-200">
                  <strong>重要提示：</strong>请使用您在 DataReach 用户端注册的邮箱申请。
                  如果还没有账号，请先<a href="/" className="text-amber-400 underline hover:text-amber-300">注册用户端账号</a>。
                </AlertDescription>
              </Alert>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-white text-base">
                    用户端邮箱 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="请输入您在用户端注册的邮箱"
                    className="bg-slate-900/50 border-slate-600 h-12 text-base"
                  />
                  <p className="text-slate-500 text-sm">
                    审核通过后，您将使用此邮箱登录代理后台
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="walletAddress" className="text-white text-base">
                    USDT 收款地址 (TRC20) <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="walletAddress"
                    value={formData.walletAddress}
                    onChange={(e) => setFormData({ ...formData, walletAddress: e.target.value })}
                    placeholder="T..."
                    className="bg-slate-900/50 border-slate-600 h-12 text-base font-mono"
                  />
                  <p className="text-slate-500 text-sm">
                    用于接收佣金提现，请确保地址正确
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-12 text-lg bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                >
                  {isSubmitting ? "提交中..." : "提交申请"}
                </Button>

                <p className="text-center text-slate-500 text-sm">
                  提交后请耐心等待管理员审核
                </p>
              </form>

              {/* 已有代理账号 */}
              <div className="mt-8 pt-6 border-t border-slate-700 text-center">
                <p className="text-slate-400 mb-3">已是代理？</p>
                <Button 
                  variant="outline" 
                  onClick={() => setLocation("/agent-portal/login")}
                  className="w-full"
                >
                  登录代理后台
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
