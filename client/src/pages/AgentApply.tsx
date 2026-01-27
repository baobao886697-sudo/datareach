import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Crown, CheckCircle, Users, Wallet, TrendingUp, Shield } from "lucide-react";

export default function AgentApply() {
  const [, setLocation] = useLocation();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    wechat: "",
    company: "",
    experience: "",
    channels: "",
    expectedUsers: "",
    walletAddress: "",
  });

  const submitApplication = trpc.agent.submitApplication.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("申请已提交，我们会尽快审核您的申请");
    },
    onError: (error) => {
      toast.error(error.message || "提交失败");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.phone) {
      toast.error("请填写必填项：姓名、邮箱和手机号");
      return;
    }
    setIsSubmitting(true);
    try {
      await submitApplication.mutateAsync(formData);
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
              感谢您的申请！我们的团队会在 1-3 个工作日内审核您的资料。
              审核通过后，您将收到邮件通知。
            </p>
            <Button onClick={() => setLocation("/")} variant="outline">
              返回首页
            </Button>
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
                      <span className="text-yellow-500">创始代理</span>
                    </td>
                    <td className="text-center">15%</td>
                    <td className="text-center">5%</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="py-2">
                      <span className="text-amber-500">金牌代理</span>
                    </td>
                    <td className="text-center">12%</td>
                    <td className="text-center">4%</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="py-2">
                      <span className="text-slate-300">银牌代理</span>
                    </td>
                    <td className="text-center">10%</td>
                    <td className="text-center">3%</td>
                  </tr>
                  <tr>
                    <td className="py-2">
                      <span className="text-slate-400">普通代理</span>
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
              <CardTitle className="text-white">代理申请表</CardTitle>
              <CardDescription>
                请填写以下信息，我们会尽快审核您的申请
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-white">
                      姓名 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="您的真实姓名"
                      className="bg-slate-900/50 border-slate-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-white">
                      手机号 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="您的手机号码"
                      className="bg-slate-900/50 border-slate-600"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-white">
                    邮箱 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="用于接收审核通知"
                    className="bg-slate-900/50 border-slate-600"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="wechat" className="text-white">微信号</Label>
                    <Input
                      id="wechat"
                      value={formData.wechat}
                      onChange={(e) => setFormData({ ...formData, wechat: e.target.value })}
                      placeholder="方便联系"
                      className="bg-slate-900/50 border-slate-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company" className="text-white">公司/团队</Label>
                    <Input
                      id="company"
                      value={formData.company}
                      onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                      placeholder="所属公司或团队"
                      className="bg-slate-900/50 border-slate-600"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="experience" className="text-white">推广经验</Label>
                  <Textarea
                    id="experience"
                    value={formData.experience}
                    onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                    placeholder="请简述您的推广经验，如：社群运营、自媒体、销售团队等"
                    className="bg-slate-900/50 border-slate-600 min-h-[80px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="channels" className="text-white">推广渠道</Label>
                  <Textarea
                    id="channels"
                    value={formData.channels}
                    onChange={(e) => setFormData({ ...formData, channels: e.target.value })}
                    placeholder="您计划通过哪些渠道推广？如：微信群、公众号、抖音、线下等"
                    className="bg-slate-900/50 border-slate-600 min-h-[80px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expectedUsers" className="text-white">预期用户量</Label>
                  <Input
                    id="expectedUsers"
                    value={formData.expectedUsers}
                    onChange={(e) => setFormData({ ...formData, expectedUsers: e.target.value })}
                    placeholder="预计每月能带来多少新用户"
                    className="bg-slate-900/50 border-slate-600"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="walletAddress" className="text-white">
                    USDT 收款地址 (TRC20)
                  </Label>
                  <Input
                    id="walletAddress"
                    value={formData.walletAddress}
                    onChange={(e) => setFormData({ ...formData, walletAddress: e.target.value })}
                    placeholder="用于接收佣金，可稍后填写"
                    className="bg-slate-900/50 border-slate-600 font-mono text-sm"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600 text-black font-semibold"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "提交中..." : "提交申请"}
                </Button>

                <p className="text-xs text-slate-500 text-center">
                  提交申请即表示您同意我们的代理协议和隐私政策
                </p>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
