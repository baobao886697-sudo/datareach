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
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Search as SearchIcon, Loader2, AlertCircle, Info, Zap, Target, MapPin, 
  Briefcase, User, Sparkles, Users, Calendar, ChevronRight, Coins,
  CheckCircle2, AlertTriangle, Eye, Database, Shield, TrendingUp,
  ArrowRight, RefreshCw, Rocket, ArrowLeft, Clock, History
} from "lucide-react";

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

// 积分费用常量
const FUZZY_SEARCH_COST = 1;
const FUZZY_PHONE_COST_PER_PERSON = 2;
const EXACT_SEARCH_COST = 5;
const EXACT_PHONE_COST_PER_PERSON = 10;

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
  }, [searchLimit, profile?.credits, searchMode]);

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

  return (
    <DashboardLayout>
      {/* 全屏加载遮罩 */}
      {isSearching && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-sm overflow-hidden">
          {/* 动态背景效果 */}
          <div className="absolute inset-0 pointer-events-none">
            {/* 渐变光晕 */}
            <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px] animate-pulse" />
            <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
            
            {/* 浮动粒子 */}
            <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-cyan-400/40 rounded-full animate-float-slow" />
            <div className="absolute top-1/3 right-1/4 w-3 h-3 bg-blue-400/30 rounded-full animate-float-medium" />
            <div className="absolute bottom-1/4 left-1/3 w-2 h-2 bg-purple-400/35 rounded-full animate-float-fast" />
            <div className="absolute top-1/2 right-1/3 w-1.5 h-1.5 bg-cyan-300/40 rounded-full animate-float-slow" style={{ animationDelay: '1s' }} />
            <div className="absolute bottom-1/3 right-1/4 w-2.5 h-2.5 bg-blue-300/30 rounded-full animate-float-medium" style={{ animationDelay: '0.5s' }} />
            <div className="absolute top-2/3 left-1/4 w-1.5 h-1.5 bg-purple-300/35 rounded-full animate-float-fast" style={{ animationDelay: '1.5s' }} />
            <div className="absolute top-1/5 left-1/2 w-2 h-2 bg-cyan-400/30 rounded-full animate-float-medium" style={{ animationDelay: '0.8s' }} />
            <div className="absolute bottom-1/5 right-1/2 w-2.5 h-2.5 bg-purple-400/25 rounded-full animate-float-slow" style={{ animationDelay: '1.2s' }} />
            
            {/* 连接线效果 */}
            <svg className="absolute inset-0 w-full h-full opacity-20">
              <defs>
                <linearGradient id="loading-line-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
              <line x1="15%" y1="25%" x2="35%" y2="45%" stroke="url(#loading-line-gradient)" strokeWidth="1" className="animate-pulse" />
              <line x1="65%" y1="15%" x2="85%" y2="35%" stroke="url(#loading-line-gradient)" strokeWidth="1" className="animate-pulse" style={{ animationDelay: '0.5s' }} />
              <line x1="25%" y1="55%" x2="45%" y2="75%" stroke="url(#loading-line-gradient)" strokeWidth="1" className="animate-pulse" style={{ animationDelay: '1s' }} />
              <line x1="75%" y1="55%" x2="90%" y2="75%" stroke="url(#loading-line-gradient)" strokeWidth="1" className="animate-pulse" style={{ animationDelay: '1.5s' }} />
            </svg>
            
            {/* 脉冲光环 */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="w-[500px] h-[500px] rounded-full border border-cyan-500/10 animate-ping-slow" />
              <div className="absolute inset-0 w-[500px] h-[500px] rounded-full border border-purple-500/10 animate-ping-slow" style={{ animationDelay: '1.5s' }} />
            </div>
          </div>
          
          <div className="max-w-md w-full mx-4 text-center relative z-10">
            {/* 动画图标 */}
            <div className="relative mb-8">
              <div className="w-24 h-24 mx-auto relative">
                {/* 外圈旋转 */}
                <div className="absolute inset-0 rounded-full border-4 border-cyan-500/20 animate-pulse" />
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-cyan-500 animate-spin" />
                {/* 内圈图标 */}
                <div className="absolute inset-4 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                  <Rocket className="w-8 h-8 text-cyan-400 animate-bounce" />
                </div>
              </div>
              {/* 光晕效果 */}
              <div className="absolute inset-0 w-32 h-32 mx-auto -top-4 bg-cyan-500/10 rounded-full blur-2xl animate-pulse" />
            </div>

            {/* 加载提示 */}
            <h2 className="text-2xl font-bold text-white mb-2" style={{ fontFamily: 'Orbitron, sans-serif' }}>
              {loadingMessage}
            </h2>
            
            {/* 二次验证提示 */}
            <p className="text-yellow-400 text-sm mb-2">
              正在进行二次验证，请耐心等待
            </p>
            
            {/* 预估时间 */}
            <div className="flex items-center justify-center gap-2 text-slate-400 mb-4">
              <Clock className="w-4 h-4" />
              <span>
                预计需要约 {searchLimit >= 60 ? `${Math.ceil(searchLimit * 0.8 / 60)} 分 ${Math.round((searchLimit * 0.8) % 60)} 秒` : `${Math.round(searchLimit * 0.8)} 秒`}
              </span>
            </div>

            {/* 进度条 */}
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mb-4">
              <div 
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300 ease-out"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>

            {/* 搜索条件摘要 */}
            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 text-left mb-4">
              <h3 className="text-sm text-slate-400 mb-3 flex items-center gap-2">
                <SearchIcon className="w-4 h-4" />
                搜索条件
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">关键词</span>
                  <span className="text-white">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">职位</span>
                  <span className="text-white">{title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">地区</span>
                  <span className="text-white">{state}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">数量</span>
                  <span className="text-cyan-400">{searchLimit} 条</span>
                </div>
                {enableAgeFilter && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">年龄范围</span>
                    <span className="text-white">{ageRange[0]} - {ageRange[1]} 岁</span>
                  </div>
                )}
              </div>
            </div>

            {/* 提示信息 */}
            <p className="text-xs text-slate-500 mb-4">
              💡 提示：您可以点击返回查看其他任务，搜索会在后台继续进行
            </p>
            
            {/* 返回按钮 */}
            <button
              onClick={() => {
                setIsSearching(false);
                setLocation('/history');
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-all"
            >
              <History className="w-4 h-4" />
              返回搜索历史
            </button>
          </div>
        </div>
      )}

      <div className="p-6 max-w-4xl mx-auto relative">
        {/* 背景装饰 */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[100px]" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[100px]" />
        </div>

        {/* 标题区域 */}
        <div className="relative mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-5 h-5 text-cyan-400" />
            <span className="text-sm text-cyan-400">精准搜索</span>
          </div>
          <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Orbitron, sans-serif' }}>
            搜索专业人士
          </h1>
          <p className="text-slate-400 mt-2">
            输入搜索条件，获取LinkedIn专业人士的验证联系方式
          </p>
        </div>

        {/* 当前积分余额 */}
        <div className="relative mb-6 p-4 rounded-xl bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                <Coins className="h-5 w-5 text-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-slate-400">当前积分余额</p>
                <p className="text-2xl font-bold text-yellow-400 font-mono">{credits}</p>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
              onClick={() => setLocation("/recharge")}
            >
              充值积分
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：搜索表单 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 基本搜索条件 */}
            <div className="relative p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                  <SearchIcon className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">搜索条件</h3>
                  <p className="text-sm text-slate-400">填写目标人员的基本信息</p>
                </div>
              </div>

              <form className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-slate-300 flex items-center gap-2">
                    <User className="h-4 w-4 text-slate-500" />
                    姓名关键词
                  </Label>
                  <Input
                    id="name"
                    placeholder="例如：John, Smith, Wang"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-12 bg-slate-800/50 border-slate-700 focus:border-cyan-500 text-white placeholder:text-slate-500 rounded-xl"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="title" className="text-slate-300 flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-slate-500" />
                    职位/工作
                  </Label>
                  <Input
                    id="title"
                    placeholder="例如：CEO, Software Engineer, Marketing Manager"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-12 bg-slate-800/50 border-slate-700 focus:border-cyan-500 text-white placeholder:text-slate-500 rounded-xl"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="state" className="text-slate-300 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-slate-500" />
                    州
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
              </form>
            </div>

            {/* 高级选项 */}
            <div className="relative p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">高级选项</h3>
                  <p className="text-sm text-slate-400">自定义搜索参数</p>
                </div>
              </div>

              <div className="space-y-6">
                {/* 搜索数量 */}
                <div className="space-y-3">
                  <Label className="text-slate-300 flex items-center gap-2">
                    <Users className="h-4 w-4 text-slate-500" />
                    搜索数量
                  </Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {SEARCH_LIMITS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setSearchLimit(option.value);
                          setCustomLimit("");
                        }}
                        className={`relative p-3 rounded-xl border transition-all ${
                          searchLimit === option.value && !customLimit
                            ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                            : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                        <div className="text-lg font-bold">{option.value}</div>
                        <div className="text-xs opacity-70">{option.description}</div>
                      </button>
                    ))}
                  </div>
                  {/* 自定义数量输入框 */}
                  <div className="flex items-center gap-3 mt-3">
                    <span className="text-sm text-slate-400">或自定义:</span>
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        placeholder="输入数量 (100-10000)"
                        value={customLimit}
                        onChange={(e) => {
                          let value = e.target.value;
                          let num = parseInt(value);
                          
                          // 自动限制范围
                          if (num > 10000) {
                            value = '10000';
                            num = 10000;
                          }
                          
                          setCustomLimit(value);
                          
                          // 如果是有效数字，更新 searchLimit
                          if (!isNaN(num) && num >= 100 && num <= 10000) {
                            setSearchLimit(num);
                          }
                        }}
                        className={`bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 pr-12 ${
                          customLimit ? 'border-cyan-500 ring-1 ring-cyan-500/30' : ''
                        }`}
                        min={100}
                        max={10000}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">条</span>
                    </div>
                  </div>
                  {customLimit && parseInt(customLimit) < 100 && customLimit.length >= 3 && (
                    <p className="text-xs text-amber-400 mt-1">最小搜索数量为 100 条</p>
                  )}
                </div>

                {/* 年龄筛选 */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-slate-500" />
                      年龄筛选
                    </Label>
                    <Switch
                      checked={enableAgeFilter}
                      onCheckedChange={setEnableAgeFilter}
                    />
                  </div>
                  {enableAgeFilter && (
                    <div className="space-y-4 p-4 rounded-xl bg-slate-800/30">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">年龄范围</span>
                        <span className="text-cyan-400 font-mono">{ageRange[0]} - {ageRange[1]} 岁</span>
                      </div>
                      <Slider
                        value={ageRange}
                        onValueChange={(value) => setAgeRange(value as [number, number])}
                        min={18}
                        max={100}
                        step={1}
                        className="w-full"
                      />
                      <p className="text-xs text-slate-500">
                        只返回年龄在此范围内的结果
                      </p>
                    </div>
                  )}
                </div>

                {/* 搜索模式选择器 */}
                <div className="space-y-3">
                  <Label className="text-slate-300 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-slate-500" />
                    搜索模式
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSearchMode('fuzzy')}
                      className={`relative p-4 rounded-xl border transition-all text-left ${
                        searchMode === 'fuzzy'
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                          : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <div className="text-lg font-bold">模糊搜索</div>
                      <div className="text-xs opacity-70">便宜、大批量</div>
                      <div className="text-xs opacity-50 mt-1">~2 积分/条</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSearchMode('exact')}
                      className={`relative p-4 rounded-xl border transition-all text-left ${
                        searchMode === 'exact'
                          ? 'bg-purple-500/20 border-purple-500 text-purple-400'
                          : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <div className="text-lg font-bold">精准搜索</div>
                      <div className="text-xs opacity-70">实时、高质量</div>
                      <div className="text-xs opacity-50 mt-1">~10 积分/条</div>
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    💡 精准模式使用实时数据，电话号码更准确，但成本更高。
                  </p>
                </div>

                {/* 电话验证 */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/30">
                  <div className="flex items-center gap-3">
                    <Shield className="h-5 w-5 text-green-400" />
                    <div>
                      <p className="text-slate-300">二次电话验证</p>
                      <p className="text-xs text-slate-500">通过多个数据源验证电话号码</p>
                    </div>
                  </div>
                  <Switch
                    checked={enableVerification}
                    onCheckedChange={setEnableVerification}
                  />
                </div>
              </div>
            </div>

            {/* 搜索按钮 */}
            <div className="flex gap-3">
              <Button
                onClick={handlePreview}
                disabled={previewMutation.isPending || !name || !title || !state}
                variant="outline"
                className="flex-1 h-14 border-slate-700 text-slate-300 hover:bg-slate-800 rounded-xl"
              >
                {previewMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    预览中...
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-5 w-5" />
                    预览搜索
                  </>
                )}
              </Button>
              <Button
                onClick={handleDirectSearch}
                disabled={!creditEstimate.canAfford || !name || !title || !state}
                className="flex-1 h-14 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 rounded-xl text-lg font-semibold"
              >
                <Zap className="mr-2 h-5 w-5" />
                开始搜索
              </Button>
            </div>
          </div>

          {/* 右侧：积分预估 */}
          <div className="space-y-6">
            {/* 积分预估卡片 */}
            <div className="relative p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">积分预估</h3>
                  <p className="text-sm text-slate-400">本次搜索消耗</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">搜索费用</span>
                  <span className="text-white font-mono">{creditEstimate.searchCost} 积分</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">数据费用</span>
                  <span className="text-white font-mono">{creditEstimate.phoneCost} 积分</span>
                </div>
                <div className="h-px bg-slate-700" />
                <div className="flex justify-between items-center">
                  <span className="text-slate-300 font-medium">预估总计</span>
                  <span className="text-cyan-400 font-mono text-xl font-bold">~{creditEstimate.totalCost} 积分</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">搜索后余额</span>
                  <span className={`font-mono ${creditEstimate.remainingCredits >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ~{creditEstimate.remainingCredits} 积分
                  </span>
                </div>
              </div>

              {/* 积分不足警告 */}
              {!creditEstimate.canAfford && (
                <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-red-400 font-medium">积分不足</p>
                      <p className="text-sm text-slate-400 mt-1">
                        当前余额可搜索约 <span className="text-white font-mono">{creditEstimate.maxAffordable}</span> 条
                      </p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="mt-3 border-red-500/30 text-red-400 hover:bg-red-500/10"
                        onClick={() => setLocation("/recharge")}
                      >
                        立即充值
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 费用说明 */}
            <div className="relative p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
                <div className="text-sm text-slate-400">
                  <p className="text-cyan-400 font-medium mb-2">费用说明</p>
                  <ul className="space-y-1">
                    <li>• 搜索费用：每次搜索 1 积分</li>
                    <li>• 电话获取：每条结果 2 积分</li>
                    <li>• 电话验证：免费</li>
                    <li>• 实际消耗可能因结果数量有所浮动</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* 搜索流程说明 */}
            <div className="relative p-4 rounded-xl bg-purple-500/5 border border-purple-500/20">
              <div className="flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-purple-400 shrink-0 mt-0.5" />
                <div className="text-sm text-slate-400">
                  <p className="text-purple-400 font-medium mb-2">搜索流程</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Database className="h-3 w-3 text-blue-400" />
                      <span>数据获取</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-3 w-3 text-slate-600" />
                      <span>数据处理与筛选</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Shield className="h-3 w-3 text-green-400" />
                      <span>二次验证</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-cyan-400" />
                      <span>导出 CSV 报表</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 预览结果对话框 */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Eye className="h-5 w-5 text-cyan-400" />
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
                  <div className="text-4xl font-bold text-cyan-400 font-mono">
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
                  <span className="text-cyan-400 font-mono font-bold">
                    ~{creditEstimate.searchCost + Math.min(searchLimit, previewResult.totalAvailable) * creditEstimate.phoneCost / searchLimit} 积分
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
                    <div>
                      <p className="text-red-400 font-medium">积分不足</p>
                      <p className="text-sm text-slate-400 mt-1">
                        最多可搜索 <span className="text-white font-mono">{previewResult.maxAffordable}</span> 条
                      </p>
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
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
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
              <SearchIcon className="h-5 w-5 text-cyan-400" />
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
                <span className="text-slate-400">电话验证</span>
                <span className={enableVerification ? "text-green-400" : "text-slate-500"}>
                  {enableVerification ? "已启用" : "已禁用"}
                </span>
              </div>
            </div>

            {/* 积分消耗 */}
            <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 space-y-2">
              <h4 className="text-sm text-purple-400 mb-3">积分消耗</h4>
              <div className="flex justify-between">
                <span className="text-slate-400">预估消耗</span>
                <span className="text-cyan-400 font-mono font-bold">~{creditEstimate.totalCost} 积分</span>
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
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
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
