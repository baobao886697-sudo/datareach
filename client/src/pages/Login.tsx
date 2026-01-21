import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Loader2, Target, Mail, Lock, Eye, EyeOff, ArrowRight, Sparkles,
  Phone, Shield, Users, Zap, CheckCircle, Globe
} from "lucide-react";
import { ParticleNetwork } from "@/components/ParticleNetwork";

// 生成或获取设备ID（保持原有逻辑不变）
function getDeviceId(): string {
  let deviceId = localStorage.getItem("deviceId");
  if (!deviceId) {
    // 生成唯一设备ID
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem("deviceId", deviceId);
  }
  return deviceId;
}

// 功能亮点数据
const FEATURES = [
  { icon: Target, label: "精准搜索", desc: "LinkedIn 专业人士" },
  { icon: Phone, label: "电话验证", desc: "双重验证确保可达" },
  { icon: Shield, label: "数据安全", desc: "加密传输存储" },
  { icon: Zap, label: "快速获取", desc: "秒级响应速度" },
];

// 统计数据
const STATS = [
  { value: "50,000+", label: "已获取联系人" },
  { value: "95%+", label: "数据准确率" },
  { value: "1,000+", label: "活跃用户" },
];

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [deviceId, setDeviceId] = useState("");

  useEffect(() => {
    setDeviceId(getDeviceId());
  }, []);

  // 保持原有的登录逻辑不变
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success("登录成功");
      setLocation("/dashboard");
    },
    onError: (error) => {
      if (error.message.includes("其他设备")) {
        toast.error(error.message, {
          duration: 5000,
          action: {
            label: "强制登录",
            onClick: () => {
              forceLoginMutation.mutate({ email, password, deviceId, force: true });
            },
          },
        });
      } else {
        toast.error(error.message || "登录失败");
      }
    },
  });

  const forceLoginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success("登录成功，其他设备已下线");
      setLocation("/dashboard");
    },
    onError: (error) => {
      toast.error(error.message || "登录失败");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ email, password, deviceId });
  };

  return (
    <div className="min-h-screen flex bg-slate-950 relative overflow-hidden">
      {/* 动态粒子网络背景 */}
      <div className="absolute inset-0 z-0">
        <ParticleNetwork 
          particleCount={60}
          connectionDistance={120}
          speed={0.3}
        />
      </div>

      {/* 渐变光晕叠加 */}
      <div className="absolute inset-0 pointer-events-none z-[1]">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-[150px]" />
        <div className="absolute -bottom-40 -left-40 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[150px]" />
        <div className="absolute top-1/2 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-[120px]" />
      </div>

      {/* 左侧：功能展示区（大屏幕显示） */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-12 xl:px-20 relative z-10">
        {/* Logo 和标题 */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-xl shadow-cyan-500/30">
              <Target className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                云端寻踪
              </h1>
              <span className="text-sm text-cyan-400/60">PRO 2.0</span>
            </div>
          </div>
          <p className="text-xl text-slate-300 leading-relaxed">
            专业级 LinkedIn 商业情报平台
            <br />
            <span className="text-slate-400">精准获取决策层联系方式</span>
          </p>
        </div>

        {/* 功能亮点 */}
        <div className="grid grid-cols-2 gap-4 mb-12">
          {FEATURES.map((feature, index) => (
            <div 
              key={index}
              className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/50 backdrop-blur-sm hover:border-cyan-500/30 transition-all duration-300 group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center group-hover:from-cyan-500/30 group-hover:to-blue-500/30 transition-all">
                  <feature.icon className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <p className="text-white font-medium">{feature.label}</p>
                  <p className="text-xs text-slate-500">{feature.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 统计数据 */}
        <div className="flex gap-8">
          {STATS.map((stat, index) => (
            <div key={index} className="text-center">
              <p className="text-3xl font-bold text-white mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                {stat.value}
              </p>
              <p className="text-sm text-slate-500">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* 信任标识 */}
        <div className="mt-12 flex items-center gap-6 text-slate-500">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-green-500" />
            <span className="text-sm">数据加密</span>
          </div>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-blue-500" />
            <span className="text-sm">全球覆盖</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-cyan-500" />
            <span className="text-sm">实时验证</span>
          </div>
        </div>
      </div>

      {/* 右侧：登录表单 */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-4 relative z-10">
        <div className="w-full max-w-md">
          {/* 移动端 Logo */}
          <div className="flex flex-col items-center mb-10 lg:hidden">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-xl shadow-cyan-500/30 mb-4">
              <Target className="h-9 w-9 text-white" />
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent" style={{ fontFamily: 'Orbitron, sans-serif' }}>
              云端寻踪
            </h1>
            <span className="text-xs text-cyan-400/60 mt-1">PRO 2.0</span>
          </div>

          {/* 登录卡片 */}
          <div className="p-8 rounded-2xl bg-slate-900/80 backdrop-blur-xl border border-cyan-500/20 shadow-2xl shadow-cyan-500/10">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-4">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                <span className="text-xs text-cyan-400">安全登录</span>
              </div>
              <h2 className="text-2xl font-bold text-white">欢迎回来</h2>
              <p className="text-slate-400 mt-2">登录您的账户继续使用</p>
            </div>

            {/* 登录表单（保持原有逻辑不变） */}
            <form onSubmit={handleSubmit} className="space-y-5">
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
                    className="pl-11 h-12 bg-slate-800/50 border-slate-700 focus:border-cyan-500 text-white placeholder:text-slate-500 rounded-xl"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-slate-300">密码</Label>
                  <Link href="/forgot-password" className="text-xs text-cyan-400 hover:text-cyan-300">
                    忘记密码？
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-11 pr-11 h-12 bg-slate-800/50 border-slate-700 focus:border-cyan-500 text-white placeholder:text-slate-500 rounded-xl"
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
              </div>

              <Button
                type="submit"
                disabled={loginMutation.isPending || forceLoginMutation.isPending}
                className="w-full h-12 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-medium shadow-lg shadow-cyan-500/25 rounded-xl border-0"
              >
                {(loginMutation.isPending || forceLoginMutation.isPending) ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    登录中...
                  </>
                ) : (
                  <>
                    登录
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-8 pt-6 border-t border-slate-800 text-center">
              <p className="text-slate-400">
                还没有账户？{" "}
                <Link href="/register" className="text-cyan-400 hover:text-cyan-300 font-medium">
                  立即注册
                </Link>
              </p>
            </div>
          </div>

          {/* 移动端功能亮点 */}
          <div className="mt-8 lg:hidden">
            <div className="flex justify-center gap-6 text-slate-500">
              {FEATURES.slice(0, 3).map((feature, index) => (
                <div key={index} className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-lg bg-slate-800/50 flex items-center justify-center mb-2">
                    <feature.icon className="h-5 w-5 text-cyan-400" />
                  </div>
                  <span className="text-xs">{feature.label}</span>
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
