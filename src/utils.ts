import { Employee, Attendance, DayOfWeek, DaySchedule, WeeklySchedule, ScheduleOverride, EffectiveSchedule, SalaryRateRecord } from "./types";
import { OFFICIAL_JOEMARIE_PANGAN, OFFICIAL_STAFF_ROSTER } from "@/officialStaffBackup";

export const generateMockEmployees = (): Employee[] => {
  return OFFICIAL_STAFF_ROSTER;
};

export function formatTimeForDB(timeStr: string | null) {
  if (typeof timeStr !== 'string') return "";
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  const h = parts[0].padStart(2, "0");
  const m = parts[1].padStart(2, "0");
  let s = "00";
  if (parts.length > 2) {
    s = parts[2].split(" ")[0].padStart(2, "0");
  }
  return `${h}:${m}:${s}`;
}

export function formatTo12Hour(timeStr: string | null | undefined): string {
  if (typeof timeStr !== 'string') return "—";
  if (!timeStr || !timeStr.trim()) return "—";
  const clean = timeStr.trim();
  if (clean === "—" || clean === "--" || clean === "null" || clean === "undefined") return "—";
  if (!/^\d{1,2}:\d{2}/.test(clean)) {
    return "—";
  }
  const parts = clean.split(":");
  let h = parseInt(parts[0], 10);
  if (isNaN(h)) return "—";
  const m = parts[1] || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const hStr = String(h);
  const mStr = String(m).padStart(2, "0");
  if (parts[2]) {
    const s = parseInt(parts[2], 10);
    if (!isNaN(s)) {
      const sStrPart = String(s).padStart(2, "0");
      return `${hStr}:${mStr}:${sStrPart} ${ampm}`;
    }
  }
  return `${hStr}:${mStr} ${ampm}`;
}

export function getLiveTimerSeconds(
  currentTimeStr: string,
  timeIn: string | null,
  breakStart: string | null,
  breakEnd: string | null,
  scheduledIn: string = "22:00",
  scheduledOut: string = "07:00",
  accumulatedBreakSeconds: number = 0,
  currentBreakStart: string | null = null,
  earlyInApproved: boolean = false,
  approvedEarlyTime?: string
): number {
  if (!timeIn) return 0;
  
  const parseTimeToMinutes = (tStr: string) => {
    if (typeof tStr !== 'string') return 0;
    const parts = tStr.split(":").map(Number);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    const s = parts[2] || 0;
    return h * 60 + m + s / 60;
  };

  const schedInMins = parseTimeToMinutes(scheduledIn);
  const schedOutMins = parseTimeToMinutes(scheduledOut);
  const rawTimeInMins = parseTimeToMinutes(timeIn);
  let timeInMins = rawTimeInMins;
  if (schedOutMins < schedInMins && rawTimeInMins <= schedOutMins) {
    timeInMins += 1440;
  }
  const dayOffset = timeInMins - rawTimeInMins;
  const getAdjustedMins = (tStr: string) => {
    let mins = parseTimeToMinutes(tStr);
    if (mins < rawTimeInMins) {
      mins += 1440;
    }
    return mins + dayOffset;
  };

  // timeInMins is already initialized properly
  let effectiveTimeInMins = timeInMins;
  if (timeInMins < schedInMins) {
    if (earlyInApproved) {
      if (approvedEarlyTime) {
         effectiveTimeInMins = getAdjustedMins(approvedEarlyTime);
      } else {
         effectiveTimeInMins = timeInMins;
      }
    } else {
      effectiveTimeInMins = schedInMins;
    }
  }

  const currentMins = getAdjustedMins(currentTimeStr);
  if (currentMins < effectiveTimeInMins) return 0;

  let breakMins = 0;
  if (accumulatedBreakSeconds > 0 || currentBreakStart) {
    breakMins = accumulatedBreakSeconds / 60;
    if (currentBreakStart) {
      breakMins += Math.max(0, currentMins - getAdjustedMins(currentBreakStart));
    }
  } else if (breakStart && breakEnd) {
    const bsMins = getAdjustedMins(breakStart);
    const beMins = getAdjustedMins(breakEnd);
    if (currentMins >= bsMins) {
      breakMins = Math.min(currentMins, beMins) - bsMins;
    }
  }

  // Dynamic meal break calculation: 5 hours in for overnight/evening shifts, 4 hours in for day shifts
  const shiftHoursOffset = schedInMins >= 720 ? 5 : 4;
  const defaultMealBreakStartMinutes = (schedInMins + shiftHoursOffset * 60) % 1440;
  const defaultMealBreakEndMinutes = (defaultMealBreakStartMinutes + 60) % 1440;
  
  const autoBreakStartStr = `${String(Math.floor(defaultMealBreakStartMinutes / 60)).padStart(2, "0")}:${String(defaultMealBreakStartMinutes % 60).padStart(2, "0")}:00`;
  const autoBreakEndStr = `${String(Math.floor(defaultMealBreakEndMinutes / 60)).padStart(2, "0")}:${String(defaultMealBreakEndMinutes % 60).padStart(2, "0")}:00`;

  const autoBreakStart = getAdjustedMins(autoBreakStartStr);
  const autoBreakEnd = getAdjustedMins(autoBreakEndStr);

  let autoBreakTracked = false;
  if (breakMins >= 60 || accumulatedBreakSeconds >= 3600) {
      autoBreakTracked = true;
  } else if (breakStart && (breakStart.startsWith(autoBreakStartStr.substring(0, 5)) || breakStart === autoBreakStartStr)) {
      autoBreakTracked = true;
  }

  if (!autoBreakTracked && breakMins === 0 && effectiveTimeInMins <= autoBreakStart && currentMins > autoBreakStart) {
      const expectedAutoBreak = Math.min(currentMins, autoBreakEnd) - autoBreakStart;
      breakMins += expectedAutoBreak;
  }

  const netMins = currentMins - effectiveTimeInMins - breakMins;
  return Math.max(0, Math.floor(netMins * 60));
}

export function calculateLateMinutes(
  timeIn: string | null | undefined,
  scheduledIn: string = "22:00",
  scheduledOut: string = "07:00",
  gracePeriodMinutes: number = 0,
  isLateExcused: boolean = false,
  status?: string
): number {
  if (!timeIn || isLateExcused) return 0;
  if (status && (status === "Paid Leave" || status === "Birthday Leave" || status.toLowerCase().includes("leave") || status === "Absent")) {
    return 0;
  }
  if (typeof timeIn !== 'string') return 0;
  const cleanStr = timeIn.trim();
  // Reject non-time strings e.g. "Birthday Leave", "Paid Leave", "Absent", "—"
  if (!/^\d{1,2}:\d{2}/.test(cleanStr)) {
    return 0;
  }

  const parseTimeToMinutes = (tStr: string) => {
    if (typeof tStr !== 'string') return 0;
    const cleanStr = tStr.trim();
    let isPM = /pm/i.test(cleanStr);
    let isAM = /am/i.test(cleanStr);
    const timeOnly = cleanStr.replace(/[^\d:]/g, '');
    if (!timeOnly || !timeOnly.includes(':')) return 0;
    const parts = timeOnly.split(":").map(Number);
    let h = parts[0] || 0;
    const m = parts[1] || 0;
    const s = parts[2] || 0;
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    return h * 60 + m + s / 60;
  };

  const schedInMins = parseTimeToMinutes(scheduledIn);
  const schedOutMins = parseTimeToMinutes(scheduledOut);
  const rawTimeInMins = parseTimeToMinutes(timeIn);

  let timeInMins = rawTimeInMins;
  // If overnight shift (e.g. 21:00 to 06:00) and clock in is morning past midnight
  if (schedOutMins < schedInMins && rawTimeInMins <= 720) {
    timeInMins += 1440;
  }

  // Punctuality rule:
  // - Clocking in between 10:00:00 and 10:00:59 is On Time (0 late minutes). Late timer does not trigger at 10:00 PM.
  // - Clocking in at exactly 10:01 (22:01:00 or later) is strictly LATE.
  let calculatedLateMinutes = 0;
  if (timeInMins >= schedInMins + 1.0) {
    calculatedLateMinutes = Math.floor(timeInMins - schedInMins);
  }
  if (calculatedLateMinutes <= gracePeriodMinutes) calculatedLateMinutes = 0;
  return calculatedLateMinutes;
}

