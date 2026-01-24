import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Rocket, 
  Twitter, 
  Facebook, 
  Building2, 
  Brain, 
  Mail, 
  FileSpreadsheet, 
  Link2, 
  Chrome, 
  Users, 
  Code, 
  Sparkles,
  Clock,
  CheckCircle2,
  Circle,
  Zap,
  Globe,
  Shield,
  TrendingUp,
  MessageSquare,
  Calendar,
  Star,
  UserSearch
} from "lucide-react";

interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: "completed" | "in-progress" | "planned" | "coming-soon";
  progress?: number;
  eta?: string;
  features?: string[];
  category: "data-source" | "ai" | "automation" | "integration" | "analytics";
}

const roadmapItems: RoadmapItem[] = [
  // 已完成
  {
    id: "linkedin",
    title: "LinkedIn 数据搜索",
    description: "整合 LinkedIn 平台数据，支持模糊搜索和精准搜索两种模式，获取全球商业联系人信息",
    icon: Globe,
    status: "completed",
    progress: 100,
    category: "data-source",
    features: ["模糊搜索", "精准搜索", "年龄筛选", "职位筛选", "地区筛选"]
  },
  {
    id: "truepeoplesearch",
    title: "TruePeopleSearch 数据搜索",
    description: "整合美国 TruePeopleSearch 平台数据，通过姓名和地区精准定位目标人群，获取电话号码等联系方式",
    icon: UserSearch,
    status: "completed",
    progress: 100,
    category: "data-source",
    features: ["姓名搜索", "地区筛选", "年龄筛选", "运营商过滤", "电话类型筛选", "缓存优化"]
  },
  // 开发中
  {
    id: "twitter",
    title: "Twitter/X 数据搜索",
    description: "通过 Twitter/X 平台获取决策者的社交媒体信息，了解其兴趣和动态",
    icon: Twitter,
    status: "in-progress",
    progress: 65,
    eta: "2026年2月",
    category: "data-source",
    features: ["用户资料获取", "推文分析", "关注者数据", "话题追踪"]
  },
  {
    id: "ai-email",
    title: "AI 智能邮件撰写",
    description: "基于目标客户画像，AI 自动生成个性化的开发信和跟进邮件",
    icon: Mail,
    status: "in-progress",
    progress: 45,
    eta: "2026年2月",
    category: "ai",
    features: ["个性化模板", "多语言支持", "A/B 测试", "发送时机优化"]
  },
  {
    id: "batch-export",
    title: "批量导出功能",
    description: "一键将搜索结果导出为 Excel、CSV 等格式，方便进一步处理和分析",
    icon: FileSpreadsheet,
    status: "in-progress",
    progress: 80,
    eta: "2026年1月底",
    category: "automation",
    features: ["Excel 导出", "CSV 导出", "自定义字段", "批量下载"]
  },
  // 计划中
  {
    id: "facebook",
    title: "Facebook 商业数据",
    description: "获取 Facebook 企业页面和营销决策者信息，拓展社交媒体数据源",
    icon: Facebook,
    status: "planned",
    eta: "2026年Q1",
    category: "data-source",
    features: ["企业页面数据", "广告主信息", "受众分析", "互动数据"]
  },
  {
    id: "company-data",
    title: "企业工商数据",
    description: "整合中国企业工商信息，包括注册信息、股东结构、经营状况等",
    icon: Building2,
    status: "planned",
    eta: "2026年Q1",
    category: "data-source",
    features: ["工商注册信息", "股东结构", "经营范围", "信用评级"]
  },
  {
    id: "ai-recommend",
    title: "AI 智能推荐",
    description: "基于您的搜索历史和偏好，AI 自动推荐相似的潜在客户",
    icon: Brain,
    status: "planned",
    eta: "2026年Q2",
    category: "ai",
    features: ["相似客户推荐", "行业趋势分析", "最佳联系时机", "成功率预测"]
  },
  {
    id: "crm-integration",
    title: "CRM 系统集成",
    description: "与 Salesforce、HubSpot 等主流 CRM 系统无缝对接，自动同步联系人数据",
    icon: Link2,
    status: "planned",
    eta: "2026年Q2",
    category: "integration",
    features: ["Salesforce 集成", "HubSpot 集成", "双向同步", "自动更新"]
  },
  // 即将推出
  {
    id: "chrome-extension",
    title: "Chrome 浏览器扩展",
    description: "在浏览 LinkedIn 等网站时，一键获取联系人信息并保存到平台",
    icon: Chrome,
    status: "coming-soon",
    eta: "2026年Q2",
    category: "automation",
    features: ["一键保存", "实时验证", "快速搜索", "数据同步"]
  },
  {
    id: "team-collaboration",
    title: "团队协作功能",
    description: "支持多用户共享搜索结果、分配任务、协同跟进客户",
    icon: Users,
    status: "coming-soon",
    eta: "2026年Q3",
    category: "analytics",
    features: ["团队空间", "任务分配", "进度追踪", "权限管理"]
  },
  {
    id: "api",
    title: "开放 API 接口",
    description: "提供 RESTful API，让开发者可以将 DataReach 数据集成到自己的系统中",
    icon: Code,
    status: "coming-soon",
    eta: "2026年Q3",
    category: "integration",
    features: ["RESTful API", "Webhook 支持", "SDK 工具包", "开发者文档"]
  },
  {
    id: "analytics-dashboard",
    title: "高级数据分析",
    description: "可视化仪表盘，深入分析搜索效果、转化率、ROI 等关键指标",
    icon: TrendingUp,
    status: "coming-soon",
    eta: "2026年Q3",
    category: "analytics",
    features: ["转化漏斗", "ROI 分析", "趋势图表", "自定义报告"]
  }
];

