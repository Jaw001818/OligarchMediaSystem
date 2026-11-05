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
  Trash2
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
  const menuItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "devotion", label: "Devotion & Prayer", icon: BookOpen },
    { id: "employees", label: "Employees", icon: Users },
    { id: "attendance", label: "Attendance Tracker", icon: CalendarDays },
    { id: "attendance-override", label: "Attendance Editor", icon: Sliders },
    { id: "payroll", label: "Payroll Hub", icon: CreditCard },
    { id: "cash-advances", label: "Advances & Boss Credits", icon: Wallet },
    { id: "requests", label: "Employee Requests", icon: MailWarning },
    { id: "trash", label: "Recycle Bin", icon: Trash2 },
    { id: "settings", label: "System Config", icon: Settings },
  ];

  return (
    <aside className="w-72 bg-[#16191E] border-r border-white/5 flex flex-col h-full shrink-0 transition-colors duration-200">
      {/* Brand Header */}
      <div className="p-6 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-extrabold text-white text-base shadow-sm">
            <Paintbrush className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="font-bold text-sm leading-tight text-white tracking-tight">Oligarch Media</h1>
            <p className="text-[9px] text-indigo-400 font-semibold tracking-[0.15em]">MEDIA & OPERATIONS</p>
          </div>
        </div>
      </div>

      {/* Admin Quick Profile */}
      <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-sky-400 font-semibold text-xs">
          A
        </div>
        <div className="truncate">
          <p className="text-[10px] text-slate-500 font-medium">Logged in as</p>
          <p className="text-xs font-semibold text-slate-300 truncate">{adminName}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
        {menuItems.map((item) => {
          const IconComponent = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setPortalMode(false);
                setCurrentTab(item.id);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                isActive
                  ? "bg-sky-500/10 text-sky-400 font-semibold border-l-2 border-l-sky-500"
                  : "text-zinc-400 hover:text-white hover:bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1 text-left">
                <IconComponent className={`w-4 h-4 shrink-0 ${isActive ? "text-sky-400" : "text-slate-400"}`} />
                <span className="truncate whitespace-nowrap text-left">{item.label}</span>
              </div>
              {item.id === "requests" && pendingRequestsCount > 0 && (
                <span className="bg-sky-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[18px] h-[18px] flex items-center justify-center leading-none shadow-md shadow-sky-500/20 shrink-0 ml-2">
                  {pendingRequestsCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Action panel footer */}
      <div className="p-4 border-t border-white/5 space-y-2">
        {/* Switch Portal Button */}
        <button
          onClick={() => setPortalMode(!portalMode)}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border cursor-pointer ${
            portalMode
              ? "bg-sky-500/10 border-sky-500/20 text-sky-450"
              : "bg-white/[0.02] hover:bg-white/[0.05] border-white/5 text-slate-300"
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          {portalMode ? "Admin Console Mode" : "Employee Portal View"}
        </button>


        {/* Theme Toggler */}
        <button
          id="theme-toggler-btn"
          onClick={() => setThemeMode(themeMode === "light" ? "dark" : "light")}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 transition-all duration-300 cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
              {themeMode === "light" ? (
                <Sun className="h-3.5 w-3.5 text-amber-500 animate-in spin-in-12 duration-300" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-sky-400 animate-in spin-in-12 duration-300" />
              )}
            </span>
            <span>Theme Mode</span>
          </div>
          
          <div className="w-8 h-4 rounded-full bg-zinc-800 dark:bg-zinc-700 p-0.5 relative flex items-center transition-colors duration-300">
            <div 
              className={`w-3 h-3 rounded-full bg-white shadow-md transform transition-all duration-300 ease-out ${
                themeMode === "light" ? "translate-x-0 bg-yellow-500" : "translate-x-4 bg-sky-400"
              }`}
            />
          </div>
        </button>

        {/* Sign Out */}
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-all text-left cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5 text-red-400" />
          <span>Sign Out Session</span>
        </button>
      </div>
    </aside>
  );
}