export async function sanitizeLeaveAttendanceRecords() {
  try {
    const { collection, getDocs, updateDoc, doc, db } = await import("./firebase");
    
    // 1. Fetch approved leave requests to know all approved leave dates per employee
    const reqSnap = await getDocs(collection(db, "leave_requests"));
    const approvedLeaveDates = new Map<string, string>(); // key: `${employeeId}_${date}` or `${empNum}_${date}` -> leave type
    reqSnap.forEach(d => {
      const r = d.data();
      if (r.status === "Approved" && r.startDate) {
        const startD = new Date(r.startDate);
        const endD = new Date(r.endDate || r.startDate);
        for (let cur = new Date(startD); cur <= endD; cur.setDate(cur.getDate() + 1)) {
          const curStr = cur.toISOString().split("T")[0];
          if (r.employeeId) approvedLeaveDates.set(`${r.employeeId}_${curStr}`, r.type);
          if (r.employeeNumber) approvedLeaveDates.set(`${r.employeeNumber}_${curStr}`, r.type);
          if (r.employeeName) approvedLeaveDates.set(`${r.employeeName.trim().toLowerCase()}_${curStr}`, r.type);
        }
      }
    });

    const snap = await getDocs(collection(db, "attendance"));
    const updates: Promise<any>[] = [];
    snap.forEach(d => {
      const data = d.data();
      const empIdKey = data.employeeId ? `${data.employeeId}_${data.date}` : "";
      const empNumKey = data.employeeNumber ? `${data.employeeNumber}_${data.date}` : "";
      const empNameKey = data.employeeName ? `${data.employeeName.trim().toLowerCase()}_${data.date}` : "";
      
      const approvedLeaveType = approvedLeaveDates.get(empIdKey) || approvedLeaveDates.get(empNumKey) || approvedLeaveDates.get(empNameKey);
      const isLeaveStatus = data.status === "Birthday Leave" || data.status === "Paid Leave" || (typeof data.status === "string" && data.status.toLowerCase().includes("leave"));

      if (approvedLeaveType || isLeaveStatus) {
        const targetStatus = approvedLeaveType || data.status;
        const targetHours = targetStatus === "Absent Notice" ? 0 : 8;
        const needsFix = (data.lateMinutes && data.lateMinutes > 0) || 
                         !data.isLateExcused ||
                         data.timeIn !== null ||
                         data.timeOut !== null ||
                         data.status !== targetStatus ||
                         data.hoursWorked !== targetHours;
        if (needsFix) {
          updates.push(updateDoc(doc(db, "attendance", d.id), {
            status: targetStatus,
            timeIn: null,
            timeOut: null,
            breakStart: null,
            breakEnd: null,
            hoursWorked: targetHours,
            otHours: 0,
            lateMinutes: 0,
            isLateExcused: true
          }));
        }
      }
    });
    if (updates.length > 0) {
      await Promise.all(updates);
      console.log(`Cleaned up and excused ${updates.length} leave attendance records.`);
    }
  } catch (err) {
    console.error("Error sanitizing leave attendance records:", err);
  }
}

export interface BirthdayWeekInfo {
  birthdayFormatted: string; // e.g., "September 1"
  birthdayDateThisYearStr: string; // e.g., "2026-09-01"
  weekStartMondayStr: string; // e.g., "2026-09-01" (YYYY-MM-DD)
  weekEndFridayStr: string; // e.g., "2026-09-05" (YYYY-MM-DD)
  weekEndSundayStr: string; // e.g., "2026-09-07" (YYYY-MM-DD)
  isValid: boolean;
  isInBirthdayWeek: (dateStr: string) => boolean;
  explanation: string;
}

export function getBirthdayWeekInfo(
  birthdayStr: string | null | undefined,
  targetDateOrYear?: string | number
): BirthdayWeekInfo {
  if (!birthdayStr || typeof birthdayStr !== "string" || !birthdayStr.trim()) {
    return {
      birthdayFormatted: "Not Set",
      birthdayDateThisYearStr: "",
      weekStartMondayStr: "",
      weekEndFridayStr: "",
      weekEndSundayStr: "",
      isValid: false,
      isInBirthdayWeek: () => false,
      explanation: "No birthday configured for employee."
    };
  }

  const cleanBday = birthdayStr.trim();
  let bMonth = 0;
  let bDay = 0;
  let bYear = 0;

  if (cleanBday.includes("-")) {
    const parts = cleanBday.split("-").map(Number);
    if (parts.length >= 2) {
      if (parts[0] > 1000) {
        bYear = parts[0];
        bMonth = parts[1];
        bDay = parts[2] || 1;
      } else {
        bMonth = parts[0];
        bDay = parts[1];
        bYear = parts[2] || 0;
      }
    }
  } else if (cleanBday.includes("/")) {
    const parts = cleanBday.split("/").map(Number);
    if (parts.length >= 2) {
      if (parts[2] > 1000) {
        bMonth = parts[0];
        bDay = parts[1];
        bYear = parts[2];
      } else if (parts[0] > 1000) {
        bYear = parts[0];
        bMonth = parts[1];
        bDay = parts[2];
      } else {
        bMonth = parts[0];
        bDay = parts[1];
      }
    }
  }

  if (!bMonth || !bDay || bMonth < 1 || bMonth > 12 || bDay < 1 || bDay > 31) {
    return {
      birthdayFormatted: cleanBday,
      birthdayDateThisYearStr: "",
      weekStartMondayStr: "",
      weekEndFridayStr: "",
      weekEndSundayStr: "",
      isValid: false,
      isInBirthdayWeek: () => false,
      explanation: `Invalid birthday format (${cleanBday}). Please update to YYYY-MM-DD.`
    };
  }

  // Determine target reference year
  let targetYear = new Date().getFullYear();
  if (typeof targetDateOrYear === "number") {
    targetYear = targetDateOrYear;
  } else if (typeof targetDateOrYear === "string" && targetDateOrYear.includes("-")) {
    const yPart = parseInt(targetDateOrYear.split("-")[0], 10);
    if (!isNaN(yPart) && yPart > 1900) targetYear = yPart;
  }

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const bdayThisYear = new Date(targetYear, bMonth - 1, bDay);
  const birthdayDateThisYearStr = `${targetYear}-${pad2(bMonth)}-${pad2(bDay)}`;

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const birthdayFormatted = `${monthNames[bMonth - 1]} ${bDay}${bYear ? `, ${bYear}` : ""}`;

  // Find Monday of the birthday week
  // 0 = Sunday, 1 = Monday, 2 = Tuesday, ..., 6 = Saturday
  const dayOfWeek = bdayThisYear.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const mondayDate = new Date(bdayThisYear);
  mondayDate.setDate(bdayThisYear.getDate() - daysFromMonday);

  const fridayDate = new Date(mondayDate);
  fridayDate.setDate(mondayDate.getDate() + 4);

  const sundayDate = new Date(mondayDate);
  sundayDate.setDate(mondayDate.getDate() + 6);

  const weekStartMondayStr = `${mondayDate.getFullYear()}-${pad2(mondayDate.getMonth() + 1)}-${pad2(mondayDate.getDate())}`;
  const weekEndFridayStr = `${fridayDate.getFullYear()}-${pad2(fridayDate.getMonth() + 1)}-${pad2(fridayDate.getDate())}`;
  const weekEndSundayStr = `${sundayDate.getFullYear()}-${pad2(sundayDate.getMonth() + 1)}-${pad2(sundayDate.getDate())}`;

  return {
    birthdayFormatted,
    birthdayDateThisYearStr,
    weekStartMondayStr,
    weekEndFridayStr,
    weekEndSundayStr,
    isValid: true,
    isInBirthdayWeek: (dateStr: string) => {
      if (!dateStr) return false;
      return dateStr >= weekStartMondayStr && dateStr <= weekEndSundayStr;
    },
    explanation: `Birthday Week: Monday ${weekStartMondayStr} to Friday ${weekEndFridayStr}`
  };
}

