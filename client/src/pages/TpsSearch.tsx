/**
 * TruePeopleSearch 搜索页面 - 黄金模板 v2.1
 * 整合 TPS + SPF 最佳设计
 * v2.1: 添加4种搜索模式支持（nameZip, nameCity, nameState, nameOnly）
 */

import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { 
  Search, 
  Users, 
  MapPin, 
  Filter, 
  Loader2, 
  Info,
  DollarSign,
  Clock,
  AlertCircle,
  CheckCircle,
  Sparkles,
  Star,
  Home,
  Phone,
  Crown,
  Zap,
  TrendingUp,
  Building,
  Calendar,
  Shield,
  Hash,
  Map
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// 七彩鎏金动画样式
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
  
  @keyframes border-dance {
    0%, 100% { border-color: #ffd700; }
    16% { border-color: #ff6b6b; }
    33% { border-color: #ff69b4; }
    50% { border-color: #9b59b6; }
    66% { border-color: #3498db; }
    83% { border-color: #2ecc71; }
  }
  
  @keyframes star-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.2); opacity: 0.8; }
  }
  
  .rainbow-text {
    background: linear-gradient(90deg, #ffd700, #ffb347, #ff6b6b, #ff69b4, #9b59b6, #3498db, #2ecc71, #ffd700);
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
    background: linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(255, 179, 71, 0.15), rgba(255, 107, 107, 0.15), rgba(255, 105, 180, 0.15), rgba(155, 89, 182, 0.15), rgba(52, 152, 219, 0.15), rgba(46, 204, 113, 0.15));
    background-size: 400% 400%;
    animation: rainbow-flow 8s ease infinite;
  }
  
  .rainbow-btn {
    background: linear-gradient(135deg, #ffd700, #ff6b6b, #ff69b4, #9b59b6);
    background-size: 300% 300%;
    animation: rainbow-flow 3s ease infinite;
  }
  
  .rainbow-btn:hover {
    transform: scale(1.02);
    box-shadow: 0 0 30px rgba(255, 215, 0, 0.5);
  }
  
  .star-pulse {
    animation: star-pulse 1.5s ease-in-out infinite;
  }
  
  .recommend-badge {
    background: linear-gradient(135deg, #ffd700 0%, #ff6b6b 50%, #9b59b6 100%);
    background-size: 200% 200%;
    animation: rainbow-flow 2s ease infinite;
  }
`;

// 搜索模式类型
type SearchMode = "nameZip" | "nameCity" | "nameState" | "nameOnly";

// 搜索模式配置
const SEARCH_MODES = {
  nameZip: {
    label: "名字 + 邮编",
    icon: Hash,
    description: "支持仅名字搜索，配合邮编定位",
    namePlaceholder: "Tom\nJohn\nMichael",
    nameHint: "可以只输入名字（First Name），不需要姓氏",
    locationPlaceholder: "75201\n90210\n10001",
    locationHint: "输入5位数美国邮编",
    locationLabel: "邮编列表",
  },
  nameCity: {
    label: "名字 + 城市州",
    icon: MapPin,
    description: "支持仅名字搜索，配合城市州定位",
    namePlaceholder: "Tom\nJohn\nMichael",
    nameHint: "可以只输入名字（First Name），不需要姓氏",
    locationPlaceholder: "Dallas, TX\nLos Angeles, CA\nNew York, NY",
    locationHint: "格式：城市, 州缩写（必须包含州）",
    locationLabel: "城市州列表",
  },
  nameState: {
    label: "名字 + 州",
    icon: Map,
    description: "在整个州范围内搜索",
    namePlaceholder: "Tom Smith\nJohn Doe\nJane Wilson",
    nameHint: "建议输入完整姓名以获得更精确的结果",
    locationPlaceholder: "TX\nCA\nNY",
    locationHint: "输入2位州缩写",
    locationLabel: "州列表",
  },
  nameOnly: {
    label: "仅姓名搜索",
    icon: Users,
    description: "全美范围搜索，需要完整姓名",
    namePlaceholder: "John Smith\nJane Doe\nRobert Johnson",
    nameHint: "必须输入完整姓名（名字 + 姓氏）",
    locationPlaceholder: "",
    locationHint: "",
    locationLabel: "",
  },
};

export default function TpsSearch() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  
  // 搜索模式 - 默认使用 nameZip（最灵活）
  const [mode, setMode] = useState<SearchMode>("nameZip");
  
  // 输入
  const [namesInput, setNamesInput] = useState("");
  const [locationsInput, setLocationsInput] = useState("");
  
  // 过滤条件 - 默认值会从后端配置获取
  const [filters, setFilters] = useState({
    minAge: 50,
    maxAge: 79,
    minPropertyValue: 0,
    excludeTMobile: false,
    excludeComcast: false,
    excludeLandline: false,
  });
  
  // 从后端配置获取默认年龄范围，实现前后端联动
  const [ageRangeInitialized, setAgeRangeInitialized] = useState(false);
  
  // 高级选项
  const [showFilters, setShowFilters] = useState(false);
  
  // 获取用户资料
  const { data: profile, isLoading: profileLoading } = trpc.user.profile.useQuery(undefined, {
    enabled: !!user,
  });
  
  // 获取 TPS 配置（从后端获取，确保与管理后台同步）
  const { data: tpsConfig } = trpc.tps.getConfig.useQuery();
  
  // 从后端配置初始化默认年龄范围，实现前后端联动
  useEffect(() => {
    if (tpsConfig && !ageRangeInitialized) {
      setFilters(prev => ({
        ...prev,
        minAge: tpsConfig.defaultMinAge || 50,
        maxAge: tpsConfig.defaultMaxAge || 79,
      }));
      setAgeRangeInitialized(true);
    }
  }, [tpsConfig, ageRangeInitialized]);
  
  // 计算预估消耗
  const names = namesInput.trim().split("\n").filter(n => n.trim());
  const locations = locationsInput.trim().split("\n").filter(l => l.trim());
  
  // TPS 费率（从后端配置获取，默认 0.3）
  const searchCost = tpsConfig?.searchCost || 0.3;
  const detailCost = tpsConfig?.detailCost || 0.3;
  
  // ==================== 预扣费用计算（多扣少补策略） ====================
  // 预扣上限：固定 25 搜索页 + 200 详情页（与后端保持一致）
  const MAX_PREDEDUCT_SEARCH_PAGES = 25;  // 预扣搜索页上限
  const MAX_PREDEDUCT_DETAIL_PAGES = 200; // 预扣详情页上限
  
  // 计算预扣费用（任务完成后退还多余积分）
  const estimatedSearchPageCost = MAX_PREDEDUCT_SEARCH_PAGES * searchCost;
  const estimatedDetailPageCost = MAX_PREDEDUCT_DETAIL_PAGES * detailCost;
  const estimatedCost = estimatedSearchPageCost + estimatedDetailPageCost;
  
  // 当前模式配置
  const currentModeConfig = SEARCH_MODES[mode];
  const needsLocation = mode !== "nameOnly";
  
  // 计算搜索组合数
  const searchCombinations = needsLocation 
    ? names.length * Math.max(locations.length, 1) 
    : names.length;
  
  // 提交搜索
  const searchMutation = trpc.tps.search.useMutation({
    onSuccess: (data) => {
      toast.success("搜索任务已提交", {
        description: `任务ID: ${data.taskId.slice(0, 8)}...`,
      });
      setLocation(`/tps/task/${data.taskId}`);
    },
    onError: (error: any) => {
      toast.error("搜索失败", {
        description: error.message,
      });
    },
  });
  
  const handleSearch = () => {
    if (names.length === 0) {
      toast.error("请输入至少一个姓名");
      return;
    }
    
    // 需要地点的模式必须输入地点
    if (needsLocation && locations.length === 0) {
      toast.error(`${currentModeConfig.label}模式需要输入${currentModeConfig.locationLabel}`);
      return;
    }
    
    // 验证地点格式
    if (mode === "nameCity") {
      const invalidLocations = locations.filter(loc => !loc.includes(","));
      if (invalidLocations.length > 0) {
        toast.error("城市格式错误", {
          description: `请使用"城市, 州"格式，如 "Dallas, TX"。以下地点格式不正确：${invalidLocations.slice(0, 3).join(", ")}${invalidLocations.length > 3 ? "..." : ""}`,
        });
        return;
      }
    }
    
    if (mode === "nameZip") {
      const invalidZips = locations.filter(loc => !/^\d{5}$/.test(loc.trim()));
      if (invalidZips.length > 0) {
        toast.error("邮编格式错误", {
          description: `请输入5位数字邮编。以下邮编格式不正确：${invalidZips.slice(0, 3).join(", ")}${invalidZips.length > 3 ? "..." : ""}`,
        });
        return;
      }
    }
    
    if (mode === "nameState") {
      const invalidStates = locations.filter(loc => !/^[A-Z]{2}$/i.test(loc.trim()));
      if (invalidStates.length > 0) {
        toast.error("州缩写格式错误", {
          description: `请输入2位州缩写，如 "TX"、"CA"。以下格式不正确：${invalidStates.slice(0, 3).join(", ")}${invalidStates.length > 3 ? "..." : ""}`,
        });
        return;
      }
    }
    
    const userCredits = profile?.credits || 0;
    if (userCredits < estimatedCost) {
      toast.error("积分不足", {
        description: `需要约 ${estimatedCost.toFixed(1)} 积分，当前余额 ${userCredits} 积分`,
      });
      return;
    }
    
    searchMutation.mutate({
      names,
      locations: needsLocation ? locations : undefined,
      mode,
      filters: filters,  // 始终传递过滤条件（包含默认值）
    });
  };

  if (loading || !user) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <style>{rainbowStyles}</style>
      
      <div className="p-6 space-y-6">
        {/* 顶部横幅 - 七彩鎏金风格 */}
        <div className="relative overflow-hidden rounded-2xl rainbow-bg rainbow-border rainbow-glow p-8">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-pink-500/10"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <Badge className="bg-gradient-to-r from-amber-400 to-orange-500 text-white border-0">
                <Star className="w-3 h-3 mr-1" />
                推荐数据源
              </Badge>
              <Badge className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-0">
                <Home className="w-3 h-3 mr-1" />
                房产价格
              </Badge>
              <Badge className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white border-0">
                <Phone className="w-3 h-3 mr-1" />
                最新号码
              </Badge>
            </div>
            <h1 className="text-3xl font-bold rainbow-text mb-2 flex items-center gap-2">
              <Star className="h-8 w-8 text-yellow-500 fill-yellow-500 star-pulse" />
              TruePeopleSearch 搜索
              <span className="recommend-badge text-xs px-3 py-1 rounded-full text-white font-bold shadow-lg">
                ⭐ 推荐 ⭐
              </span>
            </h1>
            <p className="text-muted-foreground max-w-2xl">
              华侨/美国人最新数据！获取房产价格、最新电话号码、运营商信息等高价值数据。
            </p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => setLocation("/tps/history")} 
            className="absolute top-6 right-6 border-amber-500/50 hover:bg-amber-500/10"
          >
            <Clock className="h-4 w-4 mr-2 text-amber-500" />
            搜索历史
          </Button>
        </div>

        {/* TPS 独特亮点展示 - 4个特色卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30 hover:border-amber-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Home className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <h3 className="font-semibold text-amber-400">房产价格</h3>
              <p className="text-xs text-muted-foreground">独家房产价值数据</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-500/30 hover:border-emerald-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Phone className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <h3 className="font-semibold text-emerald-400">最新号码</h3>
              <p className="text-xs text-muted-foreground">Primary 主号提取</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/30 hover:border-blue-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Shield className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <h3 className="font-semibold text-blue-400">运营商信息</h3>
              <p className="text-xs text-muted-foreground">精准过滤号码</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-purple-500/30 hover:border-purple-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Calendar className="w-8 h-8 text-purple-400 mx-auto mb-2" />
              <h3 className="font-semibold text-purple-400">年龄筛选</h3>
              <p className="text-xs text-muted-foreground">精准定位目标人群</p>
            </CardContent>
          </Card>
        </div>

        {/* 主内容区 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：搜索表单 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 搜索模式选择 - 4种模式 */}
            <Card className="rainbow-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="w-5 h-5 text-amber-400" />
                  搜索模式
                </CardTitle>
                <CardDescription>
                  选择搜索方式：支持仅名字搜索（配合邮编/城市州）或完整姓名搜索
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={mode} onValueChange={(v) => setMode(v as SearchMode)}>
                  <TabsList className="grid w-full grid-cols-4">
                    {(Object.keys(SEARCH_MODES) as SearchMode[]).map((modeKey) => {
                      const config = SEARCH_MODES[modeKey];
                      const IconComponent = config.icon;
                      return (
                        <TabsTrigger key={modeKey} value={modeKey} className="flex items-center gap-1 text-xs">
                          <IconComponent className="h-3 w-3" />
                          <span className="hidden sm:inline">{config.label}</span>
                          <span className="sm:hidden">{config.label.split(" ")[0]}</span>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                  
                  {/* 模式说明 */}
                  <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <p className="text-sm text-amber-400 flex items-center gap-2">
                      <Info className="h-4 w-4 flex-shrink-0" />
                      {currentModeConfig.description}
                    </p>
                  </div>
                  
                  {/* 输入区域 */}
                  <div className="mt-4 space-y-4">
                    {needsLocation ? (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="names">姓名列表（每行一个）</Label>
                          <Textarea
                            id="names"
                            placeholder={currentModeConfig.namePlaceholder}
                            value={namesInput}
                            onChange={(e) => setNamesInput(e.target.value)}
                            className="mt-2 min-h-[150px] font-mono bg-slate-800/50"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            {currentModeConfig.nameHint}
                          </p>
                          <p className="text-xs text-emerald-400 mt-1">
                            已输入 {names.length} 个姓名
                          </p>
                        </div>
                        <div>
                          <Label htmlFor="locations">{currentModeConfig.locationLabel}（每行一个）</Label>
                          <Textarea
                            id="locations"
                            placeholder={currentModeConfig.locationPlaceholder}
                            value={locationsInput}
                            onChange={(e) => setLocationsInput(e.target.value)}
                            className="mt-2 min-h-[150px] font-mono bg-slate-800/50"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            {currentModeConfig.locationHint}
                          </p>
                          <p className="text-xs text-emerald-400 mt-1">
                            已输入 {locations.length} 个地点
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Label htmlFor="names">姓名列表（每行一个）</Label>
                        <Textarea
                          id="names"
                          placeholder={currentModeConfig.namePlaceholder}
                          value={namesInput}
                          onChange={(e) => setNamesInput(e.target.value)}
                          className="mt-2 min-h-[200px] font-mono bg-slate-800/50"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          {currentModeConfig.nameHint}
                        </p>
                        <p className="text-xs text-emerald-400 mt-1">
                          已输入 {names.length} 个姓名
                        </p>
                      </div>
                    )}
                    
                    {/* 搜索组合数提示 */}
                    {needsLocation && (
                      <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                        <p className="text-sm text-blue-400 flex items-center gap-2">
                          <Info className="h-4 w-4" />
                          将搜索 {names.length} × {locations.length} = {searchCombinations} 个组合
                        </p>
                      </div>
                    )}
                  </div>
                </Tabs>
              </CardContent>
            </Card>

            {/* 高级选项 */}
            <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/50 border-slate-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Filter className="h-5 w-5" />
                      高级选项
                    </CardTitle>
                    <CardDescription>过滤和筛选条件</CardDescription>
                  </div>
                  <Switch
                    checked={showFilters}
                    onCheckedChange={setShowFilters}
                  />
                </div>
              </CardHeader>
              {showFilters && (
                <CardContent className="space-y-6">
                  {/* 当前过滤条件显示 */}
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <p className="text-sm text-amber-400 font-medium mb-2">当前过滤条件：</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="border-amber-500/50 text-amber-400">
                        年龄: {filters.minAge}-{filters.maxAge}岁
                      </Badge>
                      {filters.minPropertyValue > 0 && (
                        <Badge variant="outline" className="border-green-500/50 text-green-400">
                          房产 ≥ ${filters.minPropertyValue.toLocaleString()}
                        </Badge>
                      )}
                      {filters.excludeTMobile && (
                        <Badge variant="outline" className="border-red-500/50 text-red-400">
                          排除 T-Mobile
                        </Badge>
                      )}
                      {filters.excludeComcast && (
                        <Badge variant="outline" className="border-red-500/50 text-red-400">
                          排除 Comcast
                        </Badge>
                      )}
                      {filters.excludeLandline && (
                        <Badge variant="outline" className="border-red-500/50 text-red-400">
                          排除固话
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* 年龄范围 */}
                  <div>
                    <Label className="flex items-center gap-2 mb-4">
                      <Calendar className="h-4 w-4" />
                      年龄范围: {filters.minAge} - {filters.maxAge} 岁
                    </Label>
                    <div className="px-2">
                      <Slider
                        value={[filters.minAge, filters.maxAge]}
                        min={18}
                        max={100}
                        step={1}
                        onValueChange={([min, max]) => setFilters(f => ({ ...f, minAge: min, maxAge: max }))}
                        className="w-full"
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-2">
                      <span>18岁</span>
                      <span>100岁</span>
                    </div>
                  </div>

                  {/* 房产价值 */}
                  <div>
                    <Label className="flex items-center gap-2 mb-2">
                      <Home className="h-4 w-4" />
                      最低房产价值
                    </Label>
                    <Input
                      type="number"
                      value={filters.minPropertyValue}
                      onChange={(e) => setFilters(f => ({ ...f, minPropertyValue: parseInt(e.target.value) || 0 }))}
                      placeholder="0"
                      className="bg-slate-800/50"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      设置为 0 表示不限制
                    </p>
                  </div>

                  {/* 运营商过滤 */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>排除 T-Mobile 号码</Label>
                        <p className="text-xs text-muted-foreground">过滤掉 T-Mobile 运营商的号码</p>
                      </div>
                      <Switch
                        checked={filters.excludeTMobile}
                        onCheckedChange={(v) => setFilters(f => ({ ...f, excludeTMobile: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>排除 Comcast 号码</Label>
                        <p className="text-xs text-muted-foreground">过滤掉 Comcast/Spectrum 运营商的号码</p>
                      </div>
                      <Switch
                        checked={filters.excludeComcast}
                        onCheckedChange={(v) => setFilters(f => ({ ...f, excludeComcast: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>排除固话号码</Label>
                        <p className="text-xs text-muted-foreground">过滤掉 Landline 类型的固定电话号码</p>
                      </div>
                      <Switch
                        checked={filters.excludeLandline}
                        onCheckedChange={(v) => setFilters(f => ({ ...f, excludeLandline: v }))}
                      />
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          </div>

          {/* 右侧：费用预估和提交 */}
          <div className="space-y-6">
            {/* 积分余额 */}
            <Card className="bg-gradient-to-br from-amber-900/30 to-orange-900/30 border-amber-700/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-amber-500" />
                  积分余额
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-amber-400">
                  {profileLoading ? (
                    <Skeleton className="h-9 w-24" />
                  ) : (
                    profile?.credits?.toLocaleString() || 0
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">可用积分</p>
              </CardContent>
            </Card>

            {/* 预扣费用（多扣少补） */}
            <Card className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 border-purple-700/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-500" />
                  预扣费用
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">预扣搜索页</span>
                  <span>{MAX_PREDEDUCT_SEARCH_PAGES} 页</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">预扣详情页</span>
                  <span>{MAX_PREDEDUCT_DETAIL_PAGES} 条</span>
                </div>
                
                <div className="border-t border-slate-700 pt-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">搜索页预扣</span>
                    <span className="text-cyan-400">
                      {MAX_PREDEDUCT_SEARCH_PAGES} × {searchCost} = {estimatedSearchPageCost.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">详情页预扣</span>
                    <span className="text-cyan-400">
                      {MAX_PREDEDUCT_DETAIL_PAGES} × {detailCost} = {estimatedDetailPageCost.toFixed(1)}
                    </span>
                  </div>
                </div>
                
                <div className="border-t border-slate-700 pt-3">
                  <div className="flex justify-between">
                    <span className="font-medium">预扣总额</span>
                    <span className="text-xl font-bold text-purple-400">
                      {estimatedCost.toFixed(1)} 积分
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    多扣少补：任务完成后退还多余积分
                  </p>
                </div>
                
                {profile && estimatedCost > (profile.credits || 0) && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-sm text-red-400 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      积分不足，请先充值
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 提交按钮 - 金色渐变 */}
            <Button
              onClick={handleSearch}
              disabled={searchMutation.isPending || names.length === 0}
              className="w-full h-14 text-lg font-bold rainbow-btn text-white shadow-lg"
            >
              {searchMutation.isPending ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  搜索中...
                </>
              ) : (
                <>
                  <Search className="h-5 w-5 mr-2" />
                  开始搜索
                  <Star className="h-4 w-4 ml-2 fill-current" />
                </>
              )}
            </Button>

            {/* TPS 核心优势 */}
            <Card className="bg-gradient-to-br from-amber-900/30 via-orange-900/20 to-pink-900/30 border-amber-600/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Crown className="h-5 w-5 text-amber-400" />
                  <span className="rainbow-text">核心优势</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 核心优势1: 灵活搜索 */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20">
                  <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                    <Search className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div>
                    <p className="font-bold text-cyan-300">灵活搜索模式</p>
                    <p className="text-xs text-muted-foreground">支持仅名字搜索，配合邮编/城市州精准定位</p>
                  </div>
                </div>
                
                {/* 核心优势2: 最新号码 */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <Phone className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="font-bold text-emerald-300">智能提取最新号码</p>
                    <p className="text-xs text-muted-foreground">自动识别并提取每个人的主要联系电话（Primary）</p>
                  </div>
                </div>
                
                {/* 核心优势3: 房产价格 */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-pink-500/10 to-purple-500/10 border border-pink-500/20">
                  <div className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center flex-shrink-0">
                    <Home className="h-5 w-5 text-pink-400" />
                  </div>
                  <div>
                    <p className="font-bold text-pink-300 flex items-center gap-2">
                      房产价格信息
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/30 text-pink-200">独家</span>
                    </p>
                    <p className="text-xs text-muted-foreground">获取目标人物的房产估值，精准筛选高净值客户</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 快速入门 */}
            <Card className="bg-gradient-to-br from-slate-900/50 to-amber-900/10 border-amber-700/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-amber-500" />
                  快速入门
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-black">1</div>
                  <p className="text-sm">选择搜索模式（推荐：名字+邮编）</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-black">2</div>
                  <p className="text-sm">输入姓名和地点列表，每行一个</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-black">3</div>
                  <p className="text-sm">点击"开始搜索"，等待结果</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-black">4</div>
                  <p className="text-sm">导出 CSV 文档，开始联系客户</p>
                </div>
              </CardContent>
            </Card>

            {/* 费用说明 */}
            <Card className="bg-slate-900/50 border-slate-700">
              <CardContent className="pt-4">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-yellow-500" />
                  费用说明
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• 每页搜索消耗 {searchCost} 积分</li>
                  <li>• 每条详情消耗 {detailCost} 积分</li>
                  <li>• 缓存命中的数据免费使用</li>
                  <li>• 搜索结果缓存 180 天</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
// TPS Golden Template v2.1 - 支持4种搜索模式
