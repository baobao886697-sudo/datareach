import { Link } from "wouter";
import { ArrowLeft, Globe, Shield, Lock, Eye, Database, UserCheck, Bell, Trash2 } from "lucide-react";

export default function Privacy() {
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
      <section className="pt-32 pb-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 to-purple-500/5" />
        <div className="container mx-auto px-4 lg:px-8 relative">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-6">
              <Shield className="w-5 h-5 text-cyan-400" />
              <span className="text-cyan-400 text-sm font-medium">数据安全保障</span>
            </div>
            <h1 className="text-5xl lg:text-6xl font-bold text-white mb-6">
              隐私政策
            </h1>
            <p className="text-xl text-slate-300">
              最后更新日期：2024年1月1日
            </p>
          </div>
        </div>
      </section>

      {/* 内容区域 */}
      <section className="py-16">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="max-w-4xl mx-auto">
            {/* 引言 */}
            <div className="p-8 rounded-2xl bg-slate-800/50 border border-slate-700/50 mb-8">
              <p className="text-slate-300 leading-relaxed">
                DataReach Pro（以下简称"我们"）非常重视用户的隐私保护。本隐私政策旨在向您说明我们如何收集、使用、存储和保护您的个人信息。
                使用我们的服务即表示您同意本隐私政策中描述的做法。
              </p>
            </div>

            {/* 信息收集 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                  <Database className="w-6 h-6 text-cyan-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">1. 我们收集的信息</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed pl-15">
                <p><strong className="text-white">账户信息：</strong>当您注册账户时，我们会收集您的电子邮箱地址、用户名和密码。</p>
                <p><strong className="text-white">使用数据：</strong>我们会收集您使用服务的相关信息，包括搜索记录、访问时间、IP地址和设备信息。</p>
                <p><strong className="text-white">支付信息：</strong>当您进行充值时，我们会收集必要的交易信息，但不会存储您的完整支付凭证。</p>
                <p><strong className="text-white">通信记录：</strong>当您与我们的客服团队联系时，我们会保留通信记录以便更好地为您服务。</p>
              </div>
            </div>

            {/* 信息使用 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <Eye className="w-6 h-6 text-purple-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">2. 信息的使用方式</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>我们使用收集的信息用于以下目的：</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>提供、维护和改进我们的服务</li>
                  <li>处理您的交易和发送相关通知</li>
                  <li>向您发送技术通知、更新和安全警报</li>
                  <li>响应您的评论、问题和客户服务请求</li>
                  <li>监控和分析使用趋势以改进用户体验</li>
                  <li>检测、调查和防止欺诈交易和其他非法活动</li>
                </ul>
              </div>
            </div>

            {/* 信息保护 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <Lock className="w-6 h-6 text-green-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">3. 信息安全保护</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>我们采取多种安全措施保护您的个人信息：</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>所有数据传输均使用 SSL/TLS 加密</li>
                  <li>密码使用业界标准的单向哈希算法存储</li>
                  <li>定期进行安全审计和漏洞扫描</li>
                  <li>严格的员工访问控制和培训</li>
                  <li>数据中心符合 ISO 27001 安全标准</li>
                </ul>
              </div>
            </div>

            {/* 信息共享 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
                  <UserCheck className="w-6 h-6 text-orange-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">4. 信息共享与披露</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>我们不会出售您的个人信息。我们可能在以下情况下共享您的信息：</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li><strong className="text-white">服务提供商：</strong>与帮助我们运营服务的第三方服务提供商共享</li>
                  <li><strong className="text-white">法律要求：</strong>根据法律要求或政府机构的合法请求</li>
                  <li><strong className="text-white">业务转让：</strong>在公司合并、收购或资产出售的情况下</li>
                  <li><strong className="text-white">您的同意：</strong>在获得您明确同意的情况下</li>
                </ul>
              </div>
            </div>

            {/* 用户权利 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-pink-500/10 flex items-center justify-center">
                  <Bell className="w-6 h-6 text-pink-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">5. 您的权利</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>根据适用的数据保护法律，您享有以下权利：</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>访问和获取您的个人信息副本</li>
                  <li>更正不准确的个人信息</li>
                  <li>请求删除您的个人信息</li>
                  <li>反对或限制某些数据处理活动</li>
                  <li>数据可携带性权利</li>
                  <li>撤回同意（如适用）</li>
                </ul>
              </div>
            </div>

            {/* 数据保留 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Trash2 className="w-6 h-6 text-blue-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">6. 数据保留</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>
                  我们会在实现本隐私政策所述目的所需的期限内保留您的个人信息，除非法律要求或允许更长的保留期限。
                  当您删除账户时，我们会在合理时间内删除或匿名化您的个人信息，但可能会保留某些信息以遵守法律义务。
                </p>
              </div>
            </div>

            {/* 联系我们 */}
            <div className="p-8 rounded-2xl bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-500/20">
              <h2 className="text-2xl font-bold text-white mb-4">联系我们</h2>
              <p className="text-slate-300 mb-4">
                如果您对本隐私政策有任何问题或疑虑，请通过以下方式联系我们：
              </p>
              <div className="space-y-2 text-slate-300">
                <p>📧 电子邮箱：privacy@datareach.pro</p>
                <p>📍 地址：新加坡 莱佛士坊 1号 One Raffles Place Tower 2</p>
              </div>
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
