import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Loader2, Mail, Lock, User, Eye, EyeOff, ArrowRight, Gift, CheckCircle,
  Shield, Zap, Star, Network, Database, Globe, Layers, Award, TrendingUp, UserPlus
} from "lucide-react";
import { ParticleNetwork } from "@/components/ParticleNetwork";

// 注册福利
const BENEFITS = [
  { icon: Gift, label: "注册即送", value: "100 积分", color: "text-green-400" },
  { icon: Database, label: "海量数据", value: "10亿+记录", color: "text-cyan-400" },
  { icon: Globe, label: "全球覆盖", value: "195+国家", color: "text-blue-400" },
  { icon: Shield, label: "数据安全", value: "加密存储", color: "text-purple-400" },
];

// 功能特点
const FEATURES = [
  { icon: Layers, text: "多平台数据整合，一站式获取" },
  { icon: Shield, text: "多重验证系统，95%+准确率" },
  { icon: Zap, text: "实时数据更新，秒级响应" },
];

export default function Register() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState("");

  // 从 URL 获取邀请码
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('ref') || params.get('invite');
    if (code) {
      setInviteCode(code);
    }
  }, []);

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

    registerMutation.mutate({ email, password, name: name || undefined, inviteCode: inviteCode || undefined });
  };

  // 密码强度检测（保持原有逻辑）
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
    <div className="min-h-screen flex bg-[#0a0f1a] relative overflow-hidden">
      {/* 动态粒子网络背景 */}
      <div className="absolute inset-0 z-0">
        <ParticleNetwork 
          particleCount={80}
          connectionDistance={150}
          speed={0.2}
          particleColor="rgba(168, 85, 247, 0.8)"
          lineColor="rgba(168, 85, 247, 0.15)"
        />
      </div>

      {/* 高级背景效果 */}
      <div className="absolute inset-0 pointer-events-none z-[1]">
        {/* 星空点阵 */}
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.1) 1px, transparent 0)`,
          backgroundSize: '60px 60px'
        }} />
        {/* 动态光晕 */}
        <div className="absolute -top-[300px] -left-[300px] w-[600px] h-[600px] bg-purple-500/15 rounded-full blur-[180px] animate-pulse" />
        <div className="absolute -bottom-[300px] -right-[300px] w-[600px] h-[600px] bg-pink-500/15 rounded-full blur-[180px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 right-1/4 translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[150px]" />
      </div>

      {/* 左侧：福利展示区（大屏幕显示） */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-12 xl:px-20 relative z-10">
        {/* Logo 和标题 */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-8">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-400 via-pink-500 to-cyan-500 flex items-center justify-center shadow-2xl shadow-purple-500/30">
                <Network className="h-9 w-9 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-[#0a0f1a] animate-pulse" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent tracking-tight">
                DataReach
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-purple-400/80 font-medium tracking-widest">GLOBAL DATA PLATFORM</span>
                <span className="px-2 py-0.5 text-[10px] bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-400 rounded border border-purple-500/30">PRO</span>
              </div>
            </div>
          </div>
          <p className="text-2xl text-slate-300 leading-relaxed font-light">
            加入全球领先的<span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 font-semibold">商业数据平台</span>
          </p>
          <p className="text-slate-500 mt-2">
            开启高效获客之旅，触达全球人脉资源
          </p>
        </div>

        {/* 注册福利 */}
        <div className="grid grid-cols-2 gap-4 mb-12">
          {BENEFITS.map((benefit, index) => (
            <div 
              key={index}
              className="p-5 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 backdrop-blur-sm hover:border-purple-500/30 transition-all duration-300 group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center group-hover:from-purple-500/30 group-hover:to-pink-500/30 transition-all group-hover:scale-110 duration-300">
                  <benefit.icon className={`h-6 w-6 ${benefit.color}`} />
                </div>
                <div>
                  <p className="text-sm text-slate-500">{benefit.label}</p>
                  <p className="text-white font-semibold">{benefit.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 功能特点 */}
        <div className="space-y-4 mb-12">
          <h3 className="text-lg font-semibold text-white mb-4">为什么选择 DataReach？</h3>
          {FEATURES.map((feature, index) => (
            <div key={index} className="flex items-center gap-4 p-3 rounded-xl bg-slate-900/30 border border-slate-800/50">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                <feature.icon className="h-5 w-5 text-purple-400" />
              </div>
              <span className="text-slate-300">{feature.text}</span>
            </div>
          ))}
        </div>

        {/* 用户评价 */}
        <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
          <div className="flex items-center gap-1 mb-3">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star key={star} className="w-5 h-5 text-yellow-400 fill-yellow-400" />
            ))}
          </div>
          <p className="text-slate-300 italic leading-relaxed">
            "DataReach 帮助我们团队效率提升了 300%，一手数据资源让我们的销售转化率大幅提升！"
          </p>
          <div className="flex items-center gap-3 mt-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold">
              Z
            </div>
            <div>
              <p className="text-white font-medium">张总</p>
              <p className="text-slate-500 text-sm">某科技公司销售总监</p>
            </div>
          </div>
        </div>
      </div>

      {/* 右侧：注册表单 */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-4 relative z-10">
        <div className="w-full max-w-md">
          {/* 移动端 Logo */}
          <div className="flex flex-col items-center mb-8 lg:hidden">
            <div className="relative mb-4">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-400 via-pink-500 to-cyan-500 flex items-center justify-center shadow-2xl shadow-purple-500/30">
                <Network className="h-11 w-11 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-[#0a0f1a] animate-pulse" />
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
              DataReach
            </h1>
            <span className="text-xs text-purple-400/60 mt-1 tracking-widest">GLOBAL DATA PLATFORM</span>
          </div>

          {/* 注册卡片 */}
          <div className="p-8 lg:p-10 rounded-3xl bg-gradient-to-br from-slate-900/90 to-slate-800/80 backdrop-blur-2xl border border-purple-500/20 shadow-2xl shadow-purple-500/10">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 mb-6">
                <Gift className="w-4 h-4 text-green-400" />
                <span className="text-sm text-green-400 font-medium">注册即送 100 积分</span>
              </div>
              <h2 className="text-3xl font-bold text-white mb-2">创建账户</h2>
              <p className="text-slate-400">加入全球领先的商业数据平台</p>
            </div>

            {/* 注册表单（保持原有逻辑不变） */}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-slate-300 font-medium">姓名（可选）</Label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                  <Input
                    id="name"
                    type="text"
                    placeholder="您的姓名"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-12 h-14 bg-slate-800/50 border-slate-700 focus:border-purple-500 focus:ring-purple-500/20 text-white placeholder:text-slate-500 rounded-xl text-base"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300 font-medium">邮箱地址</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-12 h-14 bg-slate-800/50 border-slate-700 focus:border-purple-500 focus:ring-purple-500/20 text-white placeholder:text-slate-500 rounded-xl text-base"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300 font-medium">密码</Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="至少8位"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-12 pr-12 h-14 bg-slate-800/50 border-slate-700 focus:border-purple-500 focus:ring-purple-500/20 text-white placeholder:text-slate-500 rounded-xl text-base"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                {/* 密码强度指示器 */}
                {password && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${passwordStrength.color} transition-all duration-300`}
                        style={{ width: `${(passwordStrength.level / 5) * 100}%` }}
                      />
                    </div>
                    <span className={`text-xs font-medium ${passwordStrength.color.replace('bg-', 'text-')}`}>
                      {passwordStrength.text}
                    </span>
                  </div>
                )}
              </div>

              {/* 邀请码输入框 */}
              <div className="space-y-2">
                <Label htmlFor="inviteCode" className="text-slate-300 font-medium">邀请码（可选）</Label>
                <div className="relative">
                  <UserPlus className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                  <Input
                    id="inviteCode"
                    type="text"
                    placeholder="输入邀请码享受专属服务"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    className="pl-12 h-14 bg-slate-800/50 border-slate-700 focus:border-purple-500 focus:ring-purple-500/20 text-white placeholder:text-slate-500 rounded-xl text-base uppercase"
                  />
                  {inviteCode && (
                    <CheckCircle className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-green-400" />
                  )}
                </div>
                {inviteCode && (
                  <p className="text-xs text-green-400 mt-1">✨ 您将绑定专属顾问，享受优质服务</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-slate-300 font-medium">确认密码</Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="再次输入密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-12 pr-12 h-14 bg-slate-800/50 border-slate-700 focus:border-purple-500 focus:ring-purple-500/20 text-white placeholder:text-slate-500 rounded-xl text-base"
                    required
                  />
                  {confirmPassword && password === confirmPassword && (
                    <CheckCircle className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-green-400" />
                  )}
                </div>
              </div>

              <Button
                type="submit"
                disabled={registerMutation.isPending}
                className="w-full h-14 text-base bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 hover:from-purple-600 hover:via-pink-600 hover:to-cyan-600 text-white font-semibold shadow-xl shadow-purple-500/25 rounded-xl border-0 mt-2 transition-all duration-300"
              >
                {registerMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    注册中...
                  </>
                ) : (
                  <>
                    创建账户
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-8 pt-8 border-t border-slate-800 text-center">
              <p className="text-slate-400">
                已有账户？{" "}
                <Link href="/login" className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 hover:from-purple-300 hover:to-pink-300 font-semibold transition-all">
                  立即登录
                </Link>
              </p>
            </div>
          </div>

          {/* 移动端福利展示 */}
          <div className="mt-8 lg:hidden">
            <div className="flex justify-center gap-6">
              {BENEFITS.slice(0, 3).map((benefit, index) => (
                <div key={index} className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-center mb-2">
                    <benefit.icon className={`h-6 w-6 ${benefit.color}`} />
                  </div>
                  <span className="text-xs text-slate-500">{benefit.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 底部链接 */}
          <div className="mt-8 text-center">
            <Link href="/" className="text-sm text-slate-500 hover:text-purple-400 transition-colors">
              ← 返回首页
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