export function calculateAttendanceHours(
  timeIn: string,
  breakStart: string | null,
  breakEnd: string | null,
  timeOut: string | null,
  scheduledIn: string = "22:00",
  scheduledOut: string = "07:00",
  dstOffsetMinutes: number = 0,
  accumulatedBreakSeconds: number = 0,
  currentBreakStart: string | null = null,
  earlyInApproved: boolean = false,
  gracePeriodMinutes: number = 0,
  isLateExcused: boolean = false,
  approvedEarlyTime?: string,
  requiredRegularHours: number = 8,
  status?: string
) {
  // If record is a Leave or Absent, late minutes is ALWAYS 0 and never counted as late
  const isLeave = status === "Paid Leave" || status === "Birthday Leave" || (typeof status === "string" && status.toLowerCase().includes("leave")) || status === "Absent";
  if (isLeave || isLateExcused) {
    if (!timeIn || !/^\d{1,2}:\d{2}/.test(String(timeIn).trim())) {
      const isPaid = status === "Paid Leave" || status === "Birthday Leave";
      return {
        hoursWorked: isPaid ? 8 : 0,
        lateMinutes: 0,
        otHours: 0,
        breakMinutes: 0,
        effectiveWorkStartMins: 0,
        computedBreakStart: null,
        computedBreakEnd: null
      };
    }
  }

  // If timeIn is missing or not a valid time string, it can NEVER be late
  if (!timeIn || typeof timeIn !== 'string' || !/^\d{1,2}:\d{2}/.test(timeIn.trim())) {
    return {
      hoursWorked: 0,
      lateMinutes: 0,
      otHours: 0,
      breakMinutes: 0,
      effectiveWorkStartMins: 0,
      computedBreakStart: null,
      computedBreakEnd: null
    };
  }

  const parseTimeToMinutes = (tStr: string) => {
    if (typeof tStr !== 'string') return 0;
    const cleanStr = tStr.trim();
    let isPM = /pm/i.test(cleanStr);
    let isAM = /am/i.test(cleanStr);
    const parts = cleanStr.replace(/[^\d:]/g, '').split(":").map(Number);
    let h = parts[0] || 0;
    const m = parts[1] || 0;
    const s = parts[2] || 0;
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    return h * 60 + m + s / 60;
  };

  const schedInMins = parseTimeToMinutes(scheduledIn);
  const schedOutMins = parseTimeToMinutes(scheduledOut);
  const rawTimeInMins = parseTimeToMinutes(timeIn);
  let timeInMins = rawTimeInMins;
  if (schedOutMins < schedInMins && rawTimeInMins <= 720) {
    timeInMins += 1440;
  }
  const dayOffset = timeInMins - rawTimeInMins;
  const getAdjustedMins = (tStr: string) => {
    let mins = parseTimeToMinutes(tStr);
    if (mins < rawTimeInMins) {
      mins += 1440;
    }
    return mins + dayOffset;
  };

  // timeInMins is already initialized properly
  let effectiveTimeInMins = timeInMins;

  if (timeInMins < schedInMins) {
    if (earlyInApproved) {
      if (approvedEarlyTime) {
         effectiveTimeInMins = getAdjustedMins(approvedEarlyTime);
      } else {
         effectiveTimeInMins = timeInMins;
      }
    } else {
      effectiveTimeInMins = schedInMins;
    }
  }

  // Punctuality rule:
  // - Clocking in between 10:00:00 and 10:00:59 is On Time (0 late minutes). Late timer does not trigger at 10:00 PM.
  // - Clocking in at exactly 10:01 (22:01:00 or later) is strictly LATE.
  let calculatedLateMinutes = 0;
  if (timeInMins >= schedInMins + 1.0) {
    calculatedLateMinutes = Math.floor(timeInMins - schedInMins);
  }
  if (calculatedLateMinutes <= gracePeriodMinutes) calculatedLateMinutes = 0;
  if (isLateExcused) calculatedLateMinutes = 0;

  if (!timeOut) {
    return { hoursWorked: 0, lateMinutes: calculatedLateMinutes, otHours: 0, breakMinutes: 0, effectiveWorkStartMins: effectiveTimeInMins, computedBreakStart: null, computedBreakEnd: null };
  }

  const timeOutMins = getAdjustedMins(timeOut);
  let breakMins = 0;

  if (accumulatedBreakSeconds > 0 || currentBreakStart) {
    breakMins = accumulatedBreakSeconds / 60;
    if (currentBreakStart) {
      breakMins += Math.max(0, timeOutMins - getAdjustedMins(currentBreakStart));
    }
  } else if (breakStart && breakEnd) {
    const bsMins = getAdjustedMins(breakStart);
    const beMins = getAdjustedMins(breakEnd);
    if (timeOutMins >= bsMins) {
      breakMins = Math.min(timeOutMins, beMins) - bsMins;
    }
  }

  // Dynamic meal break calculation: 5 hours in for overnight/evening shifts, 4 hours in for day shifts
  const shiftHoursOffset = schedInMins >= 720 ? 5 : 4;
  const defaultMealBreakStartMinutes = (schedInMins + shiftHoursOffset * 60) % 1440;
  const defaultMealBreakEndMinutes = (defaultMealBreakStartMinutes + 60) % 1440;
  
  const autoBreakStartStr = `${String(Math.floor(defaultMealBreakStartMinutes / 60)).padStart(2, "0")}:${String(defaultMealBreakStartMinutes % 60).padStart(2, "0")}:00`;
  const autoBreakEndStr = `${String(Math.floor(defaultMealBreakEndMinutes / 60)).padStart(2, "0")}:${String(defaultMealBreakEndMinutes % 60).padStart(2, "0")}:00`;

  const autoBreakStart = getAdjustedMins(autoBreakStartStr);
  const autoBreakEnd = getAdjustedMins(autoBreakEndStr);
  let computedBreakStart = null;
  let computedBreakEnd = null;

  let autoBreakTracked = false;
  if (breakMins >= 60 || accumulatedBreakSeconds >= 3600) {
      autoBreakTracked = true;
  } else if (breakStart && (breakStart.startsWith(autoBreakStartStr.substring(0, 5)) || breakStart === autoBreakStartStr)) {
      autoBreakTracked = true;
  }

  if (!autoBreakTracked && breakMins === 0 && effectiveTimeInMins <= autoBreakStart && timeOutMins > autoBreakStart) {
      const expectedAutoBreak = Math.min(timeOutMins, autoBreakEnd) - autoBreakStart;
      breakMins += expectedAutoBreak;
      if (!breakStart && expectedAutoBreak > 0) {
          computedBreakStart = autoBreakStartStr;
          computedBreakEnd = expectedAutoBreak === 60 ? autoBreakEndStr : null;
      }
  }

  // Actual elapsed worked minutes between effective work start and timeout (net of break)
  const totalShiftMins = timeOutMins - effectiveTimeInMins;
  const netWorkMins = Math.max(0, totalShiftMins - breakMins);
  
  const standardWorkMins = (requiredRegularHours || 8) * 60;

  let otMins = netWorkMins > standardWorkMins ? netWorkMins - standardWorkMins : 0;
  
  // Cap regular hours worked to standardWorkMins so it doesn't double count OT
  const regularWorkMins = Math.min(netWorkMins, standardWorkMins);
  const hoursWorked = isNaN(regularWorkMins) ? 0 : parseFloat(((regularWorkMins || 0) / 60).toFixed(2));
  const otHours = isNaN(otMins) ? 0 : parseFloat(((otMins || 0) / 60).toFixed(2));

  const isNight = isQualifyingNightShift(scheduledIn, scheduledOut, timeIn);
  const companyNightShiftHours = isNight ? parseFloat(Math.min(8.0, hoursWorked).toFixed(2)) : 0;

  return {
    hoursWorked,
    lateMinutes: calculatedLateMinutes,
    otHours,
    breakMinutes: Math.round(breakMins),
    effectiveWorkStartMins: effectiveTimeInMins,
    computedBreakStart: computedBreakStart || breakStart,
    computedBreakEnd: computedBreakEnd || breakEnd,
    companyNightShiftHours
  };
}

export async function ensureEmployee002Exists() {
  const { doc, getDoc, setDoc, db } = await import("./firebase");
  try {
    const canonicalDocRef = doc(db, "employees", "Y5fCWLfZk5lfg2Ocp1f9");
    const canonicalSnap = await getDoc(canonicalDocRef);

    if (!canonicalSnap.exists()) {
      console.log("Self-healing: Restoring official profile for PANGAN, JOEMARIE G (002)...");
      await setDoc(canonicalDocRef, {
        ...OFFICIAL_JOEMARIE_PANGAN,
        id: "Y5fCWLfZk5lfg2Ocp1f9",
        status: "Active",
        updatedAt: Date.now()
      }, { merge: true });
    }
  } catch (error) {
    // Non-fatal permission or quota limitation, safe fallback
    console.warn("Notice checking employee 002:", error);
  }
}

// Direct Brevo REST API dispatcher (300 free emails/day, zero Google passwords or OAuth)
export async function sendEmailViaBrevo({
  apiKey,
  senderName = "Oligarch Media Graphic Design Studio",
  senderEmail = "hr.oligarchmedia@gmail.com",
  to,
  subject,
  html
}: {
  apiKey: string;
  senderName?: string;
  senderEmail?: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": apiKey.trim(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: to.trim() }],
        subject,
        htmlContent: html
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data?.message || `Brevo API HTTP ${res.status}` };
    }
    return { success: true, messageId: data?.messageId };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to communicate with Brevo service" };
  }
}

