/**
 * Anywho 搜索页面 - 基于黄金模板 v2.0
 * Anywho 特色：AT&T 官方数据、婚姻状况、运营商信息
 * 
 * 过滤条件：
 * - 默认年龄：50-79岁（可调节 0-100）
 * - 默认排除已故：是
 * - 默认号码年份：2025-2026（可调节 2020-2030）
 * - 排除已婚
 * - 排除 T-Mobile 号码
 * - 排除 Comcast 号码
 * - 排除 Landline 号码
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
  Heart,
  Star,
  Building,
  Phone,
  Mail,
  Home,
  Shield,
  Calendar,
  UserX,
  Ban,
  Crown,
  Zap,
  TrendingUp,
  Wifi,
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
    0%, 100% { border-color: #f59e0b; }
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
    background: linear-gradient(90deg, #f59e0b, #ffb347, #ff6b6b, #ff69b4, #9b59b6, #3498db, #2ecc71, #f59e0b);
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
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(255, 179, 71, 0.15), rgba(255, 107, 107, 0.15), rgba(255, 105, 180, 0.15), rgba(155, 89, 182, 0.15), rgba(52, 152, 219, 0.15), rgba(46, 204, 113, 0.15));
    background-size: 400% 400%;
    animation: rainbow-flow 8s ease infinite;
  }
  
  .rainbow-btn {
    background: linear-gradient(135deg, #f59e0b, #ff6b6b, #ff69b4, #9b59b6);
    background-size: 300% 300%;
    animation: rainbow-flow 3s ease infinite;
  }
  
  .rainbow-btn:hover {
    transform: scale(1.02);
    box-shadow: 0 0 30px rgba(245, 158, 11, 0.5);
  }
  
  .star-pulse {
    animation: star-pulse 1.5s ease-in-out infinite;
  }
  
  .feature-badge {
    background: linear-gradient(135deg, #f59e0b 0%, #ff6b6b 50%, #9b59b6 100%);
    background-size: 200% 200%;
    animation: rainbow-flow 2s ease infinite;
  }
`;

export default function AnywhoSearch() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  
  // 搜索模式
  const [mode, setMode] = useState<"nameOnly" | "nameLocation">("nameOnly");
  
  // 输入
  const [namesInput, setNamesInput] = useState("");
  const [locationsInput, setLocationsInput] = useState("");
  
  // 姓名+地点模式的独立输入
  const [citiesInput, setCitiesInput] = useState("");
  const [statesInput, setStatesInput] = useState("");
  
  // 过滤条件 - 新的默认值
  const [filters, setFilters] = useState({
    minAge: 50,           // 默认最小年龄 50
    maxAge: 79,           // 默认最大年龄 79
    minYear: 2025,        // 默认号码最早年份 2025
    excludeDeceased: true,     // 默认排除已故
    excludeMarried: false,     // 排除已婚
    excludeTMobile: false,     // 排除 T-Mobile
    excludeComcast: false,     // 排除 Comcast
    excludeLandline: false,    // 排除 Landline
  });
  
  // 从后端配置获取默认年龄范围
  const [configInitialized, setConfigInitialized] = useState(false);
  
  // 高级选项
  const [showFilters, setShowFilters] = useState(false);
  
  // 获取用户资料
  const { data: profile, isLoading: profileLoading } = trpc.user.profile.useQuery(undefined, {
    enabled: !!user,
  });
  
  // 获取 Anywho 配置
  const { data: anywhoConfig } = trpc.anywho.getConfig.useQuery(undefined, {
    retry: false,
  });
  
  // 从后端配置初始化默认年龄范围
  useEffect(() => {
    if (anywhoConfig && !configInitialized) {
      setFilters(prev => ({
        ...prev,
        minAge: anywhoConfig.defaultMinAge || 50,
        maxAge: anywhoConfig.defaultMaxAge || 79,
      }));
      setConfigInitialized(true);
    }
  }, [anywhoConfig, configInitialized]);
  
  // 计算预估消耗
  const names = namesInput.trim().split("\n").filter(n => n.trim());
  const locations = locationsInput.trim().split("\n").filter(l => l.trim());
  
  // 姓名+地点模式的独立列表
  const cities = citiesInput.trim().split("\n").filter(c => c.trim());
  const states = statesInput.trim().split("\n").filter(s => s.trim());
  
  // 构建地点组合（城市+州）
  const buildLocationCombinations = () => {
    const combos: string[] = [];
    if (cities.length > 0) {
      cities.forEach(city => {
        if (states.length > 0) {
          states.forEach(state => {
            combos.push(`${city}, ${state}`);
          });
        } else {
          combos.push(city);
        }
      });
    } else if (states.length > 0) {
      states.forEach(state => combos.push(state));
    }
    return combos;
  };
  
  const locationCombinations = buildLocationCombinations();
  
  // Anywho 费率
  const searchCost = anywhoConfig?.searchCost || 0.5;
  const detailCost = anywhoConfig?.detailCost || 0.5;
  
  // 根据用户年龄范围确定需要搜索的 Anywho 年龄段数量
  const determineAgeRangeCount = (minAge: number, maxAge: number): number => {
    let count = 0;
    if (minAge <= 30 && maxAge >= 0) count++;
    if (minAge <= 60 && maxAge >= 31) count++;
    if (minAge <= 80 && maxAge >= 61) count++;
    if (maxAge > 80) count++;
    return Math.max(count, 1);
  };
  
  const ageRangeCount = determineAgeRangeCount(filters.minAge, filters.maxAge);
  
  // 预估消耗计算
  const estimatedSearches = mode === "nameOnly" 
    ? names.length 
    : names.length * Math.max(locationCombinations.length, 1);
  const maxPages = anywhoConfig?.maxPages || 4;
  const estimatedSearchPageCost = estimatedSearches * maxPages * ageRangeCount * searchCost;
  const estimatedDetailResults = estimatedSearches * maxPages * ageRangeCount * 5;
  const estimatedDetailPageCost = estimatedDetailResults * detailCost;
  const estimatedCost = estimatedSearchPageCost + estimatedDetailPageCost;
  
  // 提交搜索
  const searchMutation = trpc.anywho.search.useMutation({
    onSuccess: (data) => {
      toast.success("搜索任务已提交", {
        description: `任务ID: ${data.taskId.slice(0, 8)}...`,
      });
      setLocation(`/anywho/task/${data.taskId}`);
    },
    onError: (error: any) => {
      toast.error("搜索失败", {
        description: error.message,
      });
    },
  });
  
  const handleSearch = () => {
    if (anywhoConfig && !anywhoConfig.enabled) {
      toast.error("Anywho 搜索功能暂时不可用", {
        description: "请联系管理员或稍后再试",
      });
      return;
    }
    
    if (names.length === 0) {
      toast.error("请输入至少一个姓名");
      return;
    }
    
    if (mode === "nameLocation" && locationCombinations.length === 0) {
      toast.error("姓名+地点模式需要输入至少一个地点条件（城市或州）");
      return;
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
      locations: mode === "nameLocation" ? locationCombinations : undefined,
      cities: mode === "nameLocation" ? cities : undefined,
      states: mode === "nameLocation" ? states : undefined,
      mode,
      filters,
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
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <Badge className="bg-gradient-to-r from-amber-400 to-orange-500 text-white border-0">
                <Star className="w-3 h-3 mr-1" />
                AT&T 官方
              </Badge>
              <Badge className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-0">
                <Heart className="w-3 h-3 mr-1" />
                婚姻状况
              </Badge>
              <Badge className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0">
                <Wifi className="w-3 h-3 mr-1" />
                运营商信息
              </Badge>
            </div>
            <h1 className="text-3xl font-bold rainbow-text mb-2 flex items-center gap-2">
              <Star className="h-8 w-8 text-amber-500 fill-amber-500 star-pulse" />
              Anywho 搜索
              <span className="feature-badge text-xs px-3 py-1 rounded-full text-white font-bold shadow-lg">
                AT&T 官方数据
              </span>
            </h1>
            <p className="text-muted-foreground max-w-2xl">
              AT&T 官方数据源！获取婚姻状况、运营商信息等独特数据，数据准确可靠。
            </p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => setLocation("/anywho/history")} 
            className="absolute top-6 right-6 border-amber-500/50 hover:bg-amber-500/10"
          >
            <Clock className="h-4 w-4 mr-2 text-amber-500" />
            搜索历史
          </Button>
        </div>

        {/* Anywho 独特亮点展示 - 4个特色卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30 hover:border-amber-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Building className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <h3 className="font-semibold text-amber-400">AT&T 官方</h3>
              <p className="text-xs text-muted-foreground">权威数据来源</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-pink-500/10 to-purple-500/10 border-pink-500/30 hover:border-pink-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Heart className="w-8 h-8 text-pink-400 mx-auto mb-2" />
              <h3 className="font-semibold text-pink-400">婚姻状况</h3>
              <p className="text-xs text-muted-foreground">已婚/未婚/离异</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/30 hover:border-blue-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Wifi className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <h3 className="font-semibold text-blue-400">运营商信息</h3>
              <p className="text-xs text-muted-foreground">详细运营商数据</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/30 hover:border-green-500/50 transition-colors">
            <CardContent className="p-4 text-center">
              <Phone className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <h3 className="font-semibold text-green-400">电话类型</h3>
              <p className="text-xs text-muted-foreground">固话/无线分类</p>
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
                  <Search className="w-5 h-5 text-amber-400" />
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
                    <div>
                      <Label htmlFor="names2">姓名列表（每行一个）</Label>
                      <Textarea
                        id="names2"
                        placeholder="John Smith&#10;Jane Doe"
                        value={namesInput}
                        onChange={(e) => setNamesInput(e.target.value)}
                        className="mt-2 min-h-[120px] font-mono bg-slate-800/50"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        已输入 {names.length} 个姓名
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="cities">城市列表（每行一个，可选）</Label>
                        <Textarea
                          id="cities"
                          placeholder="Los Angeles&#10;New York&#10;Chicago"
                          value={citiesInput}
                          onChange={(e) => setCitiesInput(e.target.value)}
                          className="mt-2 min-h-[100px] font-mono bg-slate-800/50"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          已输入 {cities.length} 个城市
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="states">州列表（每行一个，可选）</Label>
                        <Textarea
                          id="states"
                          placeholder="CA&#10;NY&#10;IL"
                          value={statesInput}
                          onChange={(e) => setStatesInput(e.target.value)}
                          className="mt-2 min-h-[100px] font-mono bg-slate-800/50"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          已输入 {states.length} 个州
                        </p>
                      </div>
                    </div>
                    
                    {locationCombinations.length > 0 && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                        <p className="text-sm text-amber-400 flex items-center gap-2">
                          <Info className="h-4 w-4" />
                          将搜索 {names.length} × {locationCombinations.length} = {names.length * locationCombinations.length} 个组合
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          地点组合: {locationCombinations.slice(0, 3).join(", ")}{locationCombinations.length > 3 ? ` 等 ${locationCombinations.length} 个` : ""}
                        </p>
                      </div>
                    )}
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
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <p className="text-sm text-amber-400 font-medium mb-2">当前过滤条件：</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="border-amber-500/50 text-amber-400">
                        年龄: {filters.minAge}-{filters.maxAge}岁
                      </Badge>
                      <Badge variant="outline" className="border-blue-500/50 text-blue-400">
                        号码年份 ≥ {filters.minYear}
                      </Badge>
                      {filters.excludeDeceased && (
                        <Badge variant="outline" className="border-green-500/50 text-green-400">
                          排除已故
                        </Badge>
                      )}
                      {filters.excludeMarried && (
                        <Badge variant="outline" className="border-pink-500/50 text-pink-400">
                          排除已婚
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
                    <Label>年龄范围: {filters.minAge} - {filters.maxAge} 岁</Label>
                    <div className="flex gap-4 mt-2">
                      <Slider
                        value={[filters.minAge, filters.maxAge]}
                        onValueChange={([min, max]) => setFilters(f => ({ ...f, minAge: min, maxAge: max }))}
                        min={0}
                        max={100}
                        step={1}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      当前覆盖 {ageRangeCount} 个年龄段（Anywho 使用固定年龄段）
                    </p>
                  </div>
                  
                  {/* 号码年份 */}
                  <div>
                    <Label>号码最早年份: {filters.minYear}</Label>
                    <div className="flex gap-4 mt-2">
                      <Slider
                        value={[filters.minYear]}
                        onValueChange={([year]) => setFilters(f => ({ ...f, minYear: year }))}
                        min={2020}
                        max={2030}
                        step={1}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      只保留 {filters.minYear} 年及以后的号码记录
                    </p>
                  </div>
                  
                  {/* 排除选项 */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <UserX className="h-5 w-5 text-gray-400" />
                        <div>
                          <Label>排除已故人员</Label>
                          <p className="text-xs text-muted-foreground">过滤掉已故人员的记录</p>
                        </div>
                      </div>
                      <Switch
                        checked={filters.excludeDeceased}
                        onCheckedChange={(v) => setFilters(f => ({ ...f, excludeDeceased: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Heart className="h-5 w-5 text-pink-400" />
                        <div>
                          <Label>排除已婚人员</Label>
                          <p className="text-xs text-muted-foreground">过滤掉婚姻状况为“已婚”的记录</p>
                        </div>
                      </div>
                      <Switch
                        checked={filters.excludeMarried}
                        onCheckedChange={(v) => setFilters(f => ({ ...f, excludeMarried: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Phone className="h-5 w-5 text-purple-400" />
                        <div>
                          <Label>排除 T-Mobile 号码</Label>
                          <p className="text-xs text-muted-foreground">过滤掉 T-Mobile 运营商的号码</p>
                        </div>
                      </div>
                      <Switch
                        checked={filters.excludeTMobile}
                        onCheckedChange={(v) => setFilters(f => ({ ...f, excludeTMobile: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Phone className="h-5 w-5 text-blue-400" />
                        <div>
                          <Label>排除 Comcast 号码</Label>
                          <p className="text-xs text-muted-foreground">过滤掉 Comcast/Spectrum 运营商的号码</p>
                        </div>
                      </div>
                      <Switch
                        checked={filters.excludeComcast}
                        onCheckedChange={(v) => setFilters(f => ({ ...f, excludeComcast: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Phone className="h-5 w-5 text-green-400" />
                        <div>
                          <Label>排除 Landline 号码</Label>
                          <p className="text-xs text-muted-foreground">过滤掉固定电话（Landline）类型的号码</p>
                        </div>
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

            {/* 费用预估 */}
            <Card className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 border-purple-700/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-500" />
                  费用预估 (混合模式)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">搜索任务数</span>
                  <span>{estimatedSearches} 个</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">年龄段数量</span>
                  <span className="text-purple-400">{ageRangeCount} 个</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">搜索页费用</span>
                  <span>{estimatedSearches * maxPages * ageRangeCount} 页 × {searchCost} = {estimatedSearchPageCost.toFixed(1)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">详情页费用</span>
                  <span>~{estimatedDetailResults} 条 × {detailCost} = {estimatedDetailPageCost.toFixed(1)}</span>
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

            {/* Anywho 核心优势 */}
            <Card className="bg-gradient-to-br from-amber-900/30 via-orange-900/20 to-red-900/30 border-amber-600/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Crown className="h-5 w-5 text-amber-400" />
                  <span className="rainbow-text">核心优势</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 核心优势1: AT&T 官方 */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20">
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <Building className="h-5 w-5 text-amber-400" />
                  </div>
                  <div>
                    <p className="font-bold text-amber-300 flex items-center gap-2">
                      AT&T 官方数据
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-200">权威</span>
                    </p>
                    <p className="text-xs text-muted-foreground">数据来源于 AT&T 官方数据库</p>
                  </div>
                </div>
                
                {/* 核心优势2: 婚姻状况 */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-pink-500/10 to-purple-500/10 border border-pink-500/20">
                  <div className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center flex-shrink-0">
                    <Heart className="h-5 w-5 text-pink-400" />
                  </div>
                  <div>
                    <p className="font-bold text-pink-300 flex items-center gap-2">
                      婚姻状况
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/30 text-pink-200">独家</span>
                    </p>
                    <p className="text-xs text-muted-foreground">已婚/未婚/离异等状态</p>
                  </div>
                </div>
                
                {/* 核心优势3: 运营商信息 */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/20">
                  <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <Wifi className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="font-bold text-blue-300">运营商信息</p>
                    <p className="text-xs text-muted-foreground">详细的运营商和电话类型数据</p>
                  </div>
                </div>
                
                {/* 核心优势4: 年龄段筛选 */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                    <Calendar className="h-5 w-5 text-green-400" />
                  </div>
                  <div>
                    <p className="font-bold text-green-300">精准年龄筛选</p>
                    <p className="text-xs text-muted-foreground">支持按年龄段精确筛选目标人群</p>
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
                  <p className="text-sm">选择搜索模式（仅姓名 / 姓名+地点）</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-black">2</div>
                  <p className="text-sm">输入姓名列表，每行一个姓名</p>
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
// Anywho Golden Template v2.0
