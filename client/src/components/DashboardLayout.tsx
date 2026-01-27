import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { LayoutDashboard, LogOut, PanelLeft, Search, History, CreditCard, Shield, Wallet, Target, User, Settings, Coins, MessageCircle, Linkedin, Rocket, UserCircle, Users, UserSearch, SearchCheck, Star, Sparkles, Crown } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { NotificationCenter } from "./NotificationCenter";

const menuItems: Array<{ icon: React.ComponentType<{ className?: string }>; label: string; path: string; adminOnly?: boolean; isNew?: boolean; isRainbow?: boolean }> = [
  { icon: LayoutDashboard, label: "仪表盘", path: "/dashboard" },
  { icon: Linkedin, label: "LinkedIn", path: "/search" },
  { icon: Users, label: "TruePeopleSearch", path: "/tps" },
  { icon: UserSearch, label: "PeopleSearchNow", path: "/people-search-now", isNew: true },
  { icon: SearchCheck, label: "SearchPeopleFree", path: "/search-people-free", isNew: true },
  { icon: Sparkles, label: "Anywho", path: "/anywho", isRainbow: true },
  { icon: Rocket, label: "正在开发", path: "/roadmap" },
  { icon: History, label: "历史记录", path: "/history" },
  { icon: Wallet, label: "积分充值", path: "/recharge" },
  { icon: Crown, label: "代理中心", path: "/agent", isNew: true },
  { icon: MessageCircle, label: "联系我们", path: "/feedback" },
  { icon: Shield, label: "管理后台", path: "/admin", adminOnly: true },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Access to this dashboard requires authentication. Continue to launch the login flow.
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
                    <Target className="h-5 w-5 text-white" />
                  </div>
                  <span className="font-bold tracking-tight truncate bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent" style={{ fontFamily: 'Orbitron, sans-serif' }}>
                    DataReach
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            {/* 七彩錆金动画样式 */}
            <style>{`
              @keyframes rainbow-shimmer {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
              }
              @keyframes star-sparkle {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.7; transform: scale(1.2); }
              }
              .rainbow-menu-text {
                background: linear-gradient(
                  90deg,
                  #ffd700, #ffb347, #ff6b6b, #ff69b4, #9b59b6, #3498db, #2ecc71, #ffd700
                );
                background-size: 200% auto;
                -webkit-background-clip: text;
                background-clip: text;
                -webkit-text-fill-color: transparent;
                animation: rainbow-shimmer 3s linear infinite;
              }
              .rainbow-menu-item {
                background: linear-gradient(
                  90deg,
                  rgba(255, 215, 0, 0.05),
                  rgba(255, 105, 180, 0.05),
                  rgba(155, 89, 182, 0.05),
                  rgba(52, 152, 219, 0.05)
                );
                background-size: 200% auto;
                animation: rainbow-shimmer 4s linear infinite;
              }
              .rainbow-menu-item:hover {
                background: linear-gradient(
                  90deg,
                  rgba(255, 215, 0, 0.15),
                  rgba(255, 105, 180, 0.15),
                  rgba(155, 89, 182, 0.15),
                  rgba(52, 152, 219, 0.15)
                );
                background-size: 200% auto;
              }
              .star-sparkle {
                animation: star-sparkle 1.5s ease-in-out infinite;
              }
            `}</style>
            <SidebarMenu className="px-2 py-1">
              {menuItems.filter(item => !item.adminOnly || user?.role === 'admin').map(item => {
                const isActive = location === item.path;
                const isNewItem = item.isNew;
                const isRainbowItem = item.isRainbow;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal ${isNewItem ? 'hover:bg-emerald-500/10' : ''} ${isRainbowItem ? 'rainbow-menu-item rounded-lg' : ''}`}
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? (isNewItem ? "text-emerald-400" : isRainbowItem ? "text-yellow-400" : "text-primary") : (isNewItem ? "text-emerald-500" : isRainbowItem ? "text-amber-400" : "")}`}
                      />
                      <span className={isNewItem ? "text-emerald-400 font-medium" : isRainbowItem ? "rainbow-menu-text font-bold" : ""}>{item.label}</span>
                      {isNewItem && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          NEW
                        </span>
                      )}
                      {isRainbowItem && (
                        <span className="ml-auto flex items-center gap-1">
                          <Star className="h-3 w-3 text-yellow-400 fill-yellow-400 star-sparkle" />
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gradient-to-r from-yellow-500/20 via-pink-500/20 to-purple-500/20 text-yellow-300 border border-yellow-500/30">
                            推荐
                          </span>
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
            
            {/* 产品介绍 */}
            {!isCollapsed && (
              <div className="mx-3 mt-4 p-3 rounded-lg bg-gradient-to-br from-cyan-500/5 to-blue-500/5 border border-cyan-500/10 group-data-[collapsible=icon]:hidden">
                <div className="text-xs font-medium text-cyan-400 mb-2">精准获客 · 拒绝无效数据</div>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  DataReach Pro 整合全球多平台数据，为您提供经过多重验证的高质量商业联系人信息。
                </p>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                    <span className="w-1 h-1 rounded-full bg-cyan-400"></span>
                    <span>年龄精准筛选 - 锁定决策层</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                    <span className="w-1 h-1 rounded-full bg-cyan-400"></span>
                    <span>电话双重验证 - 确保可达</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                    <span className="w-1 h-1 rounded-full bg-cyan-400"></span>
                    <span>邮箱有效确认 - 提升触达率</span>
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-gray-700/50">
                  <p className="text-[10px] text-gray-500">
                    如有定制开发或商务合作需求，欢迎通过「联系我们」与我们的团队沟通。
                  </p>
                </div>
              </div>
            )}
          </SidebarContent>

          <SidebarFooter className="p-3">
            {/* 通知按钮 */}
            <div className="flex justify-center mb-2 group-data-[collapsible=icon]:mb-0">
              <NotificationCenter />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border border-cyan-500/30 shrink-0 bg-gradient-to-br from-cyan-500/20 to-blue-600/20">
                    <AvatarFallback className="text-sm font-bold bg-gradient-to-br from-cyan-500/30 to-blue-600/30 text-cyan-300">
                      {user?.name && user.name.length > 0 
                        ? user.name.charAt(0).toUpperCase() 
                        : user?.email 
                          ? user.email.charAt(0).toUpperCase()
                          : <UserCircle className="h-5 w-5 text-cyan-400" />
                      }
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5 border-b mb-1">
                  <p className="text-sm font-medium">{user?.name || user?.email?.split('@')[0]}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <Coins className="h-3 w-3 text-yellow-500" />
                    <span className="text-xs text-yellow-500 font-medium">{user?.credits?.toLocaleString() || 0} 积分</span>
                  </div>
                </div>
                <DropdownMenuItem
                  onClick={() => setLocation('/dashboard')}
                  className="cursor-pointer"
                >
                  <User className="mr-2 h-4 w-4" />
                  <span>个人中心</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setLocation('/recharge')}
                  className="cursor-pointer"
                >
                  <Wallet className="mr-2 h-4 w-4" />
                  <span>充值积分</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setLocation('/history')}
                  className="cursor-pointer"
                >
                  <History className="mr-2 h-4 w-4" />
                  <span>搜索记录</span>
                </DropdownMenuItem>
                <div className="border-t my-1" />
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>退出登录</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">
                    {activeMenuItem?.label ?? "Menu"}
                  </span>
                </div>
              </div>
            </div>
            <NotificationCenter />
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </>
  );
}
