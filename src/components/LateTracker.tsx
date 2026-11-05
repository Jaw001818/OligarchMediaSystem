import React, { useState, useEffect } from "react";
import { Payroll, PayrollPeriod, AppSettings, Employee, Attendance } from "../types";
import { AlertCircle } from "lucide-react";
import { db, collection, query, where, onSnapshot } from "../firebase";
import { calculateLateMinutes, getScheduleTimesForLog } from "../utils";

interface LateTrackerProps {
  employeePayrolls: Payroll[];
  payrollPeriods: PayrollPeriod[];
  settings: AppSettings | null;
  verifiedEmployee: Employee | null;
}

export default function LateTracker({ employeePayrolls, payrollPeriods, settings, verifiedEmployee }: LateTrackerProps) {
  const openPeriod = payrollPeriods.find(p => p.status === "Open" || p.status === "Processing");
  const [liveLates, setLiveLates] = useState<{ totalLates: number, converted: number, remaining: number } | null>(null);

  useEffect(() => {
    if (!openPeriod || !verifiedEmployee) return;

    const q = query(collection(db, "attendance"));
    const qReq = query(collection(db, "leave_requests"));
    let approvedDates = new Set<string>();

    const unsubscribeReq = onSnapshot(qReq, (reqSnap) => {
      const dates = new Set<string>();
      const empId = String(verifiedEmployee.id);
      const empNum = String(verifiedEmployee.employeeNumber);
      const empName = verifiedEmployee.fullName?.trim().toLowerCase();

      reqSnap.forEach(d => {
        const r = d.data();
        if (r.status === "Approved" && r.startDate) {
          const matchId = r.employeeId && String(r.employeeId) === empId;
          const matchNum = r.employeeNumber && String(r.employeeNumber) === empNum;
          const matchName = r.employeeName && String(r.employeeName).trim().toLowerCase() === empName;
          if (matchId || matchNum || matchName) {
            const startD = new Date(r.startDate);
            const endD = new Date(r.endDate || r.startDate);
            for (let cur = new Date(startD); cur <= endD; cur.setDate(cur.getDate() + 1)) {
              dates.add(cur.toISOString().split("T")[0]);
            }
          }
        }
      });
      approvedDates = dates;
    }, (err) => console.error("Error listening to leave requests in LateTracker:", err));

    const unsubscribe = onSnapshot(q, (snap) => {
      const logs: Attendance[] = [];
      snap.forEach(doc => {
        logs.push({ ...doc.data() as Attendance, id: doc.id });
      });

      // Filter by date range
      const empId = String(verifiedEmployee.id);
      const empNum = String(verifiedEmployee.employeeNumber);
      const empName = verifiedEmployee.fullName;
      const periodLogs = logs.filter(
        a => {
          const aId = String(a.employeeId);
          const aNum = String(a.employeeNumber);
          return a.date >= openPeriod.startDate && a.date <= openPeriod.endDate &&
          (aId === empId || aNum === empNum || aId === empNum || a.employeeName === empName || aId === empName);
        }
      );

      const totalLates = periodLogs.filter(a => {
        const isLeave = a.status === "Paid Leave" || a.status === "Birthday Leave" || (typeof a.status === "string" && a.status.toLowerCase().includes("leave"));
        if (a.isLateExcused || a.status === "Absent" || isLeave || approvedDates.has(a.date)) return false;
        if ((a.lateMinutes && a.lateMinutes > 0) || a.status === "Late") return true;
        if (a.timeIn) {
          const schedTimes = getScheduleTimesForLog(a, verifiedEmployee, settings);
          return calculateLateMinutes(a.timeIn, schedTimes.shiftStart, schedTimes.shiftEnd, settings?.gracePeriodMinutes || 0, false, a.status) > 0;
        }
        return false;
      }).length;
      const lateThreshold = settings?.lateToAbsentCount || 3;
      const enableAutoConvert = settings?.enableAutoConvertLate ?? true;
      
      const converted = enableAutoConvert ? Math.floor(totalLates / lateThreshold) : 0;
      const remaining = enableAutoConvert ? totalLates % lateThreshold : totalLates;

      setLiveLates({ totalLates, converted, remaining });
    }, (error) => {
      console.error("Error listening to attendance for late tracker:", error);
    });

    return () => {
      unsubscribe();
      unsubscribeReq();
    };
  }, [openPeriod, verifiedEmployee, settings]);

  if (!openPeriod) return null;

  const lateThreshold = settings?.lateToAbsentCount || 3;
  const enableAutoConvert = settings?.enableAutoConvertLate ?? true;

  // Fallback to draftPayroll if live fetching hasn't completed yet
  let draftPayroll = null;
  if (!liveLates) {
    draftPayroll = employeePayrolls.find(p => p.cutoffPeriodId === openPeriod.periodId);
  }

  const convertedAbsences = liveLates ? liveLates.converted : (draftPayroll?.convertedAbsences || 0);
  const remainingLates = liveLates ? liveLates.remaining : (draftPayroll?.remainingLates || 0);
  const totalLatesCount = liveLates ? liveLates.totalLates : (convertedAbsences * lateThreshold + remainingLates);
  
  const remainingBeforeAbsent = lateThreshold - remainingLates;

  // Progress dots
  const maxDots = lateThreshold;
  const dots = [];
  for (let i = 0; i < maxDots; i++) {
    dots.push(i < remainingLates);
  }

  return (
    <div className="p-5 border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 rounded-2xl space-y-4">
      <div className="flex items-center gap-2 border-b border-amber-200/50 dark:border-amber-900/50 pb-2">
        <AlertCircle className="w-4 h-4 text-amber-500" />
        <h4 className="text-xs font-bold font-mono text-amber-600 dark:text-amber-500 uppercase tracking-widest">
          Late Tracker
        </h4>
      </div>
      
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase">Current Payroll Cutoff</p>
          <p className="text-sm font-bold text-zinc-900 dark:text-white mt-0.5">
            {openPeriod.startDate} to {openPeriod.endDate}
          </p>
        </div>

        <div className="flex items-center gap-6 text-center">
          <div>
            <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase">Total Lates</p>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-500 leading-none mt-1">{totalLatesCount}</p>
          </div>
          
          {enableAutoConvert && (
            <>
              <div>
                <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase">Converted Absent</p>
                <p className="text-2xl font-black text-red-600 dark:text-red-500 leading-none mt-1">{convertedAbsences}</p>
              </div>
              
              <div className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 text-left min-w-[140px]">
                <p className="text-[9px] font-mono text-zinc-500 uppercase mb-2">Progress</p>
                <div className="flex items-center gap-1.5 mb-2">
                  {dots.map((isFilled, idx) => (
                    <span 
                      key={idx} 
                      className={`w-3 h-3 rounded-full ${isFilled ? 'bg-amber-500' : 'bg-zinc-200 dark:bg-zinc-700'}`} 
                    />
                  ))}
                </div>
                <p className="text-[10px] font-bold text-zinc-700 dark:text-zinc-300">
                  {remainingLates} / {lateThreshold} Late
                </p>
                <p className="text-[9px] text-zinc-500 mt-0.5">
                  {remainingBeforeAbsent} More Late = 1 Auto Absent
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
