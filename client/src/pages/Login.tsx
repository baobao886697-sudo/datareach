import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Loader2, Mail, Lock, Eye, EyeOff, ArrowRight, Sparkles,
  Phone, Shield, Users, Zap, CheckCircle, Globe, Network,
  Database, TrendingUp, Layers, Award, AlertTriangle
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
  { icon: Database, label: "10亿+数据", desc: "全球商业联系人" },
  { icon: Shield, label: "多重验证", desc: "95%+准确率" },
  { icon: Globe, label: "195+国家", desc: "全球覆盖" },
  { icon: Zap, label: "实时更新", desc: "每日数据刷新" },
];

// 平台优势
const ADVANTAGES = [
  { icon: Layers, text: "多平台数据整合" },
  { icon: CheckCircle, text: "一手数据资源" },
  { icon: TrendingUp, text: "智能精准匹配" },
];

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  // 新增：强制登录状态
  const [showForceLogin, setShowForceLogin] = useState(false);
  const [forceLoginMessage, setForceLoginMessage] = useState("");
  // 新增：内联错误提示状态
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    setDeviceId(getDeviceId());
  }, []);

  // 保持原有的登录逻辑不变
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      setLoginError("");
      toast.success("登录成功");
      setShowForceLogin(false);
      setLocation("/dashboard");
    },
    onError: (error) => {
      const errorMsg = error.message || "登录失败，请检查邮箱和密码";
      if (error.message.includes("其他设备")) {
        // 显示强制登录提示
        setForceLoginMessage(error.message);
        setShowForceLogin(true);
        setLoginError("账户已在其他设备登录");
        toast.error("账户已在其他设备登录");
      } else {
        // 设置内联错误提示
        setLoginError(errorMsg);
        toast.error(errorMsg);
      }
    },
  });

  const forceLoginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success("登录成功，其他设备已下线");
      setShowForceLogin(false);
      setLocation("/dashboard");
    },
    onError: (error) => {
      toast.error(error.message || "强制登录失败");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setShowForceLogin(false);
    loginMutation.mutate({ email, password, deviceId });
  };

  const handleForceLogin = () => {
    forceLoginMutation.mutate({ email, password, deviceId, force: true });
  };

  return (
    <div className="min-h-screen flex bg-[#0a0f1a] relative overflow-hidden">
      {/* 动态粒子网络背景 */}
      <div className="absolute inset-0 z-0">
        <ParticleNetwork 
          particleCount={80}
          connectionDistance={150}
          speed={0.2}
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
        <div className="absolute -top-[300px] -right-[300px] w-[600px] h-[600px] bg-cyan-500/15 rounded-full blur-[180px] animate-pulse" />
        <div className="absolute -bottom-[300px] -left-[300px] w-[600px] h-[600px] bg-purple-500/15 rounded-full blur-[180px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[150px]" />
      </div>

      {/* 左侧：功能展示区（大屏幕显示） */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-12 xl:px-20 relative z-10">
        {/* Logo 和标题 */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-8">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-cyan-500/30">
                <Network className="h-9 w-9 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-[#0a0f1a] animate-pulse" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent tracking-tight">
                DataReach
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-cyan-400/80 font-medium tracking-widest">GLOBAL DATA PLATFORM</span>
                <span className="px-2 py-0.5 text-[10px] bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-400 rounded border border-cyan-500/30">PRO</span>
              </div>
            </div>
          </div>
          <p className="text-2xl text-slate-300 leading-relaxed font-light">
            全球人脉资源，<span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 font-semibold">一键触达</span>
          </p>
          <p className="text-slate-500 mt-2">
            整合多平台数据，获取一手精准商业联系人信息
          </p>
        </div>

        {/* 功能亮点 */}
        <div className="grid grid-cols-2 gap-4 mb-12">
          {FEATURES.map((feature, index) => (
            <div 
              key={index}
              className="p-5 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 backdrop-blur-sm hover:border-cyan-500/30 transition-all duration-300 group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center group-hover:from-cyan-500/30 group-hover:to-blue-500/30 transition-all group-hover:scale-110 duration-300">
                  <feature.icon className="h-6 w-6 text-cyan-400" />
                </div>
                <div>
                  <p className="text-white font-semibold">{feature.label}</p>
                  <p className="text-sm text-slate-500">{feature.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 平台优势 */}
        <div className="flex flex-wrap gap-4 mb-12">
          {ADVANTAGES.map((item, index) => (
            <div key={index} className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800/50 border border-slate-700/50">
              <item.icon className="w-4 h-4 text-green-400" />
              <span className="text-sm text-slate-400">{item.text}</span>
            </div>
          ))}
        </div>

        {/* 信任标识 */}
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-yellow-500" />
            <span className="text-slate-400 text-sm">10,000+ 企业信赖</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-500" />
            <span className="text-slate-400 text-sm">数据安全加密</span>
          </div>
        </div>
      </div>

      {/* 右侧：登录表单 */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-4 relative z-10">
        <div className="w-full max-w-md">
          {/* 移动端 Logo */}
          <div className="flex flex-col items-center mb-10 lg:hidden">
            <div className="relative mb-4">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-cyan-500/30">
                <Network className="h-11 w-11 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-[#0a0f1a] animate-pulse" />
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              DataReach
            </h1>
            <span className="text-xs text-cyan-400/60 mt-1 tracking-widest">GLOBAL DATA PLATFORM</span>
          </div>

          {/* 登录卡片 */}
          <div className="p-8 lg:p-10 rounded-3xl bg-gradient-to-br from-slate-900/90 to-slate-800/80 backdrop-blur-2xl border border-cyan-500/20 shadow-2xl shadow-cyan-500/10">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-500/20 mb-6">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span className="text-sm text-cyan-400">安全登录</span>
              </div>
              <h2 className="text-3xl font-bold text-white mb-2">欢迎回来</h2>
              <p className="text-slate-400">登录您的账户，开始探索全球人脉</p>
            </div>

            {/* 强制登录提示 */}
            {showForceLogin && (
              <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-amber-200 text-sm mb-3">{forceLoginMessage}</p>
                    <Button
                      type="button"
                      onClick={handleForceLogin}
                      disabled={forceLoginMutation.isPending}
                      className="w-full h-10 text-sm bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg"
                    >
                      {forceLoginMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          强制登录中...
                        </>
                      ) : (
                        "强制登录（踢掉其他设备）"
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* 内联错误提示 */}
            {loginError && !showForceLogin && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                  <p className="text-red-200 text-sm">{loginError}</p>
                </div>
              </div>
            )}

            {/* 登录表单（保持原有逻辑不变） */}
            <form onSubmit={handleSubmit} className="space-y-6">
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
                    className="pl-12 h-14 bg-slate-800/50 border-slate-700 focus:border-cyan-500 focus:ring-cyan-500/20 text-white placeholder:text-slate-500 rounded-xl text-base"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-slate-300 font-medium">密码</Label>
                  <Link href="/forgot-password" className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors">
                    忘记密码？
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-12 pr-12 h-14 bg-slate-800/50 border-slate-700 focus:border-cyan-500 focus:ring-cyan-500/20 text-white placeholder:text-slate-500 rounded-xl text-base"
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
              </div>

              <Button
                type="submit"
                disabled={loginMutation.isPending || forceLoginMutation.isPending}
                className="w-full h-14 text-base bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 hover:from-cyan-600 hover:via-blue-600 hover:to-purple-700 text-white font-semibold shadow-xl shadow-cyan-500/25 rounded-xl border-0 transition-all duration-300"
              >
                {(loginMutation.isPending || forceLoginMutation.isPending) ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    登录中...
                  </>
                ) : (
                  <>
                    登录
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-8 pt-8 border-t border-slate-800 text-center">
              <p className="text-slate-400">
                还没有账户？{" "}
                <Link href="/register" className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 hover:from-cyan-300 hover:to-purple-300 font-semibold transition-all">
                  立即注册
                </Link>
              </p>
            </div>
          </div>

          {/* 移动端功能亮点 */}
          <div className="mt-8 lg:hidden">
            <div className="flex justify-center gap-6">
              {FEATURES.slice(0, 3).map((feature, index) => (
                <div key={index} className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-center mb-2">
                    <feature.icon className="h-6 w-6 text-cyan-400" />
                  </div>
                  <span className="text-xs text-slate-500">{feature.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 底部链接 */}
          <div className="mt-8 text-center">
            <Link href="/" className="text-sm text-slate-500 hover:text-cyan-400 transition-colors">
              ← 返回首页
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
