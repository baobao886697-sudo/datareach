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
  Sparkles
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function TpsSearch() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  
  // 搜索模式
  const [mode, setMode] = useState<"nameOnly" | "nameLocation">("nameOnly");
  
  // 输入
  const [namesInput, setNamesInput] = useState("");
  const [locationsInput, setLocationsInput] = useState("");
  
  // 过滤条件 - 默认值会从后端配置获取
  const [filters, setFilters] = useState({
    minAge: 50,
    maxAge: 79,
    minYear: 2025,
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
  
  // 预估消耗计算（包含搜索页和详情页费用）
  const estimatedSearches = mode === "nameOnly" 
    ? names.length 
    : names.length * Math.max(locations.length, 1);
  const maxPages = 25;  // 固定使用最大 25 页
  const avgDetailsPerSearch = 50;  // 预估每个搜索平均 50 条详情
  // 费用 = 搜索页费用 + 详情页费用
  const estimatedSearchPageCost = estimatedSearches * maxPages * searchCost;
  const estimatedDetailPageCost = estimatedSearches * avgDetailsPerSearch * detailCost;
  const estimatedCost = estimatedSearchPageCost + estimatedDetailPageCost;
  
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
    
    if (mode === "nameLocation" && locations.length === 0) {
      toast.error("姓名+地点模式需要输入地点");
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
      locations: mode === "nameLocation" ? locations : undefined,
      mode,
      filters: filters,  // 始终传递过滤条件（包含默认值）
      // maxPages 已删除，后端固定使用 25 页
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
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-cyan-500" />
              TruePeopleSearch 搜索
            </h1>
            <p className="text-muted-foreground mt-1">
              搜索美国公开数据，获取联系人电话和地址信息
            </p>
          </div>
          <Button variant="outline" onClick={() => setLocation("/tps/history")}>
            <Clock className="h-4 w-4 mr-2" />
            搜索历史
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：搜索表单 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 搜索模式选择 */}
            <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/50 border-slate-700">
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
                          placeholder="New York, NY&#10;Los Angeles, CA&#10;Chicago, IL"
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
                  {/* 年龄范围 */}
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
                  
                  {/* 电话年份 */}
                  <div>
                    <Label>电话最早年份: {filters.minYear}</Label>
                    <Slider
                      value={[filters.minYear]}
                      onValueChange={([v]) => setFilters(f => ({ ...f, minYear: v }))}
                      min={2000}
                      max={2030}
                      step={1}
                      className="mt-2"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      过滤掉早于此年份的电话号码
                    </p>
                  </div>
                  
                  {/* 房产价值 */}
                  <div>
                    <Label>最低房产价值: ${filters.minPropertyValue.toLocaleString()}</Label>
                    <Slider
                      value={[filters.minPropertyValue]}
                      onValueChange={([v]) => setFilters(f => ({ ...f, minPropertyValue: v }))}
                      min={0}
                      max={10000000}
                      step={100000}
                      className="mt-2"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      过滤掉房产价值低于此金额的记录
                    </p>
                  </div>
                  
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
                </CardContent>
              )}
            </Card>
          </div>

          {/* 右侧：费用预估和提交 */}
          <div className="space-y-6">
            {/* 积分余额 */}
            <Card className="bg-gradient-to-br from-cyan-900/30 to-blue-900/30 border-cyan-700/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-cyan-500" />
                  积分余额
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-cyan-400">
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
                  费用预估
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">搜索任务数</span>
                  <span>{estimatedSearches} 个</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">最大搜索页数</span>
                  <span>每任务 {maxPages} 页</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">预估详情数</span>
                  <span>每任务 ~{avgDetailsPerSearch} 条</span>
                </div>
                
                <div className="border-t border-slate-700 pt-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">搜索页费用</span>
                    <span className="text-cyan-400">
                      {estimatedSearches} × {maxPages} × {searchCost} = {estimatedSearchPageCost.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">详情页费用</span>
                    <span className="text-cyan-400">
                      {estimatedSearches} × {avgDetailsPerSearch} × {detailCost} = {estimatedDetailPageCost.toFixed(1)}
                    </span>
                  </div>
                </div>
                
                <div className="border-t border-slate-700 pt-3">
                  <div className="flex justify-between">
                    <span className="font-medium">预估总消耗</span>
                    <span className="text-xl font-bold text-purple-400">
                      ~{estimatedCost.toFixed(1)} 积分
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    实际费用取决于搜索结果数量，可能低于预估
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
              className="w-full h-12 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
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

            {/* 说明 */}
            <Card className="bg-slate-900/50 border-slate-700">
              <CardContent className="pt-4">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-500" />
                  使用说明
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• 每页搜索消耗 {searchCost} 积分</li>
                  <li>• 每条详情消耗 {detailCost} 积分</li>
                  <li>• 搜索结果缓存 30 天</li>
                  <li>• 支持批量搜索多个姓名</li>
                  <li>• 数据来源：TruePeopleSearch.com</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
// TPS Integration v1.0
