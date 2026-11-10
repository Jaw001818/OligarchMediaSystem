import React from "react";
import { 
  Users, 
  CalendarDays, 
  CreditCard, 
  MailWarning, 
  Settings, 
  LogOut, 
  LayoutDashboard,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sliders,
  Paintbrush,
  Sun,
  Moon,
  BookOpen,
  Wallet,
  Trash2,
  MessageSquare
} from "lucide-react";

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  onLogout: () => void;
  adminName: string;
  themeMode: "light" | "dark";
  setThemeMode: (mode: "light" | "dark") => void;
  portalMode: boolean;
  setPortalMode: (mode: boolean) => void;
  pendingRequestsCount?: number;
}

export default function Sidebar({
  currentTab,
  setCurrentTab,
  onLogout,
  adminName,
  themeMode,
  setThemeMode,
  portalMode,
  setPortalMode,
  pendingRequestsCount = 0
}: SidebarProps) {
  const navGroups = [
    {
      title: "STUDIO OPERATIONS",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { id: "employees", label: "Employees Roster", icon: Users },
        { id: "attendance", label: "Attendance Tracker", icon: CalendarDays },
        { id: "attendance-override", label: "Attendance Editor", icon: Sliders },
      ]
    },
    {
      title: "FINANCE & PAYROLL",
      items: [
        { id: "payroll", label: "Payroll Hub", icon: CreditCard },
        { id: "cash-advances", label: "Advances & Loans", icon: Wallet },
      ]
    },
    {
      title: "COMMUNICATION & CHANNELS",
      items: [
        { id: "devotion", label: "Devotion & Prayer", icon: BookOpen },
        { id: "requests", label: "Staff Requests", icon: MailWarning, count: pendingRequestsCount },
        { id: "chat", label: "Studio Chat / Messages", icon: MessageSquare, badge: "Upcoming" },
        { id: "trash", label: "Recycle Bin", icon: Trash2 },
        { id: "settings", label: "System Config", icon: Settings },
      ]
    }
  ];

  return (
    <aside className="w-72 bg-white dark:bg-[#0A0D14] border-r border-slate-200 dark:border-white/5 flex flex-col h-full shrink-0 transition-colors duration-200">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-200 dark:border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20">
            <Paintbrush className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-sm leading-tight text-slate-900 dark:text-white tracking-tight truncate">
              Oligarch Media
            </h1>
            <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold tracking-wider uppercase">
              Design Studio · HR
            </p>
          </div>
        </div>
      </div>

      {/* Admin Quick Profile Card */}
      <div className="px-5 py-3.5 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.01]">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xs">
              {adminName ? adminName.charAt(0).toUpperCase() : "A"}
            </div>
            <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#0A0D14]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Admin Console
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
              {adminName}
            </p>
          </div>
        </div>
      </div>

      {/* Grouped Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.title} className="space-y-1">
            <p className="px-3 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              {group.title}
            </p>
            {group.items.map((item) => {
              const IconComponent = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setPortalMode(false);
                    setCurrentTab(item.id);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    isActive
                      ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-semibold ring-1 ring-indigo-500/20"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
                    <IconComponent className={`w-4 h-4 shrink-0 transition-colors ${isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`} />
                    <span className="truncate whitespace-nowrap">{item.label}</span>
                  </div>
                  {(item as any).badge && (
                    <span className="px-1.5 py-0.5 rounded-full bg-gradient-to-r from-indigo-500/10 to-violet-500/10 dark:from-indigo-500/20 dark:to-violet-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 text-[9px] font-mono font-bold uppercase tracking-wider shrink-0 ml-1.5">
                      {(item as any).badge}
                    </span>
                  )}
                  {item.count !== undefined && item.count > 0 && (
                    <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] h-[20px] flex items-center justify-center leading-none shadow-sm shadow-indigo-600/30 shrink-0 ml-2">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Action panel footer */}
      <div className="p-3.5 border-t border-slate-200 dark:border-white/5 space-y-2 bg-slate-50/40 dark:bg-transparent">
        {/* Switch Portal Button */}
        <button
          onClick={() => setPortalMode(!portalMode)}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${
            portalMode
              ? "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300"
              : "bg-white dark:bg-white/[0.02] hover:bg-slate-100 dark:hover:bg-white/[0.05] border-slate-200 dark:border-white/5 text-slate-700 dark:text-slate-300"
          }`}
        >
          <Smartphone className="w-3.5 h-3.5 text-indigo-500" />
          <span>{portalMode ? "Admin Console" : "Employee Kiosk View"}</span>
        </button>

        {/* Theme Toggler */}
        <button
          id="theme-toggler-btn"
          onClick={() => setThemeMode(themeMode === "light" ? "dark" : "light")}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 bg-white dark:bg-white/[0.02] hover:bg-slate-100 dark:hover:bg-white/[0.04] border border-slate-200 dark:border-white/5 transition-all cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
              {themeMode === "light" ? (
                <Sun className="h-3.5 w-3.5 text-amber-500" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-indigo-400" />
              )}
            </span>
            <span>{themeMode === "light" ? "Light Mode" : "Dark Mode"}</span>
          </div>
          <div className="w-7 h-4 rounded-full bg-slate-200 dark:bg-slate-800 p-0.5 relative flex items-center transition-colors">
            <div 
              className={`w-3 h-3 rounded-full bg-white shadow-xs transform transition-transform duration-200 ${
                themeMode === "light" ? "translate-x-0" : "translate-x-3 bg-indigo-400"
              }`}
            />
          </div>
        </button>

        {/* Sign Out */}
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all text-left cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out Session</span>
        </button>
      </div>
    </aside>
  );
}
