import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { Target, Search, Phone, Shield, Zap, CheckCircle, ArrowRight, Sparkles, Database, Globe, TrendingUp } from "lucide-react";
import { useEffect } from "react";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  // 已登录用户自动跳转到仪表盘
  useEffect(() => {
    if (!loading && isAuthenticated) {
      setLocation("/dashboard");
    }
  }, [loading, isAuthenticated, setLocation]);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* 背景效果 */}
      <div className="fixed inset-0 pointer-events-none">
        {/* 网格背景 */}
        <div 
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `linear-gradient(rgba(56, 189, 248, 0.03) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(56, 189, 248, 0.03) 1px, transparent 1px)`,
            backgroundSize: '60px 60px'
          }}
        />
        {/* 渐变光晕 */}
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 -left-40 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500/5 rounded-full blur-[150px]" />
      </div>

      {/* 导航栏 */}
      <nav className="relative z-50 border-b border-cyan-500/10 bg-slate-950/80 backdrop-blur-xl sticky top-0">
        <div className="container mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <Target className="h-6 w-6 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                云端寻踪
              </span>
              <span className="text-xs text-cyan-400/60 block -mt-1">PRO 2.0</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost" className="text-slate-300 hover:text-cyan-400 hover:bg-cyan-500/10">
                登录
              </Button>
            </Link>
            <Link href="/register">
              <Button className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg shadow-cyan-500/25 border-0">
                免费注册
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative py-24 lg:py-40">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto text-center">
            {/* 标签 */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-8">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span className="text-sm text-cyan-400">专业级商业情报平台</span>
            </div>
            
            <h1 className="text-5xl lg:text-7xl font-bold leading-tight mb-8">
              <span className="text-white">精准获取</span>
              <br />
              <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                LinkedIn 专业人士
              </span>
              <br />
              <span className="text-white">联系方式</span>
            </h1>
            
            <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-12 leading-relaxed">
              通过姓名、职位和地区精准搜索，获取经过
              <span className="text-cyan-400">双重验证</span>
              的电话号码。
              <br />
              强大的AI驱动系统确保数据准确性高达
              <span className="text-green-400 font-semibold"> 95%+</span>
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/register">
                <Button size="lg" className="gap-2 text-lg px-10 py-6 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-xl shadow-cyan-500/30 border-0 rounded-xl">
                  <Search className="h-5 w-5" />
                  开始免费试用
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="gap-2 text-lg px-10 py-6 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500/50 rounded-xl">
                  已有账户？登录
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
            </div>
            
            {/* 统计数据 */}
            <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8">
              {[
                { value: "10M+", label: "数据库记录", icon: Database },
                { value: "95%+", label: "验证准确率", icon: Shield },
                { value: "50+", label: "覆盖州/地区", icon: Globe },
                { value: "24/7", label: "全天候服务", icon: Zap },
              ].map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 mb-3">
                    <stat.icon className="w-6 h-6 text-cyan-400" />
                  </div>
                  <div className="text-3xl font-bold text-white mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {stat.value}
                  </div>
                  <div className="text-sm text-slate-500">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative py-24 border-t border-cyan-500/10">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">
              为什么选择 <span className="text-cyan-400">云端寻踪</span>？
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              采用先进的数据挖掘和验证技术，为您提供最精准的商业联系人信息
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {[
              {
                icon: Search,
                title: "智能精准搜索",
                description: "通过姓名、职位和州进行多维度搜索，AI智能匹配算法确保找到最相关的目标人员。",
                gradient: "from-cyan-500 to-blue-500",
                glow: "shadow-cyan-500/20"
              },
              {
                icon: Shield,
                title: "双重验证系统",
                description: "通过 TruePeopleSearch 和 FastPeopleSearch 双重交叉验证，确保电话号码真实有效。",
                gradient: "from-purple-500 to-pink-500",
                glow: "shadow-purple-500/20"
              },
              {
                icon: Zap,
                title: "高效批量处理",
                description: "自动批量处理，每批50条数据并行处理，系统自动运行直到完成或积分用尽。",
                gradient: "from-green-500 to-emerald-500",
                glow: "shadow-green-500/20"
              },
            ].map((feature, index) => (
              <div 
                key={index} 
                className={`group relative p-8 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-cyan-500/30 transition-all duration-300 hover:-translate-y-2 hover:shadow-xl ${feature.glow}`}
              >
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-6 shadow-lg`}>
                  <feature.icon className="h-7 w-7 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">
                  {feature.title}
                </h3>
                <p className="text-slate-400 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="relative py-24 border-t border-cyan-500/10">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">
              简单透明的 <span className="text-cyan-400">定价</span>
            </h2>
            <p className="text-slate-400">
              按需付费，无月费，无隐藏费用
            </p>
          </div>
          
          <div className="max-w-lg mx-auto">
            <div className="relative p-8 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-cyan-500/30 shadow-2xl shadow-cyan-500/10">
              {/* 装饰角标 */}
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full text-sm font-medium text-white">
                推荐方案
              </div>
              
              <div className="text-center mb-8 pt-4">
                <p className="text-slate-400 mb-2">USDT-TRC20 充值</p>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-5xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>1</span>
                  <span className="text-2xl text-cyan-400">USDT</span>
                  <span className="text-slate-500">=</span>
                  <span className="text-5xl font-bold text-cyan-400" style={{ fontFamily: 'Orbitron, sans-serif' }}>100</span>
                  <span className="text-2xl text-slate-400">积分</span>
                </div>
              </div>
              
              <div className="space-y-4 mb-8">
                {[
                  { text: "搜索预览：1 积分/次", highlight: false },
                  { text: "获取电话：2 积分/条", highlight: false },
                  { text: "双重验证：免费", highlight: true },
                  { text: "CSV导出：免费", highlight: true },
                  { text: "结果保留：180天", highlight: true },
                ].map((item, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center ${item.highlight ? 'bg-green-500/20' : 'bg-cyan-500/20'}`}>
                      <CheckCircle className={`h-4 w-4 ${item.highlight ? 'text-green-400' : 'text-cyan-400'}`} />
                    </div>
                    <span className="text-slate-300">{item.text}</span>
                  </div>
                ))}
              </div>
              
              <Link href="/register">
                <Button className="w-full py-6 text-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg shadow-cyan-500/25 border-0 rounded-xl">
                  立即开始
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-24 border-t border-cyan-500/10">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center p-12 rounded-3xl bg-gradient-to-br from-cyan-500/10 via-blue-500/10 to-purple-500/10 border border-cyan-500/20">
            <TrendingUp className="w-12 h-12 text-cyan-400 mx-auto mb-6" />
            <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">
              准备好提升您的销售效率了吗？
            </h2>
            <p className="text-slate-400 mb-8 max-w-xl mx-auto">
              立即注册，开始使用专业级商业情报平台，获取精准的潜在客户联系方式。
            </p>
            <Link href="/register">
              <Button size="lg" className="gap-2 text-lg px-10 py-6 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-xl shadow-cyan-500/30 border-0 rounded-xl">
                免费注册
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative py-12 border-t border-cyan-500/10">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center">
                <Target className="h-5 w-5 text-white" />
              </div>
              <span className="font-semibold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>云端寻踪 Pro</span>
            </div>
            <p className="text-sm text-slate-500">
              © 2024 云端寻踪 Pro. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
