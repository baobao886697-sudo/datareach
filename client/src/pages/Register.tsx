import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Loader2, Target, Mail, Lock, User, Eye, EyeOff, ArrowRight, Gift, CheckCircle,
  Phone, Shield, Zap, Rocket, Star
} from "lucide-react";
import { ParticleNetwork } from "@/components/ParticleNetwork";

// 注册福利
const BENEFITS = [
  { icon: Gift, label: "注册即送", value: "100 积分", color: "text-green-400" },
  { icon: Rocket, label: "快速上手", value: "3 分钟入门", color: "text-blue-400" },
  { icon: Shield, label: "数据安全", value: "加密存储", color: "text-purple-400" },
  { icon: Star, label: "专业支持", value: "7×24 小时", color: "text-yellow-400" },
];

// 功能特点
const FEATURES = [
  { icon: Target, text: "精准定位 LinkedIn 决策层" },
  { icon: Phone, text: "双重验证确保联系方式可达" },
  { icon: Zap, text: "秒级响应，批量获取" },
];

export default function Register() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // 保持原有的注册逻辑不变
  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => {
      toast.success("注册成功！请登录");
      setLocation("/login");
    },
    onError: (error) => {
      toast.error(error.message || "注册失败");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast.error("两次输入的密码不一致");
      return;
    }

    if (password.length < 8) {
      toast.error("密码至少需要8位");
      return;
    }

    registerMutation.mutate({ email, password, name: name || undefined });
  };

  // 密码强度检测
  const getPasswordStrength = () => {
    if (!password) return { level: 0, text: "", color: "" };
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    
    if (strength <= 2) return { level: strength, text: "弱", color: "bg-red-500" };
    if (strength <= 3) return { level: strength, text: "中", color: "bg-yellow-500" };
    return { level: strength, text: "强", color: "bg-green-500" };
  };

  const passwordStrength = getPasswordStrength();

  return (
    <div className="min-h-screen flex bg-slate-950 relative overflow-hidden">
      {/* 动态粒子网络背景 */}
      <div className="absolute inset-0 z-0">
        <ParticleNetwork 
          particleCount={60}
          connectionDistance={120}
          speed={0.3}
          particleColor="rgba(168, 85, 247, 0.8)"
          lineColor="rgba(168, 85, 247, 0.15)"
        />
      </div>

      {/* 渐变光晕叠加 */}
      <div className="absolute inset-0 pointer-events-none z-[1]">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[150px]" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-pink-500/10 rounded-full blur-[150px]" />
        <div className="absolute top-1/2 right-1/4 translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-[120px]" />
      </div>

      {/* 左侧：福利展示区（大屏幕显示） */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-12 xl:px-20 relative z-10">
        {/* Logo 和标题 */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-400 to-pink-600 flex items-center justify-center shadow-xl shadow-purple-500/30">
              <Target className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                云端寻踪
              </h1>
              <span className="text-sm text-purple-400/60">PRO 2.0</span>
            </div>
          </div>
          <p className="text-xl text-slate-300 leading-relaxed">
            加入专业级商业情报平台
            <br />
            <span className="text-slate-400">开启高效获客之旅</span>
          </p>
        </div>

        {/* 注册福利 */}
        <div className="grid grid-cols-2 gap-4 mb-12">
          {BENEFITS.map((benefit, index) => (
            <div 
              key={index}
              className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/50 backdrop-blur-sm hover:border-purple-500/30 transition-all duration-300 group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center group-hover:from-purple-500/30 group-hover:to-pink-500/30 transition-all">
                  <benefit.icon className={`h-5 w-5 ${benefit.color}`} />
                </div>
                <div>
                  <p className="text-xs text-slate-500">{benefit.label}</p>
                  <p className="text-white font-medium">{benefit.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 功能特点 */}
        <div className="space-y-4 mb-12">
          <h3 className="text-lg font-medium text-white mb-4">为什么选择云端寻踪？</h3>
          {FEATURES.map((feature, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                <feature.icon className="h-4 w-4 text-purple-400" />
              </div>
              <span className="text-slate-300">{feature.text}</span>
            </div>
          ))}
        </div>

        {/* 用户评价 */}
        <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/50">
          <div className="flex items-center gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star key={star} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
            ))}
          </div>
          <p className="text-slate-300 text-sm italic">
            "云端寻踪帮助我们团队效率提升了 300%，再也不用手动搜索联系方式了！"
          </p>
          <p className="text-slate-500 text-xs mt-2">— 某科技公司销售总监</p>
        </div>
      </div>

      {/* 右侧：注册表单 */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-4 relative z-10">
        <div className="w-full max-w-md">
          {/* 移动端 Logo */}
          <div className="flex flex-col items-center mb-8 lg:hidden">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-400 to-pink-600 flex items-center justify-center shadow-xl shadow-purple-500/30 mb-4">
              <Target className="h-9 w-9 text-white" />
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent" style={{ fontFamily: 'Orbitron, sans-serif' }}>
              云端寻踪
            </h1>
            <span className="text-xs text-purple-400/60 mt-1">PRO 2.0</span>
          </div>

          {/* 注册卡片 */}
          <div className="p-8 rounded-2xl bg-slate-900/80 backdrop-blur-xl border border-purple-500/20 shadow-2xl shadow-purple-500/10">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 mb-4">
                <Gift className="w-3 h-3 text-green-400" />
                <span className="text-xs text-green-400">注册即送 100 积分</span>
              </div>
              <h2 className="text-2xl font-bold text-white">创建账户</h2>
              <p className="text-slate-400 mt-2">开始使用专业级商业情报平台</p>
            </div>

            {/* 注册表单（保持原有逻辑不变） */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-slate-300">姓名（可选）</Label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    id="name"
                    type="text"
                    placeholder="您的姓名"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-11 h-12 bg-slate-800/50 border-slate-700 focus:border-purple-500 text-white placeholder:text-slate-500 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">邮箱地址</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-11 h-12 bg-slate-800/50 border-slate-700 focus:border-purple-500 text-white placeholder:text-slate-500 rounded-xl"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300">密码</Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="至少8位"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-11 pr-11 h-12 bg-slate-800/50 border-slate-700 focus:border-purple-500 text-white placeholder:text-slate-500 rounded-xl"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {/* 密码强度指示器 */}
                {password && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${passwordStrength.color} transition-all duration-300`}
                        style={{ width: `${(passwordStrength.level / 5) * 100}%` }}
                      />
                    </div>
                    <span className={`text-xs ${passwordStrength.color.replace('bg-', 'text-')}`}>
                      {passwordStrength.text}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-slate-300">确认密码</Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="再次输入密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-11 h-12 bg-slate-800/50 border-slate-700 focus:border-purple-500 text-white placeholder:text-slate-500 rounded-xl"
                    required
                  />
                  {confirmPassword && password === confirmPassword && (
                    <CheckCircle className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-green-400" />
                  )}
                </div>
              </div>

              <Button
                type="submit"
                disabled={registerMutation.isPending}
                className="w-full h-12 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-medium shadow-lg shadow-purple-500/25 rounded-xl border-0 mt-2"
              >
                {registerMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    注册中...
                  </>
                ) : (
                  <>
                    创建账户
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-slate-800 text-center">
              <p className="text-slate-400">
                已有账户？{" "}
                <Link href="/login" className="text-purple-400 hover:text-purple-300 font-medium">
                  立即登录
                </Link>
              </p>
            </div>
          </div>

          {/* 移动端福利展示 */}
          <div className="mt-8 lg:hidden">
            <div className="flex justify-center gap-6 text-slate-500">
              {BENEFITS.slice(0, 3).map((benefit, index) => (
                <div key={index} className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-lg bg-slate-800/50 flex items-center justify-center mb-2">
                    <benefit.icon className={`h-5 w-5 ${benefit.color}`} />
                  </div>
                  <span className="text-xs">{benefit.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 底部链接 */}
          <div className="mt-8 text-center">
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-400">
              ← 返回首页
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
