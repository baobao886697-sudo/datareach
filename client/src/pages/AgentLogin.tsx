import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Crown, Eye, EyeOff } from "lucide-react";

export default function AgentLogin() {
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const agentLogin = trpc.agent.login.useMutation({
    onSuccess: (data) => {
      // 存储代理token
      localStorage.setItem("agent_token", data.token);
      localStorage.setItem("agent_info", JSON.stringify(data.agent));
      toast.success(`欢迎回来，${data.agent.name}`);
      setLocation("/agent-portal");
    },
    onError: (error) => {
      toast.error(error.message || "登录失败");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email || !formData.password) {
      toast.error("请填写邮箱和密码");
      return;
    }
    setIsLoading(true);
    try {
      await agentLogin.mutateAsync(formData);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <Crown className="w-10 h-10 text-yellow-500" />
            <span className="text-2xl font-bold text-white">DataReach</span>
          </div>
          <h1 className="text-xl text-slate-300">代理商后台</h1>
        </div>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-center">代理登录</CardTitle>
            <CardDescription className="text-center">
              使用您的代理账号登录管理后台
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-white">邮箱地址</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="your@email.com"
                  className="bg-slate-900/50 border-slate-600"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-white">密码</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="••••••••"
                    className="bg-slate-900/50 border-slate-600 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600 text-black font-semibold"
                disabled={isLoading}
              >
                {isLoading ? "登录中..." : "登录"}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-slate-700">
              <p className="text-sm text-slate-400 text-center mb-4">
                还不是代理？
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setLocation("/apply-agent")}
              >
                申请成为代理
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <Button
            variant="link"
            className="text-slate-400 hover:text-white"
            onClick={() => setLocation("/")}
          >
            返回首页
          </Button>
        </div>
      </div>
    </div>
  );
}
