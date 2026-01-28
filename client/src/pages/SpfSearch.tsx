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
  Mail,
  Heart,
  Briefcase,
  Calendar,
  Globe
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

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
  
  // SPF 费率
  const searchCost = spfConfig?.searchCost || 0.3;
  const detailCost = spfConfig?.detailCost || 0.3;
  
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
      toast.error(error.message);
    },
  });
  
  // 提交搜索
  const handleSearch = () => {
    if (names.length === 0) {
      toast.error("请输入至少一个姓名");
      return;
    }
    
    if (mode === "nameLocation" && locations.length === 0) {
      toast.error("请输入至少一个地点");
      return;
    }
    
    searchMutation.mutate({
      names,
      locations: mode === "nameLocation" ? locations : [],
      mode,
      filters,
    });
  };
  
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
  `;

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
          <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/10 via-pink-500/10 to-purple-500/10"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
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
            <h1 className="text-3xl font-bold rainbow-text mb-2">
              SearchPeopleFree 搜索
            </h1>
            <p className="text-muted-foreground max-w-2xl">
              独家数据源！获取电子邮件、婚姻状态、配偶信息、就业状态等 TPS/FPS 没有的独特数据。
            </p>
          </div>
        </div>

        {/* SPF 独特亮点展示 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border-yellow-500/30">
            <CardContent className="p-4 text-center">
              <Mail className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
              <h3 className="font-semibold text-yellow-400">电子邮件</h3>
              <p className="text-xs text-muted-foreground">独家邮箱数据</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-pink-500/10 to-purple-500/10 border-pink-500/30">
            <CardContent className="p-4 text-center">
              <Heart className="w-8 h-8 text-pink-400 mx-auto mb-2" />
              <h3 className="font-semibold text-pink-400">婚姻状态</h3>
              <p className="text-xs text-muted-foreground">配偶信息查询</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/30">
            <CardContent className="p-4 text-center">
              <Briefcase className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <h3 className="font-semibold text-blue-400">就业状态</h3>
              <p className="text-xs text-muted-foreground">职业信息</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/30">
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
                  <Search className="w-5 h-5 text-yellow-400" />
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
                      <Users className="w-4 h-4" />
                      仅姓名搜索
                    </TabsTrigger>
                    <TabsTrigger value="nameLocation" className="flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      姓名 + 地点
                    </TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="nameOnly" className="space-y-4 mt-4">
                    <div>
                      <Label htmlFor="names" className="flex items-center gap-2 mb-2">
                        <Users className="w-4 h-4 text-yellow-400" />
                        姓名列表（每行一个）
                      </Label>
                      <Textarea
                        id="names"
                        placeholder="John Smith&#10;Jane Doe&#10;Michael Johnson"
                        value={namesInput}
                        onChange={(e) => setNamesInput(e.target.value)}
                        className="min-h-[200px] font-mono"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        已输入 {names.length} 个姓名
                      </p>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="nameLocation" className="space-y-4 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="names2" className="flex items-center gap-2 mb-2">
                          <Users className="w-4 h-4 text-yellow-400" />
                          姓名列表（每行一个）
                        </Label>
                        <Textarea
                          id="names2"
                          placeholder="John Smith&#10;Jane Doe"
                          value={namesInput}
                          onChange={(e) => setNamesInput(e.target.value)}
                          className="min-h-[150px] font-mono"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          已输入 {names.length} 个姓名
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="locations" className="flex items-center gap-2 mb-2">
                          <MapPin className="w-4 h-4 text-pink-400" />
                          地点列表（每行一个）
                        </Label>
                        <Textarea
                          id="locations"
                          placeholder="New York, NY&#10;Los Angeles, CA&#10;Chicago, IL"
                          value={locationsInput}
                          onChange={(e) => setLocationsInput(e.target.value)}
                          className="min-h-[150px] font-mono"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          已输入 {locations.length} 个地点
                        </p>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                      <p className="text-sm text-yellow-400 flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        将生成 {names.length} × {Math.max(locations.length, 1)} = {estimatedSearches} 个搜索组合
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* 过滤条件 */}
            <Card className="rainbow-border">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Filter className="w-5 h-5 text-purple-400" />
                      过滤条件
                    </CardTitle>
                    <CardDescription>
                      设置年龄范围和其他过滤选项
                    </CardDescription>
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
                    <Label className="flex items-center gap-2 mb-4">
                      <Users className="w-4 h-4 text-yellow-400" />
                      年龄范围: {filters.minAge} - {filters.maxAge} 岁
                    </Label>
                    <div className="px-2">
                      <Slider
                        value={[filters.minAge, filters.maxAge]}
                        min={18}
                        max={100}
                        step={1}
                        onValueChange={([min, max]) => setFilters(prev => ({ ...prev, minAge: min, maxAge: max }))}
                        className="w-full"
                      />
                    </div>
                  </div>

                  {/* 电话类型过滤 */}
                  <div className="space-y-3">
                    <Label className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-pink-400" />
                      电话类型过滤
                    </Label>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <span className="text-sm">排除座机</span>
                        <Switch
                          checked={filters.excludeLandline}
                          onCheckedChange={(v) => setFilters(prev => ({ ...prev, excludeLandline: v }))}
                        />
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <span className="text-sm">排除手机</span>
                        <Switch
                          checked={filters.excludeWireless}
                          onCheckedChange={(v) => setFilters(prev => ({ ...prev, excludeWireless: v }))}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 运营商过滤 */}
                  <div className="space-y-3">
                    <Label className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-blue-400" />
                      运营商过滤
                    </Label>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <span className="text-sm">排除 T-Mobile</span>
                        <Switch
                          checked={filters.excludeTMobile}
                          onCheckedChange={(v) => setFilters(prev => ({ ...prev, excludeTMobile: v }))}
                        />
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <span className="text-sm">排除 Comcast</span>
                        <Switch
                          checked={filters.excludeComcast}
                          onCheckedChange={(v) => setFilters(prev => ({ ...prev, excludeComcast: v }))}
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
            {/* 费用预估 */}
            <Card className="rainbow-border rainbow-glow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-yellow-400" />
                  费用预估
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">搜索任务数</span>
                    <span className="font-medium">{estimatedSearches} 个</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">单次搜索费用</span>
                    <span className="font-medium">{searchCost} 积分</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">单条数据费用</span>
                    <span className="font-medium">{detailCost} 积分</span>
                  </div>
                </div>
                
                <div className="border-t pt-4">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">预估总消耗</span>
                    <span className="text-2xl font-bold rainbow-text">
                      ~{estimatedCost.toFixed(1)} 积分
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    实际消耗按返回结果数量计算
                  </p>
                </div>

                <div className="border-t pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">当前余额</span>
                    <span className="font-medium text-green-400">
                      {profile?.credits?.toLocaleString() || 0} 积分
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 提交按钮 */}
            <Button
              onClick={handleSearch}
              disabled={searchMutation.isPending || names.length === 0}
              className="w-full h-14 text-lg font-bold rainbow-btn text-white border-0"
            >
              {searchMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  创建任务中...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  开始搜索
                </>
              )}
            </Button>

            {/* 快捷链接 */}
            <Card>
              <CardContent className="p-4 space-y-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setLocation("/spf/history")}
                >
                  <Clock className="w-4 h-4 mr-2" />
                  查看搜索历史
                </Button>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setLocation("/recharge")}
                >
                  <DollarSign className="w-4 h-4 mr-2" />
                  充值积分
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
