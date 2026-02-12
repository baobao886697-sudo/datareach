import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Rocket, 
  Search, 
  Phone, 
  Mail, 
  MapPin, 
  Users, 
  Shield, 
  Zap, 
  Clock,
  CheckCircle2,
  Star,
  Bell,
  Globe,
  Heart,
  Building2,
  Briefcase,
  Home,
  UserCheck,
  FileText,
  Calendar,
  AlertTriangle,
  Sparkles,
  Crown,
  Award
} from "lucide-react";
import { useState } from "react";

export default function Anywho() {
  const [isSubscribed, setIsSubscribed] = useState(false);

  // 数据字段可用性表格
  const dataFields = [
    { field: "年龄 & 性别", status: "complete", statusText: "完整", icon: UserCheck },
    { field: "完整地址", status: "complete", statusText: "完整", icon: MapPin },
    { field: "电话号码", status: "multiple", statusText: "多个", icon: Phone },
    { field: "邮箱地址", status: "partial", statusText: "部分遮盖", icon: Mail },
    { field: "社交媒体档案", status: "complete", statusText: "支持", icon: Users },
    { field: "约会档案", status: "complete", statusText: "支持", icon: Heart },
    { field: "就业历史", status: "complete", statusText: "支持", icon: Briefcase },
    { field: "家庭成员信息", status: "complete", statusText: "支持", icon: Users },
    { field: "房产所有权", status: "complete", statusText: "支持", icon: Home },
    { field: "婚姻状况", status: "highlight", statusText: "明确显示", icon: Heart },
    { field: "犯罪记录", status: "premium", statusText: "高级功能", icon: Shield },
  ];

  const searchMethods = [
    { title: "姓名搜索", description: "输入姓名 + 城市/州，精准定位目标人员" },
    { title: "电话反查", description: "输入电话号码查找机主详细信息" },
    { title: "地址搜索", description: "输入地址查找居住者及历史住户" },
    { title: "邮箱搜索", description: "输入邮箱查找关联人员信息" },
  ];

  const whyReliable = [
    { 
      title: "AT&T 背书", 
      description: "作为美国最大电信公司之一的子公司，数据来源于官方电话目录和政府记录",
      icon: Building2
    },
    { 
      title: "历史悠久", 
      description: "1994年成立，运营超过30年，是行业内最可靠的数据提供商之一",
      icon: Calendar
    },
    { 
      title: "数据规模大", 
      description: "120亿条记录，覆盖美国全境，数据全面且准确",
      icon: Globe
    },
    { 
      title: "持续更新", 
      description: "官方声明每周更新数据，确保信息的时效性和准确性",
      icon: Zap
    },
  ];

  const features = [
    {
      icon: Search,
      title: "智能人员搜索",
      description: "通过姓名、电话、地址等多维度快速定位目标人员"
    },
    {
      icon: Phone,
      title: "反向电话查询",
      description: "输入任意电话号码，获取机主完整信息"
    },
    {
      icon: MapPin,
      title: "地址历史追踪",
      description: "查看任意地址的现任和历史住户信息"
    },
    {
      icon: Briefcase,
      title: "就业历史",
      description: "了解目标人员的工作经历和职业背景"
    },
    {
      icon: Users,
      title: "家庭关系网络",
      description: "发现目标人员的家庭成员和亲属关系"
    },
    {
      icon: Home,
      title: "房产信息",
      description: "查询房产所有权和不动产记录"
    }
  ];

  return (
    <div className="min-h-screen p-6 md:p-8">
      {/* 七彩鎏金动画样式 */}
      <style>{`
        @keyframes rainbow-flow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        
        @keyframes pulse-glow {
          0%, 100% {
            box-shadow: 0 0 20px rgba(255, 215, 0, 0.4),
                        0 0 40px rgba(255, 165, 0, 0.3),
                        0 0 60px rgba(255, 105, 180, 0.2);
          }
          50% {
            box-shadow: 0 0 30px rgba(255, 215, 0, 0.6),
                        0 0 60px rgba(255, 165, 0, 0.5),
                        0 0 90px rgba(255, 105, 180, 0.4);
          }
        }

        @keyframes heart-beat {
          0%, 100% { transform: scale(1); }
          25% { transform: scale(1.1); }
          50% { transform: scale(1); }
          75% { transform: scale(1.15); }
        }
        
        @keyframes border-dance {
          0%, 100% { border-color: #ffd700; }
          16% { border-color: #ff6b6b; }
          33% { border-color: #ff69b4; }
          50% { border-color: #9b59b6; }
          66% { border-color: #3498db; }
          83% { border-color: #2ecc71; }
        }

        @keyframes sparkle {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }

        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        
        .rainbow-text {
          background: linear-gradient(
            90deg,
            #ffd700, #ffb347, #ff6b6b, #ff69b4, #9b59b6, #3498db, #2ecc71, #ffd700
          );
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 3s linear infinite;
        }
        
        .rainbow-border {
          border: 3px solid transparent;
          animation: border-dance 4s linear infinite;
        }
        
        .rainbow-glow {
          animation: pulse-glow 2s ease-in-out infinite;
        }
        
        .rainbow-bg {
          background: linear-gradient(
            135deg,
            rgba(255, 215, 0, 0.15),
            rgba(255, 179, 71, 0.15),
            rgba(255, 107, 107, 0.15),
            rgba(255, 105, 180, 0.15),
            rgba(155, 89, 182, 0.15),
            rgba(52, 152, 219, 0.15),
            rgba(46, 204, 113, 0.15)
          );
          background-size: 400% 400%;
          animation: rainbow-flow 8s ease infinite;
        }

        .heart-pulse {
          animation: heart-beat 1.5s ease-in-out infinite;
        }

        .sparkle-effect {
          animation: sparkle 2s ease-in-out infinite;
        }

        .float-effect {
          animation: float 3s ease-in-out infinite;
        }

        .marriage-card {
          background: linear-gradient(
            135deg,
            rgba(255, 0, 128, 0.1),
            rgba(255, 105, 180, 0.15),
            rgba(255, 20, 147, 0.1),
            rgba(219, 112, 147, 0.15)
          );
          background-size: 400% 400%;
          animation: rainbow-flow 6s ease infinite;
        }

        .gold-shimmer {
          background: linear-gradient(
            90deg,
            #ffd700 0%,
            #fff8dc 25%,
            #ffd700 50%,
            #fff8dc 75%,
            #ffd700 100%
          );
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 2s linear infinite;
        }
      `}</style>

      {/* 顶部横幅 - 七彩鎏金效果 */}
      <div className="relative overflow-hidden rounded-2xl rainbow-border rainbow-glow p-8 md:p-12 mb-8">
        <div className="absolute inset-0 rainbow-bg"></div>
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-pink-500/10 to-purple-500/10"></div>
        <div className="absolute top-4 right-4 float-effect">
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-to-r from-yellow-400 via-orange-500 to-pink-500">
            <Star className="w-4 h-4 text-white fill-white sparkle-effect" />
            <span className="text-white font-bold text-sm">推荐</span>
          </div>
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/30">
              <Rocket className="w-3 h-3 mr-1" />
              即将上线
            </Badge>
            <Badge className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white border-0">
              <Crown className="w-3 h-3 mr-1" />
              AT&T 官方数据
            </Badge>
            <Badge className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-0 animate-pulse">
              <Heart className="w-3 h-3 mr-1" />
              婚姻状况查询
            </Badge>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold mb-4">
            <span className="rainbow-text">Anywho</span>
            <span className="ml-3 inline-flex items-center">
              <Star className="w-8 h-8 text-yellow-400 fill-yellow-400 sparkle-effect" />
            </span>
          </h1>
          <p className="text-lg text-white/90 max-w-2xl mb-6">
            AT&T 旗下权威人员搜索平台，拥有超过 <span className="font-bold text-yellow-300">120亿条</span> 记录。
            提供最全面的个人信息查询服务，包括<span className="font-bold text-pink-300">婚姻状况</span>、
            家庭成员、就业历史、房产信息等。
          </p>
          <div className="flex flex-wrap items-center gap-4 text-white/80 text-sm">
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>预计上线：2026年Q1</span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              <span>敬请期待</span>
            </div>
            <div className="flex items-center gap-1">
              <Award className="w-4 h-4" />
              <span>30年行业经验</span>
            </div>
          </div>
        </div>
      </div>

      {/* 🌈💖 婚姻状况查询 - 超级醒目的特效卡片 */}
      <div className="mb-8">
        <Card className="rainbow-border rainbow-glow overflow-hidden relative marriage-card">
          <div className="absolute inset-0 bg-gradient-to-r from-pink-500/5 via-red-500/5 to-purple-500/5"></div>
          <CardContent className="p-8 relative z-10">
            <div className="flex flex-col lg:flex-row items-center gap-8">
              {/* 左侧大图标 */}
              <div className="relative">
                <div className="w-28 h-28 rounded-full bg-gradient-to-br from-pink-500/30 to-red-500/30 flex items-center justify-center rainbow-glow">
                  <Heart className="w-16 h-16 text-pink-400 heart-pulse" style={{
                    filter: 'drop-shadow(0 0 20px rgba(255, 105, 180, 0.8))'
                  }} />
                </div>
                <div className="absolute -top-2 -right-2 w-10 h-10 rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 flex items-center justify-center animate-bounce">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div className="absolute -bottom-1 -left-1 w-8 h-8 rounded-full bg-gradient-to-r from-purple-400 to-pink-500 flex items-center justify-center sparkle-effect">
                  <Star className="w-4 h-4 text-white fill-white" />
                </div>
              </div>
              
              {/* 中间内容 */}
              <div className="flex-1 text-center lg:text-left">
                <div className="flex items-center justify-center lg:justify-start gap-3 mb-3 flex-wrap">
                  <h3 className="text-3xl md:text-4xl font-bold rainbow-text">
                    婚姻状况查询
                  </h3>
                  <Badge className="bg-gradient-to-r from-pink-500 via-red-500 to-purple-500 text-white border-0 text-sm px-3 py-1 animate-pulse">
                    <Crown className="w-3 h-3 mr-1" />
                    独家功能
                  </Badge>
                </div>
                <p className="text-muted-foreground mb-5 max-w-2xl text-base">
                  <span className="text-pink-400 font-semibold">全网最准确的婚姻状况信息！</span>
                  通过整合政府婚姻登记记录、法院档案、社交媒体分析等多源数据，
                  为您提供目标人员的<span className="text-yellow-400 font-semibold">真实婚姻状况</span>。
                  无论是商务背调还是个人了解，都能获得可靠信息。
                </p>
                
                {/* 婚姻状况类型展示 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/30">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span className="text-sm text-green-400">单身</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-pink-500/10 border border-pink-500/30">
                    <div className="w-3 h-3 rounded-full bg-pink-500"></div>
                    <span className="text-sm text-pink-400">已婚</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
                    <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                    <span className="text-sm text-orange-400">离异</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-500/10 border border-purple-500/30">
                    <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                    <span className="text-sm text-purple-400">丧偶</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4">
                  <div className="flex items-center gap-1 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    <span className="text-muted-foreground">政府婚姻登记</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    <span className="text-muted-foreground">法院离婚记录</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    <span className="text-muted-foreground">社交状态分析</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    <span className="text-muted-foreground">约会档案关联</span>
                  </div>
                </div>
              </div>
              
              {/* 右侧标签 */}
              <div className="flex flex-col items-center gap-3">
                <div className="px-5 py-3 rounded-full bg-gradient-to-r from-yellow-400 via-pink-500 to-purple-500 text-white font-bold animate-pulse shadow-lg shadow-pink-500/30">
                  ✨ 即将推出
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold gold-shimmer">95%+</div>
                  <div className="text-xs text-muted-foreground">准确率</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 数据字段可用性表格 */}
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <FileText className="w-5 h-5 text-amber-400" />
        数据字段可用性
      </h2>
      <Card className="mb-8 bg-card/50 border-amber-500/20">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-500/20 bg-amber-500/5">
                  <th className="text-left p-4 font-semibold">数据字段</th>
                  <th className="text-center p-4 font-semibold">实测可用性</th>
                </tr>
              </thead>
              <tbody>
                {dataFields.map((item, index) => (
                  <tr key={index} className={`border-b border-gray-800 hover:bg-gray-800/30 transition-colors ${item.status === 'highlight' ? 'rainbow-bg' : ''}`}>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <item.icon className={`w-5 h-5 ${item.status === 'highlight' ? 'text-pink-400' : 'text-gray-400'}`} />
                        <span className={item.status === 'highlight' ? 'font-bold text-pink-400' : ''}>{item.field}</span>
                        {item.status === 'highlight' && (
                          <Badge className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-0 text-xs">
                            特色功能
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {item.status === 'complete' && (
                          <>
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                            <span className="text-green-400">{item.statusText}</span>
                          </>
                        )}
                        {item.status === 'multiple' && (
                          <>
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                            <span className="text-green-400">{item.statusText}</span>
                          </>
                        )}
                        {item.status === 'partial' && (
                          <>
                            <AlertTriangle className="w-5 h-5 text-yellow-500" />
                            <span className="text-yellow-400">{item.statusText}</span>
                          </>
                        )}
                        {item.status === 'highlight' && (
                          <>
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                            <span className="text-green-400 font-bold">{item.statusText}</span>
                            <Heart className="w-4 h-4 text-pink-400 heart-pulse" />
                          </>
                        )}
                        {item.status === 'premium' && (
                          <>
                            <Crown className="w-5 h-5 text-amber-500" />
                            <span className="text-amber-400">{item.statusText}</span>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 搜索方式 */}
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Search className="w-5 h-5 text-amber-400" />
        搜索方式
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {searchMethods.map((method, index) => (
          <Card key={index} className="bg-card/50 border-amber-500/20 hover:border-amber-500/40 transition-all">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold">
                  {index + 1}
                </div>
                <div>
                  <h3 className="font-semibold text-amber-400">{method.title}</h3>
                  <p className="text-sm text-muted-foreground">{method.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 为什么数据可靠 */}
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Shield className="w-5 h-5 text-amber-400" />
        为什么 Anywho 数据可靠？
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {whyReliable.map((item, index) => (
          <Card key={index} className="bg-card/50 border-amber-500/20 hover:border-amber-500/40 transition-all hover:shadow-lg hover:shadow-amber-500/5">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                  <item.icon className="w-5 h-5 text-amber-400" />
                </div>
                <CardTitle className="text-base text-amber-400">{item.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-muted-foreground text-sm">
                {item.description}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 核心功能 */}
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Zap className="w-5 h-5 text-amber-400" />
        核心功能
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {features.map((feature, index) => (
          <Card key={index} className="bg-card/50 border-amber-500/20 hover:border-amber-500/40 transition-all hover:shadow-lg hover:shadow-amber-500/5">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                  <feature.icon className="w-5 h-5 text-amber-400" />
                </div>
                <CardTitle className="text-base">{feature.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-muted-foreground text-sm">
                {feature.description}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 覆盖范围说明 */}
      <Card className="mb-8 bg-gradient-to-br from-amber-500/5 to-orange-500/5 border-amber-500/20">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-amber-500/20">
              <Globe className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-amber-400 mb-2">覆盖范围</h3>
              <p className="text-muted-foreground">
                Anywho 仅覆盖<span className="text-amber-400 font-semibold">美国境内人员</span>，
                不包含其他国家的数据。这是因为其数据来源主要是美国的公开记录系统，
                包括电话目录、政府档案、法院记录等。如需查询其他国家人员，
                请使用我们平台的其他搜索工具。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 订阅通知 */}
      <Card className="bg-card/50 border-dashed border-2 border-amber-500/30">
        <CardContent className="p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mx-auto mb-4">
            <Bell className="w-8 h-8 text-amber-400" />
          </div>
          <h3 className="text-xl font-semibold mb-2">功能开发中</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            我们正在努力开发 Anywho 集成功能，上线后您将能够使用
            AT&T 官方数据进行人员搜索，包括独家的婚姻状况查询。敬请期待！
          </p>
          <Button 
            onClick={() => setIsSubscribed(true)}
            disabled={isSubscribed}
            className={`${isSubscribed 
              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' 
              : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400'
            }`}
          >
            {isSubscribed ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                已订阅通知
              </>
            ) : (
              <>
                <Bell className="w-4 h-4 mr-2" />
                订阅上线通知
              </>
            )}
          </Button>
          {isSubscribed && (
            <p className="text-sm text-amber-400 mt-3">
              感谢您的关注！功能上线后我们会通过系统通知告知您。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
