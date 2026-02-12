import { useState } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Settings, Lock, Eye, EyeOff, CheckCircle, Shield, User, Mail, Calendar, Coins, Loader2, ArrowLeft, KeyRound, AlertCircle, XCircle
} from "lucide-react";

export default function SettingsPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // 修改密码表单状态
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  // 内联消息状态
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const changePasswordMutation = trpc.user.changePassword.useMutation({
    onSuccess: () => {
      setPasswordChanged(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ type: "success", text: "密码修改成功！下次登录请使用新密码。" });
      try { toast.success("密码修改成功"); } catch (_) {}
    },
    onError: (error: any) => {
      setMessage({ type: "error", text: error.message || "密码修改失败，请稍后重试" });
      try { toast.error(error.message || "密码修改失败"); } catch (_) {}
    },
  });

  const handleChangePassword = () => {
    setMessage(null);

    // 前端验证
    if (!currentPassword) {
      setMessage({ type: "error", text: "请输入当前密码" });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: "error", text: "新密码至少8位" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "两次输入的新密码不一致" });
      return;
    }
    if (currentPassword === newPassword) {
      setMessage({ type: "error", text: "新密码不能与当前密码相同" });
      return;
    }

    changePasswordMutation.mutate({
      currentPassword,
      newPassword,
    });
  };

  // 格式化日期
  const formatDate = (dateStr: string | Date | null | undefined) => {
    if (!dateStr) return "未知";
    const date = new Date(dateStr);
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6 p-4 md:p-6">
        {/* 页面标题 */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setLocation("/dashboard")}
            className="p-2 rounded-lg hover:bg-slate-800/50 transition-colors text-slate-400 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-400 mb-1">
              <Settings className="w-4 h-4" />
              <span>个人设置</span>
            </div>
            <h1 className="text-2xl font-bold text-white">账户设置</h1>
          </div>
        </div>

        {/* 账户信息卡片 */}
        <Card className="bg-slate-900/50 border-slate-800/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <User className="w-5 h-5 text-cyan-400" />
              账户信息
            </CardTitle>
            <CardDescription className="text-slate-400">
              您的基本账户信息
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/30 border border-slate-700/30">
                <Mail className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">邮箱</p>
                  <p className="text-sm text-white truncate">{user?.email || "-"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/30 border border-slate-700/30">
                <User className="w-5 h-5 text-green-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">昵称</p>
                  <p className="text-sm text-white truncate">{user?.name || "-"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/30 border border-slate-700/30">
                <Coins className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">积分余额</p>
                  <p className="text-sm text-white">{user?.credits?.toLocaleString() || 0} 积分</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/30 border border-slate-700/30">
                <Calendar className="w-5 h-5 text-purple-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">注册时间</p>
                  <p className="text-sm text-white">{formatDate(user?.createdAt)}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 修改密码卡片 */}
        <Card className="bg-slate-900/50 border-slate-800/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-400" />
              修改密码
            </CardTitle>
            <CardDescription className="text-slate-400">
              修改您的登录密码，建议定期更换以保障账户安全
            </CardDescription>
          </CardHeader>
          <CardContent>
            {passwordChanged ? (
              /* 修改成功状态 */
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">密码修改成功</h3>
                <p className="text-slate-400 mb-6 text-sm">
                  您的密码已成功更新，下次登录请使用新密码
                </p>
                <Button
                  onClick={() => { setPasswordChanged(false); setMessage(null); }}
                  variant="outline"
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  继续修改
                </Button>
              </div>
            ) : (
              /* 修改密码表单 */
              <div className="space-y-5">
                {/* 内联消息提示 */}
                {message && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg border text-sm ${
                    message.type === "error"
                      ? "bg-red-900/30 border-red-700/50 text-red-300"
                      : "bg-green-900/30 border-green-700/50 text-green-300"
                  }`}>
                    {message.type === "error" ? (
                      <XCircle className="w-4 h-4 flex-shrink-0" />
                    ) : (
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    )}
                    <span>{message.text}</span>
                    <button
                      type="button"
                      onClick={() => setMessage(null)}
                      className="ml-auto text-slate-400 hover:text-white"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* 当前密码 */}
                <div className="space-y-2">
                  <Label htmlFor="currentPassword" className="text-slate-300">
                    当前密码
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="currentPassword"
                      type={showCurrentPassword ? "text" : "password"}
                      placeholder="请输入当前密码"
                      value={currentPassword}
                      onChange={(e) => { setCurrentPassword(e.target.value); setMessage(null); }}
                      className="pl-10 pr-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:ring-cyan-500/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* 新密码 */}
                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-slate-300">
                    新密码
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="newPassword"
                      type={showNewPassword ? "text" : "password"}
                      placeholder="请输入新密码（至少8位）"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setMessage(null); }}
                      className="pl-10 pr-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:ring-cyan-500/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {newPassword && newPassword.length < 8 && (
                    <p className="text-xs text-amber-400">密码至少需要8位字符</p>
                  )}
                </div>

                {/* 确认新密码 */}
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-slate-300">
                    确认新密码
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="请再次输入新密码"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setMessage(null); }}
                      className="pl-10 pr-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:ring-cyan-500/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-xs text-red-400">两次输入的密码不一致</p>
                  )}
                  {confirmPassword && newPassword === confirmPassword && confirmPassword.length >= 8 && (
                    <p className="text-xs text-green-400 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      密码一致
                    </p>
                  )}
                </div>

                {/* 密码安全提示 */}
                <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-700/30">
                  <div className="flex items-start gap-2">
                    <Shield className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-slate-400 space-y-1">
                      <p>密码安全建议：</p>
                      <ul className="list-disc list-inside space-y-0.5 text-slate-500">
                        <li>至少包含8位字符</li>
                        <li>建议混合使用大小写字母、数字和符号</li>
                        <li>不要使用与其他网站相同的密码</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* 提交按钮 */}
                <Button
                  type="button"
                  onClick={handleChangePassword}
                  disabled={changePasswordMutation.isPending || !currentPassword || newPassword.length < 8 || newPassword !== confirmPassword}
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white py-5 disabled:opacity-50"
                >
                  {changePasswordMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      修改中...
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4 mr-2" />
                      确认修改密码
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
