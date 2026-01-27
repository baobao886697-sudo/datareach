/**
 * Anywho 搜索页面
 * 布局参照 TPS，独立模块方便后期管理
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
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

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
    excludeMarried: false,     // 排除已婚（替换原来的婚姻查询）
    excludeTMobile: false,     // 排除 T-Mobile（替换原来的房产信息）
    excludeComcast: false,     // 排除 Comcast（替换原来的家庭成员）
    excludeLandline: false,    // 排除 Landline（替换原来的就业历史）
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
    // 如果有城市，使用城市
    if (cities.length > 0) {
      cities.forEach(city => {
        // 如果有州，组合城市+州
        if (states.length > 0) {
          states.forEach(state => {
            combos.push(`${city}, ${state}`);
          });
        } else {
          combos.push(city);
        }
      });
    } else if (states.length > 0) {
      // 只有州
      states.forEach(state => combos.push(state));
    }
    return combos;
  };
  
  const locationCombinations = buildLocationCombinations();
  
  // Anywho 费率
  const searchCost = anywhoConfig?.searchCost || 0.5;
  const detailCost = anywhoConfig?.detailCost || 0.5;
  
  // 根据用户年龄范围确定需要搜索的 Anywho 年龄段数量
  // Anywho 只支持 4 个固定年龄段: 0-30, 31-60, 61-80, 80+
  const determineAgeRangeCount = (minAge: number, maxAge: number): number => {
    let count = 0;
    if (minAge <= 30 && maxAge >= 0) count++;   // 0-30
    if (minAge <= 60 && maxAge >= 31) count++;  // 31-60
    if (minAge <= 80 && maxAge >= 61) count++;  // 61-80
    if (maxAge > 80) count++;                   // 80+
    return Math.max(count, 1);
  };
  
  const ageRangeCount = determineAgeRangeCount(filters.minAge, filters.maxAge);
  
  // 预估消耗计算 - 从后端配置获取参数
  const estimatedSearches = mode === "nameOnly" 
    ? names.length 
    : names.length * Math.max(locationCombinations.length, 1);
  // 从后端配置获取 maxPages，确保前后端一致
  const maxPages = anywhoConfig?.maxPages || 4;
  // 搜索页费用 = 任务数 × 每任务页数 × 年龄段数量
  const estimatedSearchPageCost = estimatedSearches * maxPages * ageRangeCount * searchCost;
  // 详情页费用预估（基于搜索页数量，每页约 10 条结果，过滤后约 50%）
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
    // 检查 Anywho 功能是否启用
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
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* 页面标题 - 七彩鎏金效果 */}
        <style>{`
          @keyframes rainbow-title {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          .rainbow-title {
            background: linear-gradient(
              90deg,
              #ffd700, #ffb347, #ff6b6b, #ff69b4, #9b59b6, #3498db, #2ecc71, #ffd700
            );
            background-size: 200% auto;
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: rainbow-title 3s linear infinite;
          }
        `}</style>
        
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Star className="h-6 w-6 text-yellow-500 fill-yellow-500" />
              <span className="rainbow-title">Anywho 搜索</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gradient-to-r from-yellow-500/20 via-pink-500/20 to-purple-500/20 text-yellow-300 border border-yellow-500/30">
                AT&T 官方数据
              </span>
            </h1>
            <p className="text-muted-foreground mt-1">
              搜索美国公开数据，获取联系人详细信息，包括<span className="text-pink-400 font-medium">婚姻状况</span>
            </p>
          </div>
          <Button variant="outline" onClick={() => setLocation("/anywho/history")}>
            <Clock className="h-4 w-4 mr-2" />
            搜索历史
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：搜索表单 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 搜索模式选择 */}
            <Card className="bg-gradient-to-br from-amber-900/20 to-orange-900/20 border-amber-700/50">
              <CardHeader>
                <CardTitle className="text-lg">搜索模式</CardTitle>
                <CardDescription>选择搜索方式</CardDescription>
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
                    {/* 姓名输入 */}
                    <div>
                      <Label htmlFor="names2">姓名列表（每行一个）</Label>
                      <Textarea
                        id="names2"
                        placeholder="John Smith&#10;Jane Doe&#10;Robert Johnson"
                        value={namesInput}
                        onChange={(e) => setNamesInput(e.target.value)}
                        className="mt-2 min-h-[120px] font-mono bg-slate-800/50"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        已输入 {names.length} 个姓名
                      </p>
                    </div>
                    
                    {/* 地点输入 - 三个独立输入框 */}
                    <div className="border-t border-slate-700 pt-4">
                      <p className="text-sm font-medium text-amber-400 mb-3 flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        地点条件（可分开输入，会自动组合）
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        {/* 城市 */}
                        <div>
                          <Label htmlFor="cities" className="flex items-center gap-1">
                            <Building className="h-3 w-3" />
                            城市 (City)
                          </Label>
                          <Textarea
                            id="cities"
                            placeholder="New York&#10;Los Angeles&#10;Chicago"
                            value={citiesInput}
                            onChange={(e) => setCitiesInput(e.target.value)}
                            className="mt-2 min-h-[100px] font-mono bg-slate-800/50 text-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            {cities.length} 个城市
                          </p>
                        </div>
                        
                        {/* 州 */}
                        <div>
                          <Label htmlFor="states" className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            州 (State)
                          </Label>
                          <Textarea
                            id="states"
                            placeholder="NY&#10;CA&#10;IL"
                            value={statesInput}
                            onChange={(e) => setStatesInput(e.target.value)}
                            className="mt-2 min-h-[100px] font-mono bg-slate-800/50 text-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            {states.length} 个州
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    {/* 搜索组合预览 */}
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                      <p className="text-sm text-amber-400 flex items-center gap-2">
                        <Info className="h-4 w-4" />
                        将搜索 {names.length} 个姓名 × {locationCombinations.length} 个地点 = {names.length * locationCombinations.length} 个组合
                      </p>
                      {locationCombinations.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-2">
                          地点组合: {locationCombinations.slice(0, 5).join(', ')}{locationCombinations.length > 5 ? ` ... 等 ${locationCombinations.length} 个` : ''}
                        </p>
                      )}
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
                    <CardDescription>数据筛选和过滤条件</CardDescription>
                  </div>
                  <Switch
                    checked={showFilters}
                    onCheckedChange={setShowFilters}
                  />
                </div>
              </CardHeader>
              {showFilters && (
                <CardContent className="space-y-6">
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
                      过滤掉不在此年龄范围内的记录（默认 50-79 岁）
                    </p>
                  </div>
                  
                  {/* 电话年份 */}
                  <div>
                    <Label>电话最早年份: {filters.minYear}</Label>
                    <Slider
                      value={[filters.minYear]}
                      onValueChange={([v]) => setFilters(f => ({ ...f, minYear: v }))}
                      min={2020}
                      max={2030}
                      step={1}
                      className="mt-2"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      过滤掉早于此年份的电话号码（默认 2025 年）
                    </p>
                  </div>
                  
                  {/* 排除已故 */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/20">
                    <div className="flex items-center gap-3">
                      <UserX className="h-5 w-5 text-red-400" />
                      <div>
                        <Label className="text-red-300">排除已故人员</Label>
                        <p className="text-xs text-muted-foreground">过滤掉已故或死亡记录的人员</p>
                      </div>
                    </div>
                    <Switch
                      checked={filters.excludeDeceased}
                      onCheckedChange={(v) => setFilters(f => ({ ...f, excludeDeceased: v }))}
                    />
                  </div>
                  
                  {/* 排除选项 */}
                  <div className="border-t border-slate-700 pt-4">
                    <p className="text-sm font-medium text-amber-400 mb-3 flex items-center gap-2">
                      <Ban className="h-4 w-4" />
                      排除过滤条件
                    </p>
                    
                    <div className="space-y-4">
                      {/* 排除已婚（替换原来的婚姻查询） */}
                      <div className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-pink-500/10 to-purple-500/10 border border-pink-500/20">
                        <div className="flex items-center gap-3">
                          <Heart className="h-5 w-5 text-pink-400" />
                          <div>
                            <Label className="text-pink-300">排除已婚</Label>
                            <p className="text-xs text-muted-foreground">过滤掉婚姻状态为已婚的人员</p>
                          </div>
                        </div>
                        <Switch
                          checked={filters.excludeMarried}
                          onCheckedChange={(v) => setFilters(f => ({ ...f, excludeMarried: v }))}
                        />
                      </div>
                      
                      {/* 排除 T-Mobile（替换原来的房产信息） */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Phone className="h-5 w-5 text-amber-400" />
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
                      
                      {/* 排除 Comcast（替换原来的家庭成员） */}
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
                      
                      {/* 排除 Landline（替换原来的就业历史） */}
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
                    <span className="text-muted-foreground">预估总消耗</span>
                    <span className="text-xl font-bold text-purple-400">
                      ~{estimatedCost.toFixed(1)} 积分
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    💡 混合模式: 搜索页基本信息 + 详情页完整信息
                  </p>
                  <p className="text-xs text-muted-foreground">
                    📝 获取: 运营商、电话类型、婚姻状况
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* 当前过滤条件摘要 */}
            <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/50 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Filter className="h-5 w-5 text-slate-400" />
                  当前过滤条件
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">年龄范围</span>
                  <span>{filters.minAge} - {filters.maxAge} 岁</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">号码年份</span>
                  <span>≥ {filters.minYear} 年</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">排除已故</span>
                  <span className={filters.excludeDeceased ? "text-green-400" : "text-gray-500"}>
                    {filters.excludeDeceased ? "是" : "否"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">排除已婚</span>
                  <span className={filters.excludeMarried ? "text-green-400" : "text-gray-500"}>
                    {filters.excludeMarried ? "是" : "否"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">排除 T-Mobile</span>
                  <span className={filters.excludeTMobile ? "text-green-400" : "text-gray-500"}>
                    {filters.excludeTMobile ? "是" : "否"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">排除 Comcast</span>
                  <span className={filters.excludeComcast ? "text-green-400" : "text-gray-500"}>
                    {filters.excludeComcast ? "是" : "否"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">排除 Landline</span>
                  <span className={filters.excludeLandline ? "text-green-400" : "text-gray-500"}>
                    {filters.excludeLandline ? "是" : "否"}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* 提交按钮 */}
            <Button
              className="w-full h-12 text-lg bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500"
              onClick={handleSearch}
              disabled={searchMutation.isPending || names.length === 0}
            >
              {searchMutation.isPending ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <Search className="h-5 w-5 mr-2" />
                  开始搜索
                </>
              )}
            </Button>

            {/* Anywho 特色提示 */}
            <Card className="bg-gradient-to-br from-pink-900/20 to-purple-900/20 border-pink-700/30">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <Heart className="h-5 w-5 text-pink-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-pink-300">Anywho 特色功能</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      支持查询婚姻状况、运营商信息，数据来源于 AT&T 官方数据库
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