// Direct Resend REST API dispatcher (3,000 free emails/mo)
export async function sendEmailViaResend({
  apiKey,
  senderName = "Oligarch Media Graphic Design Studio",
  senderEmail = "onboarding@resend.dev",
  to,
  subject,
  html
}: {
  apiKey: string;
  senderName?: string;
  senderEmail?: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `${senderName} <${senderEmail}>`,
        to: [to.trim()],
        subject,
        html
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data?.message || `Resend API HTTP ${res.status}` };
    }
    return { success: true, messageId: data?.id };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to communicate with Resend service" };
  }
}

export async function sendNotificationEmail(to: string, subject: string, content: string, customSmtpConfig?: any) {
  try {
    // 1. Check Brevo API Key
    const brevoKey = customSmtpConfig?.brevoApiKey || "";
    if (brevoKey) {
      const bRes = await sendEmailViaBrevo({
        apiKey: brevoKey,
        senderName: customSmtpConfig?.senderName || "Oligarch Media Graphic Design Studio",
        senderEmail: customSmtpConfig?.user || "hr.oligarchmedia@gmail.com",
        to,
        subject,
        html: content
      });
      if (bRes.success) {
        return { success: true, status: "Delivered", provider: "brevo", messageId: bRes.messageId };
      }
      console.warn("Brevo direct dispatch note:", bRes.error);
    }

    // 2. Check Resend API Key
    const resendKey = customSmtpConfig?.resendApiKey || "";
    if (resendKey) {
      const rRes = await sendEmailViaResend({
        apiKey: resendKey,
        senderName: customSmtpConfig?.senderName || "Oligarch Media Graphic Design Studio",
        senderEmail: customSmtpConfig?.user || "onboarding@resend.dev",
        to,
        subject,
        html: content
      });
      if (rRes.success) {
        return { success: true, status: "Delivered", provider: "resend", messageId: rRes.messageId };
      }
      console.warn("Resend direct dispatch note:", rRes.error);
    }

    // 3. Check Google OAuth Access Token
    let googleToken: string | null = null;
    try {
      const { getAccessToken, sendEmailViaGmailApi } = await import("./services/googleAuth");
      googleToken = await getAccessToken();
      if (googleToken) {
        // Direct browser-to-Gmail API dispatch! 100% serverless, works everywhere
        const directRes = await sendEmailViaGmailApi({
          to,
          subject,
          html: content,
          fromName: customSmtpConfig?.senderName || "Oligarch Media Graphic Design Studio",
          fromEmail: customSmtpConfig?.user || "hr.oligarchmedia@gmail.com"
        });
        if (directRes.success) {
          return { success: true, status: "Delivered", provider: "gmail", messageId: directRes.messageId };
        }
        console.warn("Direct Gmail API failed, checking backend:", directRes.error);
      }
    } catch (e) {
      // ignore
    }

    // 4. Retrieve settings from database if not passed
    let smtpConfig: any = customSmtpConfig || null;
    if (!smtpConfig && !googleToken) {
      try {
        const { doc, getDoc, db } = await import("./firebase");
        const settingsSnap = await getDoc(doc(db, "settings", "general"));
        if (settingsSnap.exists()) {
          const settingsData = settingsSnap.data();

          // Check if Brevo or Resend key is stored in general settings!
          if (settingsData.brevoApiKey) {
            const bRes = await sendEmailViaBrevo({
              apiKey: settingsData.brevoApiKey,
              senderName: settingsData.smtpSenderName || settingsData.companyName || "Oligarch Media Graphic Design Studio",
              senderEmail: settingsData.smtpUser || settingsData.adminEmail || "hr.oligarchmedia@gmail.com",
              to,
              subject,
              html: content
            });
            if (bRes.success) {
              return { success: true, status: "Delivered", provider: "brevo", messageId: bRes.messageId };
            }
          }

          if (settingsData.resendApiKey) {
            const rRes = await sendEmailViaResend({
              apiKey: settingsData.resendApiKey,
              senderName: settingsData.smtpSenderName || settingsData.companyName || "Oligarch Media Graphic Design Studio",
              senderEmail: settingsData.smtpUser || "onboarding@resend.dev",
              to,
              subject,
              html: content
            });
            if (rRes.success) {
              return { success: true, status: "Delivered", provider: "resend", messageId: rRes.messageId };
            }
          }

          smtpConfig = {
            host: settingsData.smtpHost || "smtp.gmail.com",
            port: settingsData.smtpPort || "587",
            user: settingsData.smtpUser || settingsData.adminEmail || "hr.oligarchmedia@gmail.com",
            pass: settingsData.smtpPass || "",
            senderName: settingsData.smtpSenderName || settingsData.companyName || "Oligarch Media Graphic Design Studio",
            secure: settingsData.smtpPort === "465",
            brevoApiKey: settingsData.brevoApiKey || "",
            resendApiKey: settingsData.resendApiKey || ""
          };
        }
      } catch (dbErr) {
        console.warn("Failed to retrieve SMTP credentials from database:", dbErr);
      }
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (googleToken) {
      headers["Authorization"] = `Bearer ${googleToken}`;
    }

    const response = await fetch("/api/send-email", {
      method: "POST",
      headers,
      body: JSON.stringify({ to, subject, content, smtpConfig, googleAccessToken: googleToken })
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.error || `HTTP ${response.status}: ${response.statusText}`, simulated: false };
    }
    return await response.json();
  } catch (error: any) {
    console.error("Email dispatch API error:", error);
    return { success: false, error: error?.message || "Email dispatch failed", simulated: true };
  }
}

export async function sendBulkPayrollEmails(
  items: Array<{
    to: string;
    subject: string;
    content: string;
    employeeId: string;
    fullName: string;
    employeeNumber: string;
  }>,
  customSmtpConfig?: any
) {
  try {
    let effectiveBrevoKey = customSmtpConfig?.brevoApiKey || "";
    let effectiveResendKey = customSmtpConfig?.resendApiKey || "";
    let effectiveSenderName = customSmtpConfig?.senderName || "Oligarch Media Graphic Design Studio";
    let effectiveSenderEmail = customSmtpConfig?.user || "hr.oligarchmedia@gmail.com";

    if (!effectiveBrevoKey && !effectiveResendKey) {
      try {
        const { doc, getDoc, db } = await import("./firebase");
        const settingsSnap = await getDoc(doc(db, "settings", "general"));
        if (settingsSnap.exists()) {
          const s = settingsSnap.data();
          if (s.brevoApiKey) effectiveBrevoKey = s.brevoApiKey;
          if (s.resendApiKey) effectiveResendKey = s.resendApiKey;
          if (s.smtpSenderName) effectiveSenderName = s.smtpSenderName;
          if (s.smtpUser) effectiveSenderEmail = s.smtpUser;
        }
      } catch (e) {
        // ignore
      }
    }

    // 1. Batch via Brevo API if configured
    if (effectiveBrevoKey) {
      const results: Array<{
        employeeId: string;
        fullName: string;
        employeeNumber: string;
        email: string;
        status: "Delivered" | "Simulated" | "Failed";
        messageId?: string;
        error?: string;
      }> = [];
      let deliveredCount = 0;
      let failedCount = 0;

      for (const item of items) {
        const to = String(item.to || "").trim();
        if (!to) {
          results.push({
            employeeId: item.employeeId,
            fullName: item.fullName,
            employeeNumber: item.employeeNumber,
            email: "",
            status: "Failed",
            error: "Missing employee email address."
          });
          failedCount++;
          continue;
        }

        const res = await sendEmailViaBrevo({
          apiKey: effectiveBrevoKey,
          senderName: effectiveSenderName,
          senderEmail: effectiveSenderEmail,
          to,
          subject: item.subject,
          html: item.content
        });

        if (res.success) {
          results.push({
            employeeId: item.employeeId,
            fullName: item.fullName,
            employeeNumber: item.employeeNumber,
            email: to,
            status: "Delivered",
            messageId: res.messageId
          });
          deliveredCount++;
        } else {
          results.push({
            employeeId: item.employeeId,
            fullName: item.fullName,
            employeeNumber: item.employeeNumber,
            email: to,
            status: "Failed",
            error: res.error || "Brevo delivery error"
          });
          failedCount++;
        }
        await new Promise(r => setTimeout(r, 120));
      }

      return {
        success: deliveredCount > 0,
        provider: "brevo",
        total: items.length,
        delivered: deliveredCount,
        simulated: 0,
        failed: failedCount,
        results
      };
    }

    // 2. Batch via Google OAuth if connected
    let googleToken: string | null = null;
    try {
      const { getAccessToken, sendEmailViaGmailApi } = await import("./services/googleAuth");
      googleToken = await getAccessToken();
      if (googleToken) {
        // Direct client-side batch sending via official Gmail REST API
        const results: Array<{
          employeeId: string;
          fullName: string;
          employeeNumber: string;
          email: string;
          status: "Delivered" | "Simulated" | "Failed";
          messageId?: string;
          error?: string;
        }> = [];
        let deliveredCount = 0;
        let failedCount = 0;

        for (const item of items) {
          const to = String(item.to || "").trim();
          if (!to) {
            results.push({
              employeeId: item.employeeId,
              fullName: item.fullName,
              employeeNumber: item.employeeNumber,
              email: "",
              status: "Failed",
              error: "Missing employee email address."
            });
            failedCount++;
            continue;
          }
          const res = await sendEmailViaGmailApi({
            to,
            subject: item.subject,
            html: item.content,
            fromName: customSmtpConfig?.senderName || "Oligarch Media Graphic Design Studio",
            fromEmail: customSmtpConfig?.user || "hr.oligarchmedia@gmail.com"
          });
          if (res.success) {
            results.push({
              employeeId: item.employeeId,
              fullName: item.fullName,
              employeeNumber: item.employeeNumber,
              email: to,
              status: "Delivered",
              messageId: res.messageId
            });
            deliveredCount++;
          } else {
            results.push({
              employeeId: item.employeeId,
              fullName: item.fullName,
              employeeNumber: item.employeeNumber,
              email: to,
              status: "Failed",
              error: res.error || "Gmail API error"
            });
            failedCount++;
          }
          await new Promise(r => setTimeout(r, 120));
        }

        return {
          success: deliveredCount > 0,
          provider: "gmail",
          total: items.length,
          delivered: deliveredCount,
          simulated: 0,
          failed: failedCount,
          results
        };
      }
    } catch (e) {
      // ignore
    }

    let smtpConfig: any = customSmtpConfig || null;
    if (!smtpConfig && !googleToken) {
      try {
        const { doc, getDoc, db } = await import("./firebase");
        const settingsSnap = await getDoc(doc(db, "settings", "general"));
        if (settingsSnap.exists()) {
          const settingsData = settingsSnap.data();
          smtpConfig = {
            host: settingsData.smtpHost || "smtp.gmail.com",
            port: settingsData.smtpPort || "587",
            user: settingsData.smtpUser || settingsData.adminEmail || "hr.oligarchmedia@gmail.com",
            pass: settingsData.smtpPass || "",
            senderName: settingsData.smtpSenderName || settingsData.companyName || "Oligarch Media Graphic Design Studio",
            secure: settingsData.smtpPort === "465"
          };
        }
      } catch (dbErr) {
        console.warn("Failed to retrieve SMTP credentials for bulk email:", dbErr);
      }
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (googleToken) {
      headers["Authorization"] = `Bearer ${googleToken}`;
    }

    const response = await fetch("/api/send-bulk-payroll-emails", {
      method: "POST",
      headers,
      body: JSON.stringify({ items, smtpConfig, googleAccessToken: googleToken })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errData.error || `HTTP ${response.status}: ${response.statusText}`,
        total: items.length,
        delivered: 0,
        failed: items.length,
        simulated: 0,
        results: items.map(it => ({
          employeeId: it.employeeId,
          fullName: it.fullName,
          employeeNumber: it.employeeNumber,
          email: it.to,
          status: "Failed" as const,
          error: errData.error || "Server error"
        }))
      };
    }

    return await response.json();
  } catch (error: any) {
    console.error("Bulk email API error:", error);
    return {
      success: false,
      error: error?.message || "Bulk email dispatch failed",
      total: items.length,
      delivered: 0,
      failed: items.length,
      simulated: 0,
      results: items.map(it => ({
        employeeId: it.employeeId,
        fullName: it.fullName,
        employeeNumber: it.employeeNumber,
        email: it.to,
        status: "Failed" as const,
        error: error?.message || "Network error"
      }))
    };
  }
}

export async function seedInitialDataIfEmpty() {
  const { collection, getDocs, addDoc, db } = await import("./firebase");
  try {
    const snap = await getDocs(collection(db, "employees"));
    if (snap.empty) {
      const { doc, setDoc } = await import("./firebase");
      const mockData = generateMockEmployees();
      for (const emp of mockData) {
        const effectiveId = emp.id || `emp-${emp.employeeNumber}`;
        await setDoc(doc(db, "employees", effectiveId), emp, { merge: true });
      }
    }

    // Seed default devotion schedules if empty
    const devotionSnap = await getDocs(collection(db, "devotion_schedules"));
    if (devotionSnap.empty) {
      const today = new Date();
      const sampleTopics = [
        { scripture: "Philippians 4:6-7", topic: "Peace in the Midst of Deadlines", notes: "Opening prayer focused on team focus and creativity" },
        { scripture: "Romans 12:1-2", topic: "Renewing Our Minds in Design & Excellence", notes: "Fellowship after shift handover" },
        { scripture: "Colossians 3:23-24", topic: "Working with All Our Heart for the Lord", notes: "Prayers for clients and creative campaigns" },
        { scripture: "Proverbs 3:5-6", topic: "Trusting God with Direction & Plans", notes: "Sharing personal praises" },
        { scripture: "Joshua 1:9", topic: "Strength & Courage in Complex Projects", notes: "Prayer for stamina during late shifts" },
        { scripture: "Galatians 6:9", topic: "Perseverance and Doing Good", notes: "Special prayer for team well-being" },
        { scripture: "Psalm 23:1-3", topic: "Rest, Renewal, and Quiet Waters", notes: "Closing prayer for families and loved ones" }
      ];

      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const dateStr = `${y}-${m}-${day}`;

        const sample = sampleTopics[i % sampleTopics.length];
        const isJoemarie = i % 2 === 0;

        await addDoc(collection(db, "devotion_schedules"), {
          date: dateStr,
          devotionLeaderName: isJoemarie ? "Joemarie G. Pangan" : "Gideon Balboa",
          prayerLeaderName: isJoemarie ? "Gideon Balboa" : "Joemarie G. Pangan",
          topic: sample.topic,
          scripture: sample.scripture,
          notes: sample.notes,
          isAbsent: false,
          isPrayerAbsent: false,
          updatedAt: new Date().toISOString(),
          updatedBy: "System Setup"
        });
      }
      console.log("Seeded initial devotion & prayer schedules.");
    }
  } catch (error) {
    console.error("Error seeding initial data:", error);
  }
}


export async function recomputeAllAttendance(settings: any) {
  const { collection, getDocs, updateDoc, doc, db } = await import("./firebase");
  try {
    const snap = await getDocs(collection(db, "attendance"));
    const batchUpdates = [];
    snap.forEach(d => {
      const att = { id: d.id, ...d.data() } as any;
      const isLeave = att.status === "Paid Leave" || att.status === "Birthday Leave" || (typeof att.status === "string" && att.status.toLowerCase().includes("leave")) || att.status === "Absent";
      if (isLeave) {
        if ((att.lateMinutes && att.lateMinutes > 0) || !att.isLateExcused) {
          batchUpdates.push(updateDoc(doc(db, "attendance", att.id), {
            lateMinutes: 0,
            isLateExcused: true
          }));
        }
        return;
      }
      if (att.timeIn && att.timeOut) {
         const schedTimes = getScheduleTimesForLog(att, null, settings);
         const math = calculateAttendanceHours(
            att.timeIn, att.breakStart || schedTimes.breakStart, att.breakEnd || schedTimes.breakEnd, att.timeOut,
            schedTimes.shiftStart,
            schedTimes.shiftEnd,
            settings?.dstOffset || 0,
            att.accumulatedBreakSeconds || 0,
            att.currentBreakStart || null,
            att.earlyInApproved || false,
            settings?.gracePeriodMinutes || 0,
            att.isLateExcused || false,
            att.approvedEarlyTime,
            8,
            att.status
         );
         if (Math.abs(math.hoursWorked - (att.hoursWorked || 0)) > 0.01 || Math.abs(math.otHours - (att.otHours || 0)) > 0.01 || (math.computedBreakStart && !att.breakStart)) {
            console.log(`Fixing attendance for ${att.employeeName} on ${att.date}: ${att.hoursWorked} -> ${math.hoursWorked}`);
            const updates: any = {
               hoursWorked: math.hoursWorked,
               otHours: math.otHours,
               lateMinutes: math.lateMinutes
            };
            if (math.computedBreakStart && !att.breakStart) {
               updates.breakStart = math.computedBreakStart;
               updates.breakEnd = math.computedBreakEnd;
            }
            batchUpdates.push(updateDoc(doc(db, "attendance", att.id), updates));
         }
      }
    });
    if (batchUpdates.length > 0) {
      await Promise.all(batchUpdates);
      console.log(`Fixed ${batchUpdates.length} attendance records.`);
    }
  } catch (error) {
    console.error("Error recomputing attendance:", error);
  }
}

export function getManilaDate(dateObj: Date = new Date()): Date {
  const manilaDateStr = dateObj.toLocaleString("en-US", { timeZone: "Asia/Manila" });
  return new Date(manilaDateStr);
}

export function getManilaTimeString(dateObj: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(dateObj);
}

export function getManilaDateString(dateObj: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(dateObj);
}

export function getBusinessDate(dateObj: Date = new Date()): string {
  const m = getManilaDate(dateObj);
  // For the standard 22:00-07:00 (or 21:00-06:00) night shift:
  // Any time before 12:00 PM (noon) in Asia/Manila belongs to the previous calendar day's business cycle.
  if (m.getHours() < 12) {
    m.setDate(m.getDate() - 1);
  }
  return [
    m.getFullYear(),
    String(m.getMonth() + 1).padStart(2, '0'),
    String(m.getDate()).padStart(2, '0')
  ].join('-');
}

export const DAYS_OF_WEEK: { key: DayOfWeek; label: string; short: string }[] = [
  { key: "monday", label: "Monday", short: "Mon" },
  { key: "tuesday", label: "Tuesday", short: "Tue" },
  { key: "wednesday", label: "Wednesday", short: "Wed" },
  { key: "thursday", label: "Thursday", short: "Thu" },
  { key: "friday", label: "Friday", short: "Fri" },
  { key: "saturday", label: "Saturday", short: "Sat" },
  { key: "sunday", label: "Sunday", short: "Sun" },
];

export function getDayOfWeekKey(dateInput: string | Date = new Date()): DayOfWeek {
  let d: Date;
  if (typeof dateInput === "string") {
    if (dateInput.includes("T")) {
      d = new Date(dateInput);
    } else {
      const parts = dateInput.split("-").map(Number);
      if (parts.length === 3) {
        d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
      } else {
        d = new Date(dateInput);
      }
    }
  } else {
    d = dateInput;
  }
  const dayNum = d.getDay();
  const map: Record<number, DayOfWeek> = {
    0: "sunday",
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
    6: "saturday",
  };
  return map[dayNum] || "monday";
}

export function createDefaultWeeklySchedule(
  baseStart = "21:00",
  baseEnd = "06:00",
  baseRequired = 8,
  breakDuration = 60
): WeeklySchedule {
  return {
    monday: { day: "monday", workHourStart: baseStart, workHourEnd: baseEnd, requiredHours: baseRequired, breakDurationMinutes: breakDuration, isRestDay: false, notes: "Regular Shift" },
    tuesday: { day: "tuesday", workHourStart: baseStart, workHourEnd: baseEnd, requiredHours: baseRequired, breakDurationMinutes: breakDuration, isRestDay: false, notes: "Regular Shift" },
    wednesday: { day: "wednesday", workHourStart: baseStart, workHourEnd: baseEnd, requiredHours: baseRequired, breakDurationMinutes: breakDuration, isRestDay: false, notes: "Regular Shift" },
    thursday: { day: "thursday", workHourStart: baseStart, workHourEnd: baseEnd, requiredHours: baseRequired, breakDurationMinutes: breakDuration, isRestDay: false, notes: "Regular Shift" },
    friday: { day: "friday", workHourStart: baseStart, workHourEnd: baseEnd, requiredHours: baseRequired, breakDurationMinutes: breakDuration, isRestDay: false, notes: "Regular Shift" },
    saturday: { day: "saturday", workHourStart: baseStart, workHourEnd: baseEnd, requiredHours: baseRequired, breakDurationMinutes: breakDuration, isRestDay: false, notes: "Regular Shift" },
    sunday: { day: "sunday", workHourStart: baseStart, workHourEnd: baseEnd, requiredHours: baseRequired, breakDurationMinutes: breakDuration, isRestDay: true, notes: "Rest Day" },
  };
}

export function getEmployeeSchedule(
  emp?: Employee | null,
  settings?: any | null,
  targetDate?: string | Date
): EffectiveSchedule {
  // Determine target date string (YYYY-MM-DD)
  let dateStr: string;
  if (!targetDate) {
    dateStr = getBusinessDate(new Date());
  } else if (typeof targetDate === "string") {
    dateStr = targetDate.includes("T") ? targetDate.split("T")[0] : targetDate;
  } else {
    dateStr = getBusinessDate(targetDate);
  }

  const dayOfWeek = getDayOfWeekKey(dateStr);
  
  // Date-aware Daylight Saving Time seasonal shift resolution:
  // - Effective Nov 1, 2026 onwards: Standard winter shift is 10:00 PM – 7:00 AM (22:00 – 07:00).
  // - Pre-Nov 1, 2026: Standard summer shift was 9:00 PM – 6:00 AM (21:00 – 06:00).
  const isWinterDST = dateStr >= "2026-11-01";
  const defaultSeasonalStart = isWinterDST ? "22:00" : "21:00";
  const defaultSeasonalEnd = isWinterDST ? "07:00" : "06:00";

  const companyStart = settings?.workHourStart || defaultSeasonalStart;
  const companyEnd = settings?.workHourEnd || defaultSeasonalEnd;

  // PRIORITY 1: Current-Day Shift Change (Override)
  if (emp?.scheduleOverride && emp.scheduleOverride.date === dateStr) {
    const ov = emp.scheduleOverride;
    const workHourStart = ov.workHourStart || companyStart;
    const workHourEnd = ov.workHourEnd || companyEnd;
    const requiredHours = ov.requiredHours !== undefined ? ov.requiredHours : 8;
    const breakDurationMinutes = ov.breakDurationMinutes !== undefined ? ov.breakDurationMinutes : 60;
    const isRestDay = !!ov.isRestDay;
    const label = isRestDay
      ? "Rest Day (Override)"
      : `${formatTo12Hour(workHourStart)} – ${formatTo12Hour(workHourEnd)}`;
    return {
      workHourStart,
      workHourEnd,
      requiredHours,
      breakDurationMinutes,
      isRestDay,
      isCustom: true,
      isOverride: true,
      source: "override",
      label,
      notes: ov.notes || ov.reason || "Current-Day Shift Override",
      date: dateStr,
      dayOfWeek,
    };
  }

  // PRIORITY 2: Weekly Work Schedule for that day
  if (emp?.weeklySchedule && emp.weeklySchedule[dayOfWeek]) {
    const daySched = emp.weeklySchedule[dayOfWeek]!;
    let workHourStart = daySched.workHourStart || companyStart;
    let workHourEnd = daySched.workHourEnd || companyEnd;

    // Automatic daylight saving shift transition for regular night-shift employees:
    // If weekly schedule was configured as 21:00-06:00, but target date is Nov 1 onwards, use 22:00-07:00
    if (isWinterDST && workHourStart === "21:00" && workHourEnd === "06:00") {
      workHourStart = "22:00";
      workHourEnd = "07:00";
    } else if (!isWinterDST && workHourStart === "22:00" && workHourEnd === "07:00") {
      workHourStart = "21:00";
      workHourEnd = "06:00";
    }

    const requiredHours = daySched.requiredHours !== undefined ? daySched.requiredHours : 8;
    const breakDurationMinutes = daySched.breakDurationMinutes !== undefined ? daySched.breakDurationMinutes : 60;
    const isRestDay = !!daySched.isRestDay;
    const dayNameCapitalized = dayOfWeek ? dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1) : "";
    const label = isRestDay
      ? `${dayNameCapitalized}: Rest Day`
      : `${formatTo12Hour(workHourStart)} – ${formatTo12Hour(workHourEnd)}`;
    return {
      workHourStart,
      workHourEnd,
      requiredHours,
      breakDurationMinutes,
      isRestDay,
      isCustom: true,
      isOverride: false,
      source: "weekly",
      label,
      notes: daySched.notes || `${dayNameCapitalized} Schedule`,
      date: dateStr,
      dayOfWeek,
    };
  }

  // PRIORITY 3: Legacy custom schedule configured on employee
  const isLegacyCustom =
    emp?.scheduleType === "custom" ||
    (!!emp?.workHourStart &&
      !!emp?.workHourEnd &&
      (emp.workHourStart !== companyStart || emp.workHourEnd !== companyEnd));

  if (isLegacyCustom && emp?.workHourStart && emp?.workHourEnd) {
    let workHourStart = emp.workHourStart;
    let workHourEnd = emp.workHourEnd;

    if (isWinterDST && workHourStart === "21:00" && workHourEnd === "06:00") {
      workHourStart = "22:00";
      workHourEnd = "07:00";
    } else if (!isWinterDST && workHourStart === "22:00" && workHourEnd === "07:00") {
      workHourStart = "21:00";
      workHourEnd = "06:00";
    }

    const requiredHours = emp.requiredHours !== undefined ? emp.requiredHours : 8;
    const label = `${formatTo12Hour(workHourStart)} – ${formatTo12Hour(workHourEnd)}`;
    return {
      workHourStart,
      workHourEnd,
      requiredHours,
      breakDurationMinutes: 60,
      isRestDay: false,
      isCustom: true,
      isOverride: false,
      source: "custom",
      label,
      notes: emp.scheduleNotes || "Custom Shift",
      date: dateStr,
      dayOfWeek,
    };
  }

  // PRIORITY 4: Company Default Schedule
  const effectiveCompanyStart = isWinterDST && companyStart === "21:00" ? "22:00" : (!isWinterDST && companyStart === "22:00" ? "21:00" : companyStart);
  const effectiveCompanyEnd = isWinterDST && companyEnd === "06:00" ? "07:00" : (!isWinterDST && companyEnd === "07:00" ? "06:00" : companyEnd);
  const label = `${formatTo12Hour(effectiveCompanyStart)} – ${formatTo12Hour(effectiveCompanyEnd)}`;
  return {
    workHourStart: effectiveCompanyStart,
    workHourEnd: effectiveCompanyEnd,
    requiredHours: 8,
    breakDurationMinutes: 60,
    isRestDay: false,
    isCustom: false,
    isOverride: false,
    source: "default",
    label,
    notes: isWinterDST ? "Company Default (Nov 1 DST Shift: 10PM–7AM)" : "Company Default",
    date: dateStr,
    dayOfWeek,
  };
}

