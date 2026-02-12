import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Megaphone, Plus, Edit, Trash2, Pin, Eye, EyeOff,
  AlertTriangle, CheckCircle, Info, XCircle, RefreshCw
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function AnnouncementManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<any>(null);
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    type: "info" as "info" | "warning" | "success" | "error",
    isPinned: false,
    startTime: "",
    endTime: "",
  });

  // 获取公告列表
  const { data: announcementsData, isLoading, refetch } = trpc.admin.getAnnouncements.useQuery();

  // Mutations
  const createMutation = trpc.admin.createAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("公告创建成功");
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "创建失败");
    },
  });

  const updateMutation = trpc.admin.updateAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("公告更新成功");
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "更新失败");
    },
  });

  const deleteMutation = trpc.admin.deleteAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("公告删除成功");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "删除失败");
    },
  });

  const resetForm = () => {
    setFormData({
      title: "",
      content: "",
      type: "info",
      isPinned: false,
      startTime: "",
      endTime: "",
    });
    setEditingAnnouncement(null);
  };

  const handleEdit = (announcement: any) => {
    setEditingAnnouncement(announcement);
    setFormData({
      title: announcement.title,
      content: announcement.content,
      type: announcement.type,
      isPinned: announcement.isPinned,
      startTime: announcement.startTime ? new Date(announcement.startTime).toISOString().slice(0, 16) : "",
      endTime: announcement.endTime ? new Date(announcement.endTime).toISOString().slice(0, 16) : "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.title || !formData.content) {
      toast.error("请填写标题和内容");
      return;
    }

    if (editingAnnouncement) {
      updateMutation.mutate({
        id: editingAnnouncement.id,
        ...formData,
        startTime: formData.startTime || null,
        endTime: formData.endTime || null,
      });
    } else {
      createMutation.mutate({
        ...formData,
        startTime: formData.startTime || undefined,
        endTime: formData.endTime || undefined,
      });
    }
  };

  const handleToggleActive = (announcement: any) => {
    updateMutation.mutate({
      id: announcement.id,
      isActive: !announcement.isActive,
    });
  };

  const handleTogglePinned = (announcement: any) => {
    updateMutation.mutate({
      id: announcement.id,
      isPinned: !announcement.isPinned,
    });
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "info":
        return <Info className="h-4 w-4 text-blue-400" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-400" />;
      default:
        return <Info className="h-4 w-4 text-blue-400" />;
    }
  };

  const getTypeBadge = (type: string) => {
    const styles: Record<string, string> = {
      info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      warning: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      success: "bg-green-500/20 text-green-400 border-green-500/30",
      error: "bg-red-500/20 text-red-400 border-red-500/30",
    };
    const labels: Record<string, string> = {
      info: "信息",
      warning: "警告",
      success: "成功",
      error: "紧急",
    };
    return <Badge className={styles[type] || styles.info}>{labels[type] || type}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-orange-400" />
            公告管理
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            管理系统公告，向所有用户发布通知
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-slate-600"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            刷新
          </Button>
          <Button
            onClick={() => {
              resetForm();
              setDialogOpen(true);
            }}
            className="bg-orange-500 hover:bg-orange-600"
          >
            <Plus className="h-4 w-4 mr-2" />
            发布公告
          </Button>
        </div>
      </div>

      {/* 公告列表 */}
      {isLoading ? (
        <Skeleton className="h-60 w-full" />
      ) : (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 bg-slate-800/50">
                  <TableHead className="text-slate-400">标题</TableHead>
                  <TableHead className="text-slate-400">类型</TableHead>
                  <TableHead className="text-slate-400">状态</TableHead>
                  <TableHead className="text-slate-400">置顶</TableHead>
                  <TableHead className="text-slate-400">创建时间</TableHead>
                  <TableHead className="text-slate-400 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {announcementsData?.announcements.map((announcement: any) => (
                  <TableRow key={announcement.id} className="border-slate-700">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getTypeIcon(announcement.type)}
                        <div>
                          <span className="text-white font-medium">{announcement.title}</span>
                          <p className="text-slate-500 text-xs mt-0.5 line-clamp-1 max-w-xs">{announcement.content}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getTypeBadge(announcement.type)}</TableCell>
                    <TableCell>
                      <Badge className={announcement.isActive ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-400"}>
                        {announcement.isActive ? "显示中" : "已隐藏"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {announcement.isPinned && (
                        <Pin className="h-4 w-4 text-orange-400" />
                      )}
                    </TableCell>
                    <TableCell className="text-slate-400 text-sm">
                      {new Date(announcement.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(announcement)}
                          className="text-slate-400 hover:text-white"
                        >
                          {announcement.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTogglePinned(announcement)}
                          className={announcement.isPinned ? "text-orange-400" : "text-slate-400 hover:text-white"}
                        >
                          <Pin className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(announcement)}
                          className="text-slate-400 hover:text-white"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm("确定要删除这条公告吗？")) {
                              deleteMutation.mutate({ id: announcement.id });
                            }
                          }}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(!announcementsData?.announcements || announcementsData.announcements.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                      暂无公告
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 创建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">
              {editingAnnouncement ? "编辑公告" : "发布公告"}
            </DialogTitle>
            <DialogDescription>
              {editingAnnouncement ? "修改公告内容" : "创建新的系统公告"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-slate-400">标题</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="公告标题"
                className="bg-slate-800 border-slate-600"
              />
            </div>

            <div>
              <Label className="text-slate-400">内容</Label>
              <Textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="公告内容"
                className="bg-slate-800 border-slate-600"
                rows={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-400">类型</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value: any) => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600">
                    <SelectItem value="info">信息</SelectItem>
                    <SelectItem value="success">成功</SelectItem>
                    <SelectItem value="warning">警告</SelectItem>
                    <SelectItem value="error">紧急</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pt-6">
                <Switch
                  checked={formData.isPinned}
                  onCheckedChange={(checked) => setFormData({ ...formData, isPinned: checked })}
                />
                <Label className="text-slate-400">置顶显示</Label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-400">开始时间（可选）</Label>
                <Input
                  type="datetime-local"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div>
                <Label className="text-slate-400">结束时间（可选）</Label>
                <Input
                  type="datetime-local"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-slate-600"
            >
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-orange-500 hover:bg-orange-600"
            >
              {createMutation.isPending || updateMutation.isPending ? "处理中..." : editingAnnouncement ? "保存" : "发布"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
