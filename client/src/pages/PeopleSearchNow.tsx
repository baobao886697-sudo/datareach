import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Rocket, 
  Search, 
  Phone, 
  MapPin, 
  Users, 
  Shield, 
  Zap, 
  Clock,
  CheckCircle2,
  Star,
  ArrowRight,
  Bell
} from "lucide-react";
import { useState } from "react";

export default function PeopleSearchNow() {
  const [isSubscribed, setIsSubscribed] = useState(false);

  const features = [
    {
      icon: Search,
      title: "智能姓名搜索",
      description: "通过姓名快速定位目标人员，支持模糊匹配和精确搜索"
    },
    {
      icon: Phone,
      title: "反向电话查询",
      description: "输入电话号码，即刻获取机主详细信息和关联数据"
    },
    {
      icon: MapPin,
      title: "地址关联查询",
      description: "查找与特定地址关联的所有人员，包括历史住户信息"
    },
    {
      icon: Shield,
      title: "背景调查报告",
      description: "全面的公共记录搜索，包括社交媒体、工作经历等"
    }
  ];

  const advantages = [
    "覆盖数亿美国公民的公共记录数据库",
    "实时数据更新，确保信息准确性",
    "多维度交叉验证，提高搜索精度",
    "简洁直观的操作界面，快速上手"
  ];

  return (
    <div className="min-h-screen p-6 md:p-8">
      {/* 顶部横幅 */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-green-500 to-teal-500 p-8 md:p-12 mb-8">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIj48cGF0aCBkPSJNMzYgMzRjMC0yLjIgMS44LTQgNC00czQgMS44IDQgNC0xLjggNC00IDQtNC0xLjgtNC00eiIvPjwvZz48L2c+PC9zdmc+')] opacity-30"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/30">
              <Rocket className="w-3 h-3 mr-1" />
              即将上线
            </Badge>
            <Badge className="bg-yellow-400/20 text-yellow-100 border-yellow-400/30">
              <Star className="w-3 h-3 mr-1" />
              新功能
            </Badge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
            PeopleSearchNow
          </h1>
          <p className="text-lg text-white/90 max-w-2xl mb-6">
            美国领先的人员搜索引擎，快速、准确、全面。通过姓名、电话或地址，
            即刻获取您需要的联系人信息。
          </p>
          <div className="flex items-center gap-4 text-white/80 text-sm">
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>即将上线</span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              <span>敬请期待</span>
            </div>
          </div>
        </div>
      </div>

      {/* 功能介绍 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {features.map((feature, index) => (
          <Card key={index} className="bg-card/50 border-emerald-500/20 hover:border-emerald-500/40 transition-all hover:shadow-lg hover:shadow-emerald-500/5">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500/20 to-green-500/20">
                  <feature.icon className="w-5 h-5 text-emerald-400" />
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-muted-foreground">
                {feature.description}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 优势列表 */}
      <Card className="bg-gradient-to-br from-emerald-500/5 to-green-500/5 border-emerald-500/20 mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-400" />
            为什么选择 PeopleSearchNow？
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {advantages.map((advantage, index) => (
              <div key={index} className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-sm text-muted-foreground">{advantage}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 订阅通知 */}
      <Card className="bg-card/50 border-dashed border-2 border-emerald-500/30">
        <CardContent className="p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500/20 to-green-500/20 flex items-center justify-center mx-auto mb-4">
            <Bell className="w-8 h-8 text-emerald-400" />
          </div>
          <h3 className="text-xl font-semibold mb-2">功能开发中</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            我们正在努力开发 PeopleSearchNow 集成功能，上线后将第一时间通知您。
            敬请期待！
          </p>
          <Button 
            onClick={() => setIsSubscribed(true)}
            disabled={isSubscribed}
            className={`${isSubscribed 
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
              : 'bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400'
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
            <p className="text-sm text-emerald-400 mt-3">
              感谢您的关注！功能上线后我们会通过系统通知告知您。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