export function getScheduleTimesForLog(
  log: { date?: string; shiftStart?: string | null; shiftEnd?: string | null; breakStart?: string | null; breakEnd?: string | null },
  emp?: Employee | null,
  settings?: any
): { shiftStart: string; shiftEnd: string; breakStart: string; breakEnd: string } {
  const dateStr = log?.date || "";
  const isWinter = dateStr >= "2026-11-01";
  const defaultSeasonalStart = isWinter ? "22:00" : "21:00";
  const defaultSeasonalEnd = isWinter ? "07:00" : "06:00";
  const defaultBreakStart = isWinter ? "03:00" : "02:00";
  const defaultBreakEnd = isWinter ? "04:00" : "03:00";

  let shiftStart = log?.shiftStart;
  let shiftEnd = log?.shiftEnd;

  if (!shiftStart || !shiftEnd) {
    if (emp) {
      const sched = getEmployeeSchedule(emp, settings, dateStr);
      shiftStart = shiftStart || sched.workHourStart;
      shiftEnd = shiftEnd || sched.workHourEnd;
    }
  }

  return {
    shiftStart: shiftStart || defaultSeasonalStart,
    shiftEnd: shiftEnd || defaultSeasonalEnd,
    breakStart: log?.breakStart || defaultBreakStart,
    breakEnd: log?.breakEnd || defaultBreakEnd
  };
}

