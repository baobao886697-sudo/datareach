import { useState, useMemo } from "react";
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
  ArrowRight, RefreshCw
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
  { value: 10, label: "10 条", description: "快速测试" },
  { value: 25, label: "25 条", description: "小批量" },
  { value: 50, label: "50 条", description: "标准搜索", recommended: true },
  { value: 100, label: "100 条", description: "大批量" },
];

// 积分费用常量
const SEARCH_COST = 1;
const PHONE_COST_PER_PERSON = 2;

export default function Search() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  
  // 搜索条件
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [state, setState] = useState("");
  const [searchLimit, setSearchLimit] = useState(50);
  
  // 年龄筛选
  const [enableAgeFilter, setEnableAgeFilter] = useState(false);
  const [ageRange, setAgeRange] = useState<[number, number]>([25, 65]);
  
  // 电话验证开关
  const [enableVerification, setEnableVerification] = useState(true);
  
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

  const { data: profile, refetch: refetchProfile } = trpc.user.profile.useQuery(undefined, { enabled: !!user });

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
      toast.success("搜索任务已创建，正在处理中...");
      setShowConfirmDialog(false);
      setShowPreviewDialog(false);
      if (data.taskId) {
        // 跳转到新的进度页面
        setLocation(`/progress/${data.taskId}`);
      }
    },
    onError: (error) => {
      toast.error(error.message || "搜索失败");
      setShowConfirmDialog(false);
    },
  });

  // 计算积分预估
  const creditEstimate = useMemo(() => {
    const searchCost = SEARCH_COST;
    const phoneCost = searchLimit * PHONE_COST_PER_PERSON;
    const totalCost = searchCost + phoneCost;
    const currentCredits = profile?.credits || 0;
    const remainingCredits = currentCredits - totalCost;
    const canAfford = currentCredits >= totalCost;
    const maxAffordable = Math.floor((currentCredits - SEARCH_COST) / PHONE_COST_PER_PERSON);
    
    return {
      searchCost,
      phoneCost,
      totalCost,
      currentCredits,
      remainingCredits,
      canAfford,
      maxAffordable: Math.max(0, maxAffordable),
    };
  }, [searchLimit, profile?.credits]);

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
    searchMutation.mutate({ 
      name: name.trim(), 
      title: title.trim(), 
      state,
      limit: previewResult ? Math.min(searchLimit, previewResult.totalAvailable) : searchLimit,
      ageMin: enableAgeFilter ? ageRange[0] : undefined,
      ageMax: enableAgeFilter ? ageRange[1] : undefined,
      enableVerification,
    });
  };

  const credits = profile?.credits || 0;

  return (
    <DashboardLayout>
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
                    <SelectTrigger className="h-12 bg-slate-800/50 border-slate-700 focus:border-cyan-500 text-white rounded-xl">
                      <SelectValue placeholder="选择州" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700 max-h-[300px]">
                      {US_STATES.map((s) => (
                        <SelectItem key={s} value={s} className="text-white hover:bg-slate-800">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 搜索数量选择 */}
                <div className="space-y-3">
                  <Label className="text-slate-300 flex items-center gap-2">
                    <Users className="h-4 w-4 text-slate-500" />
                    搜索数量
                  </Label>
                  <div className="grid grid-cols-4 gap-2">
                    {SEARCH_LIMITS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSearchLimit(option.value)}
                        className={`relative p-3 rounded-xl border transition-all ${
                          searchLimit === option.value
                            ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                            : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                        {option.recommended && (
                          <span className="absolute -top-2 -right-2 px-1.5 py-0.5 text-[10px] bg-cyan-500 text-white rounded-full">
                            推荐
                          </span>
                        )}
                        <div className="text-lg font-bold">{option.value}</div>
                        <div className="text-xs opacity-70">{option.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 年龄筛选 */}
                <div className="space-y-3 p-4 rounded-xl bg-slate-800/30 border border-slate-700/30">
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
                    <div className="space-y-4 pt-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">年龄范围</span>
                        <span className="text-cyan-400 font-mono">{ageRange[0]} - {ageRange[1]} 岁</span>
                      </div>
                      <Slider
                        value={ageRange}
                        onValueChange={(value) => setAgeRange(value as [number, number])}
                        min={18}
                        max={80}
                        step={1}
                        className="py-2"
                      />
                    </div>
                  )}
                </div>

                {/* 电话验证开关 */}
                <div className="space-y-3 p-4 rounded-xl bg-slate-800/30 border border-slate-700/30">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300 flex items-center gap-2">
                      <Shield className="h-4 w-4 text-slate-500" />
                      电话二次验证
                      <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded">免费</span>
                    </Label>
                    <Switch
                      checked={enableVerification}
                      onCheckedChange={setEnableVerification}
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    启用后将通过 Scrape.do 验证电话号码真实性，提高数据质量
                  </p>
                </div>

                {/* 搜索按钮 */}
                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePreview}
                    disabled={previewMutation.isPending || !name.trim() || !title.trim() || !state}
                    className="flex-1 h-12 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 rounded-xl"
                  >
                    {previewMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        查询中...
                      </>
                    ) : (
                      <>
                        <Eye className="mr-2 h-4 w-4" />
                        预览搜索
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleDirectSearch}
                    disabled={searchMutation.isPending || !creditEstimate.canAfford || !name.trim() || !title.trim() || !state}
                    className="flex-1 h-12 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white rounded-xl shadow-lg shadow-cyan-500/25"
                  >
                    {searchMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        处理中...
                      </>
                    ) : (
                      <>
                        <Zap className="mr-2 h-4 w-4" />
                        直接搜索
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </div>

          {/* 右侧：费用预估 */}
          <div className="space-y-6">
            {/* 费用预估卡片 */}
            <div className="relative p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">费用预估</h3>
                  <p className="text-sm text-slate-400">预计消耗积分</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                  <span className="text-slate-400">搜索费用</span>
                  <span className="text-white font-mono">{SEARCH_COST} 积分</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                  <span className="text-slate-400">电话获取</span>
                  <span className="text-white font-mono">
                    {searchLimit} × {PHONE_COST_PER_PERSON} = {creditEstimate.phoneCost} 积分
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700/50">
                  <span className="text-slate-400">电话验证</span>
                  <span className="text-green-400 font-mono">免费</span>
                </div>
                <div className="flex justify-between items-center py-3 bg-slate-800/50 rounded-lg px-3 -mx-3">
                  <span className="text-white font-medium">预估总消耗</span>
                  <span className="text-xl font-bold text-cyan-400 font-mono">
                    ~{creditEstimate.totalCost} 积分
                  </span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-slate-400">当前余额</span>
                  <span className="text-yellow-400 font-mono">{creditEstimate.currentCredits} 积分</span>
                </div>
                <div className="flex justify-between items-center py-2">
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
                    <li>• 电话验证：免费（Scrape.do）</li>
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
                      <span>Apollo 数据获取</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-3 w-3 text-slate-600" />
                      <span>异步获取电话号码</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Shield className="h-3 w-3 text-green-400" />
                      <span>Scrape.do 二次验证</span>
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
                    {previewResult.cacheHit ? "命中缓存" : "Apollo 查询"}
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
                    ~{SEARCH_COST + Math.min(searchLimit, previewResult.totalAvailable) * PHONE_COST_PER_PERSON} 积分
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
              {searchMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  开始搜索
                </>
              )}
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
              <span>实际消耗可能因搜索结果数量有所浮动，积分不足时将自动停止</span>
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
              {searchMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  确认搜索
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
