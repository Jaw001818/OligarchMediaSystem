import React, { useState, useEffect } from "react";
import { 
  Trash2, 
  RotateCcw, 
  Search, 
  AlertTriangle, 
  Clock, 
  User, 
  Calendar, 
  RefreshCw, 
  CheckCircle2, 
  FileText,
  Filter,
  DollarSign,
  BookOpen
} from "lucide-react";
import { 
  db,
  collection, 
  onSnapshot, 
  restoreDeletedRecord, 
  permanentlyDeleteTrashRecord, 
  emptyTrash 
} from "../firebase";
import { DeletedRecord } from "../types";

interface RecycleBinManagerProps {
  onRefresh?: () => void;
}

export default function RecycleBinManager({ onRefresh }: RecycleBinManagerProps) {
  const [deletedRecords, setDeletedRecords] = useState<DeletedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Subscribe to real-time updates for deleted_records
  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(collection(db, "deleted_records"), (snapshot) => {
      const records: DeletedRecord[] = [];
      snapshot.forEach((doc: any) => {
        records.push({ id: doc.id, ...doc.data() });
      });
      // Sort newest deleted first
      records.sort((a, b) => {
        const timeA = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
        const timeB = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
        return timeB - timeA;
      });
      setDeletedRecords(records);
      setLoading(false);
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const handleRestore = async (record: DeletedRecord) => {
    setActionLoadingId(record.id);
    setMessage(null);
    try {
      const ok = await restoreDeletedRecord(record.id);
      if (ok) {
        setMessage({
          type: "success",
          text: `"${record.title}" restored successfully to ${getCollectionLabel(record.originalCollection)}!`
        });
        setDeletedRecords((prev) => prev.filter((r) => r.id !== record.id));
        if (onRefresh) onRefresh();
      } else {
        setMessage({ type: "error", text: "Failed to restore record. Please try again." });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "Error restoring record" });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handlePermanentDelete = async (record: DeletedRecord) => {
    if (!window.confirm(`Are you sure you want to PERMANENTLY delete "${record.title}"? This cannot be undone.`)) {
      return;
    }
    setActionLoadingId(record.id);
    setMessage(null);
    try {
      const ok = await permanentlyDeleteTrashRecord(record.id);
      if (ok) {
        setMessage({
          type: "success",
          text: `"${record.title}" was permanently deleted.`
        });
        setDeletedRecords((prev) => prev.filter((r) => r.id !== record.id));
      } else {
        setMessage({ type: "error", text: "Failed to delete permanently." });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "Error deleting record" });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleEmptyTrash = async () => {
    setActionLoadingId("EMPTY_ALL");
    setMessage(null);
    try {
      await emptyTrash();
      setDeletedRecords([]);
      setConfirmEmpty(false);
      setMessage({ type: "success", text: "Recycle Bin has been completely emptied." });
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "Error emptying recycle bin" });
    } finally {
      setActionLoadingId(null);
    }
  };

  const getCollectionBadge = (col: string) => {
    switch (col) {
      case "employees":
        return { label: "Employee", color: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: User };
      case "attendance":
        return { label: "Attendance Log", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: Calendar };
      case "requests":
      case "attendance_copy_requests":
        return { label: "Request", color: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: FileText };
      case "cash_advances":
      case "boss_debts":
        return { label: "Advance/Debt", color: "bg-purple-500/15 text-purple-400 border-purple-500/30", icon: DollarSign };
      case "devotion_schedules":
        return { label: "Devotion/Prayer", color: "bg-teal-500/15 text-teal-400 border-teal-500/30", icon: BookOpen };
      case "payrolls":
      case "payroll_periods":
        return { label: "Payroll", color: "bg-rose-500/15 text-rose-400 border-rose-500/30", icon: DollarSign };
      default:
        return { label: col, color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30", icon: Trash2 };
    }
  };

  const getCollectionLabel = (col: string) => {
    switch (col) {
      case "employees": return "Employees Directory";
      case "attendance": return "Attendance Tracker";
      case "requests": return "Leave Requests";
      case "attendance_copy_requests": return "Attendance Copy Requests";
      case "cash_advances": return "Cash Advances";
      case "boss_debts": return "Boss Credits";
      case "devotion_schedules": return "Devotion & Prayer Schedules";
      case "payrolls": return "Payroll Records";
      default: return col;
    }
  };

  const filterTabs = [
    { id: "all", label: "All Items" },
    { id: "employees", label: "Employees" },
    { id: "attendance", label: "Attendance" },
    { id: "requests", label: "Requests" },
    { id: "devotion_schedules", label: "Devotion" },
    { id: "cash_advances", label: "Advances/Credits" },
  ];

  const filtered = deletedRecords.filter((rec) => {
    if (selectedFilter !== "all") {
      if (selectedFilter === "requests") {
        if (rec.originalCollection !== "requests" && rec.originalCollection !== "attendance_copy_requests") return false;
      } else if (selectedFilter === "cash_advances") {
        if (rec.originalCollection !== "cash_advances" && rec.originalCollection !== "boss_debts") return false;
      } else if (rec.originalCollection !== selectedFilter) {
        return false;
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = rec.title?.toLowerCase().includes(q);
      const matchSub = rec.subtitle?.toLowerCase().includes(q);
      const matchCol = rec.originalCollection?.toLowerCase().includes(q);
      const matchData = JSON.stringify(rec.data || {}).toLowerCase().includes(q);
      return matchTitle || matchSub || matchCol || matchData;
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-in fade-in duration-300">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-gradient-to-r from-zinc-900 to-zinc-950 border border-white/5 rounded-2xl shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
            <Trash2 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-black text-white tracking-tight">Recycle Bin & Safe Storage</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                {deletedRecords.length} {deletedRecords.length === 1 ? "Item" : "Items"}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
              Deleted employees, attendance logs, and requests are safely archived here before permanent removal. Restore accidentally deleted items with a single click.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {deletedRecords.length > 0 && (
            confirmEmpty ? (
              <div className="flex items-center gap-2 bg-rose-950/40 p-1.5 rounded-xl border border-rose-800/40 animate-in fade-in">
                <span className="text-[11px] text-rose-300 font-bold px-2">Permanently purge all?</span>
                <button
                  onClick={handleEmptyTrash}
                  disabled={actionLoadingId === "EMPTY_ALL"}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-md"
                >
                  {actionLoadingId === "EMPTY_ALL" ? "Purging..." : "Yes, Purge"}
                </button>
                <button
                  onClick={() => setConfirmEmpty(false)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmEmpty(true)}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-rose-950/40 hover:text-rose-300 border border-white/5 hover:border-rose-500/30 text-zinc-400 text-xs font-bold transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Empty Recycle Bin</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* Notifications / Alerts */}
      {message && (
        <div className={`p-4 rounded-xl flex items-center gap-3 text-xs font-semibold border ${
          message.type === "success" 
            ? "bg-emerald-950/30 text-emerald-300 border-emerald-800/30" 
            : "bg-rose-950/30 text-rose-300 border-rose-800/30"
        }`}>
          {message.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Controls: Search & Category Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#16191E] p-3 rounded-xl border border-white/5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search deleted records by name, date, ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-black/30 border border-white/5 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500/50"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                selectedFilter === tab.id
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow-xs"
                  : "bg-white/[0.02] text-zinc-400 hover:text-zinc-200 border border-white/5 hover:bg-white/[0.05]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* List / Grid of Deleted Records */}
      {loading ? (
        <div className="p-16 text-center bg-[#16191E] rounded-2xl border border-white/5">
          <RefreshCw className="w-8 h-8 text-rose-400 animate-spin mx-auto mb-3" />
          <p className="text-xs text-zinc-400 font-semibold">Loading recycle bin records...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-16 text-center bg-[#16191E] rounded-2xl border border-white/5">
          <div className="w-14 h-14 rounded-2xl bg-zinc-800/50 flex items-center justify-center text-zinc-500 mx-auto mb-3">
            <Trash2 className="w-7 h-7" />
          </div>
          <h3 className="text-sm font-bold text-zinc-300">Recycle Bin is Empty</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
            {searchQuery 
              ? "No deleted items match your search criteria." 
              : "No records are currently deleted. When items are removed, they will appear here safely for recovery."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map((item) => {
            const badge = getCollectionBadge(item.originalCollection);
            const Icon = badge.icon;
            const isRestoring = actionLoadingId === item.id;
            const isExpanded = expandedId === item.id;
            const deletedTimeFormatted = item.deletedAt 
              ? new Date(item.deletedAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                })
              : "Recently";

            return (
              <div 
                key={item.id}
                className="bg-[#16191E] border border-white/5 hover:border-white/10 rounded-xl p-4 transition-all duration-200"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-zinc-800/60 border border-white/5 flex items-center justify-center text-zinc-400 shrink-0 mt-0.5">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-white truncate max-w-md">
                          {item.title}
                        </h4>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badge.color}`}>
                          {badge.label}
                        </span>
                      </div>
                      
                      {item.subtitle && (
                        <p className="text-xs text-zinc-400 mt-0.5 truncate">
                          {item.subtitle}
                        </p>
                      )}

                      <div className="flex items-center gap-3 text-[11px] text-zinc-500 mt-1.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>Deleted: {deletedTimeFormatted}</span>
                        </span>
                        <span>•</span>
                        <span className="font-mono text-[10px]">
                          ID: {item.originalId}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] text-zinc-400 hover:text-white text-[11px] font-semibold border border-white/5 transition-colors cursor-pointer"
                    >
                      {isExpanded ? "Hide Details" : "View Details"}
                    </button>
                    
                    <button
                      onClick={() => handleRestore(item)}
                      disabled={isRestoring}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all disabled:opacity-50 shadow-xs cursor-pointer"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${isRestoring ? "animate-spin" : ""}`} />
                      <span>{isRestoring ? "Restoring..." : "Restore"}</span>
                    </button>

                    <button
                      onClick={() => handlePermanentDelete(item)}
                      disabled={isRestoring}
                      className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/20 transition-all disabled:opacity-50 cursor-pointer"
                      title="Permanently Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded Details Preview */}
                {isExpanded && (
                  <div className="mt-4 pt-3 border-t border-white/5 animate-in fade-in text-xs font-mono bg-black/40 p-3 rounded-lg overflow-x-auto text-zinc-300 max-h-60 scrollbar-thin">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-bold">
                      Archived Payload ({item.originalCollection}):
                    </div>
                    <pre className="text-[11px] leading-relaxed whitespace-pre-wrap">
                      {JSON.stringify(item.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