const statusConfig = {
  "completed": { 
    label: "已完成", 
    color: "bg-green-500/20 text-green-400 border-green-500/30",
    icon: CheckCircle2,
    bgGradient: "from-green-500/10 to-emerald-500/5"
  },
  "in-progress": { 
    label: "开发中", 
    color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    icon: Zap,
    bgGradient: "from-blue-500/10 to-cyan-500/5"
  },
  "planned": { 
    label: "计划中", 
    color: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    icon: Calendar,
    bgGradient: "from-purple-500/10 to-pink-500/5"
  },
  "coming-soon": { 
    label: "即将推出", 
    color: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    icon: Star,
    bgGradient: "from-orange-500/10 to-amber-500/5"
  }
};

const categoryConfig = {
  "data-source": { label: "数据源", color: "bg-cyan-500/20 text-cyan-400" },
  "ai": { label: "AI 功能", color: "bg-purple-500/20 text-purple-400" },
  "automation": { label: "自动化", color: "bg-green-500/20 text-green-400" },
  "integration": { label: "集成", color: "bg-blue-500/20 text-blue-400" },
  "analytics": { label: "分析", color: "bg-orange-500/20 text-orange-400" }
};

export default function Roadmap() {
  const completedCount = roadmapItems.filter(item => item.status === "completed").length;
  const inProgressCount = roadmapItems.filter(item => item.status === "in-progress").length;
  const plannedCount = roadmapItems.filter(item => item.status === "planned" || item.status === "coming-soon").length;
  const overallProgress = Math.round((completedCount / roadmapItems.length) * 100);

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30">
              <Rocket className="h-8 w-8 text-purple-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
                产品路线图
              </h1>
              <p className="text-slate-400 mt-1">
                探索 DataReach Pro 即将推出的强大功能
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
            <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">总体进度</p>
                    <p className="text-2xl font-bold text-white">{overallProgress}%</p>
                  </div>
                  <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20">
                    <TrendingUp className="h-5 w-5 text-purple-400" />
                  </div>
                </div>
                <Progress value={overallProgress} className="mt-3 h-2" />
              </CardContent>
            </Card>

            <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">已完成</p>
                    <p className="text-2xl font-bold text-green-400">{completedCount}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-green-500/20">
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">开发中</p>
                    <p className="text-2xl font-bold text-blue-400">{inProgressCount}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-blue-500/20">
                    <Zap className="h-5 w-5 text-blue-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">计划中</p>
                    <p className="text-2xl font-bold text-purple-400">{plannedCount}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-purple-500/20">
                    <Calendar className="h-5 w-5 text-purple-400" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Roadmap Items */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {roadmapItems.map((item) => {
            const StatusIcon = statusConfig[item.status].icon;
            const ItemIcon = item.icon;
            
            return (
              <Card 
                key={item.id} 
                className={`bg-gradient-to-br ${statusConfig[item.status].bgGradient} border-slate-700/50 backdrop-blur-sm hover:border-slate-600/50 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/5`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/50">
                        <ItemIcon className="h-5 w-5 text-cyan-400" />
                      </div>
                      <div>
                        <CardTitle className="text-lg text-white">{item.title}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className={categoryConfig[item.category].color}>
                            {categoryConfig[item.category].label}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className={statusConfig[item.status].color}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {statusConfig[item.status].label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-slate-400 mb-4">
                    {item.description}
                  </CardDescription>

                  {item.progress !== undefined && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-sm mb-2">
                        <span className="text-slate-400">开发进度</span>
                        <span className="text-white font-medium">{item.progress}%</span>
                      </div>
                      <Progress value={item.progress} className="h-2" />
                    </div>
                  )}

                  {item.eta && (
                    <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
                      <Clock className="h-4 w-4" />
                      <span>预计上线：{item.eta}</span>
                    </div>
                  )}

                  {item.features && (
                    <div className="flex flex-wrap gap-2">
                      {item.features.map((feature, index) => (
                        <Badge 
                          key={index} 
                          variant="outline" 
                          className="bg-slate-800/50 text-slate-300 border-slate-700/50 text-xs"
                        >
                          {feature}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Feature Request CTA */}
        <Card className="mt-8 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-cyan-500/10 border-purple-500/30 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30">
                  <MessageSquare className="h-6 w-6 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">有功能建议？</h3>
                  <p className="text-slate-400">我们非常重视您的反馈，欢迎提出新功能建议</p>
                </div>
              </div>
              <a 
                href="/feedback" 
                className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-medium transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/25"
              >
                提交建议
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