export interface EffectiveEmployeeRate {
  salary: number;
  dailyRate: number;
  allowance: number;
  otRate: number;
  effectiveDate?: string;
  reason?: string;
  isHistorical: boolean;
  rateRecord?: SalaryRateRecord;
}

/**
 * Calculates rate increase amount and percentage
 */
export function calculateSalaryIncrease(newSalary: number, previousSalary: number): {
  increaseAmount: number;
  increasePercentage: number;
} {
  const increaseAmount = Math.max(0, newSalary - previousSalary);
  const increasePercentage = previousSalary > 0 
    ? parseFloat((((newSalary - previousSalary) / previousSalary) * 100).toFixed(2)) 
    : 0;
  return { increaseAmount, increasePercentage };
}

/**
 * Resolves the precise employee salary, daily rate, allowance, and OT rate active
 * for any given date or cutoff period, honoring historical salary transitions so that
 * prior cutoffs and past 13th month computations are NEVER retroactively altered.
 */
export function getEmployeeRateForDate(
  emp: Employee,
  targetDate: string
): EffectiveEmployeeRate {
  const currentSalary = emp.salary || 0;
  const currentDailyRate = emp.dailyRate || (currentSalary > 0 ? parseFloat((currentSalary / 22).toFixed(2)) : 0);
  const currentAllowance = emp.allowance || 0;
  const currentOtRate = emp.otRate || (currentDailyRate > 0 ? parseFloat((currentDailyRate / 8).toFixed(2)) : 0);

  const fallback: EffectiveEmployeeRate = {
    salary: currentSalary,
    dailyRate: currentDailyRate,
    allowance: currentAllowance,
    otRate: currentOtRate,
    isHistorical: false
  };

  if (!emp.salaryHistory || emp.salaryHistory.length === 0) {
    return fallback;
  }

  // Normalize targetDate to YYYY-MM-DD
  let dateCompare = targetDate;
  if (/^\d{4}-\d{2}$/.test(targetDate)) {
    dateCompare = `${targetDate}-01`;
  }

  // Sort history ascending by effectiveDate
  const sorted = [...emp.salaryHistory].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  // Find the latest record where effectiveDate <= dateCompare
  let activeRecord: SalaryRateRecord | null = null;
  for (const rec of sorted) {
    if (rec.effectiveDate <= dateCompare) {
      activeRecord = rec;
    } else {
      break;
    }
  }

  if (activeRecord) {
    const s = activeRecord.salary || 0;
    const d = activeRecord.dailyRate || (s > 0 ? parseFloat((s / 22).toFixed(2)) : currentDailyRate);
    const a = activeRecord.allowance !== undefined ? activeRecord.allowance : currentAllowance;
    const ot = activeRecord.otRate !== undefined ? activeRecord.otRate : parseFloat((d / 8).toFixed(2));
    return {
      salary: s,
      dailyRate: d,
      allowance: a,
      otRate: ot,
      effectiveDate: activeRecord.effectiveDate,
      reason: activeRecord.reason,
      isHistorical: true,
      rateRecord: activeRecord
    };
  }

  // If dateCompare is strictly before all entries in salaryHistory:
  // Check if earliest entry documented a previousSalary
  const earliest = sorted[0];
  if (earliest && earliest.previousSalary !== undefined && earliest.previousSalary > 0) {
    const prevSalary = earliest.previousSalary;
    const prevDaily = parseFloat((prevSalary / 22).toFixed(2));
    const prevOt = parseFloat((prevDaily / 8).toFixed(2));
    return {
      salary: prevSalary,
      dailyRate: prevDaily,
      allowance: currentAllowance,
      otRate: prevOt,
      effectiveDate: `Before ${earliest.effectiveDate}`,
      reason: `Prior to ${earliest.reason || earliest.effectiveDate}`,
      isHistorical: true
    };
  }

  // If earlier than all entries, use the earliest historical entry
  if (earliest) {
    return {
      salary: earliest.salary,
      dailyRate: earliest.dailyRate,
      allowance: earliest.allowance ?? currentAllowance,
      otRate: earliest.otRate ?? currentOtRate,
      effectiveDate: earliest.effectiveDate,
      reason: earliest.reason,
      isHistorical: true,
      rateRecord: earliest
    };
  }

  return fallback;
}

