/**
 * TruePeopleSearch 搜索页面
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Search,
  Users,
  MapPin,
  Filter,
  Zap,
  Clock,
  CreditCard,
  AlertTriangle,
  CheckCircle,
  Info,
  ChevronRight,
  Loader2,
  History,
  Download,
  Phone,
  Home as HomeIcon,
  Calendar,
  Ban,
} from "lucide-react";

export default function TpsSearch() {
  const [, setLocation] = useLocation();
  
  // 搜索模式
  const [mode, setMode] = useState<"nameOnly" | "nameLocation">("nameOnly");
  
  // 输入数据
  const [namesInput, setNamesInput] = useState("");
  const [locationsInput, setLocationsInput] = useState("");
  
  // 过滤条件
  const [filters, setFilters] = useState({
    minAge: 0,
    maxAge: 120,
    minYear: 2020,
    minPropertyValue: 0,
    excludeTMobile: false,
    excludeComcast: false,
    excludeLandline: false,
  });
  
  // 高级选项
  const [maxPages, setMaxPages] = useState(10);
  const [showFilters, setShowFilters] = useState(false);
  
  // 获取配置
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["tps", "config"],
    queryFn: () => trpc.tps.getConfig.query(),
  });
  
  // 获取用户积分
  const { data: user } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => trpc.auth.me.query(),
  });
  
  // 预估消耗
  const names = namesInput.trim().split("\n").filter(n => n.trim());
  const locations = locationsInput.trim().split("\n").filter(l => l.trim());
  
  const { data: estimate } = useQuery({
    queryKey: ["tps", "estimate", names.length, locations.length, mode],
    queryFn: () => trpc.tps.estimateCost.query({
      names,
      locations: mode === "nameLocation" ? locations : undefined,
      mode,
      maxPages,
    }),
    enabled: names.length > 0,
  });
  
  // 提交搜索
  const searchMutation = useMutation({
    mutationFn: () => trpc.tps.search.mutate({
      names,
      locations: mode === "nameLocation" ? locations : undefined,
      mode,
      filters: showFilters ? filters : undefined,
      maxPages,
    }),
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
      toast.error("请输入至少一个地点");
      return;
    }
    
    searchMutation.mutate();
  };
  
  if (configLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
        </div>
      </DashboardLayout>
    );
  }
  
  if (!config?.enabled) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 space-y-4">
          <AlertTriangle className="h-12 w-12 text-yellow-500" />
          <h2 className="text-xl font-semibold">功能暂未开放</h2>
          <p className="text-gray-400">TruePeopleSearch 功能正在维护中，请稍后再试</p>
        </div>
      </DashboardLayout>
    );
  }
  
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Search className="h-6 w-6 text-cyan-500" />
              TruePeopleSearch
            </h1>
            <p className="text-gray-400 mt-1">
              美国人员信息搜索 · 支持批量查询 · 实时数据
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setLocation("/tps/history")}
            className="border-gray-700 hover:bg-gray-800"
          >
            <History className="h-4 w-4 mr-2" />
            搜索历史
          </Button>
        </div>
        
        {/* 积分信息 */}
        <Card className="bg-gradient-to-r from-cyan-900/20 to-blue-900/20 border-cyan-800/30">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-cyan-500/20 rounded-lg">
                  <CreditCard className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">当前积分</p>
                  <p className="text-xl font-bold text-white">{user?.credits?.toFixed(1) || 0}</p>
                </div>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div className="text-center">
                  <p className="text-gray-400">搜索页消耗</p>
                  <p className="text-cyan-400 font-semibold">{config.searchCost} 积分/页</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-400">详情页消耗</p>
                  <p className="text-cyan-400 font-semibold">{config.detailCost} 积分/条</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：搜索表单 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 搜索模式选择 */}
            <Card className="bg-[#0d1526] border-gray-800">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5 text-yellow-500" />
                  搜索模式
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
                  <TabsList className="grid w-full grid-cols-2 bg-gray-800/50">
                    <TabsTrigger value="nameOnly" className="data-[state=active]:bg-cyan-600">
                      <Users className="h-4 w-4 mr-2" />
                      仅姓名搜索
                    </TabsTrigger>
                    <TabsTrigger value="nameLocation" className="data-[state=active]:bg-cyan-600">
                      <MapPin className="h-4 w-4 mr-2" />
                      姓名 + 地点
                    </TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="nameOnly" className="mt-4 space-y-4">
                    <div>
                      <Label className="text-gray-300">
                        姓名列表 <span className="text-gray-500">（每行一个）</span>
                      </Label>
                      <Textarea
                        placeholder="John Smith&#10;Jane Doe&#10;Michael Johnson"
                        value={namesInput}
                        onChange={(e) => setNamesInput(e.target.value)}
                        className="mt-2 h-40 bg-gray-900/50 border-gray-700 focus:border-cyan-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        已输入 {names.length} 个姓名
                      </p>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="nameLocation" className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-gray-300">
                          姓名列表 <span className="text-gray-500">（每行一个）</span>
                        </Label>
                        <Textarea
                          placeholder="John Smith&#10;Jane Doe"
                          value={namesInput}
                          onChange={(e) => setNamesInput(e.target.value)}
                          className="mt-2 h-32 bg-gray-900/50 border-gray-700 focus:border-cyan-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          已输入 {names.length} 个姓名
                        </p>
                      </div>
                      <div>
                        <Label className="text-gray-300">
                          地点列表 <span className="text-gray-500">（每行一个）</span>
                        </Label>
                        <Textarea
                          placeholder="New York, NY&#10;Los Angeles, CA"
                          value={locationsInput}
                          onChange={(e) => setLocationsInput(e.target.value)}
                          className="mt-2 h-32 bg-gray-900/50 border-gray-700 focus:border-cyan-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          已输入 {locations.length} 个地点
                        </p>
                      </div>
                    </div>
                    <div className="p-3 bg-blue-900/20 rounded-lg border border-blue-800/30">
                      <p className="text-sm text-blue-300 flex items-center gap-2">
                        <Info className="h-4 w-4" />
                        将生成 {names.length * Math.max(locations.length, 1)} 个搜索组合
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            
            {/* 过滤条件 */}
            <Card className="bg-[#0d1526] border-gray-800">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Filter className="h-5 w-5 text-purple-500" />
                    过滤条件
                  </CardTitle>
                  <Switch
                    checked={showFilters}
                    onCheckedChange={setShowFilters}
                  />
                </div>
                <CardDescription>
                  启用过滤条件可以精准筛选目标人群
                </CardDescription>
              </CardHeader>
              
              {showFilters && (
                <CardContent className="space-y-6">
                  {/* 年龄范围 */}
                  <div>
                    <Label className="text-gray-300 flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      年龄范围: {filters.minAge} - {filters.maxAge} 岁
                    </Label>
                    <div className="flex items-center gap-4 mt-2">
                      <Input
                        type="number"
                        value={filters.minAge}
                        onChange={(e) => setFilters(f => ({ ...f, minAge: parseInt(e.target.value) || 0 }))}
                        className="w-20 bg-gray-900/50 border-gray-700"
                        min={0}
                        max={120}
                      />
                      <span className="text-gray-500">至</span>
                      <Input
                        type="number"
                        value={filters.maxAge}
                        onChange={(e) => setFilters(f => ({ ...f, maxAge: parseInt(e.target.value) || 120 }))}
                        className="w-20 bg-gray-900/50 border-gray-700"
                        min={0}
                        max={120}
                      />
                    </div>
                  </div>
                  
                  {/* 电话年份 */}
                  <div>
                    <Label className="text-gray-300 flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      电话报告年份: {filters.minYear} 年及以后
                    </Label>
                    <Slider
                      value={[filters.minYear]}
                      onValueChange={([v]) => setFilters(f => ({ ...f, minYear: v }))}
                      min={2000}
                      max={2026}
                      step={1}
                      className="mt-2"
                    />
                  </div>
                  
                  {/* 房产价值 */}
                  <div>
                    <Label className="text-gray-300 flex items-center gap-2">
                      <HomeIcon className="h-4 w-4" />
                      最低房产价值: ${filters.minPropertyValue.toLocaleString()}
                    </Label>
                    <Slider
                      value={[filters.minPropertyValue]}
                      onValueChange={([v]) => setFilters(f => ({ ...f, minPropertyValue: v }))}
                      min={0}
                      max={2000000}
                      step={50000}
                      className="mt-2"
                    />
                  </div>
                  
                  <Separator className="bg-gray-800" />
                  
                  {/* 排除选项 */}
                  <div className="space-y-3">
                    <Label className="text-gray-300 flex items-center gap-2">
                      <Ban className="h-4 w-4" />
                      排除运营商
                    </Label>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                          checked={filters.excludeTMobile}
                          onCheckedChange={(v) => setFilters(f => ({ ...f, excludeTMobile: v }))}
                        />
                        <span className="text-sm text-gray-400">排除 T-Mobile</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                          checked={filters.excludeComcast}
                          onCheckedChange={(v) => setFilters(f => ({ ...f, excludeComcast: v }))}
                        />
                        <span className="text-sm text-gray-400">排除 Comcast</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                          checked={filters.excludeLandline}
                          onCheckedChange={(v) => setFilters(f => ({ ...f, excludeLandline: v }))}
                        />
                        <span className="text-sm text-gray-400">排除座机</span>
                      </label>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
            
            {/* 高级选项 */}
            <Card className="bg-[#0d1526] border-gray-800">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-orange-500" />
                  高级选项
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  <Label className="text-gray-300">
                    每个姓名最大搜索页数: {maxPages} 页
                  </Label>
                  <Slider
                    value={[maxPages]}
                    onValueChange={([v]) => setMaxPages(v)}
                    min={1}
                    max={config.maxPages}
                    step={1}
                    className="mt-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    页数越多，结果越全面，但消耗积分也越多
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* 右侧：预估和提交 */}
          <div className="space-y-6">
            {/* 预估消耗 */}
            <Card className="bg-[#0d1526] border-gray-800 sticky top-6">
              <CardHeader>
                <CardTitle className="text-lg">搜索预估</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {names.length > 0 ? (
                  <>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">搜索组合数</span>
                        <span className="text-white font-medium">
                          {estimate?.subTaskCount || 0}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">预估搜索页</span>
                        <span className="text-white font-medium">
                          ~{estimate?.estimatedSearchPages || 0} 页
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">预估详情数</span>
                        <span className="text-white font-medium">
                          ~{estimate?.estimatedDetails || 0} 条
                        </span>
                      </div>
                      <Separator className="bg-gray-800" />
                      <div className="flex justify-between">
                        <span className="text-gray-400">预估消耗</span>
                        <span className="text-xl font-bold text-cyan-400">
                          ~{estimate?.estimatedCost || 0} 积分
                        </span>
                      </div>
                    </div>
                    
                    <div className="p-3 bg-yellow-900/20 rounded-lg border border-yellow-800/30">
                      <p className="text-xs text-yellow-300 flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        实际消耗根据搜索结果数量计算，可能与预估有差异
                      </p>
                    </div>
                    
                    <Button
                      onClick={handleSearch}
                      disabled={searchMutation.isPending || (user?.credits || 0) < (estimate?.estimatedCost || 0)}
                      className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
                    >
                      {searchMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          提交中...
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4 mr-2" />
                          开始搜索
                        </>
                      )}
                    </Button>
                    
                    {(user?.credits || 0) < (estimate?.estimatedCost || 0) && (
                      <p className="text-xs text-red-400 text-center">
                        积分不足，请先充值
                      </p>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8">
                    <Search className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-500">请输入姓名开始搜索</p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* 使用说明 */}
            <Card className="bg-[#0d1526] border-gray-800">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Info className="h-5 w-5 text-blue-500" />
                  使用说明
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-400">
                <p className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  支持批量搜索，每行输入一个姓名
                </p>
                <p className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  姓名格式：First Last（如 John Smith）
                </p>
                <p className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  地点格式：City, State（如 New York, NY）
                </p>
                <p className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  搜索结果包含电话、地址、房产等信息
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
// TPS Integration v1.0
