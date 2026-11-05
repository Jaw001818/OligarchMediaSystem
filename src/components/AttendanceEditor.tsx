import React, { useState } from "react";
import { db, handleFirestoreError, OperationType, collection, addDoc, doc, updateDoc, setDoc, deleteDoc } from "../firebase";
import { Employee, Attendance, PayrollPeriod } from "../types";
import { calculateAttendanceHours, formatTo12Hour , getBusinessDate, getEmployeeSchedule, getScheduleTimesForLog } from "../utils";
import AttendanceStatusBadges from "./AttendanceStatusBadges";
import { 
  PlusCircle, 
  Search, 
  Clock, 
  X, 
  AlertCircle,
  FileDown,
  Navigation,
  CheckCircle,
  Trash2,
  Edit2,
  Save,
  Compass,
  Wifi,
  MapPin,
  RefreshCw,
  Award,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { jsPDF } from "jspdf";

const formatDateHeader = (dateStr: string) => {
  if (!dateStr) return "Unknown Date";
  try {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const dateObj = new Date(year, month, day);
      if (!isNaN(dateObj.getTime())) {
        return dateObj.toLocaleDateString("en-US", {
          weekday: "short",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      }
    }
  } catch (err) {}
  return dateStr;
};

const parseTo24Hour = (timeStr: string | null | undefined): string | null => {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const clean = timeStr.trim();
  if (!clean || clean === "—" || clean === "--" || clean === "null" || clean === "undefined") return null;

  const isPM = /pm/i.test(clean);
  const isAM = /am/i.test(clean);

  // Extract numeric parts and colons
  const numPart = clean.replace(/[^\d:]/g, "");
  const parts = numPart.split(":");
  if (parts.length < 2) return null;

  let h = parseInt(parts[0], 10);
  if (isNaN(h)) return null;
  const m = (parts[1] || "00").padStart(2, "0");
  const s = parts[2] ? parts[2].padStart(2, "0") : "00";

  if (isPM && h < 12) {
    h += 12;
  } else if (isAM && h === 12) {
    h = 0;
  }

  const hStr = String(h).padStart(2, "0");
  return `${hStr}:${m}:${s}`;
};

const formatTimeForDB = (timeStr: string | null | undefined): string | null => {
  return parseTo24Hour(timeStr);
};

const parseToTimeInput = (timeStr: string | null | undefined): string => {
  const full = parseTo24Hour(timeStr);
  if (!full) return "";
  return full.substring(0, 5); // returns "HH:mm" for HTML time inputs
};

const getPayPeriodDates = (period: "first" | "second" | "all") => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  
  if (period === "first") {
    return {
      start: `${year}-${month}-01`,
      end: `${year}-${month}-15`
    };
  } else if (period === "second") {
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    return {
      start: `${year}-${month}-16`,
      end: `${year}-${month}-${lastDay}`
    };
  }
  return { start: "", end: "" };
};

const formatDesignerNameForPDF = (name: string, num: string) => {
  const codePart = ` (${num})`;
  const availableLength = 24; // max chars for name to prevent overlap with standard text sizing
  let truncatedName = name;
  if (name.length > availableLength) {
    truncatedName = name.substring(0, availableLength - 3) + "...";
  }
  return `${truncatedName}${codePart}`;
};

interface AttendanceEditorProps {
  employees: Employee[];
  attendance: Attendance[];
  onRefresh: () => void;
  workHourStart: string;
  workHourEnd: string;
  dstOffset?: number;
  gracePeriodMinutes?: number;
  periods?: PayrollPeriod[];
}

export default function AttendanceEditor({
  employees,
  attendance,
  onRefresh,
  workHourStart,
  workHourEnd,
  dstOffset = 0,
  gracePeriodMinutes = 0,
  periods = []
}: AttendanceEditorProps) {
  // Advanced Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortDate, setSortDate] = useState("Newest");

  // Export / Print filters
  const [exportEmployeeId, setExportEmployeeId] = useState("All");
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, sortDate, exportEmployeeId, exportStartDate, exportEndDate]);

  // Manual Shift Log Form States
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [employeeFilterText, setEmployeeFilterText] = useState("");
  const [isEmployeeDropdownOpen, setIsEmployeeDropdownOpen] = useState(false);
  const [newDate, setNewDate] = useState(() => getBusinessDate());
  const [newTimeIn, setNewTimeIn] = useState("22:00");
  const [newTimeOut, setNewTimeOut] = useState("07:00");
  const [newBreakStart, setNewBreakStart] = useState("03:00");
  const [newBreakEnd, setNewBreakEnd] = useState("04:00");
  const [newStatus, setNewStatus] = useState<Attendance["status"]>("Present");
  const [newOtHours, setNewOtHours] = useState("0.00");
  const [newHoursWorked, setNewHoursWorked] = useState("8.00");
  const [newEarlyInApproved, setNewEarlyInApproved] = useState(false);
  const [addError, setAddError] = useState("");
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);

  // Editing Mode States
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editTimeIn, setEditTimeIn] = useState("");
  const [editBreakStart, setEditBreakStart] = useState("");
  const [editBreakEnd, setEditBreakEnd] = useState("");
  const [editTimeOut, setEditTimeOut] = useState("");
  const [editStatus, setEditStatus] = useState<Attendance["status"]>("Present");
  const [editHoursWorked, setEditHoursWorked] = useState("");
  const [editOtHours, setEditOtHours] = useState("");
  const [editLateMinutes, setEditLateMinutes] = useState("");
  const [editEarlyInApproved, setEditEarlyInApproved] = useState(false);
  const [editLateExcused, setEditLateExcused] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Custom Confirmation Dialog State (Bypasses iframe sandbox dialog blocks)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // General Notification Alert
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const selectedNewEmployee = employees.find(emp => emp.id === newEmployeeId);

  // Filter and sort core logs
  const filteredAttendance = attendance.filter(log => {
    // Search across name, employee code or date formatted string
    const matchQuery = searchTerm === "" || 
      log.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) || 
      log.employeeNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.date.includes(searchTerm);

    const matchStatus = statusFilter === "All" || log.status === statusFilter;

    // Exporter Filters
    const exportEmp = exportEmployeeId !== "All" ? employees.find(e => e.id === exportEmployeeId) : null;
    const matchEmployee = exportEmployeeId === "All" || 
      log.employeeId === exportEmployeeId || 
      (exportEmp && (
        log.employeeNumber === exportEmp.employeeNumber || 
        log.employeeId === exportEmp.employeeNumber || 
        log.employeeName?.toLowerCase() === exportEmp.fullName?.toLowerCase()
      ));
    const matchStartDate = !exportStartDate || log.date >= exportStartDate;
    const matchEndDate = !exportEndDate || log.date <= exportEndDate;

    return matchQuery && matchStatus && matchEmployee && matchStartDate && matchEndDate;
  }).sort((a, b) => {
    const dateA = a.date || "";
    const dateB = b.date || "";
    if (dateA !== dateB) {
      return sortDate === "Newest" ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
    }
    const tA = (a.timeIn || "00:00:00").trim();
    const tB = (b.timeIn || "00:00:00").trim();
    return sortDate === "Newest" ? tB.localeCompare(tA) : tA.localeCompare(tB);
  });

  const totalItems = filteredAttendance.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  const pageAttendance = filteredAttendance.slice(startIndex, endIndex);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Auto calculated duration helper
    const handleAutoRecompute = (
    inTimeStr: string,
    outTimeStr: string,
    bStartStr: string,
    bEndStr: string,
    type: "add" | "edit",
    overrideEarlyIn?: boolean,
    overrideLateExcused?: boolean
  ) => {
    const timeInFormatted = formatTimeForDB(inTimeStr);
    const timeOutFormatted = formatTimeForDB(outTimeStr);
    const breakStartFormatted = formatTimeForDB(bStartStr);
    const breakEndFormatted = formatTimeForDB(bEndStr);
    let currentShiftStart = workHourStart;
    let currentShiftEnd = workHourEnd;
    let currentRequiredHours = 8;
    
    // In edit mode we want to use the currently editing log's properties if possible
    let earlyInApprv = false;
    let lateExcused = false;
    let apprvEarlyTime = undefined;
    let accumBreak = 0;
    
    if (type === "edit" && editingLogId) {
       const log = attendance.find(a => a.id === editingLogId);
       if (log) {
          const emp = employees.find(e => (log.employeeId && e.id === log.employeeId) || (log.employeeNumber && e.employeeNumber === log.employeeNumber));
          const schedTimes = getScheduleTimesForLog(log, emp, { workHourStart, workHourEnd });
          currentShiftStart = schedTimes.shiftStart;
          currentShiftEnd = schedTimes.shiftEnd;
          currentRequiredHours = log.requiredHours || (emp ? getEmployeeSchedule(emp, { workHourStart, workHourEnd }, log.date).requiredHours : 8);
          earlyInApprv = overrideEarlyIn !== undefined ? overrideEarlyIn : (log.earlyInApproved || false);
          lateExcused = overrideLateExcused !== undefined ? overrideLateExcused : (log.isLateExcused || false);
          apprvEarlyTime = log.approvedEarlyTime;
          accumBreak = log.accumulatedBreakSeconds || 0;
       }
    } else if (type === "add" && newEmployeeId) {
       const emp = employees.find(e => e.id === newEmployeeId);
       if (emp) {
          const empSched = getEmployeeSchedule(emp, { workHourStart, workHourEnd });
          currentShiftStart = empSched.workHourStart;
          currentShiftEnd = empSched.workHourEnd;
          currentRequiredHours = empSched.requiredHours;
       }
    }

    const math = calculateAttendanceHours(
      timeInFormatted,
      breakStartFormatted,
      breakEndFormatted,
      timeOutFormatted,
      currentShiftStart,
      currentShiftEnd,
      dstOffset,
      accumBreak,
      null,
      earlyInApprv,
      gracePeriodMinutes,
      lateExcused,
      apprvEarlyTime,
      currentRequiredHours
    );

    if (type === "add") {
      setNewHoursWorked(math.hoursWorked.toFixed(2));
      setNewOtHours(math.otHours.toFixed(2));
    } else {
      setEditHoursWorked(math.hoursWorked.toFixed(2));
      setEditOtHours(math.otHours.toFixed(2));
    }
  };

  const startEditing = (log: Attendance) => {
    setEditingLogId(log.id || null);
    setEditTimeIn(parseToTimeInput(log.timeIn));
    setEditBreakStart(parseToTimeInput(log.breakStart));
    setEditBreakEnd(parseToTimeInput(log.breakEnd));
    setEditTimeOut(parseToTimeInput(log.timeOut));
    setEditStatus(log.status || "Present");
    setEditHoursWorked(log.hoursWorked !== undefined && log.hoursWorked !== null ? log.hoursWorked.toString() : "0.00");
    setEditOtHours(log.otHours !== undefined && log.otHours !== null ? log.otHours.toString() : "0.00");
    setEditLateMinutes(log.lateMinutes !== undefined && log.lateMinutes !== null ? log.lateMinutes.toString() : "0");
    setEditEarlyInApproved(log.earlyInApproved || false);
    setEditLateExcused(log.isLateExcused || false);
  };

    const handleQuickPauseToggle = async (log: any) => {
    try {
      const timeStr = new Date().toTimeString().split(" ")[0];
      const docRef = doc(db, "attendance", log.id);
      if (log.status === "Present" || log.status === "Late") {
        const updateData: Record<string, any> = {
          currentBreakStart: timeStr,
          status: "On Break"
        };
        if (!log.breakStart) updateData.breakStart = timeStr;
        await updateDoc(docRef, updateData);
      } else if (log.status === "On Break") {
        const bStart = new Date(log.date + "T" + log.currentBreakStart);
        const bEnd = new Date(log.date + "T" + timeStr);
        const diffSecs = Math.max(0, Math.floor((bEnd.getTime() - bStart.getTime()) / 1000));
        const accumulated = (log.accumulatedBreakSeconds || 0) + diffSecs;
        const updateData: Record<string, any> = {
          currentBreakStart: null,
          accumulatedBreakSeconds: accumulated,
          status: (log.lateMinutes && log.lateMinutes > 0 && !log.isLateExcused) ? "Late" : "Present"
        };
        if (!log.breakEnd) updateData.breakEnd = timeStr;
        await updateDoc(docRef, updateData);
      }
      onRefresh();
    } catch (e) {
      console.error(e);
      alert("Failed to toggle break status.");
    }
  };
  const handleQuickTimeout = (log: any) => handleTimeOut(log);
  const resetAddForm = () => {
    setNewEmployeeId("");
    setNewDate(getBusinessDate());
    setNewTimeIn("09:00");
    setNewTimeOut("18:00");
    setNewBreakStart("12:00");
    setNewBreakEnd("13:00");
    setNewStatus("Present");
    setNewHoursWorked("8.00");
    setNewOtHours("0.00");
    setAddError("");
  };

  const handleCreateLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmployeeId) {
      setAddError("Please select an employee.");
      return;
    }
    const emp = employees.find(emp => emp.id === newEmployeeId);
    if (!emp) return;

    const empSched = getEmployeeSchedule(emp, { workHourStart, workHourEnd });
    const currentShiftStart = empSched.workHourStart;
    const currentShiftEnd = empSched.workHourEnd;
    const currentRequiredHours = empSched.requiredHours;

    setIsSubmittingNew(true);
    setAddError("");
    try {
      const timeInVal = formatTimeForDB(newTimeIn);
      const breakStartVal = formatTimeForDB(newBreakStart);
      const breakEndVal = formatTimeForDB(newBreakEnd);
      const timeOutVal = formatTimeForDB(newTimeOut);

      const math = calculateAttendanceHours(
        timeInVal,
        breakStartVal,
        breakEndVal,
        timeOutVal,
        currentShiftStart,
        currentShiftEnd,
        dstOffset,
        0,
        null,
        false,
        gracePeriodMinutes,
        false,
        undefined,
        currentRequiredHours
      );

      const isLeave = newStatus === "Paid Leave" || newStatus === "Birthday Leave" || (typeof newStatus === "string" && newStatus.toLowerCase().includes("leave"));
      const manualHours = newHoursWorked.trim() !== "" ? parseFloat(newHoursWorked) : NaN;
      const manualOt = newOtHours.trim() !== "" ? parseFloat(newOtHours) : NaN;

      await addDoc(collection(db, "attendance"), {
        employeeId: emp.id,
        employeeNumber: emp.employeeNumber,
        employeeName: emp.fullName,
        date: newDate,
        timeIn: isLeave ? null : timeInVal,
        breakStart: isLeave ? null : breakStartVal,
        breakEnd: isLeave ? null : breakEndVal,
        timeOut: isLeave ? null : timeOutVal,
        status: newStatus,
        hoursWorked: !isNaN(manualHours) ? manualHours : (isLeave ? (newStatus === "Absent Notice" ? 0 : 8) : math.hoursWorked),
        otHours: !isNaN(manualOt) ? manualOt : (isLeave ? 0 : math.otHours),
        lateMinutes: isLeave ? 0 : math.lateMinutes,
        isLateExcused: isLeave ? true : false,
        shiftStart: currentShiftStart,
        shiftEnd: currentShiftEnd,
        requiredHours: currentRequiredHours
      });

      try {
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Manually Created Attendance",
          details: `Created attendance for ${emp.fullName} on ${newDate}`,
          timestamp: new Date().toISOString()
        });
      } catch (logErr) {
        console.warn("Audit log notice:", logErr);
      }

      triggerToast(`Created log for ${emp.fullName}`);
      setIsAddOpen(false);
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setAddError(err?.message || "Failed to create attendance entry.");
    } finally {
      setIsSubmittingNew(false);
    }
  };

  const saveEditedLog = async (logToEdit?: Attendance) => {
    if (!editingLogId) return;
    const log = logToEdit || attendance.find(a => a.id === editingLogId);
    if (!log) return;
    
    setIsSavingEdit(true);
    try {
      const emp = employees.find(e => (log.employeeId && e.id === log.employeeId) || (log.employeeNumber && e.employeeNumber === log.employeeNumber));
      const schedTimes = getScheduleTimesForLog(log, emp, { workHourStart, workHourEnd });
      const currentShiftStart = schedTimes.shiftStart;
      const currentShiftEnd = schedTimes.shiftEnd;
      const currentRequiredHours = log.requiredHours || (emp ? getEmployeeSchedule(emp, { workHourStart, workHourEnd }, log.date).requiredHours : 8);

      const timeInVal = formatTimeForDB(editTimeIn);
      const breakStartVal = formatTimeForDB(editBreakStart);
      const breakEndVal = formatTimeForDB(editBreakEnd);
      const timeOutVal = formatTimeForDB(editTimeOut);

      const math = calculateAttendanceHours(
        timeInVal || "",
        breakStartVal,
        breakEndVal,
        timeOutVal,
        currentShiftStart,
        currentShiftEnd,
        dstOffset,
        log.accumulatedBreakSeconds || 0,
        log.currentBreakStart || null,
        editEarlyInApproved,
        gracePeriodMinutes,
        editLateExcused,
        log.approvedEarlyTime,
        currentRequiredHours,
        editStatus
      );

      const isLeave = editStatus === "Paid Leave" || editStatus === "Birthday Leave" || (typeof editStatus === "string" && editStatus.toLowerCase().includes("leave"));
      
      const manualHours = editHoursWorked.trim() !== "" ? parseFloat(editHoursWorked) : NaN;
      const manualOt = editOtHours.trim() !== "" ? parseFloat(editOtHours) : NaN;
      const manualLate = editLateMinutes.trim() !== "" ? parseInt(editLateMinutes, 10) : NaN;

      const finalHoursWorked = !isNaN(manualHours) ? manualHours : (isLeave ? (editStatus === "Absent Notice" ? 0 : 8) : math.hoursWorked);
      const finalOtHours = !isNaN(manualOt) ? manualOt : (isLeave ? 0 : math.otHours);
      const finalLateMinutes = !isNaN(manualLate) ? manualLate : (isLeave ? 0 : math.lateMinutes);

      const docRef = doc(db, "attendance", editingLogId);
      const payloadToSave: any = {
        id: editingLogId,
        date: log.date || getBusinessDate(),
        employeeId: log.employeeId || emp?.id || "",
        employeeNumber: log.employeeNumber || emp?.employeeNumber || "",
        employeeName: log.employeeName || emp?.fullName || "",
        timeIn: isLeave ? null : timeInVal,
        breakStart: isLeave ? null : breakStartVal,
        breakEnd: isLeave ? null : breakEndVal,
        timeOut: isLeave ? null : timeOutVal,
        status: editStatus,
        hoursWorked: finalHoursWorked,
        otHours: finalOtHours,
        lateMinutes: finalLateMinutes,
        isLateExcused: isLeave ? true : editLateExcused,
        earlyInApproved: editEarlyInApproved,
        shiftStart: currentShiftStart,
        shiftEnd: currentShiftEnd,
        requiredHours: currentRequiredHours,
        updatedAt: Date.now()
      };

      await setDoc(docRef, payloadToSave, { merge: true });

      try {
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Edited Attendance Log",
          details: `Edited log for ${log.employeeName || log.employeeNumber} on ${log.date}`,
          timestamp: new Date().toISOString()
        });
      } catch (logErr) {
        console.warn("Audit log notice:", logErr);
      }

      triggerToast(`Saved adjustments for ${log.employeeName || log.employeeNumber}`);
      setEditingLogId(null);
      onRefresh();
    } catch (err: any) {
      console.error("Error saving attendance log:", err);
      triggerToast("Error saving: " + (err?.message || String(err)));
      handleFirestoreError(err, OperationType.UPDATE, `attendance/${editingLogId}`);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleTimeOut = (log: Attendance) => {
    triggerConfirm(
      "Confirm Time Out",
      `Are you sure you want to mark ${log.employeeName} as Timed Out? This will calculate their cumulative hours worked and overtime for the day.`,
      async () => {
        const emp = employees.find(e => (log.employeeId && e.id === log.employeeId) || (log.employeeNumber && e.employeeNumber === log.employeeNumber));
        const schedTimes = getScheduleTimesForLog(log, emp, { workHourStart, workHourEnd });
        const currentShiftStart = schedTimes.shiftStart;
        const currentShiftEnd = schedTimes.shiftEnd;
        const currentRequiredHours = log.requiredHours || (emp ? getEmployeeSchedule(emp, { workHourStart, workHourEnd }, log.date).requiredHours : 8);

        const logoutTime = new Date().toTimeString().split(" ")[0];
        const math = calculateAttendanceHours(
          log.timeIn,
          log.breakStart,
          log.breakEnd,
          logoutTime,
          currentShiftStart,
          currentShiftEnd,
          dstOffset,
          log.accumulatedBreakSeconds || 0,
          log.currentBreakStart || null,
          log.earlyInApproved || false,
          gracePeriodMinutes,
          log.isLateExcused || false,
          log.approvedEarlyTime,
          currentRequiredHours
        );
        try {
          const docRef = doc(db, "attendance", log.id!);
          const updateData: any = {
            timeOut: logoutTime,
            hoursWorked: math.hoursWorked,
            otHours: math.otHours,
            status: "Timed Out",
            shiftStart: currentShiftStart,
            shiftEnd: currentShiftEnd,
            requiredHours: currentRequiredHours
          };
          
          if (math.computedBreakStart && !log.breakStart) {
            updateData.breakStart = math.computedBreakStart;
            updateData.breakEnd = math.computedBreakEnd;
          }
          await updateDoc(docRef, updateData);
          triggerToast(`${log.employeeName} logged out at ${logoutTime}`);
          onRefresh();
        } catch (err) {
          console.error(err);
        }
      }
    );
  };

  // Delete attendance log completely
  const deleteLog = (log: Attendance) => {
    if (!log.id) return;
    triggerConfirm(
      "Erase Attendance Record",
      `Are you absolutely sure you want to completely erase the attendance record for ${log.employeeName} on ${log.date}? This action cannot be undone and will directly modify payroll calculated totals.`,
      async () => {
        try {
          await deleteDoc(doc(db, "attendance", log.id));

          try {
            await addDoc(collection(db, "audit_logs"), {
              user: "Admin",
              action: "Erase Attendance Record",
              details: `Permanently deleted attendance log for ${log.employeeName} on ${log.date}.`,
              timestamp: new Date().toISOString()
            });
          } catch (auditErr) {
            console.warn("Failed to log deleted attendance to audit_logs", auditErr);
          }

          triggerToast(`Removed attendance entry for ${log.employeeName}`);
          onRefresh();
        } catch (err) {
          console.error(err);
          handleFirestoreError(err, OperationType.DELETE, `attendance/${log.id}`);
        }
      }
    );
  };

  // General export of current filtered registry
  const handleExportPDF = () => {
    setIsGeneratingPDF(true);
    try {
      const pdf = new jsPDF();
      const records = [...filteredAttendance].sort((a, b) => {
        const nameA = a.employeeName || "";
        const nameB = b.employeeName || "";
        const nameComparison = nameA.localeCompare(nameB);
        if (nameComparison !== 0) return nameComparison;
        return a.date.localeCompare(b.date);
      });

      const totalWorked = records.reduce((sum, r) => sum + (r.hoursWorked || 0), 0);
      const totalOvertime = records.reduce((sum, r) => sum + (r.otHours || 0), 0);

      // Header Banner (Oligarch Media corporate theme)
      pdf.setFillColor(15, 23, 42); 
      pdf.rect(0, 0, 210, 38, "F");

      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(22);
      pdf.text("OLIGARCH MEDIA", 15, 23);

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      pdf.setTextColor(14, 165, 233); // sky-500
      pdf.text("OFFICIAL PERSONNEL TIMELINE REGISTER", 15, 29);

      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text("SHIFT TIMELINE EXPORT", 152, 23);

      // Metrics metadata summary card
      pdf.setFillColor(248, 250, 252);
      pdf.setDrawColor(226, 232, 240);
      pdf.rect(15, 45, 180, 48, "FD");

      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text("OPERATIONS TIMESHEET REVIEW", 20, 52);

      pdf.setFontSize(8);
      pdf.text("Search Terms:", 20, 59);
      pdf.setFont("helvetica", "normal");
      pdf.text(searchTerm ? `"${searchTerm}"` : "None (All Registers Searched)", 45, 59);

      pdf.setFont("helvetica", "bold");
      pdf.text("Status Filter:", 20, 65);
      pdf.setFont("helvetica", "normal");
      pdf.text(statusFilter, 45, 65);

      pdf.setFont("helvetica", "bold");
      pdf.text("Generated On:", 20, 71);
      pdf.setFont("helvetica", "normal");
      pdf.text(new Date().toLocaleString(), 45, 71);

      pdf.setFont("helvetica", "bold");
      pdf.text("Studio Dept:", 20, 77);
      pdf.setFont("helvetica", "normal");
      pdf.text("Oligarch Media (All Personnel)", 45, 77);

      pdf.setFont("helvetica", "bold");
      pdf.text("Total Shift Records:", 115, 59);
      pdf.setFont("helvetica", "normal");
      pdf.text(`${records.length} logs`, 155, 59);

      pdf.setFont("helvetica", "bold");
      pdf.text("Accumulated Hours:", 115, 65);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(14, 165, 233);
      pdf.text(`${totalWorked.toFixed(2)} hrs`, 155, 65);
      pdf.setTextColor(15, 23, 42);

      pdf.setFont("helvetica", "bold");
      pdf.text("Approved Overtime:", 115, 71);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(22, 163, 74);
      pdf.text(`${totalOvertime.toFixed(2)} hrs`, 155, 71);
      pdf.setTextColor(15, 23, 42);

      // Grid Headers
      let y = 104;
      pdf.setFillColor(241, 245, 249);
      pdf.rect(15, y - 5, 180, 8, "F");

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(71, 85, 105);
      pdf.text("DATE", 18, y);
      pdf.text("EMPLOYEE NAME", 40, y);
      pdf.text("IN TIME", 88, y);
      pdf.text("OUT TIME", 112, y);
      pdf.text("STATUS", 136, y);
      pdf.text("HOURS / OVERTIME", 165, y);

      pdf.setDrawColor(226, 232, 240);
      pdf.line(15, y + 4, 195, y + 4);

      y += 10;
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(15, 23, 42);

      records.forEach((record) => {
        if (y > 275) {
          pdf.addPage();
          y = 20;
          pdf.setFillColor(241, 245, 249);
          pdf.rect(15, y - 5, 180, 8, "F");
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(71, 85, 105);
          pdf.text("DATE", 18, y);
          pdf.text("DESIGNER", 40, y);
          pdf.text("IN TIME", 88, y);
          pdf.text("OUT TIME", 112, y);
          pdf.text("STATUS STATUS", 136, y);
          pdf.text("HOURS / OVERTIME", 165, y);
          y += 10;
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(15, 23, 42);
        }

        pdf.text(record.date, 18, y);
        pdf.text(formatDesignerNameForPDF(record.employeeName, record.employeeNumber), 40, y);
        pdf.text(record.timeIn ? formatTo12Hour(record.timeIn) : "—", 88, y);
        pdf.text(record.timeOut ? formatTo12Hour(record.timeOut) : "—", 112, y);
        pdf.text(record.status, 136, y);
        pdf.text(`${record.hoursWorked.toFixed(2)} hrs (+${record.otHours.toFixed(2)} OT)`, 165, y);

        pdf.setDrawColor(241, 245, 249);
        pdf.line(15, y + 2, 195, y + 2);
        y += 8;
      });

      pdf.save(`Oligarch_Media_Shift_Timeline_${getBusinessDate()}.pdf`);
    } catch (e) {
      console.error(e);
      alert("Failed to export PDF file.");
    } finally {
      setIsGeneratingPDF(false);
    }
  };



  return (
    <div className="space-y-6 text-[#BAC2DE] w-full min-w-0">
      
      {/* Interactive Command Status Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-55 bg-[#1E1E2E] border border-sky-500/20 text-[#CDD6F4] rounded-xl py-3.5 px-5 shadow-2xl flex items-center gap-3 animate-bounce">
          <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          <p className="text-xs font-mono font-bold tracking-wide uppercase text-sky-400">COMMAND LOGGER STATUS:</p>
          <p className="text-xs font-medium">{toastMessage}</p>
        </div>
      )}

      {/* Header Banner Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#111224] p-6 rounded-2xl border border-zinc-200 dark:border-white/5 shadow-lg">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[9px] bg-sky-500/10 border border-sky-400/20 text-sky-400 font-extrabold uppercase rounded-md tracking-wider font-mono">
              DIRECTIVE CONTROL MODULE
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">ID: OM-ATT-OR</span>
          </div>
          <h2 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight mt-1">Oligarch Media Control Hub</h2>
          <p className="text-xs text-zinc-500 mt-1 max-w-xl">
            Streamlined shift adjustments interface for the Oligarch Media workforce. View active logs, add manual entries, monitor teammate coordinates, and download timesheet registers.
          </p>
        </div>
        
        {/* Status indicator widget */}
        <div className="flex bg-zinc-50 dark:bg-[#181825] p-2.5 px-4 rounded-xl border border-zinc-200 dark:border-white/5 leading-none items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-mono font-bold uppercase text-zinc-600 dark:text-zinc-400 tracking-wider">
            SHIFT ADJUSTMENT ENGINE ONLINE
          </span>
        </div>
      </div>
          {/* Timeline filter controls row */}
          <div className="space-y-4 bg-white dark:bg-[#111224]/80 p-5 rounded-2xl border border-zinc-200 dark:border-white/5">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
              {/* Search Input */}
              <div className="sm:col-span-2 relative">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  placeholder="Search logs (e.g. name, date)..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full text-xs pl-10 pr-4 py-3 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-sky-500/40 transition-colors font-semibold"
                />
              </div>

              {/* Status Selector */}
              <div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full text-xs px-3.5 py-3 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:border-sky-500/40 font-bold"
                >
                  <option value="All">All Statuses</option>
                  <option value="Present">Present</option>
                  <option value="Late">Late Arrival</option>
                  <option value="On Break">On Break</option>
                  <option value="Timed Out">Timed Out</option>
                  <option value="Absent">Absent</option>
                  <option value="Paid Leave">Paid Leave</option>
                  <option value="Birthday Leave">Birthday Leave</option>
                </select>
              </div>

              {/* Date Sorting */}
              <div>
                <select
                  value={sortDate}
                  onChange={(e) => setSortDate(e.target.value)}
                  className="w-full text-xs px-3.5 py-3 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:border-sky-500/40 font-bold"
                >
                  <option value="Newest">Sort Date: Newest</option>
                  <option value="Oldest">Sort Date: Oldest</option>
                </select>
              </div>

              {/* Action buttons exactly layout like Screenshot 2 */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(true)}
                  className="w-full px-3 py-3 bg-[#1E66F5] hover:bg-indigo-600 text-white font-bold text-[10px] tracking-wider uppercase rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-indigo-500/10"
                >
                  <PlusCircle className="w-3.5 h-3.5 shrink-0" /> Add Manual Log
                </button>
              </div>
            </div>

            {/* Custom Exporter and Target Filters nested below main search */}
            <div className="pt-4 border-t border-zinc-150 dark:border-white/5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-zinc-50 dark:bg-[#141527]/60 p-4 rounded-xl">
              {/* Target Employee Dropdown */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-mono">Individual Employee Filter</label>
                <select
                  value={exportEmployeeId}
                  onChange={(e) => setExportEmployeeId(e.target.value)}
                  className="w-full text-xs px-3.5 py-2.5 bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:border-sky-500/45 font-semibold"
                >
                  <option value="All">All Personnel (Corporate-wide)</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName} ({emp.employeeNumber})
                    </option>
                  ))}
                </select>
              </div>

              {/* Date Filters: Start Date */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-mono">Cut-off Start Date</label>
                <input
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => setExportStartDate(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:border-sky-500/45 font-semibold cursor-pointer"
                />
              </div>

              {/* Date Filters: End Date */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-mono">Cut-off End Date</label>
                <input
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => setExportEndDate(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:border-sky-500/45 font-semibold cursor-pointer"
                />
              </div>

              {/* Preset selector */}
              <div className="space-y-1.5 flex flex-col justify-end">
                <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-mono">Active Cutoff Cycles</label>
                <select
                  value={periods.find(p => p.startDate === exportStartDate && p.endDate === exportEndDate)?.periodId || "custom"}
                  onChange={(e) => {
                    const selectedValue = e.target.value;
                    if (selectedValue === "all") {
                      setExportStartDate("");
                      setExportEndDate("");
                    } else if (selectedValue !== "custom") {
                      const found = periods.find(p => p.periodId === selectedValue || p.id === selectedValue);
                      if (found) {
                        setExportStartDate(found.startDate);
                        setExportEndDate(found.endDate);
                      }
                    }
                  }}
                  className="w-full text-xs px-3.5 py-2.5 bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:border-sky-500/40 font-semibold cursor-pointer"
                >
                  <option value="custom">-- Custom Date Range --</option>
                  {periods.map((p) => (
                    <option key={p.id || p.periodId} value={p.periodId || p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="all">Clear Range (Show All)</option>
                </select>
              </div>
            </div>

            {/* Quick Action bar with PDF exporter */}
            <div className="flex flex-col sm:flex-row items-center justify-between pt-1 gap-2 text-xs">
              <div className="text-zinc-500 flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-medium text-[11px]">
                  Found <span className="text-white font-extrabold font-mono">{totalItems}</span> matching diaries. Filters instantly shape PDF exports.
                </span>
              </div>
              <button
                type="button"
                onClick={handleExportPDF}
                disabled={isGeneratingPDF}
                className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white font-bold text-[10px] tracking-wider uppercase rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30"
              >
                {isGeneratingPDF ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> COMPILING REGISTER...
                  </>
                ) : (
                  <>
                    <FileDown className="w-3.5 h-3.5" /> DOWNLOAD / PRINT PDF REGISTER
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Main Shift Timeline table container */}
          <div className="bg-white dark:bg-[#111224] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold font-mono uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                  {filteredAttendance.length} LIVE REGISTERS LOGGED
                </span>
              </div>
              <span className="text-[9px] bg-sky-550/10 border border-sky-400/10 text-sky-600 dark:text-sky-400 px-2.5 py-1 rounded-md font-bold font-mono tracking-widest uppercase">
                DIRECT ADMINISTRATIVE ACCESS GRANTED
              </span>
            </div>

            {filteredAttendance.length === 0 ? (
              <div className="text-center p-16 text-zinc-500 space-y-3">
                <Clock className="w-12 h-12 text-zinc-400 dark:text-zinc-700 mx-auto animate-pulse" />
                <h4 className="font-bold text-zinc-600 dark:text-zinc-400 text-sm">No matched shift diaries</h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-650 max-w-sm mx-auto">
                  Adjust filters or add a manual shift log to start tracking recorded hours.
                </p>
                <button
                  onClick={() => setIsAddOpen(true)}
                  className="text-sky-600 dark:text-sky-400 hover:text-sky-500 dark:hover:text-sky-300 font-bold font-mono text-xs underline mt-2 inline-block cursor-pointer"
                >
                  Create manual entry log now ➜
                </button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse min-w-[750px]">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-[#181825]/40 border-b border-zinc-200 dark:border-white/5 text-[10px] tracking-wider uppercase font-mono font-bold text-zinc-500 dark:text-zinc-400">
                      <th className="py-3.5 px-6">EMPLOYEE RESOURCE (OLIGARCH MEDIA)</th>
                      <th className="py-3.5 px-4 text-center">CHECK-IN STATS</th>
                      <th className="py-3.5 px-4 text-center font-mono">IN TIME</th>
                      <th className="py-3.5 px-4 text-center font-mono">BREAK DIARY</th>
                      <th className="py-3.5 px-4 text-center font-mono">OUT TIME</th>
                      <th className="py-3.5 px-4 text-center font-mono text-sky-600 dark:text-sky-400">TOTAL TIME</th>
                      <th className="py-3.5 px-6 text-center">DELETE ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-white/5 text-xs text-zinc-700 dark:text-zinc-300">
                    {(() => {
                      let lastGroupKey = "";
                      return pageAttendance.map((log) => {
                        const isEditingThis = editingLogId === log.id;
                        const showGroupHeader = log.date !== lastGroupKey;
                        if (showGroupHeader) {
                          lastGroupKey = log.date;
                        }

                        return (
                          <React.Fragment key={log.id}>
                            {showGroupHeader && (
                              <tr className="bg-transparent border-none">
                                <td colSpan={7} className="p-0 pt-6 pb-2.5 bg-transparent border-none">
                                  <div className="flex items-center pl-6">
                                    <div className="flex items-center gap-2.5 px-5 py-2.5 bg-zinc-100 dark:bg-[#17182c] border border-zinc-200 dark:border-white/10 rounded-xl text-sky-600 dark:text-sky-400 font-bold font-mono text-[10.5px] uppercase tracking-wider shadow-md relative select-none">
                                      {/* Colored top neon line indicator */}
                                      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-sky-550 via-indigo-500 to-teal-400 rounded-t-full" />
                                      <div className="relative flex h-2 w-2 shrink-0">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-500 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                                      </div>
                                      <span>{formatDateHeader(log.date)}</span>
                                    </div>
                                    <div className="flex-1 h-[1px] bg-zinc-200 dark:bg-white/5 mr-6 animate-pulse" />
                                  </div>
                                </td>
                              </tr>
                            )}
                            <tr className={`hover:bg-zinc-50/50 dark:hover:bg-white/[0.01] transition-colors ${isEditingThis ? "bg-sky-500/[0.02]" : ""}`}>
                              
                              {/* Name / Profile details */}
                              <td className="py-4 px-6">
                                <div>
                                  <p className="font-bold text-zinc-900 dark:text-[#CDD6F4]">{log.employeeName}</p>
                                  <p className="text-[10px] text-sky-600 dark:text-sky-400/60 font-mono mt-0.5">{log.employeeNumber} • {log.date}</p>
                                </div>
                              </td>

                              {/* Check-In Status */}
                              <td className="py-4 px-4 text-center font-semibold">
                                {isEditingThis ? (
                                  <select
                                    value={editStatus}
                                    onChange={(e) => {
                                      const val = e.target.value as Attendance["status"];
                                      setEditStatus(val);
                                      if (val === "Absent") {
                                        setEditHoursWorked("0.00");
                                        setEditOtHours("0.00");
                                        setEditTimeIn("");
                                        setEditTimeOut("");
                                        setEditBreakStart("");
                                        setEditBreakEnd("");
                                      } else {
                                        handleAutoRecompute(editTimeIn || workHourStart || "22:00", editTimeOut || workHourEnd || "07:00", editBreakStart || "03:00", editBreakEnd || "04:00", "edit");
                                      }
                                    }}
                                    className="bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 text-xs rounded-lg p-1.5 focus:outline-none text-zinc-900 dark:text-white font-bold"
                                  >
                                    <option value="Present">Present</option>
                                    <option value="Late">Late</option>
                                    <option value="Timed Out">Timed Out</option>
                                    <option value="On Break">On Break</option>
                                    <option value="Absent">Absent</option>
                                    <option value="Paid Leave">Paid Leave</option>
                                    <option value="Birthday Leave">Birthday Leave</option>
                                  </select>
                                ) : (
                                  <AttendanceStatusBadges record={log} globalWorkHourStart={workHourStart} globalWorkHourEnd={workHourEnd} />
                                )}
                              </td>

                              {/* Time In */}
                              <td className="py-4 px-4 text-center font-mono text-zinc-800 dark:text-zinc-300">
                                {isEditingThis ? (
                                  <div className="flex flex-col items-center gap-1.5">
                                    <input
                                      type="time"
                                      value={editTimeIn}
                                      disabled={editStatus === "Absent"}
                                      onChange={(e) => {
                                        setEditTimeIn(e.target.value);
                                        handleAutoRecompute(e.target.value, editTimeOut, editBreakStart, editBreakEnd, "edit");
                                      }}
                                      className="bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 text-xs rounded-lg p-1 w-24 text-center focus:outline-none text-zinc-900 dark:text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    {editStatus !== "Absent" && (
                                      <div className="flex flex-col items-center gap-2">
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                          <input
                                            type="checkbox"
                                            checked={editEarlyInApproved}
                                            onChange={(e) => {
                                            setEditEarlyInApproved(e.target.checked);
                                            handleAutoRecompute(editTimeIn, editTimeOut, editBreakStart, editBreakEnd, "edit", e.target.checked, editLateExcused);
                                          }}
                                            className="rounded border-zinc-350 dark:border-zinc-700 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                                          />
                                          <span className="text-[9px] font-sans font-bold text-zinc-500 dark:text-zinc-400">Early-In Approved</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                          <input
                                            type="checkbox"
                                            checked={editLateExcused}
                                            onChange={(e) => {
                                            setEditLateExcused(e.target.checked);
                                            handleAutoRecompute(editTimeIn, editTimeOut, editBreakStart, editBreakEnd, "edit", editEarlyInApproved, e.target.checked);
                                          }}
                                            className="rounded border-zinc-350 dark:border-zinc-700 text-indigo-500 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                                          />
                                          <span className="text-[9px] font-sans font-bold text-zinc-500 dark:text-zinc-400">Consideration (Excused)</span>
                                        </label>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center gap-1">
                                    <span>{log.status === "Absent" || log.status === "Paid Leave" || log.status === "Birthday Leave" ? "—" : (log.timeIn ? formatTo12Hour(log.timeIn) : "—")}</span>
                                    {log.status !== "Absent" && log.status !== "Paid Leave" && log.status !== "Birthday Leave" && log.earlyInApproved && (
                                      <span className="text-[8px] bg-blue-500/10 border border-blue-500/20 text-blue-500 px-1.5 py-0.5 rounded font-black uppercase tracking-wider font-sans">Early In</span>
                                    )}
                                  </div>
                                )}
                              </td>

                              {/* Break Diary */}
                              <td className="py-4 px-4 text-center font-mono text-zinc-800 dark:text-zinc-300">
                                {isEditingThis ? (
                                  <div className="flex gap-1 justify-center items-center">
                                    <input
                                      type="time"
                                      value={editBreakStart}
                                      title="Break Start"
                                      disabled={editStatus === "Absent"}
                                      onChange={(e) => {
                                        setEditBreakStart(e.target.value);
                                        handleAutoRecompute(editTimeIn, editTimeOut, e.target.value, editBreakEnd, "edit");
                                      }}
                                      className="bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 text-xs rounded-md p-0.5 w-16 text-center focus:outline-none text-zinc-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    <span className="text-zinc-500">/</span>
                                    <input
                                      type="time"
                                      value={editBreakEnd}
                                      title="Break End"
                                      disabled={editStatus === "Absent"}
                                      onChange={(e) => {
                                        setEditBreakEnd(e.target.value);
                                        handleAutoRecompute(editTimeIn, editTimeOut, editBreakStart, e.target.value, "edit");
                                      }}
                                      className="bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 text-xs rounded-md p-0.5 w-16 text-center focus:outline-none text-zinc-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                  </div>
                                ) : (
                                  log.status === "Absent" || log.status === "Paid Leave" || log.status === "Birthday Leave" ? "—" : (log.breakStart || log.breakEnd ? (
                                    `${log.breakStart ? formatTo12Hour(log.breakStart) : "—"} to ${log.breakEnd ? formatTo12Hour(log.breakEnd) : "—"}`
                                  ) : (
                                    "—"
                                  ))
                                )}
                              </td>

                              {/* Time Out */}
                              <td className="py-4 px-4 text-center font-mono text-zinc-800 dark:text-zinc-300">
                                {isEditingThis ? (
                                  <input
                                    type="time"
                                    value={editTimeOut}
                                    disabled={editStatus === "Absent"}
                                    onChange={(e) => {
                                      setEditTimeOut(e.target.value);
                                      handleAutoRecompute(editTimeIn, e.target.value, editBreakStart, editBreakEnd, "edit");
                                    }}
                                    className="bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 text-xs rounded-lg p-1 w-24 text-center focus:outline-none text-zinc-900 dark:text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                  />
                                ) : (
                                  log.status === "Absent" || log.status === "Paid Leave" || log.status === "Birthday Leave" ? "—" : (log.timeOut ? formatTo12Hour(log.timeOut) : "—")
                                )}
                              </td>

                              {/* Total Time showing hours and OT under 8 hours format */}
                              <td className="py-4 px-4 text-center font-mono text-zinc-800 dark:text-zinc-300">
                                {isEditingThis ? (
                                  <div className="flex flex-col gap-1 items-center justify-center">
                                    <div className="flex items-center gap-1">
                                      <span className="text-[9px] text-zinc-500">Hrs:</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        disabled={editStatus === "Absent"}
                                        value={editHoursWorked}
                                        onChange={(e) => setEditHoursWorked(e.target.value)}
                                        className="bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 text-xs rounded-md p-1 w-16 text-center focus:outline-none text-zinc-900 dark:text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                      />
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-[9px] text-zinc-500">OT:</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        disabled={editStatus === "Absent"}
                                        value={editOtHours}
                                        onChange={(e) => setEditOtHours(e.target.value)}
                                        className="bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 text-xs rounded-md p-1 w-14 text-center text-green-600 dark:text-green-400 focus:outline-none font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                      />
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-[9px] text-zinc-500">Late:</span>
                                      <input
                                        type="number"
                                        step="1"
                                        disabled={editStatus === "Absent"}
                                        value={editLateMinutes}
                                        onChange={(e) => setEditLateMinutes(e.target.value)}
                                        className="bg-white dark:bg-[#181825] border border-zinc-200 dark:border-white/5 text-xs rounded-md p-1 w-14 text-center text-red-600 dark:text-red-400 focus:outline-none font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                      />
                                      <span className="text-[9px] text-zinc-500">m</span>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <p className="font-extrabold text-zinc-900 dark:text-[#CDD6F4]">{log.status === "Absent" ? "0.00" : log.hoursWorked.toFixed(2)} hrs</p>
                                    <span className={`text-[9px] block font-semibold mt-0.5 ${log.status !== "Absent" && log.otHours > 0 ? 'text-green-600 dark:text-[#A6E3A1]' : 'text-zinc-400 dark:text-zinc-550'}`}>
                                      (+{log.status === "Absent" ? "0.00" : log.otHours.toFixed(2)} OT)
                                    </span>
                                  </div>
                                )}
                              </td>

                              {/* Delete Action columns matching Screenshot 2 */}
                              <td className="py-4 px-6 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  {isEditingThis ? (
                                    <>
                                      <button
                                        onClick={() => saveEditedLog(log)}
                                        disabled={isSavingEdit}
                                        className="p-1 px-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-[#111224] rounded-md flex items-center justify-center gap-1 cursor-pointer font-bold text-[10px] uppercase font-mono shadow-sm transition-all"
                                        title="Save Log Adjustments"
                                      >
                                        {isSavingEdit ? (
                                          <>
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving...
                                          </>
                                        ) : (
                                          <>
                                            <Save className="w-3.5 h-3.5" /> Save
                                          </>
                                        )}
                                      </button>
                                      <button
                                        onClick={() => setEditingLogId(null)}
                                        className="p-1 px-1.5 bg-zinc-800 hover:bg-zinc-700 text-[#CDD6F4] rounded-md flex items-center justify-center gap-1 cursor-pointer font-bold text-[10px] uppercase font-mono"
                                        title="Discard adjustments"
                                      >
                                        <X className="w-3.5 h-3.5" /> Cancel
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {(log.status === "Present" || log.status === "Late") && (
                                        <>
                                          <button
                                            onClick={() => handleQuickPauseToggle(log)}
                                            className="p-1 px-2 bg-[#F9E2AF]/10 border border-[#F9E2AF]/20 hover:bg-[#F9E2AF]/20 text-[#F9E2AF] rounded-md font-mono text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer"
                                          >
                                            ⏸️ PAUSE
                                          </button>
                                          <button
                                            onClick={() => handleQuickTimeout(log)}
                                            className="p-1 px-2 bg-red-500/10 border border-red-500/20 hover:bg-red-500/25 text-red-400 rounded-md font-mono text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer"
                                          >
                                            🟥 TIMEOUT
                                          </button>
                                        </>
                                      )}
                                      {log.status === "On Break" && (
                                        <button
                                          onClick={() => handleQuickPauseToggle(log)}
                                          className="p-1 px-2 bg-[#A6E3A1]/10 border border-[#A6E3A1]/20 hover:bg-[#A6E3A1]/20 text-[#A6E3A1] rounded-md font-mono text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer animate-pulse"
                                        >
                                          ▶️ RESUME
                                        </button>
                                      )}
                                      
                                      <button
                                        onClick={() => startEditing(log)}
                                        className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/5 transition-all cursor-pointer"
                                        title="Edit shift metrics manually"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => deleteLog(log)}
                                        className="p-1.5 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg border border-red-500/10 transition-all cursor-pointer"
                                        title="Erase log"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>

                            </tr>
                          </React.Fragment>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalItems > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 border-t border-zinc-150 dark:border-white/5 bg-zinc-50/50 dark:bg-[#181825]/20 font-mono text-xs">
                  <div className="text-zinc-500 dark:text-zinc-400 font-medium">
                    Showing <span className="text-zinc-900 dark:text-white font-bold">{startIndex + 1}</span> to{" "}
                    <span className="text-zinc-900 dark:text-white font-bold">{endIndex}</span> of{" "}
                    <span className="text-sky-600 dark:text-sky-405 font-extrabold">{totalItems}</span> logs
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      className="px-3.5 py-2 bg-white dark:bg-[#181825] hover:bg-zinc-100 dark:hover:bg-[#222339] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 disabled:hover:bg-white dark:disabled:hover:bg-[#181825] disabled:hover:text-zinc-500 dark:disabled:hover:text-zinc-300 transition-all flex items-center gap-1.5 cursor-pointer select-none font-bold active:scale-95 duration-100 disabled:pointer-events-none"
                    >
                      <ChevronLeft className="w-4 h-4 shrink-0" />
                      Prev
                    </button>
                    
                    <div className="px-4 py-2 bg-zinc-100 dark:bg-[#141527] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-800 dark:text-white font-bold flex items-center gap-1">
                      <span>Page</span>
                      <span className="text-sky-605 dark:text-sky-400 font-extrabold">{currentPage}</span>
                      <span className="text-zinc-400 dark:text-zinc-650">/</span>
                      <span className="text-zinc-600 dark:text-zinc-400 font-extrabold">{totalPages}</span>
                    </div>

                    <button
                      type="button"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      className="px-3.5 py-2 bg-white dark:bg-[#181825] hover:bg-zinc-100 dark:hover:bg-[#222339] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 disabled:hover:bg-white dark:disabled:hover:bg-[#181825] disabled:hover:text-zinc-500 dark:disabled:hover:text-zinc-300 transition-all flex items-center gap-1.5 cursor-pointer select-none font-bold active:scale-95 duration-100 disabled:pointer-events-none"
                    >
                      Next
                      <ChevronRight className="w-4 h-4 shrink-0" />
                    </button>
                  </div>
                </div>
              )}
              </>
            )}
          </div>

      {/* Manual Add Missed Shift Overlap Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#111224] border border-zinc-250 dark:border-white/10 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b border-zinc-150 dark:border-white/5 bg-zinc-50 dark:bg-[#181825] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                <h3 className="font-extrabold text-sm text-zinc-900 dark:text-white uppercase tracking-wider font-mono">Record Manual Attendance Log</h3>
              </div>
              <button 
                onClick={() => {
                  setIsAddOpen(false);
                  resetAddForm();
                }} 
                className="p-1 text-zinc-550 hover:text-zinc-905 dark:text-zinc-500 dark:hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateLog} className="p-6 space-y-4">
              
              {addError && (
                <div className="p-3.5 bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-semibold rounded-xl border border-red-500/20 flex items-start gap-2">
                  <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
                  <span>{addError}</span>
                </div>
              )}

              {/* Select Employee */}
              <div className="space-y-1.5 relative">
                <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Choose Oligarch Media Employee</label>
                
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEmployeeDropdownOpen(!isEmployeeDropdownOpen);
                      setEmployeeFilterText("");
                    }}
                    className="w-full text-xs px-3.5 py-3 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-left text-zinc-900 dark:text-white flex items-center justify-between focus:outline-none focus:border-sky-500/40 cursor-pointer text-ellipsis overflow-hidden font-medium"
                  >
                    <span className="truncate pr-4">
                      {selectedNewEmployee 
                        ? `${selectedNewEmployee.fullName} (${selectedNewEmployee.employeeNumber}) — ${selectedNewEmployee.position}`
                        : "-- Choose target employee --"}
                    </span>
                    <span className="text-zinc-400 dark:text-zinc-500 text-[10px] shrink-0">{isEmployeeDropdownOpen ? "▲" : "▼"}</span>
                  </button>

                  {selectedNewEmployee && (() => {
                    const sched = getEmployeeSchedule(selectedNewEmployee, { workHourStart, workHourEnd });
                    return (
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] font-mono px-3 py-1.5 bg-blue-500/10 dark:bg-blue-500/15 border border-blue-500/20 rounded-lg text-blue-600 dark:text-blue-400">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>Assigned Shift: <strong>{sched.label}</strong> ({sched.requiredHours}h{sched.isCustom ? " • Custom" : " • Standard"})</span>
                      </div>
                    );
                  })()}

                  {/* Dropdown Options List */}
                  {isEmployeeDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-[#15162a] border border-zinc-200 dark:border-white/10 rounded-xl shadow-2xl z-30 p-2.5 flex flex-col gap-2.5 max-h-72 animate-in fade-in slide-in-from-top-2 duration-150">
                      {/* Search Input */}
                      <div className="relative flex items-center shrink-0">
                        <Search className="w-3.5 h-3.5 text-zinc-405 dark:text-zinc-400 absolute left-3 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Type name, ID or role to search..."
                          value={employeeFilterText}
                          onChange={(e) => setEmployeeFilterText(e.target.value)}
                          className="w-full text-xs pl-8.5 pr-8 py-2 bg-zinc-50 dark:bg-[#111224] border border-zinc-200 dark:border-white/5 rounded-lg text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-sky-500/35 font-medium"
                          autoFocus
                        />
                        {employeeFilterText && (
                          <button
                            type="button"
                            onClick={() => setEmployeeFilterText("")}
                            className="text-[10px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white px-2 cursor-pointer absolute right-2 font-mono"
                          >
                            ESC
                          </button>
                        )}
                      </div>

                      {/* Options collection */}
                      <div className="overflow-y-auto flex-1 space-y-1 pr-1 max-h-44 custom-scrollbar">
                        {employees
                          .filter(emp => emp.status === "Active")
                          .filter(emp => {
                            if (!employeeFilterText) return true;
                            const term = employeeFilterText.toLowerCase();
                            return (
                              (emp.fullName || "").toLowerCase().includes(term) ||
                              (emp.employeeNumber || "").toLowerCase().includes(term) ||
                              (emp.position || "").toLowerCase().includes(term) ||
                              (emp.department || "").toLowerCase().includes(term)
                            );
                          })
                          .map(emp => {
                            const isSelected = emp.id === newEmployeeId;
                            const empSched = getEmployeeSchedule(emp, { workHourStart, workHourEnd });
                            return (
                              <button
                                key={emp.id}
                                type="button"
                                onClick={() => {
                                  setNewEmployeeId(emp.id || "");
                                  setEmployeeFilterText("");
                                  setIsEmployeeDropdownOpen(false);
                                  setAddError("");
                                  setNewTimeIn(empSched.workHourStart);
                                  setNewTimeOut(empSched.workHourEnd);
                                  handleAutoRecompute(empSched.workHourStart, empSched.workHourEnd, newBreakStart, newBreakEnd, "add");
                                }}
                                className={`w-full text-left text-xs px-3 py-2.5 rounded-lg flex items-center justify-between transition-all cursor-pointer ${
                                  isSelected 
                                    ? "bg-sky-550/15 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold border border-sky-400/20" 
                                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white border border-transparent"
                                }`}
                              >
                                <div className="truncate pr-2">
                                  <div className="font-bold truncate">{emp.fullName}</div>
                                  <div className="text-[10px] text-zinc-400 dark:text-zinc-400 font-mono mt-0.5 flex items-center gap-1.5 truncate">
                                    <span className="text-sky-600 dark:text-sky-500 font-bold shrink-0">{emp.employeeNumber}</span>
                                    <span className="text-zinc-300 dark:text-zinc-650 shrink-0">•</span>
                                    <span className="truncate">{emp.position}</span>
                                    <span className="text-zinc-300 dark:text-zinc-650 shrink-0">•</span>
                                    <span className={`px-1.5 py-0.2 rounded text-[9px] ${empSched.isCustom ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-zinc-200/60 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"}`}>
                                      {empSched.label}
                                    </span>
                                  </div>
                                </div>
                                {isSelected && <span className="text-sky-600 dark:text-sky-450 font-black shrink-0 text-sm">✓</span>}
                              </button>
                            );
                          })}

                        {employees
                          .filter(emp => emp.status === "Active")
                          .filter(emp => {
                            if (!employeeFilterText) return true;
                            const term = employeeFilterText.toLowerCase();
                            return (
                              (emp.fullName || "").toLowerCase().includes(term) ||
                              (emp.employeeNumber || "").toLowerCase().includes(term) ||
                              (emp.position || "").toLowerCase().includes(term) ||
                              (emp.department || "").toLowerCase().includes(term)
                            );
                          }).length === 0 && (
                          <div className="text-center py-4 text-xs font-mono text-zinc-500">
                            No employees matched the terms
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Date Input */}
              <div className="space-y-1.5 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Recording Date</label>
                  <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase px-1 font-mono">YEAR:</span>
                    {[2024, 2025, 2026, 2027].map((yr) => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => {
                          const parts = (newDate || getBusinessDate()).split('-');
                          const mm = parts[1] || '01';
                          const dd = parts[2] || '01';
                          setNewDate(`${yr}-${mm}-${dd}`);
                        }}
                        className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded cursor-pointer ${
                          (newDate || "").startsWith(String(yr))
                            ? "bg-indigo-600 text-white"
                            : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                        }`}
                      >
                        {yr}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="date"
                  required
                  value={newDate}
                  onChange={(e) => {
                    setNewDate(e.target.value);
                    setAddError("");
                  }}
                  className="w-full text-xs px-3.5 py-3 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:border-sky-500/40 font-mono font-bold"
                />
              </div>

              {/* Time inputs */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Shift In Time</label>
                  <input
                    type="time"
                    required={newStatus !== "Absent"}
                    value={newTimeIn}
                    disabled={newStatus === "Absent"}
                    onChange={(e) => {
                      setNewTimeIn(e.target.value);
                      handleAutoRecompute(e.target.value, newTimeOut, newBreakStart, newBreakEnd, "add");
                    }}
                    className="w-full text-xs px-3.5 py-2.5 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {newStatus !== "Absent" && (
                    <label className="flex items-center gap-1.5 pt-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={newEarlyInApproved}
                        onChange={(e) => setNewEarlyInApproved(e.target.checked)}
                        className="rounded border-zinc-350 dark:border-zinc-700 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span className="text-[10px] font-sans font-bold text-zinc-500 dark:text-zinc-400">Approve Early-In</span>
                    </label>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Shift Out Time</label>
                  <input
                    type="time"
                    required={newStatus !== "Absent"}
                    value={newTimeOut}
                    disabled={newStatus === "Absent"}
                    onChange={(e) => {
                      setNewTimeOut(e.target.value);
                      handleAutoRecompute(newTimeIn, e.target.value, newBreakStart, newBreakEnd, "add");
                    }}
                    className="w-full text-xs px-3.5 py-2.5 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Break schedule details */}
              <div className="grid grid-cols-2 gap-3.5 border-t border-dashed border-zinc-200 dark:border-white/5 pt-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Break Start (Lunch)</label>
                  <input
                    type="time"
                    value={newBreakStart}
                    disabled={newStatus === "Absent"}
                    onChange={(e) => {
                      setNewBreakStart(e.target.value);
                      handleAutoRecompute(newTimeIn, newTimeOut, e.target.value, newBreakEnd, "add");
                    }}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Break End (Resumed)</label>
                  <input
                    type="time"
                    value={newBreakEnd}
                    disabled={newStatus === "Absent"}
                    onChange={(e) => {
                      setNewBreakEnd(e.target.value);
                      handleAutoRecompute(newTimeIn, newTimeOut, newBreakStart, e.target.value, "add");
                    }}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Computations list preview and Status override */}
              <div className="grid grid-cols-3 gap-3 pt-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Shift Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => {
                      const val = e.target.value as Attendance["status"];
                      setNewStatus(val);
                      if (val === "Absent") {
                        setNewHoursWorked("0.00");
                        setNewOtHours("0.00");
                        setNewTimeIn("");
                        setNewTimeOut("");
                        setNewBreakStart("");
                        setNewBreakEnd("");
                      } else {
                        handleAutoRecompute(newTimeIn || workHourStart || "22:00", newTimeOut || workHourEnd || "07:00", newBreakStart || "03:00", newBreakEnd || "04:00", "add");
                      }
                    }}
                    className="w-full text-xs px-2.5 py-2 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none font-bold text-center"
                  >
                    <option value="Present">Present</option>
                    <option value="Late">Late</option>
                    <option value="Timed Out">Timed Out</option>
                    <option value="On Break">On Break</option>
                    <option value="Absent">Absent</option>
                    <option value="Paid Leave">Paid Leave</option>
                    <option value="Birthday Leave">Birthday Leave</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Hours Auto</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    disabled={newStatus === "Absent"}
                    value={newHoursWorked}
                    onChange={(e) => setNewHoursWorked(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-100 dark:bg-[#181825]/40 border border-zinc-200 dark:border-white/5 rounded-xl text-center text-zinc-900 dark:text-white font-black font-mono disabled:opacity-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Overtime hours</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    disabled={newStatus === "Absent"}
                    value={newOtHours}
                    onChange={(e) => setNewOtHours(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-sky-500/5 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-400/20 rounded-xl text-center text-sky-600 dark:text-sky-400 font-black font-mono animate-fadeIn disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-zinc-150 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddOpen(false);
                    resetAddForm();
                  }}
                  className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-white/5 text-zinc-700 dark:text-[#CDD6F4] dark:hover:bg-white/10 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingNew}
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-400 text-zinc-950 font-black rounded-xl text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-md shadow-sky-500/10"
                >
                  {isSubmittingNew ? "Registering..." : "Commit Shift Log"}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Sleek Custom Confirm Modal Bypassing IFrame Dialog Sandbox restrictions */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#111224] border border-zinc-250 dark:border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-sm font-extrabold text-zinc-900 dark:text-white uppercase tracking-wider font-mono flex items-center gap-2">
              ⚠️ {confirmModal.title}
            </h3>
            <p className="text-xs text-zinc-650 dark:text-zinc-300 leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex justify-end gap-3 pt-2 font-mono">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-white/5 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 text-xs font-bold uppercase rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-black uppercase rounded-xl transition-all cursor-pointer shadow-md shadow-red-500/15"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
