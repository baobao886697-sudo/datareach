/**
 * LinkedIn 搜索页面 - 黄金模板 v2.0
 * 统一 UI 风格，保留 LinkedIn 独特功能
 */

import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Search as SearchIcon, Loader2, AlertCircle, Info, Zap, Target, MapPin, 
  Briefcase, User, Sparkles, Users, Calendar, ChevronRight, Coins,
  CheckCircle2, AlertTriangle, Eye, Database, Shield, TrendingUp,
  ArrowRight, RefreshCw, Rocket, ArrowLeft, Clock, History, Star, Home,
  Phone, Crown, Building, Globe, Linkedin
} from "lucide-react";

// 七彩鎏金动画样式 - 与其他搜索系统统一
const rainbowStyles = `
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
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.4),
                  0 0 40px rgba(99, 102, 241, 0.3),
                  0 0 60px rgba(139, 92, 246, 0.2);
    }
    50% {
      box-shadow: 0 0 30px rgba(59, 130, 246, 0.6),
                  0 0 60px rgba(99, 102, 241, 0.5),
                  0 0 90px rgba(139, 92, 246, 0.4);
    }
  }
  
  @keyframes border-dance {
    0%, 100% { border-color: #3b82f6; }
    16% { border-color: #6366f1; }
    33% { border-color: #8b5cf6; }
    50% { border-color: #a855f7; }
    66% { border-color: #06b6d4; }
    83% { border-color: #10b981; }
  }
  
  @keyframes star-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.2); opacity: 0.8; }
  }
  
  .rainbow-text {
    background: linear-gradient(90deg, #3b82f6, #6366f1, #8b5cf6, #a855f7, #06b6d4, #10b981, #3b82f6);
    background-size: 200% auto;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer 3s linear infinite;
  }
  
  .rainbow-border {
    border: 2px solid transparent;
    animation: border-dance 4s linear infinite;
  }
  
  .rainbow-glow {
    animation: pulse-glow 2s ease-in-out infinite;
  }
  
  .rainbow-bg {
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.15), rgba(168, 85, 247, 0.15), rgba(6, 182, 212, 0.15), rgba(16, 185, 129, 0.15));
    background-size: 400% 400%;
    animation: rainbow-flow 8s ease infinite;
  }
  
  .rainbow-btn {
    background: linear-gradient(135deg, #3b82f6, #6366f1, #8b5cf6, #a855f7);
    background-size: 300% 300%;
    animation: rainbow-flow 3s ease infinite;
  }
  
  .rainbow-btn:hover {
    transform: scale(1.02);
    box-shadow: 0 0 30px rgba(59, 130, 246, 0.5);
  }
  
  .star-pulse {
    animation: star-pulse 1.5s ease-in-out infinite;
  }
  
  .recommend-badge {
    background: linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%);
    background-size: 200% 200%;
    animation: rainbow-flow 2s ease infinite;
  }
  
  @keyframes float-slow {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-10px); }
  }
  
  @keyframes float-medium {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-15px); }
  }
  
  @keyframes float-fast {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-20px); }
  }
  
  .animate-float-slow { animation: float-slow 4s ease-in-out infinite; }
  .animate-float-medium { animation: float-medium 3s ease-in-out infinite; }
  .animate-float-fast { animation: float-fast 2s ease-in-out infinite; }
`;

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming"
];

// 搜索数量选项
const SEARCH_LIMITS = [
  { value: 100, label: "100 条", description: "快速测试", recommended: true },
  { value: 500, label: "500 条", description: "小批量" },
  { value: 1000, label: "1000 条", description: "标准搜索" },
  { value: 5000, label: "5000 条", description: "大批量" },
];

// 积分费用默认值（当 API 未返回时使用）
const DEFAULT_FUZZY_SEARCH_COST = 1;
const DEFAULT_FUZZY_PHONE_COST_PER_PERSON = 2;
const DEFAULT_EXACT_SEARCH_COST = 5;
const DEFAULT_EXACT_PHONE_COST_PER_PERSON = 10;

// 加载状态提示信息
const LOADING_MESSAGES = [
  { text: "正在创建搜索任务...", duration: 2000 },
  { text: "正在初始化搜索引擎...", duration: 2000 },
  { text: "正在连接数据源...", duration: 2000 },
  { text: "即将开始搜索...", duration: 2000 },
];