/**
 * Computes hours worked between 10:00 PM (22:00) and 6:00 AM (06:00)
 * pursuant to Article 86 of the Labor Code of the Philippines (Night Shift Differential).
 *
 * @param log Attendance record containing timeIn, timeOut, breakStart, breakEnd, or fallback to scheduled hours
 * @param defaultShiftStart e.g. "21:00"
 * @param defaultShiftEnd e.g. "06:00"
 * @param defaultBreakStart e.g. "02:00"
 * @param defaultBreakEnd e.g. "03:00"
 * @returns Night differential hours worked (capped at log.hoursWorked)
 */
/**
 * Determines whether an attendance log or schedule qualifies as a company night shift.
 * Qualifying shifts include standard overnight operations such as:
 * - 9:00 PM – 6:00 AM (21:00 – 06:00)
 * - 10:00 PM – 7:00 AM (22:00 – 07:00)
 * - 11:00 PM – 8:00 AM (23:00 – 08:00)
 * - 12:00 AM – 9:00 AM (00:00 – 09:00)
 * Or any shift whose scheduled or actual start is between 19:00 (7:00 PM) and 02:00 (2:00 AM),
 * or crosses midnight into morning (05:00 - 10:00).
 */
export function isQualifyingNightShift(
  shiftStart?: string | null,
  shiftEnd?: string | null,
  timeIn?: string | null
): boolean {
  const parseMin = (tStr?: string | null): number | null => {
    if (!tStr || typeof tStr !== "string" || !tStr.trim()) return null;
    const cleanStr = tStr.trim();
    const isPM = /pm/i.test(cleanStr);
    const isAM = /am/i.test(cleanStr);
    const parts = cleanStr.replace(/[^\d:]/g, "").split(":").map(Number);
    let h = parts[0] || 0;
    const m = parts[1] || 0;
    if (h === 24) h = 0;
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    return h * 60 + m;
  };

  const startMins = parseMin(shiftStart) ?? parseMin(timeIn);
  const endMins = parseMin(shiftEnd);

  if (startMins !== null) {
    // Starts at or after 19:00 (7:00 PM) or at or before 02:00 (2:00 AM)
    if (startMins >= 1140 || startMins <= 120) return true;
  }

  // Crosses midnight: start in evening/night, end in morning
  if (startMins !== null && endMins !== null) {
    if (endMins <= startMins) return true;
  }

  return false;
}

