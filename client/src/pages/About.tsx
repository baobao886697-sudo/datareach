import { Link } from "wouter";
import { ArrowLeft, Globe, Shield, Users, Zap, Target, Award, Building2, MapPin, Mail, Phone } from "lucide-react";

export default function About() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      {/* 导航栏 */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-cyan-500/10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
                <Globe className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold text-white">DataReach</span>
                <span className="text-xs text-cyan-400 block -mt-1">GLOBAL DATA PLATFORM</span>
              </div>
            </Link>
            <Link href="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
              <ArrowLeft className="w-4 h-4" />
              返回首页
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 to-purple-500/5" />
        <div className="container mx-auto px-4 lg:px-8 relative">
          <div className="text-center max-w-4xl mx-auto">
            <h1 className="text-5xl lg:text-6xl font-bold text-white mb-6">
              关于 <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">DataReach</span>
            </h1>
            <p className="text-xl text-slate-300 leading-relaxed">
              我们致力于打造全球领先的商业数据平台，帮助企业精准触达目标客户，
              实现业务增长。通过先进的数据技术和多平台整合能力，为您提供一手、精准、实时的商业联系人信息。
            </p>
          </div>
        </div>
      </section>

      {/* 我们的使命 */}
      <section className="py-20 border-t border-cyan-500/10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl font-bold text-white mb-6">我们的使命</h2>
              <p className="text-lg text-slate-300 mb-6 leading-relaxed">
                在信息爆炸的时代，找到正确的人变得越来越困难。DataReach 的使命是通过技术创新，
                让每一个企业都能轻松获取高质量的商业联系人数据，打破信息壁垒，实现精准营销。
              </p>
              <p className="text-lg text-slate-300 leading-relaxed">
                我们相信，数据的价值在于连接。通过整合全球多平台数据资源，我们帮助客户建立有价值的商业人脉网络，
                推动业务发展，创造更多商业机会。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="p-6 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-transparent border border-cyan-500/20">
                <Target className="w-12 h-12 text-cyan-400 mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">精准定位</h3>
                <p className="text-slate-400">多维度筛选，精准触达目标决策者</p>
              </div>
              <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-transparent border border-purple-500/20">
                <Shield className="w-12 h-12 text-purple-400 mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">数据安全</h3>
                <p className="text-slate-400">企业级加密，保护您的数据安全</p>
              </div>
              <div className="p-6 rounded-2xl bg-gradient-to-br from-green-500/10 to-transparent border border-green-500/20">
                <Zap className="w-12 h-12 text-green-400 mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">实时更新</h3>
                <p className="text-slate-400">数据每日更新，确保信息时效性</p>
              </div>
              <div className="p-6 rounded-2xl bg-gradient-to-br from-orange-500/10 to-transparent border border-orange-500/20">
                <Globe className="w-12 h-12 text-orange-400 mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">全球覆盖</h3>
                <p className="text-slate-400">195+国家和地区，全球商业网络</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 核心数据 */}
      <section className="py-20 bg-gradient-to-r from-cyan-500/5 via-purple-500/5 to-cyan-500/5">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">平台数据概览</h2>
            <p className="text-slate-400">我们的数据规模和服务能力</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 mb-2">10亿+</div>
              <div className="text-slate-400">全球数据记录</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-2">195+</div>
              <div className="text-slate-400">覆盖国家地区</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-400 mb-2">10,000+</div>
              <div className="text-slate-400">企业客户信赖</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-yellow-400 mb-2">95%+</div>
              <div className="text-slate-400">数据准确率</div>
            </div>
          </div>
        </div>
      </section>

      {/* 我们的团队 */}
      <section className="py-20 border-t border-cyan-500/10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">专业团队</h2>
            <p className="text-slate-400">来自全球顶尖科技公司的精英团队</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center">
              <div className="w-24 h-24 rounded-full overflow-hidden mx-auto mb-6 bg-gradient-to-br from-cyan-500 to-purple-600">
                <img src="/images/asian-man-1.jpg" alt="CEO" className="w-full h-full object-cover" />
              </div>
              <h3 className="text-xl font-bold text-white mb-1">陈建华</h3>
              <div className="text-cyan-400 mb-4">创始人 & CEO</div>
              <p className="text-slate-400 text-sm">前 Google 高级工程师，拥有15年数据技术经验</p>
            </div>
            <div className="p-8 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center">
              <div className="w-24 h-24 rounded-full overflow-hidden mx-auto mb-6 bg-gradient-to-br from-purple-500 to-pink-600">
                <img src="/images/asian-woman-1.jpg" alt="CTO" className="w-full h-full object-cover" />
              </div>
              <h3 className="text-xl font-bold text-white mb-1">林雅婷</h3>
              <div className="text-purple-400 mb-4">联合创始人 & CTO</div>
              <p className="text-slate-400 text-sm">前 Meta AI 研究员，人工智能和大数据专家</p>
            </div>
            <div className="p-8 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center">
              <div className="w-24 h-24 rounded-full overflow-hidden mx-auto mb-6 bg-gradient-to-br from-green-500 to-emerald-600">
                <img src="/images/asian-man-3.jpg" alt="COO" className="w-full h-full object-cover" />
              </div>
              <h3 className="text-xl font-bold text-white mb-1">王志强</h3>
              <div className="text-green-400 mb-4">首席运营官 COO</div>
              <p className="text-slate-400 text-sm">前 Salesforce 亚太区总监，20年企业服务经验</p>
            </div>
          </div>
        </div>
      </section>

      {/* 联系信息 */}
      <section className="py-20 bg-gradient-to-r from-cyan-500/5 via-purple-500/5 to-cyan-500/5">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">联系我们</h2>
            <p className="text-slate-400">我们期待与您建立合作</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center">
              <Building2 className="w-10 h-10 text-cyan-400 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">公司地址</h3>
              <p className="text-slate-400 text-sm">新加坡 莱佛士坊 1号<br />One Raffles Place Tower 2</p>
            </div>
            <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center">
              <Mail className="w-10 h-10 text-purple-400 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">电子邮箱</h3>
              <p className="text-slate-400 text-sm">contact@datareach.pro<br />support@datareach.pro</p>
            </div>
            <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center">
              <Phone className="w-10 h-10 text-green-400 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">联系电话</h3>
              <p className="text-slate-400 text-sm">+65 6123 4567<br />周一至周五 9:00-18:00</p>
            </div>
          </div>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="py-12 border-t border-cyan-500/10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
                <Globe className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold text-white">DataReach</span>
                <span className="text-xs text-cyan-400 block -mt-1">Global Data Platform</span>
              </div>
            </div>
            <div className="flex items-center gap-8 text-sm text-slate-400">
              <Link href="/about" className="hover:text-white transition-colors">关于我们</Link>
              <Link href="/privacy" className="hover:text-white transition-colors">隐私政策</Link>
              <Link href="/terms" className="hover:text-white transition-colors">服务条款</Link>
              <Link href="/contact" className="hover:text-white transition-colors">联系我们</Link>
            </div>
            <div className="text-sm text-slate-500">
              © 2024 DataReach Pro. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
