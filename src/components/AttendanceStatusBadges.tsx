import React from "react";
import { Attendance } from "../types";
import { calculateLateMinutes } from "../utils";

export default function AttendanceStatusBadges({ record, globalWorkHourStart = "21:00", globalWorkHourEnd = "06:00" }: { record: Attendance | null, globalWorkHourStart?: string, globalWorkHourEnd?: string }) {
  if (!record) {
    return (
      <span className="px-2 py-0.5 text-[9px] font-mono rounded-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-400 uppercase">
        Unlogged
      </span>
    );
  }

  const badges = [];

  // Pending Sync Status
  if ((record as any).syncStatus === "PENDING_SYNC") {
    badges.push({ label: "PENDING SYNC", color: "bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse" });
  }

  // 1. Completion Status
  if (record.status === "Present") {
    badges.push({ label: "Present", color: "bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400 border border-green-200/50 dark:border-green-800/50" });
  } else if (record.status === "On Break") {
    badges.push({ label: "On Break", color: "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-800/50" });
  } else if (record.status === "Timed Out") {
    badges.push({ label: "Timed Out", color: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700" });
  } else if (record.status === "Absent") {
    badges.push({ label: "Absent", color: "bg-red-50 dark:bg-red-950/25 text-red-650 dark:text-red-400 border border-red-200/50 dark:border-red-800/50" });
  } else if (record.status === "Paid Leave") {
    badges.push({ label: "Paid Leave", color: "bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 border border-purple-200/50 dark:border-purple-800/50" });
  } else if (record.status === "Birthday Leave") {
    badges.push({ label: "Birthday Leave", color: "bg-pink-50 dark:bg-pink-950/20 text-pink-600 dark:text-pink-400 border border-pink-200/50 dark:border-pink-800/50" });
  } else if (record.status === "Late") {
    // If somehow DB has Late as main status and it's not Timed Out yet
    badges.push({ label: "Present", color: "bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400 border border-green-200/50 dark:border-green-800/50" });
  } else if ((record.status as string) && (record.status as string).toLowerCase().includes("leave")) {
    badges.push({ label: record.status, color: "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-800/50" });
  }

  // 2. Violation Status - Leaves and Absences are never marked as late
  const isLeaveOrOff = record.status === "Absent" || 
                       record.status === "Paid Leave" || 
                       record.status === "Birthday Leave" || 
                       (typeof record.status === "string" && record.status.toLowerCase().includes("leave"));

  if (!isLeaveOrOff) {
    const shiftStart = record.shiftStart || globalWorkHourStart;
    const shiftEnd = record.shiftEnd || globalWorkHourEnd;
    const computedLateMinutes = record.timeIn ? calculateLateMinutes(record.timeIn, shiftStart, shiftEnd, 0, record.isLateExcused, record.status) : 0;
    
    if (record.isLateExcused) {
      badges.push({ label: "Consideration", color: "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-800/50" });
    } else if ((record.lateMinutes && record.lateMinutes > 0) || computedLateMinutes > 0) {
      badges.push({ label: "Late", color: "bg-orange-50 dark:bg-orange-950/20 text-orange-600 dark:text-orange-400 border border-orange-200/50 dark:border-orange-800/50" });
    }
  }

  return (
    <div className="flex flex-wrap gap-1 justify-center items-center">
      {badges.map((b, i) => (
        <span key={i} className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-wide ${b.color}`}>
          {b.label}
        </span>
      ))}
    </div>
  );
}
