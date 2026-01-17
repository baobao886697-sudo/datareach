import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Search as SearchIcon, Loader2, AlertCircle, Info, Zap, Target, MapPin, Briefcase, User, Sparkles } from "lucide-react";

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

export default function Search() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [state, setState] = useState("");

  const { data: profile } = trpc.user.profile.useQuery(undefined, { enabled: !!user });

  const searchMutation = trpc.search.start.useMutation({
    onSuccess: (data) => {
      toast.success("搜索任务已创建");
      if (data.taskId) {
        setLocation(`/results/${data.taskId}`);
      }
    },
    onError: (error) => {
      toast.error(error.message || "搜索失败");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !title.trim() || !state) {
      toast.error("请填写所有必填字段");
      return;
    }

    if ((profile?.credits || 0) < 1) {
      toast.error("积分不足，请先充值");
      return;
    }

    searchMutation.mutate({ name: name.trim(), title: title.trim(), state });
  };

  const credits = profile?.credits || 0;
  const insufficientCredits = credits < 101;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-3xl mx-auto relative">
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
            输入姓名、职位和州来搜索LinkedIn专业人士的联系方式
          </p>
        </div>

        {/* 积分不足提示 */}
        {insufficientCredits && (
          <div className="relative mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center shrink-0">
                <AlertCircle className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-red-400">积分不足</h3>
                <p className="text-sm text-slate-400 mt-1">
                  您当前有 <span className="text-white font-mono">{credits}</span> 积分。
                  完整搜索需要至少 <span className="text-white font-mono">101</span> 积分。
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

        {/* 费用说明 */}
        <div className="relative mb-6 p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center shrink-0">
              <Info className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-cyan-400">费用说明</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                {[
                  { label: "搜索费用", value: "1 积分", icon: SearchIcon },
                  { label: "获取电话", value: "2 积分/条", icon: Zap },
                  { label: "二次验证", value: "免费", icon: Sparkles },
                  { label: "当前余额", value: `${credits} 积分`, icon: Target, highlight: true },
                ].map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <item.icon className={`h-4 w-4 ${item.highlight ? 'text-yellow-400' : 'text-slate-500'}`} />
                    <div>
                      <p className="text-xs text-slate-500">{item.label}</p>
                      <p className={`text-sm font-mono ${item.highlight ? 'text-yellow-400' : 'text-white'}`}>{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 搜索表单 */}
        <div className="relative p-6 rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/50 border border-slate-700/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
              <SearchIcon className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">搜索条件</h3>
              <p className="text-sm text-slate-400">所有字段均为必填</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-slate-300 flex items-center gap-2">
                <User className="h-4 w-4 text-slate-500" />
                姓名
              </Label>
              <Input
                id="name"
                placeholder="例如：John Smith"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-12 bg-slate-800/50 border-slate-700 focus:border-cyan-500 text-white placeholder:text-slate-500 rounded-xl"
                required
              />
              <p className="text-xs text-slate-500">
                输入要搜索的人员姓名
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title" className="text-slate-300 flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-slate-500" />
                职位/工作
              </Label>
              <Input
                id="title"
                placeholder="例如：Software Engineer, CEO, Marketing Manager"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-12 bg-slate-800/50 border-slate-700 focus:border-cyan-500 text-white placeholder:text-slate-500 rounded-xl"
                required
              />
              <p className="text-xs text-slate-500">
                输入职位名称或工作描述
              </p>
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
                <SelectContent className="bg-slate-900 border-slate-700">
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s} className="text-white hover:bg-slate-800">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                选择美国的州
              </p>
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={searchMutation.isPending || insufficientCredits}
              className="w-full h-14 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-medium shadow-lg shadow-cyan-500/25 rounded-xl border-0 text-lg"
            >
              {searchMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  正在创建搜索任务...
                </>
              ) : (
                <>
                  <SearchIcon className="mr-2 h-5 w-5" />
                  开始搜索
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    </DashboardLayout>
  );
}
