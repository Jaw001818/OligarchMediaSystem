import React, { useState, useMemo } from "react";
import { DevotionSchedule } from "../types";
import { 
  Sparkles, 
  Calendar, 
  Eye, 
  Repeat, 
  UserCheck, 
  UserX, 
  Clock, 
  Check, 
  Info,
  RefreshCw,
  Shuffle,
  ChevronRight,
  ChevronLeft,
  Edit3,
  Trash2
} from "lucide-react";

interface DevotionFlyerCardProps {
  schedules: DevotionSchedule[];
  todayStr: string;
  onOpenSubstituteModal?: (schedule: DevotionSchedule, role: "devotion" | "prayer") => void;
  onEditSchedule?: (schedule: DevotionSchedule) => void;
  onDeleteSchedule?: (scheduleId: string, dateStr: string) => void;
  onOpenLoopModal?: () => void;
  onRollDailyQueue?: () => void;
  isRolling?: boolean;
  isAdmin?: boolean;
  currentUserId?: string;
  currentUserName?: string;
  selectedMonth?: string;
  onSelectMonth?: (month: string) => void;
}

export default function DevotionFlyerCard({
  schedules,
  todayStr,
  onOpenSubstituteModal,
  onEditSchedule,
  onDeleteSchedule,
  onOpenLoopModal,
  onRollDailyQueue,
  isRolling = false,
  isAdmin = false,
  currentUserId,
  currentUserName,
  selectedMonth: externalSelectedMonth,
  onSelectMonth
}: DevotionFlyerCardProps) {
  // Exclusively Dark Paper Flyer styling (white paper flyer completely removed per requirements)
  const [selectedRow, setSelectedRow] = useState<DevotionSchedule | null>(null);

  // Month navigation: default to "upcoming15" so all 15 upcoming days across month boundaries are visible
  const currentMonthKey = todayStr.slice(0, 7);
  const [internalSelectedMonth, setInternalSelectedMonth] = useState<string>("upcoming15");
  
  const activeMonth = externalSelectedMonth || internalSelectedMonth;
  const setActiveMonth = (m: string) => {
    setInternalSelectedMonth(m);
    if (onSelectMonth) onSelectMonth(m);
  };

  // Compute available months from schedules
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    set.add(currentMonthKey);
    schedules.forEach((s) => {
      if (s.date && s.date.length >= 7) {
        set.add(s.date.slice(0, 7));
      }
    });
    return Array.from(set).sort();
  }, [schedules, currentMonthKey]);

  // Format month label, e.g. "October 2026"
  const formatMonthLabel = (mKey: string) => {
    if (mKey === "upcoming15") return isAdmin ? "Next 15 Upcoming Shifts (Date-Based)" : "Next 10 Upcoming Shifts (Date-Based)";
    if (mKey === "rolling30") return "Next 30 Days (1 Month Rolling)";
    try {
      const [yearStr, monthStr] = mKey.split("-");
      const d = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1);
      return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    } catch {
      return mKey;
    }
  };

  // Filter schedules strictly per role (Monday–Friday only; Saturday & Sunday are Rest Days):
  // - Employees (!isAdmin): Strictly the next 10 upcoming weekday schedule rows
  // - Admins (isAdmin): Strictly next 15 upcoming weekday schedule rows by default (or calendar month filter)
  const displayedSchedules = useMemo(() => {
    const isWeekday = (dateStr: string) => {
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
      const [y, m, d] = dateStr.split("-").map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      return dow !== 0 && dow !== 6;
    };

    if (!isAdmin) {
      return schedules
        .filter(s => isWeekday(s.date) && s.date >= todayStr && s.status !== "completed")
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 10);
    }
    if (activeMonth === "upcoming15" || !activeMonth || activeMonth === "rolling30") {
      return schedules
        .filter(s => isWeekday(s.date) && s.date >= todayStr && s.status !== "completed")
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 15);
    }
    return schedules
      .filter(s => isWeekday(s.date) && s.date.startsWith(activeMonth))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [schedules, activeMonth, todayStr, isAdmin]);

  // Navigate months (Admin only)
  const handlePrevMonth = () => {
    const idx = availableMonths.indexOf(activeMonth);
    if (idx > 0) {
      setActiveMonth(availableMonths[idx - 1]);
    } else {
      const [y, m] = activeMonth.split("-").map(Number);
      const prevDate = new Date(y, m - 2, 1);
      const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
      setActiveMonth(prevKey);
    }
  };

  const handleNextMonth = () => {
    const idx = availableMonths.indexOf(activeMonth);
    if (idx >= 0 && idx < availableMonths.length - 1) {
      setActiveMonth(availableMonths[idx + 1]);
    } else {
      const [y, m] = activeMonth.split("-").map(Number);
      const nextDate = new Date(y, m, 1);
      const nextKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
      setActiveMonth(nextKey);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900/60 border border-zinc-800 p-3 rounded-2xl">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${isAdmin ? "bg-indigo-400" : "bg-emerald-400"} animate-pulse`} />
          <span className="text-xs font-mono font-bold text-zinc-200">
            {isAdmin 
              ? `Admin Planning Roster: Next 15 Shifts (${displayedSchedules.length} rows visible)` 
              : `Upcoming Roster: Next 10 Shifts (${displayedSchedules.length} rows visible)`}
          </span>
          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border hidden sm:inline ${
            isAdmin ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
          }`}>
            {isAdmin ? "15-Day Sequence (5 Advance Planning)" : "10-Day Rolling View"}
          </span>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Admin Month Navigator */}
          {isAdmin && (
            <div className="flex items-center bg-zinc-800/90 border border-zinc-700 rounded-xl p-0.5">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all cursor-pointer"
                title="Previous Month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <select
                value={activeMonth}
                onChange={(e) => setActiveMonth(e.target.value)}
                className="bg-transparent text-xs font-mono font-bold text-zinc-200 px-2 py-1 focus:outline-none cursor-pointer"
              >
                <option value="upcoming15" className="bg-zinc-900 text-white">
                  Next 15 Upcoming Planning Days
                </option>
                {availableMonths.map((m) => (
                  <option key={m} value={m} className="bg-zinc-900 text-white">
                    {formatMonthLabel(m)} ({schedules.filter(s => s.date.startsWith(m)).length} days)
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all cursor-pointer"
                title="Next Month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}


          {isAdmin && onRollDailyQueue && schedules.length > 0 && (
            <button
              type="button"
              onClick={onRollDailyQueue}
              disabled={isRolling}
              className="px-3 py-1.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-200 text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              title="Advance 1 day: Removes top past day and appends newly generated fair random pair at bottom"
            >
              {isRolling ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  <span>Rolling...</span>
                </>
              ) : (
                <>
                  <Shuffle className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Advance 1 Day</span>
                </>
              )}
            </button>
          )}

          {isAdmin && onOpenLoopModal && (
            <button
              type="button"
              onClick={onOpenLoopModal}
              className="px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              title="Loop your current devotion pattern forward across upcoming Monday–Friday business days"
            >
              <Repeat className="w-3.5 h-3.5 text-indigo-400" />
              <span>Loop Devotions</span>
            </button>
          )}
        </div>
      </div>

      {/* Month Badge Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="text-zinc-300 font-bold">
            Viewing: <strong className="text-white underline">{formatMonthLabel(activeMonth)}</strong>
          </span>
          <span className="text-zinc-500">
            ({displayedSchedules.length} {displayedSchedules.length === 1 ? "day" : "days"} scheduled in this month)
          </span>
        </div>
        <span className="text-zinc-500 text-[11px] hidden md:inline">
          Tip: Hover over any row to quickly <strong>Edit</strong>, <strong>Substitute</strong>, or <strong>Delete</strong>
        </span>
      </div>

      {/* FLYER POSTER CANVAS - EXCLUSIVELY DARK PAPER FLYER */}
      <div 
        id="devotion-flyer-printable"
        className="w-full max-w-3xl mx-auto rounded-3xl p-4 sm:p-10 shadow-2xl transition-all border border-zinc-800/80 bg-gradient-to-b from-[#14161f] via-[#0f1118] to-[#14161f] text-white shadow-black/80 ring-1 ring-white/5 relative overflow-hidden"
      >
        {/* Subtle decorative glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-32 bg-amber-500/5 blur-3xl pointer-events-none rounded-full" />

        {/* POSTER HEADER: "Oligarch Media Devotion" in cursive calligraphy */}
        <div className="text-center pt-2 pb-6 space-y-1 relative">
          <h1 
            className="text-3xl sm:text-6xl font-normal tracking-wide select-none font-calligraphy text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-100 to-amber-300 drop-shadow-sm"
            style={{ fontFamily: "'Alex Brush', 'Great Vibes', 'Caveat', cursive" }}
          >
            Oligarch Media Devotion
          </h1>
          <p className="text-[10px] font-mono tracking-widest uppercase font-semibold text-zinc-400 opacity-80">
            {formatMonthLabel(activeMonth).toUpperCase()} • 1-MONTH LEADERSHIP ROSTER • 12:00 AM MIDNIGHT SHIFT
          </p>
        </div>

        {/* TWO PROMINENT COLUMN HEADERS: DEVOTION and PRAYER */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4 mb-3 sm:mb-4 relative">
          <div className="py-2.5 sm:py-3 px-3 sm:px-4 text-center rounded-xl font-black text-xs sm:text-sm tracking-widest uppercase shadow-sm bg-zinc-850/90 border border-zinc-700/60 text-zinc-100 transition-colors">
            DEVOTION
          </div>
          <div className="py-2.5 sm:py-3 px-3 sm:px-4 text-center rounded-xl font-black text-xs sm:text-sm tracking-widest uppercase shadow-sm bg-zinc-850/90 border border-zinc-700/60 text-zinc-100 transition-colors">
            PRAYER
          </div>
        </div>

        {/* ROSTER PAIR ROWS */}
        {displayedSchedules.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <p className="text-xs font-mono text-zinc-400">
              No schedule rows logged for {formatMonthLabel(activeMonth)}.
            </p>
            {isAdmin && onOpenLoopModal && (
              <button
                type="button"
                onClick={onOpenLoopModal}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-bold cursor-pointer inline-flex items-center gap-2 shadow-md"
              >
                <Repeat className="w-4 h-4 text-white" />
                <span>Create Devotion Loop</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 sm:space-y-2.5">
            {displayedSchedules.map((row, idx) => {
              const isToday = row.date === todayStr;
              
              // Devotion leader name & substitute
              const hasDevSub = row.isAbsent && row.substituteDevotionLeaderName;
              const devName = hasDevSub ? row.substituteDevotionLeaderName : row.devotionLeaderName;
              
              // Prayer leader name & substitute
              const hasPraySub = row.isPrayerAbsent && row.substitutePrayerLeaderName;
              const prayName = hasPraySub ? row.substitutePrayerLeaderName : row.prayerLeaderName;

              return (
                <div 
                  key={row.id || `${row.date}-${idx}`}
                  onClick={() => setSelectedRow(row)}
                  className={`relative group rounded-lg transition-all cursor-pointer ${
                    isToday 
                      ? "ring-2 ring-emerald-500 p-1.5 bg-emerald-500/10 shadow-md" 
                      : "p-1 hover:bg-zinc-500/5"
                  }`}
                >
                  {/* Row Header: Date, Active Status, and Inline Action Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 px-1 pb-1">
                    <span className={`text-[9px] font-mono font-bold ${
                      isToday ? "text-emerald-500 font-extrabold" : "text-zinc-400"
                    }`}>
                      ROW {idx + 1} • {row.date} {isToday ? "(TODAY - ACTIVE SHIFT)" : ""}
                    </span>

                    {/* Quick indicator badges & EASY EDIT / DELETE BUTTONS */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isToday && (
                        <span className="text-[8px] font-mono font-black uppercase px-1.5 py-0.2 rounded bg-emerald-500 text-white animate-pulse">
                          Active 12AM
                        </span>
                      )}
                      {(hasDevSub || hasPraySub) && (
                        <span className="text-[8px] font-mono font-bold uppercase px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-500">
                          Substituted
                        </span>
                      )}

                      {/* Prominent Quick Actions */}
                      {isAdmin && (
                        <div className="flex items-center gap-1">
                          {onEditSchedule && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditSchedule(row);
                              }}
                              title="Edit schedule entry"
                              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[10px] font-mono font-bold flex items-center gap-1 border border-zinc-700 cursor-pointer shadow-xs transition-all"
                            >
                              <Edit3 className="w-2.5 h-2.5 text-indigo-400" />
                              <span>Edit</span>
                            </button>
                          )}

                          {onOpenSubstituteModal && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenSubstituteModal(row, "devotion");
                              }}
                              title="Swap or assign substitute"
                              className="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[10px] font-mono font-bold flex items-center gap-1 border border-amber-500/30 cursor-pointer shadow-xs transition-all"
                            >
                              <Repeat className="w-2.5 h-2.5" />
                              <span>Sub</span>
                            </button>
                          )}

                          {onDeleteSchedule && row.id && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteSchedule(row.id!, row.date);
                              }}
                              title="Delete schedule entry"
                              className="px-2 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 text-[10px] font-mono font-bold flex items-center gap-1 border border-rose-500/30 cursor-pointer shadow-xs transition-all"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Two Pills: Devotion & Prayer */}
                  <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
                    {/* Left Box: Devotion Leader */}
                    <div 
                      className={`relative py-2.5 sm:py-3 px-3 text-center rounded-xl font-black text-xs sm:text-sm tracking-wider uppercase transition-all shadow-sm bg-[#1a1d26]/95 hover:bg-[#212531] text-white border border-zinc-800/80 ${hasDevSub ? "border-l-4 border-l-amber-500" : ""}`}
                    >
                      {hasDevSub ? (
                        <div className="flex flex-col items-center justify-center leading-tight">
                          <span className="text-[9px] font-mono text-zinc-500 line-through">
                            {row.devotionLeaderName}
                          </span>
                          <span className="text-amber-400 font-black">
                            {devName} (Sub)
                          </span>
                        </div>
                      ) : (
                        <span>{devName || "—"}</span>
                      )}
                    </div>

                    {/* Right Box: Prayer Leader */}
                    <div 
                      className={`relative py-2.5 sm:py-3 px-3 text-center rounded-xl font-black text-xs sm:text-sm tracking-wider uppercase transition-all shadow-sm bg-[#1a1d26]/95 hover:bg-[#212531] text-white border border-zinc-800/80 ${hasPraySub ? "border-l-4 border-l-amber-500" : ""}`}
                    >
                      {hasPraySub ? (
                        <div className="flex flex-col items-center justify-center leading-tight">
                          <span className="text-[9px] font-mono text-zinc-500 line-through">
                            {row.prayerLeaderName}
                          </span>
                          <span className="text-amber-400 font-black">
                            {prayName} (Sub)
                          </span>
                        </div>
                      ) : (
                        <span>{prayName || "—"}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer info in flyer */}
        <div className="mt-8 pt-4 border-t border-zinc-800/80 text-center text-[10px] font-mono text-zinc-500">
          Oligarch Media Graphic Design Studio • Spiritual Ministry & Daily Fellowship
        </div>
      </div>

      {/* Detail & Quick Action Modal when a row is clicked */}
      {selectedRow && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4 animate-in fade-in duration-200">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400 font-bold">
                  Devotion Entry Details
                </span>
                <h3 className="text-base font-black text-white">
                  Schedule for {selectedRow.date}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Devotion Leader info */}
              <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1">
                <span className="text-[10px] font-mono text-zinc-400 uppercase block font-bold">
                  📖 Devotion Leader:
                </span>
                <div className="text-sm font-black text-white flex items-center justify-between">
                  <span>
                    {selectedRow.isAbsent && selectedRow.substituteDevotionLeaderName
                      ? `${selectedRow.substituteDevotionLeaderName} (Substitute)`
                      : selectedRow.devotionLeaderName}
                  </span>
                  {onOpenSubstituteModal && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenSubstituteModal(selectedRow, "devotion");
                        setSelectedRow(null);
                      }}
                      className="text-[10px] font-mono text-amber-400 hover:underline"
                    >
                      Swap / Substitute
                    </button>
                  )}
                </div>
                {selectedRow.isAbsent && (
                  <p className="text-[10px] text-rose-400 font-mono">
                    Original assigned: {selectedRow.devotionLeaderName} (Absent)
                  </p>
                )}
              </div>

              {/* Prayer Leader info */}
              <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1">
                <span className="text-[10px] font-mono text-zinc-400 uppercase block font-bold">
                  🙏 Opening Prayer Leader:
                </span>
                <div className="text-sm font-black text-white flex items-center justify-between">
                  <span>
                    {selectedRow.isPrayerAbsent && selectedRow.substitutePrayerLeaderName
                      ? `${selectedRow.substitutePrayerLeaderName} (Substitute)`
                      : selectedRow.prayerLeaderName}
                  </span>
                  {onOpenSubstituteModal && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenSubstituteModal(selectedRow, "prayer");
                        setSelectedRow(null);
                      }}
                      className="text-[10px] font-mono text-amber-400 hover:underline"
                    >
                      Swap / Substitute
                    </button>
                  )}
                </div>
                {selectedRow.isPrayerAbsent && (
                  <p className="text-[10px] text-rose-400 font-mono">
                    Original assigned: {selectedRow.prayerLeaderName} (Absent)
                  </p>
                )}
              </div>
            </div>

            {/* Action Buttons: Delete, Edit, Close */}
            <div className="pt-2 flex justify-between items-center border-t border-zinc-800">
              {isAdmin && onDeleteSchedule && selectedRow.id ? (
                <button
                  type="button"
                  onClick={() => {
                    const rowId = selectedRow.id!;
                    const rowDate = selectedRow.date;
                    setSelectedRow(null);
                    onDeleteSchedule(rowId, rowDate);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Schedule</span>
                </button>
              ) : (
                <div />
              )}

              <div className="flex gap-2">
                {isAdmin && onEditSchedule && (
                  <button
                    type="button"
                    onClick={() => {
                      onEditSchedule(selectedRow);
                      setSelectedRow(null);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Edit Details</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedRow(null)}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
