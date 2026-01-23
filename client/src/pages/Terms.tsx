import { Link } from "wouter";
import { ArrowLeft, Globe, FileText, AlertTriangle, Scale, CreditCard, Ban, RefreshCw, Gavel } from "lucide-react";

export default function Terms() {
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
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 mb-6">
              <FileText className="w-5 h-5 text-purple-400" />
              <span className="text-purple-400 text-sm font-medium">法律条款</span>
            </div>
            <h1 className="text-5xl lg:text-6xl font-bold text-white mb-6">
              服务条款
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
                欢迎使用 DataReach Pro（以下简称"本服务"）。本服务条款（以下简称"条款"）构成您与 DataReach Pro 之间的法律协议。
                使用本服务即表示您同意受本条款的约束。如果您不同意这些条款，请勿使用本服务。
              </p>
            </div>

            {/* 服务说明 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                  <Scale className="w-6 h-6 text-cyan-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">1. 服务说明</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>DataReach Pro 是一个商业数据平台，提供以下服务：</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>商业联系人信息搜索和获取</li>
                  <li>多平台数据整合和验证</li>
                  <li>数据导出和 API 接口访问</li>
                  <li>相关的技术支持服务</li>
                </ul>
                <p>我们保留随时修改、暂停或终止服务的权利，恕不另行通知。</p>
              </div>
            </div>

            {/* 账户注册 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-purple-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">2. 账户注册与安全</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>使用本服务需要注册账户。您同意：</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>提供真实、准确、完整的注册信息</li>
                  <li>维护账户信息的及时更新</li>
                  <li>妥善保管您的账户密码</li>
                  <li>对账户下的所有活动负责</li>
                  <li>发现未经授权使用时立即通知我们</li>
                </ul>
                <p>我们保留因违反条款而暂停或终止账户的权利。</p>
              </div>
            </div>

            {/* 付费与积分 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <CreditCard className="w-6 h-6 text-green-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">3. 付费与积分</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p><strong className="text-white">积分系统：</strong></p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>1 USDT = 100 积分</li>
                  <li>积分用于搜索预览和获取联系方式</li>
                  <li>积分一经购买，不可退款</li>
                  <li>积分有效期为购买之日起 180 天</li>
                </ul>
                <p><strong className="text-white">退款政策：</strong></p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>由于数据产品的特殊性，已使用的积分不予退款</li>
                  <li>未使用的积分在特殊情况下可申请退款，需扣除 20% 手续费</li>
                  <li>退款申请需在购买后 7 天内提出</li>
                </ul>
              </div>
            </div>

            {/* 使用限制 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center">
                  <Ban className="w-6 h-6 text-red-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">4. 使用限制</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>使用本服务时，您不得：</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>违反任何适用的法律法规</li>
                  <li>侵犯他人的知识产权或隐私权</li>
                  <li>发送垃圾邮件或进行骚扰行为</li>
                  <li>尝试未经授权访问系统或数据</li>
                  <li>使用自动化工具大规模抓取数据</li>
                  <li>转售或分发从本服务获取的数据</li>
                  <li>进行任何可能损害服务运营的行为</li>
                </ul>
              </div>
            </div>

            {/* 数据使用 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
                  <RefreshCw className="w-6 h-6 text-orange-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">5. 数据使用规范</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>通过本服务获取的数据，您同意：</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>仅用于合法的商业目的</li>
                  <li>遵守所有适用的数据保护法规（包括 GDPR、CCPA 等）</li>
                  <li>不将数据用于歧视、骚扰或其他非法目的</li>
                  <li>在联系数据主体时遵守适用的通信法规</li>
                  <li>对数据的使用承担全部责任</li>
                </ul>
              </div>
            </div>

            {/* 免责声明 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-yellow-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">6. 免责声明</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>本服务按"现状"提供，我们不对以下事项作出保证：</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>数据的完全准确性或完整性</li>
                  <li>服务的不间断或无错误运行</li>
                  <li>满足您的特定需求</li>
                  <li>与其他软件或系统的兼容性</li>
                </ul>
                <p>在法律允许的最大范围内，我们不对任何间接、附带、特殊或后果性损害承担责任。</p>
              </div>
            </div>

            {/* 争议解决 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Gavel className="w-6 h-6 text-blue-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">7. 争议解决</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>
                  本条款受新加坡法律管辖。任何因本条款或服务引起的争议，双方应首先尝试友好协商解决。
                  如协商不成，争议应提交新加坡国际仲裁中心（SIAC）按其仲裁规则进行仲裁。
                </p>
              </div>
            </div>

            {/* 条款修改 */}
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-pink-500/10 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-pink-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">8. 条款修改</h2>
              </div>
              <div className="space-y-4 text-slate-300 leading-relaxed">
                <p>
                  我们保留随时修改本条款的权利。修改后的条款将在网站上发布后立即生效。
                  继续使用本服务即表示您接受修改后的条款。我们建议您定期查阅本页面以了解最新条款。
                </p>
              </div>
            </div>

            {/* 联系我们 */}
            <div className="p-8 rounded-2xl bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-500/20">
              <h2 className="text-2xl font-bold text-white mb-4">联系我们</h2>
              <p className="text-slate-300 mb-4">
                如果您对本服务条款有任何问题，请通过以下方式联系我们：
              </p>
              <div className="space-y-2 text-slate-300">
                <p>📧 电子邮箱：legal@datareach.pro</p>
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
