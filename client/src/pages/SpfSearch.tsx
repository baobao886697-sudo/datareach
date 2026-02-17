/**
 * SearchPeopleFree 搜索页面 - 基于黄金模板 v2.0
 * SPF 特色：电子邮件、婚姻状态、配偶信息、就业状态
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
import { parseErrorMessage } from "@/lib/utils";
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
  Mail,
  Heart,
  Briefcase,
  Calendar,
  Shield
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
  
  .feature-badge {
    background: linear-gradient(135deg, #ff69b4 0%, #9b59b6 50%, #3498db 100%);
    background-size: 200% 200%;
    animation: rainbow-flow 2s ease infinite;
  }
`;

export default function SpfSearch() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  
  // 搜索模式
  const [mode, setMode] = useState<"nameOnly" | "nameLocation">("nameOnly");
  
  // 输入
  const [namesInput, setNamesInput] = useState("");
  const [locationsInput, setLocationsInput] = useState("");
  
  // 过滤条件
  const [filters, setFilters] = useState({
    minAge: 50,
    maxAge: 79,
    minPropertyValue: 0,
    excludeTMobile: false,
    excludeComcast: false,
    excludeLandline: false,
    excludeWireless: false,
  });
  
  // 是否启用年龄过滤 - 默认启用
  const [enableAgeFilter, setEnableAgeFilter] = useState(true);
  
  // 从后端配置获取默认年龄范围
  const [ageRangeInitialized, setAgeRangeInitialized] = useState(false);
  
  // 高级选项
  const [showFilters, setShowFilters] = useState(false);
  
  // 获取用户资料
  const { data: profile, isLoading: profileLoading } = trpc.user.profile.useQuery(undefined, {
    enabled: !!user,
  });
  
  // 获取 SPF 配置
  const { data: spfConfig } = trpc.spf.getConfig.useQuery();
  
  // 从后端配置初始化默认年龄范围
  useEffect(() => {
    if (spfConfig && !ageRangeInitialized) {
      setFilters(prev => ({
        ...prev,
        minAge: spfConfig.defaultMinAge || 50,
        maxAge: spfConfig.defaultMaxAge || 79,
      }));
      setAgeRangeInitialized(true);
    }
  }, [spfConfig, ageRangeInitialized]);
  
  // 计算预估消耗
  const names = namesInput.trim().split("\n").filter(n => n.trim());
  const locations = locationsInput.trim().split("\n").filter(l => l.trim());
  
  // SPF 费率 (0.85 积分/次 API 调用)
  const searchCost = spfConfig?.searchCost || 0.85;
  const detailCost = spfConfig?.detailCost || 0.85;
  
  // 预估消耗计算
  const estimatedSearches = mode === "nameOnly" 
    ? names.length 
    : names.length * Math.max(locations.length, 1);
  const estimatedCost = estimatedSearches * (searchCost + detailCost);
  
  // 搜索 mutation
  const searchMutation = trpc.spf.search.useMutation({
    onSuccess: (data) => {
      toast.success("搜索任务已创建");
      setLocation(`/spf/task/${data.taskId}`);
    },
    onError: (error) => {
      toast.error("搜索失败", {
        description: parseErrorMessage(error.message),
      });
    },
  });
  
  // 提交搜索
  const handleSearch = () => {
    if (names.length === 0) {
      toast.error("请输入至少一个姓名");
      return;
    }
    
    if (names.length > 100) {
      toast.error("姓名数量超出限制", {
        description: `每次最多支持 100 个姓名，当前已输入 ${names.length} 个`,
      });
      return;
    }
    
    if (mode === "nameLocation" && locations.length === 0) {
      toast.error("请输入至少一个地点");
      return;
    }
    
    // 构建过滤器
    const effectiveFilters = {
      ...filters,
      minAge: enableAgeFilter ? filters.minAge : undefined,
      maxAge: enableAgeFilter ? filters.maxAge : undefined,
    };
    
    searchMutation.mutate({
      names,
      locations: mode === "nameLocation" ? locations : [],
      mode,
      filters: effectiveFilters,
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
          <div className="absolute inset-0 bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-blue-500/10"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <Badge className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white border-0">
                <Star className="w-3 h-3 mr-1" />
                独家数据
              </Badge>
              <Badge className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-0">
                <Heart className="w-3 h-3 mr-1" />
                婚姻状态
              </Badge>
              <Badge className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0">
                <Mail className="w-3 h-3 mr-1" />
                电子邮件
              </Badge>
            </div>
            <h1 className="text-3xl font-bold rainbow-text mb-2 flex items-center gap-2">
              <Star className="h-8 w-8 text-pink-500 fill-pink-500 star-pulse" />
              SearchPeopleFree 搜索
              <span className="feature-badge text-xs px-3 py-1 rounded-full text-white font-bold shadow-lg">
                独家数据
              </span>
            </h1>
            <p className="text-muted-foreground max-w-2xl">
              独家数据源！获取电子邮件、婚姻状态、配偶信息、就业状态等 TPS 没有的独特数据。
            </p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => setLocation("/spf/history")} 
            className="absolute top-6 right-6 border-pink-500/50 hover:bg-pink-500/10"
          >
            <Clock className="h-4 w-4 mr-2 text-pink-500" />
            搜索历史
          </Button>
        </div>

        {/* SPF 独特亮点展示 - 4个特色卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border-yellow-500/30 hover:border-yellow-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Mail className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
              <h3 className="font-semibold text-yellow-400">电子邮件</h3>
              <p className="text-xs text-muted-foreground">独家邮箱数据</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-pink-500/10 to-purple-500/10 border-pink-500/30 hover:border-pink-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Heart className="w-8 h-8 text-pink-400 mx-auto mb-2" />
              <h3 className="font-semibold text-pink-400">婚姻状态</h3>
              <p className="text-xs text-muted-foreground">配偶信息查询</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/30 hover:border-blue-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Briefcase className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <h3 className="font-semibold text-blue-400">就业状态</h3>
              <p className="text-xs text-muted-foreground">职业信息</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/30 hover:border-green-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Calendar className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <h3 className="font-semibold text-green-400">数据确认日期</h3>
              <p className="text-xs text-muted-foreground">新鲜度指标</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：搜索表单 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 搜索模式选择 */}
            <Card className="rainbow-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="w-5 h-5 text-pink-400" />
                  搜索模式
                </CardTitle>
                <CardDescription>
                  选择搜索方式：仅姓名搜索或姓名+地点组合搜索
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={mode} onValueChange={(v) => setMode(v as "nameOnly" | "nameLocation")}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="nameOnly" className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      仅姓名搜索
                    </TabsTrigger>
                    <TabsTrigger value="nameLocation" className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      姓名 + 地点
                    </TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="nameOnly" className="mt-4 space-y-4">
                    <div>
                      <Label htmlFor="names">姓名列表（每行一个）</Label>
                      <Textarea
                        id="names"
                        placeholder="John Smith&#10;Jane Doe&#10;Robert Johnson"
                        value={namesInput}
                        onChange={(e) => setNamesInput(e.target.value)}
                        className="mt-2 min-h-[200px] font-mono bg-slate-800/50"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        已输入 {names.length} 个姓名
                      </p>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="nameLocation" className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="names2">姓名列表（每行一个）</Label>
                        <Textarea
                          id="names2"
                          placeholder="John Smith&#10;Jane Doe"
                          value={namesInput}
                          onChange={(e) => setNamesInput(e.target.value)}
                          className="mt-2 min-h-[150px] font-mono bg-slate-800/50"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          已输入 {names.length} 个姓名
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="locations">地点列表（每行一个）</Label>
                        <Textarea
                          id="locations"
                          placeholder="Los Angeles, CA&#10;New York, NY&#10;Chicago, IL"
                          value={locationsInput}
                          onChange={(e) => setLocationsInput(e.target.value)}
                          className="mt-2 min-h-[150px] font-mono bg-slate-800/50"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          已输入 {locations.length} 个地点
                        </p>
                      </div>
                    </div>
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                      <p className="text-sm text-blue-400 flex items-center gap-2">
                        <Info className="h-4 w-4" />
                        将搜索 {names.length} × {locations.length} = {names.length * locations.length} 个组合
                      </p>
                    </div>
                  </TabsContent>
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
                  <div className="p-3 bg-pink-500/10 border border-pink-500/20 rounded-lg">
                    <p className="text-sm text-pink-400 font-medium mb-2">当前过滤条件：</p>
                    <div className="flex flex-wrap gap-2">
                      {enableAgeFilter && (
                        <Badge variant="outline" className="border-pink-500/50 text-pink-400">
                          年龄: {filters.minAge}-{filters.maxAge}岁
                        </Badge>
                      )}
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
                      {filters.excludeWireless && (
                        <Badge variant="outline" className="border-red-500/50 text-red-400">
                          排除无线
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  {/* 年龄过滤开关 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>启用年龄过滤</Label>
                      <p className="text-xs text-muted-foreground">开启后将按年龄范围过滤结果</p>
                    </div>
                    <Switch
                      checked={enableAgeFilter}
                      onCheckedChange={setEnableAgeFilter}
                    />
                  </div>
                  
                  {/* 年龄范围 */}
                  {enableAgeFilter && (
                    <div>
                      <Label>年龄范围: {filters.minAge} - {filters.maxAge} 岁</Label>
                      <div className="flex gap-4 mt-2">
                        <Slider
                          value={[filters.minAge, filters.maxAge]}
                          onValueChange={([min, max]) => setFilters(f => ({ ...f, minAge: min, maxAge: max }))}
                          min={18}
                          max={99}
                          step={1}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        过滤掉不在此年龄范围内的记录
                      </p>
                    </div>
                  )}
                  
                  {/* 排除运营商 */}
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
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>排除无线号码</Label>
                      <p className="text-xs text-muted-foreground">过滤掉 Wireless 类型的手机号码</p>
                    </div>
                    <Switch
                      checked={filters.excludeWireless}
                      onCheckedChange={(v) => setFilters(f => ({ ...f, excludeWireless: v }))}
                    />
                  </div>
                </CardContent>
              )}
            </Card>
          </div>

          {/* 右侧：费用预估和提交 */}
          <div className="space-y-6">
            {/* 积分余额 */}
            <Card className="bg-gradient-to-br from-pink-900/30 to-purple-900/30 border-pink-700/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-pink-500" />
                  积分余额
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-pink-400">
                  {profileLoading ? (
                    <Skeleton className="h-9 w-24" />
                  ) : (
                    profile?.credits?.toLocaleString() || 0
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">可用积分</p>
              </CardContent>
            </Card>

            {/* 费用预估 */}
            <Card className="bg-gradient-to-br from-purple-900/30 to-blue-900/30 border-purple-700/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-500" />
                  费用预估
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">搜索任务数</span>
                  <span>{estimatedSearches} 个</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">单次搜索费用</span>
                  <span>{searchCost} + {detailCost} = {(searchCost + detailCost).toFixed(1)} 积分</span>
                </div>
                
                <div className="border-t border-slate-700 pt-3">
                  <div className="flex justify-between">
                    <span className="font-medium">预估总消耗</span>
                    <span className="text-xl font-bold text-purple-400">
                      ~{estimatedCost.toFixed(1)} 积分
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    实际费用取决于搜索结果数量
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

            {/* 提交按钮 */}
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

            {/* SPF 核心优势 */}
            <Card className="bg-gradient-to-br from-pink-900/30 via-purple-900/20 to-blue-900/30 border-pink-600/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Crown className="h-5 w-5 text-pink-400" />
                  <span className="rainbow-text">核心优势</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 核心优势1: 电子邮件 */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20">
                  <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                    <Mail className="h-5 w-5 text-yellow-400" />
                  </div>
                  <div>
                    <p className="font-bold text-yellow-300 flex items-center gap-2">
                      电子邮件
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/30 text-yellow-200">独家</span>
                    </p>
                    <p className="text-xs text-muted-foreground">获取目标人物的电子邮箱地址</p>
                  </div>
                </div>
                
                {/* 核心优势2: 婚姻状态 */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-pink-500/10 to-purple-500/10 border border-pink-500/20">
                  <div className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center flex-shrink-0">
                    <Heart className="h-5 w-5 text-pink-400" />
                  </div>
                  <div>
                    <p className="font-bold text-pink-300 flex items-center gap-2">
                      婚姻状态
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/30 text-pink-200">独家</span>
                    </p>
                    <p className="text-xs text-muted-foreground">查询婚姻状态和配偶信息</p>
                  </div>
                </div>
                
                {/* 核心优势3: 就业状态 */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/20">
                  <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <Briefcase className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="font-bold text-blue-300">就业状态</p>
                    <p className="text-xs text-muted-foreground">获取职业和就业信息</p>
                  </div>
                </div>
                
                {/* 核心优势4: 数据新鲜度 */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                    <Calendar className="h-5 w-5 text-green-400" />
                  </div>
                  <div>
                    <p className="font-bold text-green-300">数据确认日期</p>
                    <p className="text-xs text-muted-foreground">显示数据最后确认时间，确保新鲜度</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 快速入门 */}
            <Card className="bg-gradient-to-br from-slate-900/50 to-pink-900/10 border-pink-700/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-pink-500" />
                  快速入门
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-pink-500 flex items-center justify-center text-xs font-bold text-black">1</div>
                  <p className="text-sm">选择搜索模式（仅姓名 / 姓名+地点）</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-pink-500 flex items-center justify-center text-xs font-bold text-black">2</div>
                  <p className="text-sm">输入姓名列表，每行一个姓名</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-pink-500 flex items-center justify-center text-xs font-bold text-black">3</div>
                  <p className="text-sm">点击"开始搜索"，等待结果</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-pink-500 flex items-center justify-center text-xs font-bold text-black">4</div>
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
// SPF Golden Template v2.0
