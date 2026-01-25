import { useState, useEffect } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Loader2, Lock, Eye, EyeOff, ArrowLeft, CheckCircle, XCircle, Shield
} from "lucide-react";
import { ParticleNetwork } from "@/components/ParticleNetwork";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/reset-password/:token");
  const searchString = useSearch();
  
  // 支持从路径参数或查询参数获取 token
  const getTokenFromSearch = () => {
    const urlParams = new URLSearchParams(searchString);
    return urlParams.get('token') || '';
  };
  
  const token = params?.token || getTokenFromSearch();
  
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const resetMutation = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      setSuccess(true);
      toast.success("密码重置成功");
    },
    onError: (error) => {
      setError(error.message || "重置失败，请重试");
      toast.error(error.message || "重置失败");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    if (!password || password.length < 8) {
      setError("密码至少需要8个字符");
      return;
    }
    
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    
    if (!token) {
      setError("无效的重置链接");
      return;
    }
    
    resetMutation.mutate({ token, newPassword: password });
  };

  // 无效token检查
  if (!token) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="text-center">
          <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">无效的重置链接</h2>
          <p className="text-slate-400 mb-4">请重新请求密码重置</p>
          <Button onClick={() => setLocation("/forgot-password")}>
            重新请求
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a] relative overflow-hidden flex items-center justify-center">
      {/* 背景效果 */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)`,
          backgroundSize: '50px 50px'
        }} />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      <ParticleNetwork />

      <div className="relative z-10 w-full max-w-md mx-4">
        {/* 返回按钮 */}
        <Link href="/login" className="inline-flex items-center gap-2 text-slate-400 hover:text-white mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          返回登录
        </Link>

        {/* 主卡片 */}
        <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800/50 rounded-2xl p-8">
          {!success ? (
            <>
              {/* 标题 */}
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-8 h-8 text-white" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">重置密码</h1>
                <p className="text-slate-400">请输入您的新密码</p>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <p className="text-red-400 text-sm flex items-center gap-2">
                    <XCircle className="w-4 h-4" />
                    {error}
                  </p>
                </div>
              )}

              {/* 表单 */}
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-slate-300">新密码</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="至少8个字符"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 pr-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-slate-300">确认新密码</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                    <Input
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      placeholder="再次输入新密码"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={resetMutation.isPending}
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 py-6 text-lg"
                >
                  {resetMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      重置中...
                    </>
                  ) : (
                    "重置密码"
                  )}
                </Button>
              </form>
            </>
          ) : (
            /* 成功状态 */
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-10 h-10 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3">密码重置成功</h2>
              <p className="text-slate-400 mb-6">
                您的密码已成功重置，请使用新密码登录。
              </p>
              <Button
                onClick={() => setLocation("/login")}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
              >
                前往登录
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