export default function Search() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  
  // 搜索条件
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [state, setState] = useState("");
  const [searchLimit, setSearchLimit] = useState(100);
  const [customLimit, setCustomLimit] = useState("");
  
  // 年龄筛选（默认启用，范围 50-79）
  const [enableAgeFilter, setEnableAgeFilter] = useState(true);
  const [ageRange, setAgeRange] = useState<[number, number]>([50, 79]);
  
  // 电话验证开关
  const [enableVerification, setEnableVerification] = useState(true);

  // 搜索模式
  const [searchMode, setSearchMode] = useState<'fuzzy' | 'exact'>('fuzzy');
  
  // 高级选项展开状态
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // 预览结果
  const [previewResult, setPreviewResult] = useState<{
    success: boolean;
    totalAvailable: number;
    estimatedCredits: number;
    canAfford: boolean;
    userCredits: number;
    maxAffordable: number;
    cacheHit: boolean;
    message: string;
  } | null>(null);
  
  // 确认对话框
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  
  // 全屏加载状态
  const [isSearching, setIsSearching] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0].text);
  const [loadingProgress, setLoadingProgress] = useState(0);

  const { data: profile, refetch: refetchProfile } = trpc.user.profile.useQuery(undefined, { enabled: !!user });

  // 获取积分配置
  const { data: creditsConfig } = trpc.search.creditsConfig.useQuery(undefined, { enabled: !!user });
  
  // 动态积分值（优先使用 API 返回的配置，否则使用默认值）
  const FUZZY_SEARCH_COST = creditsConfig?.fuzzy?.searchCredits ?? DEFAULT_FUZZY_SEARCH_COST;
  const FUZZY_PHONE_COST_PER_PERSON = creditsConfig?.fuzzy?.creditsPerPerson ?? DEFAULT_FUZZY_PHONE_COST_PER_PERSON;
  const EXACT_SEARCH_COST = creditsConfig?.exact?.searchCredits ?? DEFAULT_EXACT_SEARCH_COST;
  const EXACT_PHONE_COST_PER_PERSON = creditsConfig?.exact?.creditsPerPerson ?? DEFAULT_EXACT_PHONE_COST_PER_PERSON;

  // 加载动画效果
  useEffect(() => {
    if (!isSearching) {
      setLoadingMessage(LOADING_MESSAGES[0].text);
      setLoadingProgress(0);
      return;
    }

    let messageIndex = 0;
    let progressInterval: NodeJS.Timeout;
    
    // 更新提示信息
    const messageInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % LOADING_MESSAGES.length;
      setLoadingMessage(LOADING_MESSAGES[messageIndex].text);
    }, 2000);

    // 更新进度条（模拟进度）
    progressInterval = setInterval(() => {
      setLoadingProgress(prev => {
        if (prev >= 90) return prev; // 最多到90%，等待实际完成
        return prev + Math.random() * 10;
      });
    }, 500);

    return () => {
      clearInterval(messageInterval);
      clearInterval(progressInterval);
    };
  }, [isSearching]);

  // 预览搜索
  const previewMutation = trpc.search.preview.useMutation({
    onSuccess: (data) => {
      setPreviewResult(data);
      setShowPreviewDialog(true);
    },
    onError: (error) => {
      toast.error(error.message || "预览搜索失败");
    },
  });

  const searchMutation = trpc.search.start.useMutation({
    onSuccess: (data) => {
      setLoadingProgress(100);
      setLoadingMessage("搜索任务创建成功！正在跳转...");
      
      // 短暂延迟后跳转，让用户看到成功状态
      setTimeout(() => {
        setIsSearching(false);
        setShowConfirmDialog(false);
        setShowPreviewDialog(false);
        if (data.taskId) {
          setLocation(`/progress/${data.taskId}`);
        }
      }, 800);
    },
    onError: (error) => {
      setIsSearching(false);
      toast.error(error.message || "搜索失败");
      setShowConfirmDialog(false);
    },
  });

  // 计算积分预估
  const creditEstimate = useMemo(() => {
    const searchCost = searchMode === 'fuzzy' ? FUZZY_SEARCH_COST : EXACT_SEARCH_COST;
    const phoneCostPerPerson = searchMode === 'fuzzy' ? FUZZY_PHONE_COST_PER_PERSON : EXACT_PHONE_COST_PER_PERSON;
    const phoneCost = searchLimit * phoneCostPerPerson;
    const totalCost = searchCost + phoneCost;
    const currentCredits = profile?.credits || 0;
    const remainingCredits = currentCredits - totalCost;
    const canAfford = currentCredits >= totalCost;
    const maxAffordable = Math.floor((currentCredits - searchCost) / phoneCostPerPerson);
    
    return {
      searchCost,
      phoneCost,
      totalCost,
      currentCredits,
      remainingCredits,
      canAfford,
      maxAffordable: Math.max(0, maxAffordable),
    };
  }, [searchLimit, profile?.credits, searchMode, FUZZY_SEARCH_COST, FUZZY_PHONE_COST_PER_PERSON, EXACT_SEARCH_COST, EXACT_PHONE_COST_PER_PERSON]);

  // 预览搜索
  const handlePreview = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !title.trim() || !state) {
      toast.error("请填写所有必填字段");
      return;
    }

    previewMutation.mutate({ 
      name: name.trim(), 
      title: title.trim(), 
      state,
      limit: searchLimit,
      ageMin: enableAgeFilter ? ageRange[0] : undefined,
      ageMax: enableAgeFilter ? ageRange[1] : undefined,
      mode: searchMode,
    });
  };

  // 直接搜索（跳过预览）
  const handleDirectSearch = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !title.trim() || !state) {
      toast.error("请填写所有必填字段");
      return;
    }

    if (!creditEstimate.canAfford) {
      toast.error(`积分不足，需要 ${creditEstimate.totalCost} 积分，当前余额 ${creditEstimate.currentCredits} 积分`);
      return;
    }

    // 显示确认对话框
    setShowConfirmDialog(true);
  };

  const handleConfirmSearch = () => {
    // 显示全屏加载状态
    setIsSearching(true);
    setShowConfirmDialog(false);
    setShowPreviewDialog(false);
    
    // 开始搜索
    searchMutation.mutate({ 
      name: name.trim(), 
      title: title.trim(), 
      state,
      limit: previewResult ? Math.min(searchLimit, previewResult.totalAvailable) : searchLimit,
      ageMin: enableAgeFilter ? ageRange[0] : undefined,
      ageMax: enableAgeFilter ? ageRange[1] : undefined,
      enableVerification,
      mode: searchMode,
    });
  };

  const credits = profile?.credits || 0;

  // ========== 维护模式配置 ==========
  // 设置为 true 启用维护模式，设置为 false 恢复正常
  const MAINTENANCE_MODE = true;
  // ==================================

  return (
    <DashboardLayout>
      <style>{rainbowStyles}</style>
      
      {/* 维护模式遮罩层 */}
      {MAINTENANCE_MODE && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ backdropFilter: 'blur(8px)' }}>
          {/* 半透明背景 */}
          <div className="absolute inset-0 bg-slate-950/80"></div>
          
          {/* 维护提示卡片 */}
          <div className="relative z-10 text-center space-y-6 max-w-lg mx-auto px-6">
            {/* 维护图标 */}
            <div className="relative">
              <div className="w-32 h-32 mx-auto rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center border-2 border-amber-500/30">
                <svg className="w-16 h-16 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </div>
              <div className="absolute inset-0 w-32 h-32 mx-auto rounded-full border-2 border-amber-500/20 animate-ping" style={{ animationDuration: '2s' }} />
            </div>
            
            {/* 维护文字 */}
            <div className="space-y-4">
              <h2 className="text-3xl font-bold text-white">系统维护中</h2>
              <p className="text-lg text-slate-300">LinkedIn 搜索功能正在进行系统升级维护</p>
              <p className="text-sm text-slate-400">预计很快恢复，感谢您的耐心等待</p>
            </div>
            
            {/* 维护进度条（装饰性） */}
            <div className="w-full max-w-xs mx-auto">
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 animate-pulse"
                  style={{ width: '60%' }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">维护进行中...</p>
            </div>
            
            {/* 返回按钮 */}
            <Button 
              variant="outline" 
              onClick={() => window.history.back()}
              className="border-amber-500/50 hover:bg-amber-500/10 text-amber-400"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回上一页
            </Button>
          </div>
        </div>
      )}
      
      {/* 全屏加载遮罩 */}
      {isSearching && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-sm overflow-hidden">
          {/* 动态背景效果 */}
          <div className="absolute inset-0 pointer-events-none">
            {/* 渐变光晕 */}
            <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[120px] animate-pulse" />
            <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
            
            {/* 浮动粒子 */}
            <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-blue-400/40 rounded-full animate-float-slow" />
            <div className="absolute top-1/3 right-1/4 w-3 h-3 bg-indigo-400/30 rounded-full animate-float-medium" />
            <div className="absolute bottom-1/4 left-1/3 w-2 h-2 bg-purple-400/35 rounded-full animate-float-fast" />
          </div>
          
          <div className="relative z-10 text-center space-y-6 max-w-md mx-auto px-6">
            {/* 加载图标 */}
            <div className="relative">
              <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
              </div>
              <div className="absolute inset-0 w-24 h-24 mx-auto rounded-full border-2 border-blue-500/30 animate-ping" />
            </div>
            
            {/* 加载文字 */}
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-white">{loadingMessage}</h3>
              <p className="text-sm text-slate-400">请稍候，正在为您准备搜索结果...</p>
            </div>
            
            {/* 进度条 */}
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <p className="text-xs text-slate-500">{Math.round(loadingProgress)}%</p>
          </div>
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* 顶部横幅 - 七彩鎏金风格（LinkedIn 蓝色主题） */}
        <div className="relative overflow-hidden rounded-2xl rainbow-bg rainbow-border rainbow-glow p-8">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <Badge className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white border-0">
                <Star className="w-3 h-3 mr-1" />
                推荐数据源
              </Badge>
              <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0">
                <Shield className="w-3 h-3 mr-1" />
                双验证电话
              </Badge>
              <Badge className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white border-0">
                <Calendar className="w-3 h-3 mr-1" />
                用户年龄
              </Badge>
              <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0">
                <Briefcase className="w-3 h-3 mr-1" />
                专业人士
              </Badge>
            </div>
            <h1 className="text-3xl font-bold rainbow-text mb-2 flex items-center gap-2">
              <Linkedin className="h-8 w-8 text-blue-500 star-pulse" />
              LinkedIn 搜索
              <span className="recommend-badge text-xs px-3 py-1 rounded-full text-white font-bold shadow-lg">
                ⭐ 推荐 ⭐
              </span>
            </h1>
            <p className="text-muted-foreground max-w-2xl">
              全球 6.5 亿+ 商业人士数据！获取双验证电话号码、用户年龄等高价值信息，精准触达目标客户。
            </p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => setLocation("/history")} 
            className="absolute top-6 right-6 border-blue-500/50 hover:bg-blue-500/10"
          >
            <Clock className="h-4 w-4 mr-2 text-blue-500" />
            搜索历史
          </Button>
        </div>

        {/* LinkedIn 独特亮点展示 - 4个特色卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border-blue-500/30 hover:border-blue-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Shield className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <h3 className="font-semibold text-blue-400">双验证电话</h3>
              <p className="text-xs text-muted-foreground">多源交叉验证</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-500/30 hover:border-emerald-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Calendar className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <h3 className="font-semibold text-emerald-400">用户年龄</h3>
              <p className="text-xs text-muted-foreground">精准年龄筛选</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-purple-500/30 hover:border-purple-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Briefcase className="w-8 h-8 text-purple-400 mx-auto mb-2" />
              <h3 className="font-semibold text-purple-400">专业人士</h3>
              <p className="text-xs text-muted-foreground">6.5亿+商业精英</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30 hover:border-amber-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Zap className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <h3 className="font-semibold text-amber-400">双模式搜索</h3>
              <p className="text-xs text-muted-foreground">模糊/精准可选</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：搜索表单 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 搜索条件 */}
            <Card className="rainbow-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SearchIcon className="w-5 h-5 text-blue-400" />
                  搜索条件
                </CardTitle>
                <CardDescription>
                  填写目标人员的基本信息，获取精准联系方式
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-slate-300 flex items-center gap-2">
                    <User className="h-4 w-4 text-slate-500" />
                    姓名关键词 <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="name"
                    placeholder="例如：John, Smith, Wang"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-12 bg-slate-800/50 border-slate-700 focus:border-blue-500 text-white placeholder:text-slate-500 rounded-xl"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="title" className="text-slate-300 flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-slate-500" />
                    职位/工作 <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="title"
                    placeholder="例如：CEO, Software Engineer, Marketing Manager"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-12 bg-slate-800/50 border-slate-700 focus:border-blue-500 text-white placeholder:text-slate-500 rounded-xl"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="state" className="text-slate-300 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-slate-500" />
                    州 <span className="text-red-400">*</span>
                  </Label>
                  <Select value={state} onValueChange={setState} required>
                    <SelectTrigger className="h-12 bg-slate-800/50 border-slate-700 text-white rounded-xl">
                      <SelectValue placeholder="选择州" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      {US_STATES.map((s) => (
                        <SelectItem key={s} value={s} className="text-white hover:bg-slate-700">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* 高级选项 */}
            <Card className="rainbow-border">
              <CardHeader 
                className="cursor-pointer hover:bg-slate-800/30 transition-colors rounded-t-lg"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-purple-400" />
                    高级选项
                  </div>
                  <ChevronRight className={`h-5 w-5 text-slate-400 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                </CardTitle>
                <CardDescription>
                  自定义搜索参数和过滤条件
                </CardDescription>
              </CardHeader>
              {showAdvanced && (
                <CardContent className="space-y-6">
                  {/* 搜索数量 */}
                  <div className="space-y-3">
                    <Label className="text-slate-300">搜索数量</Label>
                    <div className="grid grid-cols-4 gap-2">
                      {SEARCH_LIMITS.map((limit) => (
                        <Button
                          key={limit.value}
                          variant={searchLimit === limit.value ? "default" : "outline"}
                          className={`h-auto py-3 flex flex-col ${
                            searchLimit === limit.value 
                              ? "bg-blue-500/20 border-blue-500 text-blue-400" 
                              : "border-slate-700 hover:border-blue-500/50"
                          }`}
                          onClick={() => {
                            setSearchLimit(limit.value);
                            setCustomLimit("");
                          }}
                        >
                          <span className="font-bold">{limit.value}</span>
                          <span className="text-xs opacity-70">{limit.description}</span>
                        </Button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-400">或自定义:</span>
                      <Input
                        type="number"
                        placeholder="输入数量 (10-10000)"
                        value={customLimit}
                        onChange={(e) => {
                          setCustomLimit(e.target.value);
                          const val = parseInt(e.target.value);
                          if (val >= 10 && val <= 10000) {
                            setSearchLimit(val);
                          }
                        }}
                        className="w-40 h-10 bg-slate-800/50 border-slate-700"
                      />
                      <span className="text-sm text-slate-400">条</span>
                    </div>
                  </div>

                  {/* 年龄筛选 */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-slate-300 flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-emerald-400" />
                        年龄筛选
                      </Label>
                      <Switch
                        checked={enableAgeFilter}
                        onCheckedChange={setEnableAgeFilter}
                      />
                    </div>
                    {enableAgeFilter && (
                      <div className="space-y-2 p-4 bg-slate-800/30 rounded-lg">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">年龄范围</span>
                          <span className="text-emerald-400 font-mono">{ageRange[0]} - {ageRange[1]} 岁</span>
                        </div>
                        <Slider
                          value={ageRange}
                          onValueChange={(value) => setAgeRange(value as [number, number])}
                          min={18}
                          max={100}
                          step={1}
                          className="mt-2"
                        />
                        <p className="text-xs text-slate-500">只返回年龄在此范围内的结果</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>

            {/* 搜索模式选择 */}
            <Card className="rainbow-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-400" />
                  搜索模式选择
                </CardTitle>
                <CardDescription>
                  根据需求选择合适的搜索方式
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  {/* 模糊搜索 */}
                  <div 
                    className={`relative p-4 rounded-xl cursor-pointer transition-all ${
                      searchMode === 'fuzzy' 
                        ? 'bg-blue-500/20 border-2 border-blue-500' 
                        : 'bg-slate-800/50 border-2 border-slate-700 hover:border-blue-500/50'
                    }`}
                    onClick={() => setSearchMode('fuzzy')}
                  >
                    <Badge className="absolute -top-2 -right-2 bg-amber-500 text-white text-xs">
                      💰 性价比之选
                    </Badge>
                    <div className="flex items-center gap-2 mb-3">
                      <Database className="h-5 w-5 text-blue-400" />
                      <h4 className="font-bold text-blue-400">模糊搜索</h4>
                    </div>
                    <p className="text-xs text-slate-400 mb-2">Fuzzy Search</p>
                    <ul className="text-xs text-slate-400 space-y-1">
                      <li className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-400" />
                        大批量数据采集，成本低廉
                      </li>
                      <li className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-400" />
                        适合广泛撒网、市场调研
                      </li>
                      <li className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-400" />
                        缓存数据，快速返回结果
                      </li>
                    </ul>
                    <div className="mt-3 pt-3 border-t border-slate-700">
                      <span className="text-xs text-slate-500">积分费用</span>
                      <span className="text-blue-400 font-mono font-bold ml-2">{FUZZY_SEARCH_COST} + {FUZZY_PHONE_COST_PER_PERSON}/条</span>
                    </div>
                  </div>

                  {/* 精准搜索 */}
                  <div 
                    className={`relative p-4 rounded-xl cursor-pointer transition-all ${
                      searchMode === 'exact' 
                        ? 'bg-purple-500/20 border-2 border-purple-500' 
                        : 'bg-slate-800/50 border-2 border-slate-700 hover:border-purple-500/50'
                    }`}
                    onClick={() => setSearchMode('exact')}
                  >
                    <Badge className="absolute -top-2 -right-2 bg-purple-500 text-white text-xs">
                      ⭐ 高质量之选
                    </Badge>
                    <div className="flex items-center gap-2 mb-3">
                      <Target className="h-5 w-5 text-purple-400" />
                      <h4 className="font-bold text-purple-400">精准搜索</h4>
                    </div>
                    <p className="text-xs text-slate-400 mb-2">Exact Search</p>
                    <ul className="text-xs text-slate-400 space-y-1">
                      <li className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-400" />
                        实时数据，电话号码更准确
                      </li>
                      <li className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-400" />
                        适合重点客户、精准营销
                      </li>
                      <li className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-400" />
                        无结果时退还搜索费用
                      </li>
                    </ul>
                    <div className="mt-3 pt-3 border-t border-slate-700">
                      <span className="text-xs text-slate-500">积分费用</span>
                      <span className="text-purple-400 font-mono font-bold ml-2">{EXACT_SEARCH_COST} + {EXACT_PHONE_COST_PER_PERSON}/条</span>
                    </div>
                  </div>
                </div>

                {/* 搜索按钮 */}
                <div className="flex gap-3 mt-6">
                  <Button
                    variant="outline"
                    onClick={handlePreview}
                    disabled={previewMutation.isPending || !name || !title || !state}
                    className="flex-1 border-slate-700 hover:border-blue-500/50"
                  >
                    {previewMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Eye className="mr-2 h-4 w-4" />
                    )}
                    预览搜索
                  </Button>
                  <Button
                    onClick={handleDirectSearch}
                    disabled={searchMutation.isPending || !name || !title || !state || !creditEstimate.canAfford}
                    className="flex-1 rainbow-btn text-white font-bold"
                  >
                    {searchMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="mr-2 h-4 w-4" />
                    )}
                    开始搜索
                    <Star className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 右侧：积分信息和核心优势 */}
          <div className="space-y-6">
            {/* 积分余额 */}
            <Card className="rainbow-border">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Coins className="h-5 w-5 text-amber-400" />
                  积分余额
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-amber-400 font-mono">
                  {credits.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">可用积分</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full mt-3 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  onClick={() => setLocation("/recharge")}
                >
                  充值积分
                </Button>
              </CardContent>
            </Card>

            {/* 费用预估 */}
            <Card className="rainbow-border">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-5 w-5 text-blue-400" />
                  费用预估
                  <Badge variant="outline" className="text-xs">
                    {searchMode === 'fuzzy' ? '模糊模式' : '精准模式'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">搜索数量</span>
                  <span className="text-white font-mono">{searchLimit} 条</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">搜索费用</span>
                  <span className="text-white font-mono">{creditEstimate.searchCost} 积分</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">数据费用</span>
                  <span className="text-white font-mono">{creditEstimate.phoneCost} 积分</span>
                </div>
                <div className="border-t border-slate-700 pt-3">
                  <div className="flex justify-between">
                    <span className="text-slate-400">预估总计</span>
                    <span className="text-blue-400 font-mono font-bold">~{creditEstimate.totalCost} 积分</span>
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">搜索后余额</span>
                  <span className={`font-mono ${creditEstimate.remainingCredits >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ~{creditEstimate.remainingCredits.toLocaleString()} 积分
                  </span>
                </div>
                {!creditEstimate.canAfford && (
                  <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      积分不足，请充值后再搜索
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 核心优势 */}
            <Card className="rainbow-border">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Crown className="h-5 w-5 text-amber-400" />
                  核心优势
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <Shield className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-blue-400 text-sm">双验证电话号码</p>
                    <p className="text-xs text-slate-400">多数据源交叉验证，准确率更高</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <Calendar className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-emerald-400 text-sm flex items-center gap-2">
                      用户年龄数据
                      <Badge className="bg-emerald-500/30 text-emerald-200 text-[10px]">独家</Badge>
                    </p>
                    <p className="text-xs text-slate-400">精准筛选目标年龄段</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <Briefcase className="h-5 w-5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-purple-400 text-sm">专业人士数据库</p>
                    <p className="text-xs text-slate-400">覆盖全球 6.5 亿+ 商业精英</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <Zap className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-400 text-sm">灵活搜索模式</p>
                    <p className="text-xs text-slate-400">模糊/精准双模式，满足不同需求</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 快速入门 */}
            <Card className="rainbow-border">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-5 w-5 text-purple-400" />
                  快速入门
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400">1</div>
                    <span className="text-sm text-slate-300">填写姓名、职位、州</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center text-xs font-bold text-purple-400">2</div>
                    <span className="text-sm text-slate-300">选择搜索模式和数量</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">3</div>
                    <span className="text-sm text-slate-300">点击"开始搜索"</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center text-xs font-bold text-amber-400">4</div>
                    <span className="text-sm text-slate-300">导出 CSV，开始联系客户</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 费用说明 */}
            <Card className="bg-slate-800/30 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Coins className="h-4 w-4 text-amber-400" />
                  费用说明
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-xs text-slate-400 space-y-1">
                  <li>• 模糊搜索：{FUZZY_SEARCH_COST} 积分 + {FUZZY_PHONE_COST_PER_PERSON} 积分/条</li>
                  <li>• 精准搜索：{EXACT_SEARCH_COST} 积分 + {EXACT_PHONE_COST_PER_PERSON} 积分/条</li>
                  <li>• 缓存命中的数据免费使用</li>
                  <li>• 精准搜索无结果时退还搜索费</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* 预览结果对话框 */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Eye className="h-5 w-5 text-blue-400" />
              预览搜索结果
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              查看搜索预估结果
            </DialogDescription>
          </DialogHeader>

          {previewResult && (
            <div className="space-y-4 py-4">
              {/* 搜索结果预估 */}
              <div className="p-4 rounded-xl bg-slate-800/50 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  {previewResult.cacheHit ? (
                    <Sparkles className="h-4 w-4 text-yellow-400" />
                  ) : (
                    <Database className="h-4 w-4 text-blue-400" />
                  )}
                  <span className={previewResult.cacheHit ? "text-yellow-400" : "text-blue-400"}>
                    {previewResult.cacheHit ? "命中缓存" : "数据查询"}
                  </span>
                </div>
                
                <div className="text-center py-4">
                  <div className="text-4xl font-bold text-blue-400 font-mono">
                    {previewResult.totalAvailable}
                  </div>
                  <div className="text-sm text-slate-400 mt-1">可用记录数</div>
                </div>

                <div className="text-sm text-slate-400 text-center">
                  {previewResult.message}
                </div>
              </div>

              {/* 积分消耗 */}
              <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 space-y-2">
                <h4 className="text-sm text-purple-400 mb-3">积分消耗</h4>
                <div className="flex justify-between">
                  <span className="text-slate-400">实际可获取</span>
                  <span className="text-white font-mono">
                    {Math.min(searchLimit, previewResult.totalAvailable)} 条
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">预估消耗</span>
                  <span className="text-blue-400 font-mono font-bold">
                    ~{creditEstimate.searchCost + Math.min(searchLimit, previewResult.totalAvailable) * (searchMode === 'fuzzy' ? FUZZY_PHONE_COST_PER_PERSON : EXACT_PHONE_COST_PER_PERSON)} 积分
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">当前余额</span>
                  <span className="text-yellow-400 font-mono">{previewResult.userCredits} 积分</span>
                </div>
              </div>

              {/* 积分不足警告 */}
              {!previewResult.canAfford && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-red-400 font-medium">积分不足</p>
                      <p className="text-sm text-slate-400 mt-1">
                        需要 <span className="text-white font-mono">{previewResult.estimatedCredits}</span> 积分，
                        当前余额 <span className="text-white font-mono">{previewResult.userCredits}</span> 积分
                      </p>
                      {previewResult.maxAffordable > 0 && (
                        <p className="text-sm text-slate-400 mt-1">
                          您最多可搜索 <span className="text-blue-400 font-mono">{previewResult.maxAffordable}</span> 条数据
                        </p>
                      )}
                      <div className="flex gap-2 mt-3">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                          onClick={() => {
                            setShowPreviewDialog(false);
                            setLocation("/recharge");
                          }}
                        >
                          <Coins className="mr-1.5 h-3.5 w-3.5" />
                          去充值
                        </Button>
                        {previewResult.maxAffordable > 0 && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="border-slate-500/30 text-slate-400 hover:bg-slate-500/10"
                            onClick={() => {
                              setSearchLimit(previewResult.maxAffordable);
                              setShowPreviewDialog(false);
                            }}
                          >
                            调整为 {previewResult.maxAffordable} 条
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 结果数量不足提示 */}
              {previewResult.totalAvailable < searchLimit && previewResult.totalAvailable > 0 && (
                <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-yellow-400 font-medium">结果数量不足</p>
                      <p className="text-sm text-slate-400 mt-1">
                        您请求 {searchLimit} 条，但只有 {previewResult.totalAvailable} 条可用
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowPreviewDialog(false)}
              className="border-slate-700 text-slate-400 hover:bg-slate-800"
            >
              取消
            </Button>
            <Button
              onClick={handleConfirmSearch}
              disabled={searchMutation.isPending || !previewResult?.canAfford || previewResult?.totalAvailable === 0}
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
            >
              <Zap className="mr-2 h-4 w-4" />
              开始搜索
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 直接搜索确认对话框 */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <SearchIcon className="h-5 w-5 text-blue-400" />
              确认搜索
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              请确认以下搜索信息
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* 搜索条件 */}
            <div className="p-4 rounded-xl bg-slate-800/50 space-y-2">
              <h4 className="text-sm text-slate-400 mb-3">搜索条件</h4>
              <div className="flex justify-between">
                <span className="text-slate-400">关键词</span>
                <span className="text-white">{name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">职位</span>
                <span className="text-white">{title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">地区</span>
                <span className="text-white">{state}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">数量</span>
                <span className="text-white">{searchLimit} 条</span>
              </div>
              {enableAgeFilter && (
                <div className="flex justify-between">
                  <span className="text-slate-400">年龄范围</span>
                  <span className="text-white">{ageRange[0]} - {ageRange[1]} 岁</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">搜索模式</span>
                <span className={searchMode === 'fuzzy' ? "text-blue-400" : "text-purple-400"}>
                  {searchMode === 'fuzzy' ? "模糊搜索" : "精准搜索"}
                </span>
              </div>
            </div>

            {/* 积分消耗 */}
            <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 space-y-2">
              <h4 className="text-sm text-purple-400 mb-3">积分消耗</h4>
              <div className="flex justify-between">
                <span className="text-slate-400">预估消耗</span>
                <span className="text-blue-400 font-mono font-bold">~{creditEstimate.totalCost} 积分</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">当前余额</span>
                <span className="text-yellow-400 font-mono">{creditEstimate.currentCredits} 积分</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">搜索后余额</span>
                <span className="text-green-400 font-mono">~{creditEstimate.remainingCredits} 积分</span>
              </div>
            </div>

            {/* 提示 */}
            <div className="flex items-start gap-2 text-sm text-slate-500">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>实际消耗按搜索返回的数据量计算，如果实际数据量少于请求量，您将节省积分</span>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
              className="border-slate-700 text-slate-400 hover:bg-slate-800"
            >
              取消
            </Button>
            <Button
              onClick={handleConfirmSearch}
              disabled={searchMutation.isPending}
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              确认搜索
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
// LinkedIn Search Golden Template v2.0