/**
 * Calculates Company Night-Shift Policy credit hours.
 * The company policy credits up to 8 night-shift hours for a completed qualifying full shift,
 * regardless of the employee's shift start time (e.g., 9pm-6am, 10pm-7am, 11pm-8am, 12am-9am).
 *
 * For incomplete shifts, calculates the credit proportionally to actual paid regular working hours.
 * Does not award 8 hours when an employee has worked fewer hours.
 * Overtime hours beyond 8 are counted as overtime, not regular shift credit.
 */
export function calculateCompanyNightShiftHours(
  log: Partial<Attendance>,
  defaultShiftStart: string = "21:00",
  defaultShiftEnd: string = "06:00"
): number {
  if (log.status === "Absent") return 0;
  const hoursWorked = log.hoursWorked || 0;
  if (hoursWorked <= 0) return 0;

  const sStart = log.shiftStart || defaultShiftStart;
  const sEnd = log.shiftEnd || defaultShiftEnd;

  if (!isQualifyingNightShift(sStart, sEnd, log.timeIn)) {
    return 0;
  }

  // Under company policy, actual paid regular working hours (up to 8.0) on qualifying night shifts
  // are credited as company night shift credit hours:
  // - Completed full shift (8 paid hours worked) = 8.0 hours credit
  // - Incomplete shift (e.g. 7 paid hours worked, like 11pm-7am) = 7.0 hours credit
  // - Overtime shifts (e.g. 9 or 10 paid hours worked) = 8.0 regular hours credit (extra 1-2 hours are OT)
  return parseFloat(Math.min(8.0, hoursWorked).toFixed(2));
}

/**
 * Computes hours worked strictly between 10:00 PM (22:00) and 6:00 AM (06:00)
 * pursuant to Article 86 of the Labor Code of the Philippines (Statutory Night Shift Differential).
 */
export function calculateNightDifferentialHours(
  log: Partial<Attendance>,
  defaultShiftStart: string = "21:00",
  defaultShiftEnd: string = "06:00",
  defaultBreakStart: string = "02:00",
  defaultBreakEnd: string = "03:00"
): number {
  if (log.status === "Absent") return 0;
  const hoursWorked = log.hoursWorked || 0;
  if (hoursWorked <= 0) return 0;

  const parseMinutes = (tStr?: string | null): number | null => {
    if (!tStr || typeof tStr !== "string" || !tStr.trim()) return null;
    const cleanStr = tStr.trim();
    const isPM = /pm/i.test(cleanStr);
    const isAM = /am/i.test(cleanStr);
    const timeOnly = cleanStr.replace(/[^\d:]/g, "");
    if (!timeOnly || !timeOnly.includes(":")) return null;
    const parts = timeOnly.split(":").map(Number);
    let h = parts[0] || 0;
    const m = parts[1] || 0;
    if (h === 24) h = 0; // Normalize 24:00 to 00:00 (midnight)
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    return h * 60 + m;
  };

  // Resolve start and end times, falling back to schedule or defaults
  let inMins = parseMinutes(log.timeIn) ?? parseMinutes(log.shiftStart || defaultShiftStart) ?? 1260;
  let outMins = parseMinutes(log.timeOut) ?? parseMinutes(log.shiftEnd || defaultShiftEnd) ?? 360;

  // Handle shift timeline crossing midnight (e.g. 21:00 to 06:00, 22:00 to 07:00, 23:00 to 08:00)
  if (outMins <= inMins) {
    outMins += 1440; // crosses midnight into next day
  }

  // Determine meal break interval
  let bStart = parseMinutes(log.breakStart);
  let bEnd = parseMinutes(log.breakEnd);

  if (bStart === null || bEnd === null) {
    // If accumulatedBreakSeconds is explicitly 0 and employee worked uninterrupted, no break was taken
    if (log.accumulatedBreakSeconds === 0 && log.breakStart === null) {
      bStart = null;
      bEnd = null;
    } else {
      // Position default meal break: 5 hours in for evening/night shifts (or fallback defaultBreakStart)
      const shiftOffset = inMins >= 720 ? 5 : 4;
      const autoBreakMins = (inMins + shiftOffset * 60);
      bStart = parseMinutes(defaultBreakStart) !== null ? parseMinutes(defaultBreakStart)! : (autoBreakMins % 1440);
      bEnd = parseMinutes(defaultBreakEnd) !== null ? parseMinutes(defaultBreakEnd)! : ((bStart + 60) % 1440);
    }
  }

  if (bStart !== null && bEnd !== null) {
    if (bEnd <= bStart) bEnd += 1440;
    // Align break with shift window if shift crosses midnight
    if (bStart < inMins && outMins > 1440 && (bStart + 1440) <= outMins) {
      bStart += 1440;
      bEnd += 1440;
    }
  }

  let nightMinutes = 0;
  // Step through each minute of the worked shift
  for (let m = inMins; m < outMins; m++) {
    // Check if minute falls within break interval
    if (bStart !== null && bEnd !== null && m >= bStart && m < bEnd) {
      continue;
    }
    // Time of day in 24-hour cycle (0 to 1439)
    const tod = m % 1440;
    // Philippine Labor Code Article 86: 10:00 PM (1320 mins) to 6:00 AM (360 mins)
    if (tod >= 1320 || tod < 360) {
      nightMinutes++;
    }
  }

  const rawNightHours = Math.round((nightMinutes / 60) * 100) / 100;
  // Statutory rule: Night differential cannot exceed actual hours worked for the shift
  return Math.min(rawNightHours, hoursWorked);
}

/**
 * Calculates Statutory Night Shift Differential hours strictly pursuant to Article 86
 * of the Labor Code of the Philippines (work performed between 10:00 PM and 6:00 AM, net of breaks).
 */
export function calculateStatutoryNightDiffHours(
  log: Partial<Attendance>,
  defaultShiftStart: string = "21:00",
  defaultShiftEnd: string = "06:00",
  defaultBreakStart: string = "02:00",
  defaultBreakEnd: string = "03:00"
): number {
  return calculateNightDifferentialHours(
    log,
    defaultShiftStart,
    defaultShiftEnd,
    defaultBreakStart,
    defaultBreakEnd
  );
}

/**
 * Resolves both Company Night-Shift Credit and Statutory Night Shift Differential hours
 * according to the designated payroll cutoff policy.
 */
export function calculateEffectiveNightDiffHours(
  log: Partial<Attendance>,
  policy: "company_full_shift" | "statutory_only" = "company_full_shift",
  defaultShiftStart: string = "21:00",
  defaultShiftEnd: string = "06:00",
  defaultBreakStart: string = "02:00",
  defaultBreakEnd: string = "03:00"
): {
  effectiveHours: number;
  companyNightShiftHours: number;
  statutoryNightDiffHours: number;
} {
  const companyHours = calculateCompanyNightShiftHours(log, defaultShiftStart, defaultShiftEnd);
  const statutoryHours = calculateStatutoryNightDiffHours(log, defaultShiftStart, defaultShiftEnd, defaultBreakStart, defaultBreakEnd);

  const effectiveHours = policy === "statutory_only" ? statutoryHours : companyHours;

  return {
    effectiveHours,
    companyNightShiftHours: companyHours,
    statutoryNightDiffHours: statutoryHours
  };
}

