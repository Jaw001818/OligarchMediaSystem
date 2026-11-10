import React, { useState, useMemo } from "react";
import { Employee, Attendance, PayrollPeriod, LeaveRequest, NoWorkDay } from "../types";
import { formatTo12Hour, getBusinessDate, calculateLateMinutes } from "../utils";
import { 
  FileDown, 
  Calendar, 
  Users, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Search, 
  ChevronDown, 
  ChevronUp, 
  Sparkles,
  Printer,
  FileSpreadsheet,
  Award
} from "lucide-react";
import { jsPDF } from "jspdf";

interface BossCutoffAttendanceSummaryProps {
  employees: Employee[];
  attendance: Attendance[];
  periods?: PayrollPeriod[];
  requests?: LeaveRequest[];
  noWorkDays?: NoWorkDay[];
  workHourStart?: string;
  workHourEnd?: string;
  dstOffset?: number;
  gracePeriodMinutes?: number;
  initialPeriodId?: string;
  onRefresh?: () => void;
}

export interface DayBreakdown {
  date: string;
  dayOfWeek: string;
  isWeekend: boolean;
  timeIn: string | null;
  timeOut: string | null;
  hoursWorked: number;
  otHours: number;
  status: string;
  isLate: boolean;
  lateMinutes: number;
  notes?: string;
}

export interface EmployeeCutoffSummary {
  employee: Employee;
  presentDays: number;
  absentDays: number;
  paidLeaveDays: number;
  birthdayLeaveDays: number;
  totalOTHours: number;
  totalRegularHours: number;
  lateDaysCount: number;
  attendanceRate: number;
  days: DayBreakdown[];
}

