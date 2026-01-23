import { Link } from "wouter";
import { ArrowLeft, Globe, Mail, Phone, MapPin, Clock, MessageSquare, Send, Building2, Headphones } from "lucide-react";
import { useState } from "react";

export default function Contact() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: ""
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 模拟提交
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

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
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20 mb-6">
              <Headphones className="w-5 h-5 text-green-400" />
              <span className="text-green-400 text-sm font-medium">7x24 客户支持</span>
            </div>
            <h1 className="text-5xl lg:text-6xl font-bold text-white mb-6">
              联系我们
            </h1>
            <p className="text-xl text-slate-300">
              我们的团队随时准备为您提供帮助
            </p>
          </div>
        </div>
      </section>

      {/* 联系方式卡片 */}
      <section className="py-16">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
            <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center hover:border-cyan-500/30 transition-colors">
              <div className="w-14 h-14 rounded-xl bg-cyan-500/10 flex items-center justify-center mx-auto mb-4">
                <Mail className="w-7 h-7 text-cyan-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">电子邮箱</h3>
              <p className="text-cyan-400 font-medium">contact@datareach.pro</p>
              <p className="text-slate-400 text-sm mt-1">24小时内回复</p>
            </div>
            <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center hover:border-purple-500/30 transition-colors">
              <div className="w-14 h-14 rounded-xl bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                <Phone className="w-7 h-7 text-purple-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">联系电话</h3>
              <p className="text-purple-400 font-medium">+65 6123 4567</p>
              <p className="text-slate-400 text-sm mt-1">周一至周五 9:00-18:00</p>
            </div>
            <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center hover:border-green-500/30 transition-colors">
              <div className="w-14 h-14 rounded-xl bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-7 h-7 text-green-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">在线客服</h3>
              <p className="text-green-400 font-medium">实时聊天</p>
              <p className="text-slate-400 text-sm mt-1">7x24 全天候服务</p>
            </div>
            <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center hover:border-orange-500/30 transition-colors">
              <div className="w-14 h-14 rounded-xl bg-orange-500/10 flex items-center justify-center mx-auto mb-4">
                <Clock className="w-7 h-7 text-orange-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">响应时间</h3>
              <p className="text-orange-400 font-medium">&lt; 2 小时</p>
              <p className="text-slate-400 text-sm mt-1">工作时间内</p>
            </div>
          </div>

          {/* 联系表单和地图 */}
          <div className="grid lg:grid-cols-2 gap-12">
            {/* 联系表单 */}
            <div className="p-8 rounded-2xl bg-slate-800/50 border border-slate-700/50">
              <h2 className="text-2xl font-bold text-white mb-6">发送消息</h2>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">您的姓名</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                      placeholder="请输入姓名"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">电子邮箱</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                      placeholder="your@email.com"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">主题</label>
                  <input
                    type="text"
                    value={formData.subject}
                    onChange={(e) => setFormData({...formData, subject: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                    placeholder="请输入主题"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">消息内容</label>
                  <textarea
                    value={formData.message}
                    onChange={(e) => setFormData({...formData, message: e.target.value})}
                    rows={5}
                    className="w-full px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors resize-none"
                    placeholder="请详细描述您的问题或需求..."
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                >
                  {submitted ? (
                    <>✓ 消息已发送</>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      发送消息
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* 公司信息 */}
            <div className="space-y-8">
              <div className="p-8 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border border-cyan-500/20">
                <h2 className="text-2xl font-bold text-white mb-6">公司信息</h2>
                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-6 h-6 text-cyan-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white mb-1">DataReach Pro Pte. Ltd.</h3>
                      <p className="text-slate-400">新加坡注册公司</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white mb-1">总部地址</h3>
                      <p className="text-slate-400">One Raffles Place Tower 2<br />1 Raffles Place, Singapore 048616</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
                      <Clock className="w-6 h-6 text-green-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white mb-1">营业时间</h3>
                      <p className="text-slate-400">周一至周五：9:00 - 18:00 (SGT)<br />周末及节假日：在线客服</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 常见问题 */}
              <div className="p-8 rounded-2xl bg-slate-800/50 border border-slate-700/50">
                <h2 className="text-2xl font-bold text-white mb-6">常见问题</h2>
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50">
                    <h3 className="text-white font-medium mb-2">如何开始使用？</h3>
                    <p className="text-slate-400 text-sm">注册账户后即可获得免费试用积分，立即体验我们的服务。</p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50">
                    <h3 className="text-white font-medium mb-2">数据准确率如何保证？</h3>
                    <p className="text-slate-400 text-sm">我们采用多源交叉验证系统，确保数据准确率达到95%以上。</p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50">
                    <h3 className="text-white font-medium mb-2">支持哪些支付方式？</h3>
                    <p className="text-slate-400 text-sm">目前支持 USDT-TRC20 充值，更多支付方式即将上线。</p>
                  </div>
                </div>
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
