import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Target, Search, Phone, Shield, Zap, CheckCircle, ArrowRight, Sparkles, 
  Database, Globe, TrendingUp, Users, Building2, Linkedin, Twitter, 
  Facebook, Mail, MapPin, BarChart3, Lock, Clock, Award, Star,
  ChevronRight, Play, Layers, Network, Cpu, Eye, EyeOff, ChevronDown
} from "lucide-react";
import { useEffect, useState, useRef } from "react";

// 生成设备指纹（保持原有逻辑）
function generateDeviceId(): string {
  const nav = window.navigator;
  const screen = window.screen;
  const fingerprint = [
    nav.userAgent,
    nav.language,
    screen.colorDepth,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    nav.hardwareConcurrency || 'unknown',
  ].join('|');
  
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// 动态计数器组件
function AnimatedCounter({ end, duration = 2000, suffix = "" }: { end: number; duration?: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    let startTime: number;
    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [end, duration]);
  
  return <span>{count.toLocaleString()}{suffix}</span>;
}

// 数据源卡片
const DATA_SOURCES = [
  { icon: Linkedin, name: "LinkedIn", records: "6.5亿+", color: "from-blue-500 to-blue-600", available: true },
  { icon: Building2, name: "企业工商", records: "2亿+", color: "from-emerald-500 to-green-600", available: true },
  { icon: Twitter, name: "Twitter/X", records: "5亿+", color: "from-slate-600 to-slate-700", available: false },
  { icon: Facebook, name: "Facebook", records: "3亿+", color: "from-blue-600 to-indigo-600", available: false },
];

// 核心功能
const CORE_FEATURES = [
  {
    icon: Search,
    title: "智能精准搜索",
    description: "通过姓名、职位、地区、行业等多维度条件精准定位目标人群，AI智能匹配算法确保找到最相关的决策者。",
    gradient: "from-cyan-500 to-blue-500",
  },
  {
    icon: Shield,
    title: "多重数据验证",
    description: "独创的多源交叉验证系统，通过多个权威数据源验证联系方式的真实性，确保数据可达率高达95%+。",
    gradient: "from-purple-500 to-pink-500",
  },
  {
    icon: Layers,
    title: "多平台数据整合",
    description: "整合LinkedIn、企业工商、社交媒体等多平台数据，构建完整的商业人脉图谱，一站式获取全方位信息。",
    gradient: "from-orange-500 to-red-500",
  },
  {
    icon: Zap,
    title: "实时数据更新",
    description: "数据库每日更新，确保您获取的始终是最新、最准确的联系方式，告别过时无效数据。",
    gradient: "from-green-500 to-emerald-500",
  },
];

// 使用场景
const USE_CASES = [
  { icon: TrendingUp, title: "销售拓客", desc: "精准触达目标客户决策层" },
  { icon: Users, title: "人才招聘", desc: "快速定位行业精英人才" },
  { icon: Building2, title: "商务合作", desc: "发现潜在合作伙伴" },
  { icon: BarChart3, title: "市场调研", desc: "深度了解目标市场" },
];

// 客户评价
const TESTIMONIALS = [
  { name: "张总", role: "某科技公司 CEO", content: "数据准确率非常高，大大提升了我们的销售效率。一个月内成交额增长了40%！", rating: 5, avatar: "/images/executive2.jpg" },
  { name: "李经理", role: "某投资机构 VP", content: "一手数据资源，帮助我们快速建立行业人脉网络。招聘效率提升了3倍。", rating: 5, avatar: "/images/executive1.jpg" },
  { name: "王总监", role: "某猎头公司 总监", content: "多平台数据整合非常实用，节省了大量时间。强烈推荐给所有B2B企业！", rating: 5, avatar: "/images/executive3.jpg" },
];

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [activeSource, setActiveSource] = useState(0);
  
  // 弹窗登录/注册状态
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // 表单状态
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  // 已登录用户自动跳转到仪表盘（保持原有逻辑）
  useEffect(() => {
    if (!loading && isAuthenticated) {
      setLocation("/dashboard");
    }
  }, [loading, isAuthenticated, setLocation]);

  // 数据源轮播
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSource((prev) => (prev + 1) % DATA_SOURCES.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  // 登录 mutation（保持原有逻辑）
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success("登录成功！");
      setShowAuthModal(false);
      window.location.href = "/dashboard";
    },
    onError: (error) => {
      toast.error(error.message || "登录失败");
      setIsLoading(false);
    },
  });

  // 注册 mutation（保持原有逻辑）
  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => {
      toast.success("注册成功！请登录");
      setAuthMode('login');
      setPassword("");
      setConfirmPassword("");
      setIsLoading(false);
    },
    onError: (error) => {
      toast.error(error.message || "注册失败");
      setIsLoading(false);
    },
  });

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error("请填写所有必填字段");
      return;
    }

    if (authMode === 'register') {
      if (password !== confirmPassword) {
        toast.error("两次密码输入不一致");
        return;
      }
      if (password.length < 6) {
        toast.error("密码至少需要6个字符");
        return;
      }
    }

    setIsLoading(true);
    const deviceId = generateDeviceId();

    if (authMode === 'login') {
      loginMutation.mutate({ email, password, deviceId });
    } else {
      registerMutation.mutate({ 
        email, 
        password, 
        inviteCode: inviteCode || undefined,
        deviceId 
      });
    }
  };

  const openAuth = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setShowAuthModal(true);
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setInviteCode("");
  };

  return (
    <div className="min-h-screen bg-[#0a0f1a] relative overflow-hidden">
      {/* 高级背景效果 */}
      <div className="fixed inset-0 pointer-events-none">
        {/* 星空点阵 */}
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)`,
          backgroundSize: '50px 50px'
        }} />
        {/* 网格线 */}
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: `linear-gradient(rgba(6, 182, 212, 0.05) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(6, 182, 212, 0.05) 1px, transparent 1px)`,
          backgroundSize: '100px 100px'
        }} />
        {/* 动态光晕 */}
        <div className="absolute -top-[400px] -right-[400px] w-[800px] h-[800px] bg-cyan-500/20 rounded-full blur-[200px] animate-pulse" />
        <div className="absolute -bottom-[400px] -left-[400px] w-[800px] h-[800px] bg-purple-500/15 rounded-full blur-[200px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-blue-500/10 rounded-full blur-[250px]" />
        {/* 扫描线效果 */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/5 to-transparent h-[200%] animate-scan" style={{
          animation: 'scan 8s linear infinite'
        }} />
      </div>

      {/* 顶部导航栏 */}
      <nav className="relative z-50 border-b border-cyan-500/10 bg-[#0a0f1a]/80 backdrop-blur-2xl sticky top-0">
        <div className="container mx-auto px-4 lg:px-8 h-20 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
                <Network className="h-7 w-7 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-[#0a0f1a] animate-pulse" />
            </div>
            <div>
              <span className="text-2xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent tracking-tight">
                DataReach
              </span>
              <div className="flex items-center gap-2 -mt-1">
                <span className="text-[10px] text-cyan-400/80 font-medium tracking-widest">GLOBAL DATA PLATFORM</span>
                <span className="px-1.5 py-0.5 text-[9px] bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-400 rounded border border-cyan-500/30">PRO</span>
              </div>
            </div>
          </div>

          {/* 导航链接 */}
          <div className="hidden lg:flex items-center gap-8">
            <a href="#features" className="text-slate-400 hover:text-cyan-400 transition-colors text-sm font-medium">产品功能</a>
            <a href="#sources" className="text-slate-400 hover:text-cyan-400 transition-colors text-sm font-medium">数据源</a>
            <a href="#pricing" className="text-slate-400 hover:text-cyan-400 transition-colors text-sm font-medium">定价方案</a>
            <a href="#cases" className="text-slate-400 hover:text-cyan-400 transition-colors text-sm font-medium">使用场景</a>
          </div>

          {/* 操作按钮 - 改为弹窗 */}
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              onClick={() => openAuth('login')}
              className="text-slate-300 hover:text-cyan-400 hover:bg-cyan-500/10 hidden sm:flex"
            >
              登录
            </Button>
            <Button 
              onClick={() => openAuth('register')}
              className="bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 hover:from-cyan-600 hover:via-blue-600 hover:to-purple-700 text-white shadow-lg shadow-cyan-500/25 border-0 px-6"
            >
              免费开始
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section - 添加图片展示 */}
      <section className="relative py-20 lg:py-32">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-7xl mx-auto">
            {/* 左侧文案 */}
            <div>
              {/* 顶部标签 */}
              <div className="flex mb-8">
                <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10 border border-cyan-500/20 backdrop-blur-sm">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    <span className="text-green-400 text-xs font-medium">实时在线</span>
                  </div>
                  <div className="w-px h-4 bg-slate-700" />
                  <span className="text-cyan-400 text-sm">全球领先的商业数据平台</span>
                  <Sparkles className="w-4 h-4 text-yellow-400" />
                </div>
              </div>
              
              {/* 主标题 */}
              <h1 className="text-5xl lg:text-6xl xl:text-7xl font-bold leading-[1.1] mb-8">
                <span className="text-white">全球人脉资源</span>
                <br />
                <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent">
                  一键触达
                </span>
              </h1>
              
              {/* 副标题 */}
              <p className="text-xl text-slate-400 mb-8 leading-relaxed">
                整合全球
                <span className="text-cyan-400 font-semibold"> 10亿+ </span>
                商业联系人数据，覆盖
                <span className="text-purple-400 font-semibold"> 195+ </span>
                国家和地区
                <br />
                <span className="text-slate-500">一手数据资源 · 多重验证系统 · 实时更新</span>
              </p>
              
              {/* CTA按钮 - 改为弹窗 */}
              <div className="flex flex-col sm:flex-row gap-4 mb-12">
                <Button 
                  size="lg" 
                  onClick={() => openAuth('register')}
                  className="gap-3 text-lg px-10 py-7 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 hover:from-cyan-600 hover:via-blue-600 hover:to-purple-700 text-white shadow-2xl shadow-cyan-500/30 border-0 rounded-2xl group"
                >
                  <Zap className="h-5 w-5 group-hover:animate-pulse" />
                  立即开始免费试用
                  <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button size="lg" variant="outline" className="gap-3 text-lg px-10 py-7 border-slate-700 text-slate-300 hover:bg-slate-800/50 hover:border-cyan-500/50 hover:text-cyan-400 rounded-2xl">
                  <Play className="h-5 w-5" />
                  观看演示视频
                </Button>
              </div>

              {/* 核心数据展示 */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { value: "10亿+", label: "全球数据", icon: Database },
                  { value: "195+", label: "覆盖国家", icon: Globe },
                  { value: "95%+", label: "准确率", icon: Shield },
                  { value: "24/7", label: "实时服务", icon: Clock },
                ].map((stat, index) => (
                  <div key={index} className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/50 backdrop-blur-sm">
                    <stat.icon className="w-5 h-5 text-cyan-400 mb-2" />
                    <div className="text-xl font-bold text-white">{stat.value}</div>
                    <div className="text-xs text-slate-500">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 右侧图片展示 */}
            <div className="relative hidden lg:block">
              <div className="relative">
                {/* 主图 */}
                <div className="relative z-10 rounded-2xl overflow-hidden shadow-2xl shadow-cyan-500/10 border border-slate-800/50">
                  <img 
                    src="/images/team-meeting.jpg" 
                    alt="Business Team Meeting" 
                    className="w-full h-[400px] object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0a0f1a] via-transparent to-transparent" />
                  <div className="absolute bottom-6 left-6 right-6">
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-900/90 backdrop-blur-sm border border-slate-700/50">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                        <CheckCircle className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <div className="text-white font-semibold">数据验证成功</div>
                        <div className="text-sm text-slate-400">已找到 847 位匹配的决策者</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 浮动卡片 - 人物信息 */}
                <div className="absolute -top-6 -right-6 p-4 rounded-xl bg-slate-900/90 backdrop-blur-sm border border-slate-700/50 shadow-xl z-20">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-700">
                      <img src="/images/executive1.jpg" alt="Executive" className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">John Smith</div>
                      <div className="text-xs text-slate-400">CEO at TechCorp</div>
                    </div>
                    <Phone className="w-4 h-4 text-green-400 ml-2" />
                  </div>
                </div>

                {/* 浮动卡片 - 全球覆盖 */}
                <div className="absolute -bottom-6 -left-6 p-4 rounded-xl bg-slate-900/90 backdrop-blur-sm border border-slate-700/50 shadow-xl z-20">
                  <div className="flex items-center gap-3">
                    <Globe className="w-8 h-8 text-cyan-400" />
                    <div>
                      <div className="text-2xl font-bold text-white">195+</div>
                      <div className="text-xs text-slate-400">覆盖国家</div>
                    </div>
                  </div>
                </div>

                {/* 协作图片 */}
                <div className="absolute -right-10 top-1/2 -translate-y-1/2 w-32 h-32 rounded-xl overflow-hidden border-2 border-slate-800 shadow-xl z-0 opacity-60">
                  <img src="/images/collaboration.jpg" alt="Collaboration" className="w-full h-full object-cover" />
                </div>
              </div>
            </div>
          </div>

          {/* 滚动提示 */}
          <div className="flex flex-col items-center gap-2 mt-16 animate-bounce">
            <span className="text-sm text-slate-500">向下滚动了解更多</span>
            <ChevronDown className="w-5 h-5 text-slate-500" />
          </div>
        </div>
      </section>

      {/* 信任背书 */}
      <section className="relative py-12 border-y border-cyan-500/10 bg-slate-900/30">
        <div className="container mx-auto px-4 lg:px-8">
          <p className="text-center text-slate-600 text-sm mb-6">已服务超过 10,000+ 企业客户</p>
          <div className="flex flex-wrap justify-center items-center gap-8 opacity-50">
            {['企业A', '企业B', '企业C', '企业D', '企业E', '企业F'].map((company, i) => (
              <div key={i} className="text-slate-500 font-semibold text-lg">{company}</div>
            ))}
          </div>
        </div>
      </section>

      {/* 数据源展示 */}
      <section id="sources" className="relative py-24">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 mb-6">
              <Layers className="w-4 h-4 text-purple-400" />
              <span className="text-sm text-purple-400">多平台数据整合</span>
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold text-white mb-6">
              一手数据，<span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">多源整合</span>
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto text-lg">
              我们直接对接全球主流商业平台，确保数据的一手性和准确性
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 max-w-5xl mx-auto">
            {DATA_SOURCES.map((source, index) => (
              <div 
                key={index}
                className={`relative p-6 rounded-2xl border transition-all duration-500 ${
                  source.available 
                    ? 'bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700 hover:border-cyan-500/50 cursor-pointer' 
                    : 'bg-slate-900/50 border-slate-800 opacity-60'
                }`}
              >
                {!source.available && (
                  <div className="absolute top-3 right-3 px-2 py-1 text-[10px] bg-slate-700 text-slate-400 rounded">即将上线</div>
                )}
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${source.color} flex items-center justify-center mb-4 ${source.available ? 'shadow-lg' : ''}`}>
                  <source.icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">{source.name}</h3>
                <p className="text-2xl font-bold text-cyan-400" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {source.records}
                </p>
                <p className="text-sm text-slate-500 mt-1">数据记录</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 全球网络展示 - 新增图片区块 */}
      <section className="relative py-24 border-t border-cyan-500/10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
            <div className="relative">
              <img 
                src="/images/global-network.webp" 
                alt="Global Network" 
                className="w-full rounded-2xl shadow-2xl shadow-cyan-500/10 border border-slate-800/50"
              />
            </div>
            <div>
              <h2 className="text-4xl font-bold mb-6">
                <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">全球覆盖</span>
                <br />触达每一个商业机会
              </h2>
              <p className="text-slate-400 text-lg mb-8 leading-relaxed">
                我们的数据网络覆盖全球195+个国家和地区，无论您的目标客户在哪里，
                DataReach 都能帮您精准触达。从北美到欧洲，从亚太到中东，
                一键获取全球商业精英的联系方式。
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/50">
                  <div className="text-3xl font-bold text-cyan-400">98%</div>
                  <div className="text-sm text-slate-500">北美市场覆盖率</div>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/50">
                  <div className="text-3xl font-bold text-purple-400">95%</div>
                  <div className="text-sm text-slate-500">欧洲市场覆盖率</div>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/50">
                  <div className="text-3xl font-bold text-green-400">92%</div>
                  <div className="text-sm text-slate-500">亚太市场覆盖率</div>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/50">
                  <div className="text-3xl font-bold text-orange-400">88%</div>
                  <div className="text-sm text-slate-500">其他地区覆盖率</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 核心功能 */}
      <section id="features" className="relative py-24 border-t border-cyan-500/10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-6">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span className="text-sm text-cyan-400">核心能力</span>
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold text-white mb-6">
              为什么选择 <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">DataReach</span>？
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto text-lg">
              采用先进的数据挖掘和验证技术，为您提供最精准的商业联系人信息
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl mx-auto">
            {CORE_FEATURES.map((feature, index) => (
              <div 
                key={index}
                className="group relative p-8 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50 hover:border-cyan-500/30 transition-all duration-500 overflow-hidden"
              >
                {/* 背景光效 */}
                <div className={`absolute -top-20 -right-20 w-40 h-40 bg-gradient-to-br ${feature.gradient} opacity-10 rounded-full blur-3xl group-hover:opacity-20 transition-opacity duration-500`} />
                
                <div className="relative z-10 flex gap-6">
                  <div className={`flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                    <feature.icon className="h-8 w-8 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white mb-3">{feature.title}</h3>
                    <p className="text-slate-400 leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 使用场景 */}
      <section id="cases" className="relative py-24 border-t border-cyan-500/10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold text-white mb-6">
              适用于<span className="text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-400">多种场景</span>
            </h2>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
            {USE_CASES.map((item, index) => (
              <div key={index} className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-green-500/30 transition-all duration-300 text-center group">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                  <item.icon className="w-7 h-7 text-green-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-sm text-slate-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 定价方案 */}
      <section id="pricing" className="relative py-24 border-t border-cyan-500/10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20 mb-6">
              <Award className="w-4 h-4 text-green-400" />
              <span className="text-sm text-green-400">透明定价</span>
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold text-white mb-6">
              简单透明的<span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-green-400">定价方案</span>
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto text-lg">
              按需付费，无月费，无隐藏费用
            </p>
          </div>

          <div className="max-w-lg mx-auto">
            <div className="relative p-10 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-2 border-cyan-500/30 shadow-2xl shadow-cyan-500/10">
              {/* 推荐标签 */}
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-6 py-2 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 rounded-full text-sm font-semibold text-white shadow-lg">
                ✨ 推荐方案
              </div>

              <div className="text-center mb-10 pt-4">
                <p className="text-slate-400 mb-4">USDT-TRC20 充值</p>
                <div className="flex items-baseline justify-center gap-3">
                  <span className="text-6xl font-bold text-white">1</span>
                  <span className="text-2xl text-cyan-400 font-semibold">USDT</span>
                  <span className="text-3xl text-slate-600">=</span>
                  <span className="text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-green-400">100</span>
                  <span className="text-2xl text-slate-400">积分</span>
                </div>
              </div>

              <div className="space-y-4 mb-10">
                {[
                  { text: "搜索预览", price: "1 积分/次", highlight: false },
                  { text: "获取联系方式", price: "2 积分/条", highlight: false },
                  { text: "多重数据验证", price: "免费", highlight: true },
                  { text: "CSV/Excel 导出", price: "免费", highlight: true },
                  { text: "数据保留期限", price: "180天", highlight: true },
                  { text: "API 接口访问", price: "免费", highlight: true },
                ].map((item, index) => (
                  <div key={index} className="flex items-center justify-between py-3 border-b border-slate-800 last:border-0">
                    <div className="flex items-center gap-3">
                      <CheckCircle className={`h-5 w-5 ${item.highlight ? 'text-green-400' : 'text-cyan-400'}`} />
                      <span className="text-slate-300">{item.text}</span>
                    </div>
                    <span className={`font-semibold ${item.highlight ? 'text-green-400' : 'text-white'}`}>{item.price}</span>
                  </div>
                ))}
              </div>

              <Button 
                onClick={() => openAuth('register')}
                className="w-full py-7 text-lg bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 hover:from-cyan-600 hover:via-blue-600 hover:to-purple-700 text-white shadow-xl shadow-cyan-500/25 border-0 rounded-2xl font-semibold"
              >
                立即开始免费试用
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>

              <p className="text-center text-slate-500 text-sm mt-4">
                <Lock className="inline w-4 h-4 mr-1" />
                安全支付 · 即时到账
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 客户评价 - 添加头像图片 */}
      <section className="relative py-24 border-t border-cyan-500/10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold text-white mb-6">
              客户<span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-400">真实评价</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {TESTIMONIALS.map((item, index) => (
              <div key={index} className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800">
                <div className="flex gap-1 mb-4">
                  {[...Array(item.rating)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
                <p className="text-slate-300 mb-6 leading-relaxed">"{item.content}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-700">
                    <img src={item.avatar} alt={item.name} className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <p className="text-white font-semibold">{item.name}</p>
                    <p className="text-sm text-slate-500">{item.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-24 border-t border-cyan-500/10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="max-w-4xl mx-auto text-center p-12 lg:p-16 rounded-3xl bg-gradient-to-br from-cyan-500/10 via-blue-500/10 to-purple-500/10 border border-cyan-500/20 relative overflow-hidden">
            {/* 背景装饰 */}
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-cyan-500/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl" />
            
            <div className="relative z-10">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-600 flex items-center justify-center mx-auto mb-8 shadow-xl shadow-cyan-500/30">
                <Zap className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-4xl lg:text-5xl font-bold text-white mb-6">
                准备好触达全球人脉了吗？
              </h2>
              <p className="text-slate-400 mb-10 max-w-xl mx-auto text-lg">
                立即注册，开始使用全球领先的商业数据平台，获取一手精准的潜在客户联系方式。
              </p>
              <Button 
                size="lg" 
                onClick={() => openAuth('register')}
                className="gap-3 text-lg px-12 py-7 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 hover:from-cyan-600 hover:via-blue-600 hover:to-purple-700 text-white shadow-2xl shadow-cyan-500/30 border-0 rounded-2xl"
              >
                免费开始使用
                <ArrowRight className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative py-16 border-t border-cyan-500/10 bg-slate-950/50">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 flex items-center justify-center">
                <Network className="h-6 w-6 text-white" />
              </div>
              <div>
                <span className="font-bold text-white text-lg">DataReach</span>
                <span className="text-cyan-400/60 text-xs block">Global Data Platform</span>
              </div>
            </div>

            {/* 链接 */}
            <div className="flex items-center gap-8 text-sm text-slate-500">
              <a href="#" className="hover:text-cyan-400 transition-colors">关于我们</a>
              <a href="#" className="hover:text-cyan-400 transition-colors">隐私政策</a>
              <a href="#" className="hover:text-cyan-400 transition-colors">服务条款</a>
              <a href="#" className="hover:text-cyan-400 transition-colors">联系我们</a>
            </div>

            {/* 版权 */}
            <p className="text-sm text-slate-600">
              © 2024 DataReach Pro. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* 登录/注册弹窗 */}
      <Dialog open={showAuthModal} onOpenChange={setShowAuthModal}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-slate-800 p-0 overflow-hidden">
          <div className="p-6">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-2xl font-bold text-center text-white">
                {authMode === 'login' ? '欢迎回来' : '创建账户'}
              </DialogTitle>
              <p className="text-center text-slate-400 mt-2">
                {authMode === 'login' 
                  ? '登录您的账户，开始探索全球人脉' 
                  : '注册成为会员，获取一手商业数据'}
              </p>
            </DialogHeader>

            <form onSubmit={handleAuth} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="modal-email" className="text-slate-300">邮箱地址</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <Input
                    id="modal-email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="modal-password" className="text-slate-300">密码</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <Input
                    id="modal-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {authMode === 'register' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="modal-confirm-password" className="text-slate-300">确认密码</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                      <Input
                        id="modal-confirm-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="modal-invite-code" className="text-slate-300">
                      邀请码 <span className="text-slate-500">(选填)</span>
                    </Label>
                    <Input
                      id="modal-invite-code"
                      type="text"
                      placeholder="输入邀请码获得额外奖励"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                    />
                  </div>
                </>
              )}

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 py-6 text-lg"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    处理中...
                  </span>
                ) : (
                  <>
                    {authMode === 'login' ? '登录' : '注册'}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-slate-400">
                {authMode === 'login' ? '还没有账户？' : '已有账户？'}
                <button
                  type="button"
                  onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                  className="ml-2 text-cyan-400 hover:text-cyan-300 font-medium"
                >
                  {authMode === 'login' ? '立即注册' : '立即登录'}
                </button>
              </p>
            </div>

            {/* 信任标识 */}
            <div className="mt-6 pt-6 border-t border-slate-800 flex items-center justify-center gap-6 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Shield className="w-4 h-4" />
                数据安全加密
              </span>
              <span className="flex items-center gap-1">
                <Lock className="w-4 h-4" />
                隐私保护
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 全局样式 */}
      <style>{`
        @keyframes scan {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
      `}</style>
    </div>
  );
}