export default function BossCutoffAttendanceSummary({
  employees,
  attendance,
  periods = [],
  requests = [],
  noWorkDays = [],
  workHourStart = "21:00",
  workHourEnd = "06:00",
  dstOffset = 0,
  gracePeriodMinutes = 0,
  initialPeriodId,
  onRefresh
}: BossCutoffAttendanceSummaryProps) {
  // 1. Cutoff Period Selection
  const defaultPeriod = useMemo(() => {
    if (initialPeriodId) {
      const found = periods.find(p => p.periodId === initialPeriodId);
      if (found) return found;
    }
    const active = periods.find(p => p.status === "Open" || p.status === "Processing");
    if (active) return active;
    if (periods.length > 0) return periods[0];
    return null;
  }, [periods, initialPeriodId]);

  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(() => {
    return defaultPeriod ? defaultPeriod.periodId : "custom";
  });

  // Date range states
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    if (defaultPeriod) return defaultPeriod.startDate;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}-01`;
  });

  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    if (defaultPeriod) return defaultPeriod.endDate;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}-15`;
  });

  // When period dropdown changes, update dates
  const handlePeriodChange = (periodId: string) => {
    setSelectedPeriodId(periodId);
    if (periodId !== "custom") {
      const found = periods.find(p => p.periodId === periodId);
      if (found) {
        setCustomStartDate(found.startDate);
        setCustomEndDate(found.endDate);
      }
    }
  };

  // Quick preset buttons
  const applyPreset = (preset: "first" | "second" | "full") => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();

    if (preset === "first") {
      setSelectedPeriodId("custom");
      setCustomStartDate(`${y}-${m}-01`);
      setCustomEndDate(`${y}-${m}-15`);
    } else if (preset === "second") {
      setSelectedPeriodId("custom");
      setCustomStartDate(`${y}-${m}-16`);
      setCustomEndDate(`${y}-${m}-${lastDay}`);
    } else if (preset === "full") {
      setSelectedPeriodId("custom");
      setCustomStartDate(`${y}-${m}-01`);
      setCustomEndDate(`${y}-${m}-${lastDay}`);
    }
  };

  // Search & Filtering
  const [searchTerm, setSearchTerm] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [expandedEmployees, setExpandedEmployees] = useState<Record<string, boolean>>({});
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  // Active Cutoff Info
  const activeCutoffName = useMemo(() => {
    if (selectedPeriodId !== "custom") {
      const found = periods.find(p => p.periodId === selectedPeriodId);
      if (found) return found.name;
    }
    return `Custom Cutoff (${customStartDate} to ${customEndDate})`;
  }, [selectedPeriodId, periods, customStartDate, customEndDate]);

  // Compute all dates in range
  const datesInRange = useMemo(() => {
    if (!customStartDate || !customEndDate) return [];
    const start = new Date(customStartDate);
    const end = new Date(customEndDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

    const list: { dateStr: string; dayOfWeek: string; isWeekend: boolean }[] = [];
    const current = new Date(start);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    while (current <= end) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, "0");
      const d = String(current.getDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${d}`;
      const dayIndex = current.getDay();
      list.push({
        dateStr,
        dayOfWeek: days[dayIndex],
        isWeekend: dayIndex === 0 || dayIndex === 6
      });
      current.setDate(current.getDate() + 1);
    }
    return list;
  }, [customStartDate, customEndDate]);

  const noWorkMap = useMemo(() => {
    return new Map<string, NoWorkDay>((noWorkDays || []).map(nw => [nw.date, nw]));
  }, [noWorkDays]);

  const totalWorkingDaysInCutoff = useMemo(() => {
    return datesInRange.filter(d => !d.isWeekend && !noWorkMap.has(d.dateStr)).length;
  }, [datesInRange, noWorkMap]);

  // Compile Cutoff Summaries for all cutoff-eligible employees (Active + Inactive/Resigned who worked or have records in this cutoff)
  const employeeSummaries = useMemo<EmployeeCutoffSummary[]>(() => {
    const cutoffStaff = employees.filter(emp => {
      if (emp.status === "Active") return true;
      const empId = String(emp.id || "");
      const empNum = String(emp.employeeNumber || "");
      const empName = emp.fullName?.toLowerCase().trim();

      // Attendance in range
      const hasAttendance = attendance.some(a => {
        if (a.date < customStartDate || a.date > customEndDate) return false;
        const aId = String(a.employeeId || "");
        const aNum = String(a.employeeNumber || "");
        const aName = a.employeeName?.toLowerCase().trim();
        return aId === empId || aNum === empNum || aId === empNum || (empName && aName === empName);
      });
      if (hasAttendance) return true;

      // Approved leaves in range
      const hasLeave = (requests || []).some(r => {
        if (r.status !== "Approved") return false;
        if (r.startDate > customEndDate || r.endDate < customStartDate) return false;
        const rEmpId = String(r.employeeId || "");
        const rEmpNum = String(r.employeeNumber || "");
        return rEmpId === empId || rEmpNum === empNum;
      });
      if (hasLeave) return true;

      return false;
    });
    const todayStr = getBusinessDate();

    return cutoffStaff.map(emp => {
      const empId = String(emp.id || "");
      const empNum = String(emp.employeeNumber || "");

      // Leave requests in range for this employee
      const empLeaves = requests.filter(r => 
        r.status === "Approved" && 
        (r.employeeId === empId || r.employeeNumber === empNum) &&
        r.startDate <= customEndDate && 
        r.endDate >= customStartDate
      );

      const paidLeaveDateSet = new Set<string>();
      const bdayLeaveDateSet = new Set<string>();

      empLeaves.forEach(req => {
        let curr = new Date(req.startDate);
        const end = new Date(req.endDate);
        while (curr <= end) {
          const day = curr.getDay();
          if (day !== 0 && day !== 6) {
            const y = curr.getFullYear();
            const m = String(curr.getMonth() + 1).padStart(2, "0");
            const d = String(curr.getDate()).padStart(2, "0");
            const dStr = `${y}-${m}-${d}`;
            if (dStr >= customStartDate && dStr <= customEndDate) {
              if (req.type === "Paid Leave") paidLeaveDateSet.add(dStr);
              else if (req.type === "Birthday Leave") bdayLeaveDateSet.add(dStr);
              else paidLeaveDateSet.add(dStr);
            }
          }
          curr.setDate(curr.getDate() + 1);
        }
      });

      // Fetch attendance in range for this employee
      const empLogs = attendance.filter(a => {
        const aId = String(a.employeeId || "");
        const aNum = String(a.employeeNumber || "");
        const isMatch = aId === empId || aNum === empNum || aId === empNum || 
          (emp.fullName && a.employeeName?.toLowerCase() === emp.fullName.toLowerCase());
        return isMatch && a.date >= customStartDate && a.date <= customEndDate;
      });

      const logMap = new Map<string, Attendance>();
      empLogs.forEach(log => {
        if (!logMap.has(log.date)) {
          logMap.set(log.date, log);
        } else {
          // Merge duplicates if any - if one is leave, leave wins
          const prev = logMap.get(log.date)!;
          const isPrevLeave = prev.status === "Paid Leave" || prev.status === "Birthday Leave" || prev.status?.toLowerCase().includes("leave");
          const isLogLeave = log.status === "Paid Leave" || log.status === "Birthday Leave" || log.status?.toLowerCase().includes("leave");
          
          if (isPrevLeave || isLogLeave) {
            const leaveStatus = isPrevLeave ? prev.status : log.status;
            logMap.set(log.date, {
              ...prev,
              status: leaveStatus,
              hoursWorked: 8,
              otHours: 0,
              timeIn: null,
              timeOut: null,
              lateMinutes: 0,
              isLateExcused: true
            });
          } else {
            logMap.set(log.date, {
              ...prev,
              hoursWorked: (prev.hoursWorked || 0) + (log.hoursWorked || 0),
              otHours: (prev.otHours || 0) + (log.otHours || 0),
              timeIn: prev.timeIn || log.timeIn,
              timeOut: log.timeOut || prev.timeOut
            });
          }
        }
      });

      let presentCount = 0;
      let absentCount = 0;
      let totalOT = 0;
      let totalRegHours = 0;
      let lateCount = 0;
      let paidLeaveCount = 0;
      let bdayLeaveCount = 0;

      const daysBreakdown: DayBreakdown[] = datesInRange.map(dateObj => {
        const dStr = dateObj.dateStr;
        const noWorkEntry = noWorkMap.get(dStr);
        const log = logMap.get(dStr);
        const isPaidLeave = paidLeaveDateSet.has(dStr) || log?.status === "Paid Leave";
        const isBdayLeave = bdayLeaveDateSet.has(dStr) || log?.status === "Birthday Leave";

        // 1. Paid Leave: employee gets paid even if it is a No Work day!
        if (isPaidLeave || log?.status === "Paid Leave") {
          presentCount++;
          paidLeaveCount++;
          totalRegHours += 8;
          return {
            date: dStr,
            dayOfWeek: dateObj.dayOfWeek,
            isWeekend: dateObj.isWeekend,
            timeIn: null,
            timeOut: null,
            hoursWorked: 8,
            otHours: 0,
            status: "Paid Leave",
            isLate: false,
            lateMinutes: 0,
            notes: noWorkEntry ? `Approved Leave on No Work Day (${noWorkEntry.label})` : "Approved Paid Leave Credit"
          };
        }

        if (isBdayLeave || log?.status === "Birthday Leave") {
          presentCount++;
          bdayLeaveCount++;
          totalRegHours += 8;
          return {
            date: dStr,
            dayOfWeek: dateObj.dayOfWeek,
            isWeekend: dateObj.isWeekend,
            timeIn: null,
            timeOut: null,
            hoursWorked: 8,
            otHours: 0,
            status: "Birthday Leave",
            isLate: false,
            lateMinutes: 0,
            notes: noWorkEntry ? `Approved Leave on No Work Day (${noWorkEntry.label})` : "Approved Birthday Leave Credit"
          };
        }

        if (log) {
          if (log.status === "Absent") {
            if (noWorkEntry) {
              // Company No Work Day: Strictly NOT an absence!
              return {
                date: dStr,
                dayOfWeek: dateObj.dayOfWeek,
                isWeekend: dateObj.isWeekend,
                timeIn: null,
                timeOut: null,
                hoursWorked: 0,
                otHours: 0,
                status: "No Work",
                isLate: false,
                lateMinutes: 0,
                notes: `No Work Day: ${noWorkEntry.label} (Not Absent / No Pay)`
              };
            }
            absentCount++;
            return {
              date: dStr,
              dayOfWeek: dateObj.dayOfWeek,
              isWeekend: dateObj.isWeekend,
              timeIn: null,
              timeOut: null,
              hoursWorked: 0,
              otHours: 0,
              status: "Absent",
              isLate: false,
              lateMinutes: 0,
              notes: "Marked Absent"
            };
          }

          const isLogLeave = (log.status as string) === "Paid Leave" || (log.status as string) === "Birthday Leave" || ((log.status as string) && (log.status as string).toLowerCase().includes("leave"));
          if (isLogLeave) {
            presentCount++;
            if ((log.status as string) === "Paid Leave") paidLeaveCount++;
            if ((log.status as string) === "Birthday Leave") bdayLeaveCount++;
            totalRegHours += (log.hoursWorked || 8);
            return {
              date: dStr,
              dayOfWeek: dateObj.dayOfWeek,
              isWeekend: dateObj.isWeekend,
              timeIn: null,
              timeOut: null,
              hoursWorked: log.hoursWorked || 8,
              otHours: 0,
              status: log.status,
              isLate: false,
              lateMinutes: 0,
              notes: (log as any).notes || `Approved ${log.status}`
            };
          }

          // Has timeIn or logged hours
          const hw = log.hoursWorked || 0;
          const ot = log.otHours || 0;
          const isLeaveRecord = isLogLeave;
          const computedLate = (!isLeaveRecord && log.timeIn) 
            ? calculateLateMinutes(log.timeIn, log.shiftStart || workHourStart, log.shiftEnd || workHourEnd, gracePeriodMinutes, log.isLateExcused, log.status)
            : 0;
          const effectiveLateMinutes = (!isLeaveRecord && log.lateMinutes && log.lateMinutes > 0) ? log.lateMinutes : computedLate;
          const isL = !isLeaveRecord && !log.isLateExcused && (effectiveLateMinutes > 0 || log.status === "Late");
          if (isL) lateCount++;

          presentCount++;
          totalRegHours += hw;
          totalOT += ot;

          return {
            date: dStr,
            dayOfWeek: dateObj.dayOfWeek,
            isWeekend: dateObj.isWeekend,
            timeIn: log.timeIn ? formatTo12Hour(log.timeIn) : "—",
            timeOut: log.timeOut ? formatTo12Hour(log.timeOut) : (log.timeIn ? "In Progress" : "—"),
            hoursWorked: hw,
            otHours: ot,
            status: isL ? "Late" : (log.status || "Present"),
            isLate: isL,
            lateMinutes: effectiveLateMinutes,
            notes: log.isLateExcused ? "Late Excused" : (noWorkEntry ? `Worked on No Work Day (${noWorkEntry.label})` : undefined)
          };
        }

        // No log found
        if (!dateObj.isWeekend) {
          if (noWorkEntry) {
            // Declared Company No Work Day: Not an absence! No pay unless leave was used.
            return {
              date: dStr,
              dayOfWeek: dateObj.dayOfWeek,
              isWeekend: false,
              timeIn: null,
              timeOut: null,
              hoursWorked: 0,
              otHours: 0,
              status: "No Work",
              isLate: false,
              lateMinutes: 0,
              notes: `Company No Work Day: ${noWorkEntry.label} (Not Absent / No Pay)`
            };
          }

          // If weekday is in past or today, count as Absent
          if (dStr <= todayStr) {
            absentCount++;
            return {
              date: dStr,
              dayOfWeek: dateObj.dayOfWeek,
              isWeekend: false,
              timeIn: null,
              timeOut: null,
              hoursWorked: 0,
              otHours: 0,
              status: "Absent",
              isLate: false,
              lateMinutes: 0,
              notes: "No attendance logged"
            };
          } else {
            // Future weekday in cutoff
            return {
              date: dStr,
              dayOfWeek: dateObj.dayOfWeek,
              isWeekend: false,
              timeIn: null,
              timeOut: null,
              hoursWorked: 0,
              otHours: 0,
              status: "Scheduled",
              isLate: false,
              lateMinutes: 0,
              notes: "Upcoming shift"
            };
          }
        }

        // Weekend without log
        return {
          date: dStr,
          dayOfWeek: dateObj.dayOfWeek,
          isWeekend: true,
          timeIn: null,
          timeOut: null,
          hoursWorked: 0,
          otHours: 0,
          status: "Rest Day",
          isLate: false,
          lateMinutes: 0,
          notes: "Scheduled Weekend"
        };
      });

      const totalExpected = presentCount + absentCount;
      const rate = totalExpected > 0 ? Math.round((presentCount / totalExpected) * 100) : 100;

      return {
        employee: emp,
        presentDays: presentCount,
        absentDays: absentCount,
        paidLeaveDays: paidLeaveDateSet.size,
        birthdayLeaveDays: bdayLeaveDateSet.size,
        totalOTHours: parseFloat(((totalOT || 0)).toFixed(2)),
        totalRegularHours: parseFloat(((totalRegHours || 0)).toFixed(2)),
        lateDaysCount: lateCount,
        attendanceRate: rate,
        days: daysBreakdown
      };
    });
  }, [employees, attendance, requests, datesInRange, customStartDate, customEndDate]);

  // Overall Cutoff Aggregates
  const overallMetrics = useMemo(() => {
    let totalPresent = 0;
    let totalAbsent = 0;
    let totalOT = 0;
    let totalHours = 0;

    employeeSummaries.forEach(s => {
      totalPresent += (s.presentDays || 0);
      totalAbsent += (s.absentDays || 0);
      totalOT += (s.totalOTHours || 0);
      totalHours += (s.totalRegularHours || 0);
    });

    return {
      totalEmployees: employeeSummaries.length,
      totalPresentDays: totalPresent,
      totalAbsentDays: totalAbsent,
      totalOTHours: parseFloat(((totalOT || 0)).toFixed(2)),
      totalHoursWorked: parseFloat(((totalHours || 0)).toFixed(2)),
      workingDays: totalWorkingDaysInCutoff
    };
  }, [employeeSummaries, totalWorkingDaysInCutoff]);

  // Filtered list based on search and department
  const filteredSummaries = useMemo(() => {
    return employeeSummaries.filter(item => {
      if (!item?.employee) return false;
      const q = (searchTerm || "").toLowerCase().trim();
      const matchesSearch = 
        (item.employee.fullName || "").toLowerCase().includes(q) ||
        (item.employee.employeeNumber || "").toLowerCase().includes(q) ||
        (item.employee.position || "").toLowerCase().includes(q);
      const matchesDept = departmentFilter === "All" || item.employee.department === departmentFilter;
      return matchesSearch && matchesDept;
    });
  }, [employeeSummaries, searchTerm, departmentFilter]);

  const uniqueDepartments = useMemo(() => {
    return Array.from(new Set(employees.map(e => e.department).filter(Boolean)));
  }, [employees]);

  // Accordion Expand/Collapse
  const toggleExpand = (empId: string) => {
    setExpandedEmployees(prev => ({
      ...prev,
      [empId]: !prev[empId]
    }));
  };

  const expandAll = () => {
    const newState: Record<string, boolean> = {};
    employeeSummaries.forEach(s => {
      if (s.employee.id) newState[s.employee.id] = true;
    });
    setExpandedEmployees(newState);
  };

  const collapseAll = () => {
    setExpandedEmployees({});
  };

  // --- PDF GENERATOR: ALL EMPLOYEES COMBINED INTO 1 SINGLE PDF ---
  const handleDownloadAllInOnePDF = () => {
    if (employeeSummaries.length === 0) {
      alert("No employee data available to generate PDF.");
      return;
    }

    setIsGeneratingPDF(true);

    try {
      // Standard A4 portrait: 210mm x 297mm
      const doc = new jsPDF("portrait", "mm", "a4");
      const margin = 14;
      const pageWidth = 210;
      const contentWidth = pageWidth - margin * 2;
      let y = 14;

      const drawHeaderBanner = (pageTitle: string = "CUTOFF ATTENDANCE, ABSENTEEISM & OVERTIME REPORT") => {
        // Dark executive header banner
        doc.setFillColor(15, 23, 42); // slate-900
        doc.rect(0, 0, pageWidth, 32, "F");

        // Gold decorative accent
        doc.setFillColor(234, 179, 8); // amber-500
        doc.rect(0, 32, pageWidth, 1.8, "F");

        // Studio Branding
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text("OLIGARCH MEDIA GRAPHIC DESIGN STUDIO", margin, 12);

        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(253, 224, 71); // bright yellow/gold
        doc.text(pageTitle, margin, 18);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(226, 232, 240);
        doc.text(`CUTOFF PERIOD: ${(activeCutoffName || "").toUpperCase()}  |  DATES: ${customStartDate} TO ${customEndDate}`, margin, 24);
        doc.text(`GENERATED: ${new Date().toLocaleString()}  |  SYSTEM ADMIN CLEARANCE`, margin, 29);
      };

      // --- PAGE 1: COVER & EXECUTIVE MASTER SUMMARY ---
      drawHeaderBanner("EXECUTIVE ATTENDANCE & OVERTIME CUTOFF SUMMARY");
      y = 42;

      // Executive Summary Highlights Box
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.rect(margin, y, contentWidth, 24, "FD");

      const colW = contentWidth / 4;

      // KPI 1: Active Staff
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text("TOTAL PERSONNEL", margin + 6, y + 6);
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text(`${overallMetrics.totalEmployees} Artists`, margin + 6, y + 14);
      doc.setFontSize(6.5);
      doc.setTextColor(59, 130, 246);
      doc.text(`${overallMetrics.workingDays} working days in cutoff`, margin + 6, y + 20);

      // KPI 2: Total Present
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text("TOTAL PRESENT SHIFTS", margin + colW + 4, y + 6);
      doc.setFontSize(12);
      doc.setTextColor(22, 163, 74);
      doc.text(`${overallMetrics.totalPresentDays} Days`, margin + colW + 4, y + 14);
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`Across all studio roster`, margin + colW + 4, y + 20);

      // KPI 3: Total Absences
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text("TOTAL ABSENT SHIFTS", margin + colW * 2 + 4, y + 6);
      doc.setFontSize(12);
      doc.setTextColor(220, 38, 38);
      doc.text(`${overallMetrics.totalAbsentDays} Days`, margin + colW * 2 + 4, y + 14);
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`Unlogged or unexcused`, margin + colW * 2 + 4, y + 20);

      // KPI 4: Overtime Hours
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text("TOTAL OVERTIME (OT)", margin + colW * 3 + 4, y + 6);
      doc.setFontSize(12);
      doc.setTextColor(147, 51, 234);
      doc.text(`${(overallMetrics?.totalOTHours ?? 0).toFixed(2)} hrs`, margin + colW * 3 + 4, y + 14);
      doc.setFontSize(6.5);
      doc.setTextColor(22, 163, 74);
      doc.text(`Total ${(overallMetrics?.totalHoursWorked ?? 0).toFixed(1)} regular hrs`, margin + colW * 3 + 4, y + 20);

      y += 30;

      // Section Header: Master Table
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, y, contentWidth, 7, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text("EMPLOYEE CUTOFF SUMMARY (PRESENT / ABSENT / OT TOTALS)", margin + 4, y + 4.8);

      y += 7;

      // Table Column Headers
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y, contentWidth, 6.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);

      doc.text("EMPLOYEE NAME", margin + 3, y + 4.5);
      doc.text("ID", margin + 58, y + 4.5);
      doc.text("DEPARTMENT", margin + 74, y + 4.5);
      doc.text("PRESENT", margin + 118, y + 4.5, { align: "right" });
      doc.text("ABSENT", margin + 138, y + 4.5, { align: "right" });
      doc.text("OVERTIME", margin + 160, y + 4.5, { align: "right" });
      doc.text("REG. HOURS", margin + 180, y + 4.5, { align: "right" });

      y += 6.5;

      // Master Summary Rows
      employeeSummaries.forEach((s) => {
        doc.setDrawColor(241, 245, 249);
        doc.line(margin, y + 7, margin + contentWidth, y + 7);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(15, 23, 42);
        doc.text(s.employee.fullName, margin + 3, y + 4.5);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(s.employee.employeeNumber, margin + 58, y + 4.5);
        doc.text(s.employee.department || "Design", margin + 74, y + 4.5);

        // Present (Green)
        doc.setFont("helvetica", "bold");
        doc.setTextColor(22, 163, 74);
        doc.text(`${s.presentDays} d`, margin + 118, y + 4.5, { align: "right" });

        // Absent (Red/Slate)
        if (s.absentDays > 0) {
          doc.setTextColor(220, 38, 38);
        } else {
          doc.setTextColor(148, 163, 184);
        }
        doc.text(`${s.absentDays} d`, margin + 138, y + 4.5, { align: "right" });

        // OT (Purple/Amber)
        if ((s?.totalOTHours ?? 0) > 0) {
          doc.setTextColor(147, 51, 234);
          doc.text(`${(s?.totalOTHours ?? 0).toFixed(1)} h`, margin + 160, y + 4.5, { align: "right" });
        } else {
          doc.setTextColor(148, 163, 184);
          doc.text("0.0 h", margin + 160, y + 4.5, { align: "right" });
        }

        // Regular Hours
        doc.setTextColor(15, 23, 42);
        doc.text(`${(s?.totalRegularHours ?? 0).toFixed(1)} h`, margin + 180, y + 4.5, { align: "right" });

        y += 7.5;
      });

      y += 10;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text("* Detailed daily timesheets with start and out times for each employee are itemized below in this report.", margin, y);

      // --- SECTION 2: DETAILED DAILY TIMELINES FOR EVERY EMPLOYEE ---
      employeeSummaries.forEach((s) => {
        // Add new page for each employee or check remaining height
        doc.addPage();
        y = 14;
        const safeEmpName = s.employee?.fullName || "EMPLOYEE";
        drawHeaderBanner(`INDIVIDUAL CUTOFF TIMESHEET: ${safeEmpName.toUpperCase()}`);
        y = 40;

        // Employee Header Card
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.rect(margin, y, contentWidth, 22, "FD");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.text(`${s.employee.fullName} (#${s.employee.employeeNumber})`, margin + 4, y + 7);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(`Position: ${s.employee.position || "Graphic Designer"}  |  Dept: ${s.employee.department || "Graphic Design"}`, margin + 4, y + 14);

        // Stats Badges on right side
        const badgeX = margin + 98;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);

        // Present Badge
        doc.setTextColor(22, 163, 74);
        doc.text(`PRESENT: ${s.presentDays} DAYS`, badgeX, y + 8);

        // Absent Badge
        doc.setTextColor(s.absentDays > 0 ? 220 : 100, s.absentDays > 0 ? 38 : 116, s.absentDays > 0 ? 38 : 139);
        doc.text(`ABSENT: ${s.absentDays} DAYS`, badgeX + 44, y + 8);

        // Overtime Badge
        doc.setTextColor(147, 51, 234);
        doc.text(`OVERTIME: +${(s?.totalOTHours ?? 0).toFixed(2)} HRS`, badgeX, y + 16);

        // Regular Hours
        doc.setTextColor(15, 23, 42);
        doc.text(`REG. WORKED: ${(s?.totalRegularHours ?? 0).toFixed(2)} HRS`, badgeX + 44, y + 16);

        y += 27;

        // Daily Breakdown Table Header
        doc.setFillColor(15, 23, 42);
        doc.rect(margin, y, contentWidth, 6.5, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(255, 255, 255);

        doc.text("DATE", margin + 4, y + 4.5);
        doc.text("DAY", margin + 28, y + 4.5);
        doc.text("WORK START (IN)", margin + 48, y + 4.5);
        doc.text("WORK OUT (OUT)", margin + 82, y + 4.5);
        doc.text("REG. HOURS", margin + 118, y + 4.5, { align: "right" });
        doc.text("OVERTIME (OT)", margin + 148, y + 4.5, { align: "right" });
        doc.text("STATUS", margin + 180, y + 4.5, { align: "right" });

        y += 6.5;

        // Daily Rows
        s.days.forEach((d) => {
          // If approaching page bottom, add page
          if (y > 275) {
            doc.addPage();
            y = 14;
            drawHeaderBanner(`INDIVIDUAL CUTOFF TIMESHEET: ${safeEmpName.toUpperCase()} (CONT.)`);
            y = 40;

            // Re-draw table header
            doc.setFillColor(15, 23, 42);
            doc.rect(margin, y, contentWidth, 6.5, "F");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(7);
            doc.setTextColor(255, 255, 255);
            doc.text("DATE", margin + 4, y + 4.5);
            doc.text("DAY", margin + 28, y + 4.5);
            doc.text("WORK START (IN)", margin + 48, y + 4.5);
            doc.text("WORK OUT (OUT)", margin + 82, y + 4.5);
            doc.text("REG. HOURS", margin + 118, y + 4.5, { align: "right" });
            doc.text("OVERTIME (OT)", margin + 148, y + 4.5, { align: "right" });
            doc.text("STATUS", margin + 180, y + 4.5, { align: "right" });
            y += 6.5;
          }

          // Row background for weekends, no work, or absences
          if (d.isWeekend) {
            doc.setFillColor(248, 250, 252);
            doc.rect(margin, y, contentWidth, 6.5, "F");
          } else if (d.status === "No Work") {
            doc.setFillColor(254, 249, 195);
            doc.rect(margin, y, contentWidth, 6.5, "F");
          } else if (d.status === "Absent") {
            doc.setFillColor(254, 242, 242);
            doc.rect(margin, y, contentWidth, 6.5, "F");
          }

          doc.setDrawColor(241, 245, 249);
          doc.line(margin, y + 6.5, margin + contentWidth, y + 6.5);

          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(15, 23, 42);

          // Date & Day
          doc.text(d.date, margin + 4, y + 4.5);
          doc.setTextColor(100, 116, 139);
          doc.text(d.dayOfWeek, margin + 28, y + 4.5);

          // Work Start (Time In)
          if (d.timeIn && d.timeIn !== "—") {
            doc.setFont("helvetica", "bold");
            doc.setTextColor(15, 23, 42);
            doc.text(d.timeIn, margin + 48, y + 4.5);
          } else if (d.status === "No Work") {
            doc.setFont("helvetica", "italic");
            doc.setTextColor(180, 83, 9);
            doc.text("No Work", margin + 48, y + 4.5);
          } else {
            doc.setFont("helvetica", "normal");
            doc.setTextColor(148, 163, 184);
            doc.text("—", margin + 48, y + 4.5);
          }

          // Work Out (Time Out)
          if (d.timeOut && d.timeOut !== "—") {
            doc.setFont("helvetica", "bold");
            doc.setTextColor(15, 23, 42);
            doc.text(d.timeOut, margin + 82, y + 4.5);
          } else if (d.status === "No Work") {
            doc.setFont("helvetica", "italic");
            doc.setTextColor(180, 83, 9);
            doc.text("No Work", margin + 82, y + 4.5);
          } else {
            doc.setFont("helvetica", "normal");
            doc.setTextColor(148, 163, 184);
            doc.text("—", margin + 82, y + 4.5);
          }

          // Regular Hours
          doc.setFont("helvetica", "normal");
          doc.setTextColor(15, 23, 42);
          doc.text((d?.hoursWorked ?? 0) > 0 ? `${(d.hoursWorked ?? 0).toFixed(2)} h` : (d.status === "No Work" ? "0.00 h" : "—"), margin + 118, y + 4.5, { align: "right" });

          // Overtime Hours
          if ((d?.otHours ?? 0) > 0) {
            doc.setFont("helvetica", "bold");
            doc.setTextColor(147, 51, 234); // Purple
            doc.text(`+${(d.otHours ?? 0).toFixed(2)} h`, margin + 148, y + 4.5, { align: "right" });
          } else {
            doc.setTextColor(148, 163, 184);
            doc.text("—", margin + 148, y + 4.5, { align: "right" });
          }

          // Status Badge Text
          doc.setFont("helvetica", "bold");
          if (d.status === "Present") {
            doc.setTextColor(22, 163, 74);
          } else if (d.status === "Late") {
            doc.setTextColor(217, 119, 6);
          } else if (d.status === "Absent") {
            doc.setTextColor(220, 38, 38);
          } else if (d.status === "No Work") {
            doc.setTextColor(180, 83, 9);
          } else if (d.status.includes("Leave")) {
            doc.setTextColor(59, 130, 246);
          } else {
            doc.setTextColor(148, 163, 184);
          }
          doc.text(d.status, margin + 180, y + 4.5, { align: "right" });

          y += 6.5;
        });

        // Summary row at bottom of employee table
        y += 2;
        doc.setFillColor(241, 245, 249);
        doc.rect(margin, y, contentWidth, 7, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(15, 23, 42);
        doc.text(`TOTALS FOR ${safeEmpName.toUpperCase()}:`, margin + 4, y + 5);
        doc.setTextColor(22, 163, 74);
        doc.text(`${s.presentDays} Present`, margin + 74, y + 5);
        doc.setTextColor(s.absentDays > 0 ? 220 : 100, s.absentDays > 0 ? 38 : 116, s.absentDays > 0 ? 38 : 139);
        doc.text(`${s.absentDays} Absent`, margin + 98, y + 5);
        doc.setTextColor(15, 23, 42);
        doc.text(`${(s?.totalRegularHours ?? 0).toFixed(2)} Regular Hrs`, margin + 118, y + 5, { align: "right" });
        doc.setTextColor(147, 51, 234);
        doc.text(`+${(s?.totalOTHours ?? 0).toFixed(2)} OT Hrs`, margin + 148, y + 5, { align: "right" });
        y += 12;
      });

      // Verification Signature Block on final page
      if (y > 240) {
        doc.addPage();
        y = 30;
      } else {
        y += 10;
      }

      doc.setDrawColor(203, 213, 225);
      doc.line(margin + 10, y + 18, margin + 75, y + 18);
      doc.line(margin + 105, y + 18, margin + 170, y + 18);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      doc.text("HR & Operations Manager", margin + 10, y + 22);
      doc.text("Executive Studio Director", margin + 105, y + 22);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text("Oligarch Media Biometrics Verification Unit", margin + 10, y + 26);
      doc.text("Final Clearance & Payroll Authorization", margin + 105, y + 26);

      // Save complete 1-PDF document
      const filename = `Oligarch_Media_Cutoff_Attendance_OT_${customStartDate}_to_${customEndDate}.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("Failed to generate PDF. Check console logs.");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200 w-full min-w-0">
      {/* Top Banner / Filter & Cutoff Selector Bar */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight flex items-center gap-2">
                Boss Cutoff Attendance & Overtime Summary
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-black border border-emerald-500/20">
                  ALL-IN-1 PDF EXPORT
                </span>
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Comprehensive overview of employee present days, absent days, work start/out times, and overtime (OT) for the cutoff.
              </p>
            </div>
          </div>

          {/* PROMINENT DOWNLOAD BUTTON REQUESTED BY USER */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              id="download-cutoff-pdf-btn"
              onClick={handleDownloadAllInOnePDF}
              disabled={isGeneratingPDF || employeeSummaries.length === 0}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-emerald-600/20 border border-emerald-400/40 flex items-center gap-2.5 transition-all cursor-pointer ring-2 ring-emerald-500/20 hover:ring-emerald-400"
              title="Download full cutoff report for all employees in a single PDF file"
            >
              <FileDown className="w-4 h-4 text-emerald-100" />
              <span>{isGeneratingPDF ? "Generating PDF..." : "Download Full Cutoff (1 PDF)"}</span>
            </button>
          </div>
        </div>

        {/* Controls: Cutoff Selection & Custom Date Range */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block mb-1">
              Select Cutoff Period
            </label>
            <select
              value={selectedPeriodId}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="w-full text-xs font-semibold px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none dark:text-zinc-100 font-mono"
            >
              {periods.map(p => (
                <option key={p.periodId} value={p.periodId}>
                  {p.name} ({p.startDate} to {p.endDate})
                </option>
              ))}
              <option value="custom">Custom Date Range...</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block mb-1">
              Cutoff Start Date
            </label>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => {
                setSelectedPeriodId("custom");
                setCustomStartDate(e.target.value);
              }}
              className="w-full text-xs font-semibold px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none dark:text-zinc-100 font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block mb-1">
              Cutoff End Date
            </label>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => {
                setSelectedPeriodId("custom");
                setCustomEndDate(e.target.value);
              }}
              className="w-full text-xs font-semibold px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none dark:text-zinc-100 font-mono"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-400 uppercase font-bold mr-1">Presets:</span>
            <button
              onClick={() => applyPreset("first")}
              className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-all cursor-pointer"
            >
              1st-15th
            </button>
            <button
              onClick={() => applyPreset("second")}
              className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-all cursor-pointer"
            >
              16th-End
            </button>
            <button
              onClick={() => applyPreset("full")}
              className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-all cursor-pointer"
            >
              Month
            </button>
          </div>
        </div>
      </div>

      {/* Executive Cutoff Summary Cards for the Boss */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Present Days */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Total Present Days</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-2">
            {overallMetrics.totalPresentDays} <span className="text-xs font-normal text-zinc-400">Days</span>
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">Across all {overallMetrics.totalEmployees} active artists</p>
        </div>

        {/* Total Absent Days */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Total Absent Days</span>
            <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center">
              <XCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-2">
            {overallMetrics.totalAbsentDays} <span className="text-xs font-normal text-zinc-400">Days</span>
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">Unlogged or unexcused shifts</p>
        </div>

        {/* Total Overtime (OT) */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Total Overtime (OT)</span>
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-2">
            +{(overallMetrics?.totalOTHours ?? 0).toFixed(2)} <span className="text-xs font-normal text-zinc-400">hrs</span>
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">Accrued overtime shifts</p>
        </div>

        {/* Working Days in Cutoff */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Cutoff Schedule</span>
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-2">
            {overallMetrics.workingDays} <span className="text-xs font-normal text-zinc-400">Workdays</span>
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">Excludes weekend restdays</p>
        </div>
      </div>

      {/* Filter, Search & Expand Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3 rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by designer name, position, or employee ID (e.g. Joemarie)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-xs pl-9 pr-3 py-2 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 rounded-xl focus:outline-none dark:text-zinc-100"
            />
          </div>

          {uniqueDepartments.length > 0 && (
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="text-xs font-semibold px-3 py-2 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 rounded-xl focus:outline-none dark:text-zinc-100 shrink-0"
            >
              <option value="All">All Departments</option>
              {uniqueDepartments.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={expandAll}
            className="px-3 py-1.5 text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg transition-all cursor-pointer"
          >
            Expand All Days
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-1.5 text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg transition-all cursor-pointer"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Employee Cards with Summary and Daily Work Start / Work Out / OT Breakdown */}
      <div className="space-y-4">
        {filteredSummaries.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-12 text-center">
            <Users className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-zinc-700 dark:text-zinc-200">No active employees found</h4>
            <p className="text-xs text-zinc-400 mt-1">Try changing your search terms or date range.</p>
          </div>
        ) : (
          filteredSummaries.map((summary) => {
            const emp = summary.employee;
            const isExpanded = !!expandedEmployees[emp.id || ""];

            return (
              <div
                key={emp.id}
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs overflow-hidden transition-all duration-200"
              >
                {/* Employee Header & High-Level Summary Card */}
                <div
                  onClick={() => toggleExpand(emp.id || "")}
                  className="p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 cursor-pointer hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <div className="flex items-center gap-3.5">
                    {emp.profilePicture ? (
                      <img
                        src={emp.profilePicture}
                        alt={emp.fullName}
                        className="w-11 h-11 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shadow-xs"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-sm border border-indigo-500/20">
                        {emp.fullName.charAt(0)}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">
                          {emp.fullName}
                        </h4>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-bold">
                          #{emp.employeeNumber}
                        </span>
                        {emp.status === "Resigned" && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold uppercase">
                            Resigned
                          </span>
                        )}
                        {emp.status === "Inactive" && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/30 font-semibold uppercase">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {emp.position || "Graphic Designer"} • {emp.department || "Design"}
                      </p>
                    </div>
                  </div>

                  {/* Summary Metric Pills (Requested by user: e.g. Joemarie 10 days present, absent, OT) */}
                  <div className="flex flex-wrap items-center gap-2.5 self-stretch md:self-auto justify-between md:justify-end">
                    {/* Present Badge */}
                    <div className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400 font-bold text-xs flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>{summary.presentDays} Days Present</span>
                    </div>

                    {/* Absent Badge */}
                    <div className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${
                      summary.absentDays > 0 
                        ? "bg-rose-50 dark:bg-rose-950/30 border-rose-200/60 dark:border-rose-800/40 text-rose-700 dark:text-rose-400" 
                        : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200/60 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400"
                    }`}>
                      <XCircle className={`w-3.5 h-3.5 ${summary.absentDays > 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-400"}`} />
                      <span>{summary.absentDays} Days Absent</span>
                    </div>

                    {/* Overtime (OT) Badge */}
                    <div className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${
                      (summary?.totalOTHours ?? 0) > 0
                        ? "bg-purple-50 dark:bg-purple-950/30 border-purple-200/60 dark:border-purple-800/40 text-purple-700 dark:text-purple-300 font-black"
                        : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200/60 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400"
                    }`}>
                      <Clock className={`w-3.5 h-3.5 ${(summary?.totalOTHours ?? 0) > 0 ? "text-purple-600 dark:text-purple-400" : "text-zinc-400"}`} />
                      <span>+{(summary?.totalOTHours ?? 0).toFixed(2)}h OT</span>
                    </div>

                    {/* Regular Hours */}
                    <div className="px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40 text-blue-700 dark:text-blue-400 font-bold text-xs">
                      <span>{(summary?.totalRegularHours ?? 0).toFixed(1)}h Reg</span>
                    </div>

                    <div className="p-1 text-zinc-400">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>
                </div>

                {/* Detailed Day-by-Day Table (Work Start, Work Out, OT, Status) */}
                {isExpanded && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/40 p-4">
                    <div className="overflow-x-auto rounded-xl border border-zinc-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs w-full">
                      <table className="w-full text-left text-xs min-w-[650px]">
                        <thead>
                          <tr className="bg-zinc-100/75 dark:bg-zinc-800/60 text-zinc-500 dark:text-zinc-400 font-mono text-[10px] uppercase border-b border-zinc-200 dark:border-zinc-800">
                            <th className="py-2.5 px-3">Date</th>
                            <th className="py-2.5 px-3">Day</th>
                            <th className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400 font-bold">Work Start (Time In)</th>
                            <th className="py-2.5 px-3 text-blue-600 dark:text-blue-400 font-bold">Work Out (Time Out)</th>
                            <th className="py-2.5 px-3 text-right">Regular Worked</th>
                            <th className="py-2.5 px-3 text-right text-purple-600 dark:text-purple-400 font-bold">Overtime (OT)</th>
                            <th className="py-2.5 px-3 text-right">Shift Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 font-mono">
                          {summary.days.map((day) => {
                            const isAbsentDay = day.status === "Absent";
                            const isNoWorkDay = day.status === "No Work";
                            const isPresentDay = day.status === "Present" || day.status === "Late" || day.status.includes("Leave");

                            return (
                              <tr
                                key={day.date}
                                className={`transition-colors ${
                                  day.isWeekend 
                                    ? "bg-zinc-50/40 dark:bg-zinc-900/30 text-zinc-400" 
                                    : isNoWorkDay
                                    ? "bg-amber-50/40 dark:bg-amber-950/20"
                                    : isAbsentDay 
                                    ? "bg-rose-50/20 dark:bg-rose-950/10" 
                                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                                }`}
                              >
                                <td className="py-2.5 px-3 font-bold text-zinc-900 dark:text-zinc-100">
                                  <div>{day.date}</div>
                                  {day.notes && (
                                    <div className="text-[10px] text-zinc-400 dark:text-zinc-500 font-sans truncate max-w-[140px]" title={day.notes}>
                                      {day.notes}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-zinc-500">
                                  {day.dayOfWeek}
                                </td>

                                {/* WORK START (TIME IN) */}
                                <td className="py-2.5 px-3">
                                  {day.timeIn ? (
                                    <span className="font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/40">
                                      {day.timeIn}
                                    </span>
                                  ) : isNoWorkDay ? (
                                    <span className="text-amber-600 dark:text-amber-400 font-medium text-[11px] italic">No Work</span>
                                  ) : (
                                    <span className="text-zinc-400 italic text-[11px]">—</span>
                                  )}
                                </td>

                                {/* WORK OUT (TIME OUT) */}
                                <td className="py-2.5 px-3">
                                  {day.timeOut ? (
                                    <span className="font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800/40">
                                      {day.timeOut}
                                    </span>
                                  ) : isNoWorkDay ? (
                                    <span className="text-amber-600 dark:text-amber-400 font-medium text-[11px] italic">No Work</span>
                                  ) : (
                                    <span className="text-zinc-400 italic text-[11px]">—</span>
                                  )}
                                </td>

                                {/* REGULAR WORKED HOURS */}
                                <td className="py-2.5 px-3 text-right text-zinc-700 dark:text-zinc-300 font-bold">
                                  {(day?.hoursWorked ?? 0) > 0 ? `${(day.hoursWorked ?? 0).toFixed(2)} hrs` : (isNoWorkDay ? <span className="text-amber-700 dark:text-amber-400 font-normal text-[11px]">0.00 hrs (No Pay)</span> : "—")}
                                </td>

                                {/* OVERTIME (OT) */}
                                <td className="py-2.5 px-3 text-right">
                                  {(day?.otHours ?? 0) > 0 ? (
                                    <span className="font-black text-purple-700 dark:text-purple-300 bg-purple-100/70 dark:bg-purple-950/50 px-2 py-0.5 rounded border border-purple-300 dark:border-purple-800/50">
                                      +{(day?.otHours ?? 0).toFixed(2)} hrs OT
                                    </span>
                                  ) : (
                                    <span className="text-zinc-400 text-[11px]">—</span>
                                  )}
                                </td>

                                {/* STATUS */}
                                <td className="py-2.5 px-3 text-right">
                                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                    day.status === "Present"
                                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400"
                                      : day.status === "Late"
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400"
                                      : day.status === "Absent"
                                      ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-400"
                                      : day.status === "No Work"
                                      ? "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700/60"
                                      : day.status.includes("Leave")
                                      ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-400"
                                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                                  }`}>
                                    {day.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
