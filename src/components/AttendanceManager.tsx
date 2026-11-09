import React, { useState, useEffect } from "react";
import { db, handleFirestoreError, OperationType, collection, addDoc, doc, updateDoc, deleteDoc, setDoc } from "../firebase";
import { Employee, Attendance, PayrollPeriod, LeaveRequest, NoWorkDay } from "../types";
import AttendanceStatusBadges from "./AttendanceStatusBadges";
import BossCutoffAttendanceSummary from "./BossCutoffAttendanceSummary";
import AIAttendanceScannerModal from "./AIAttendanceScannerModal";
import { calculateAttendanceHours, getLiveTimerSeconds, formatTo12Hour , getBusinessDate, getEmployeeSchedule } from "../utils";
import { 
  Play, 
  Coffee, 
  CheckCircle, 
  XCircle, 
  Search, 
  Calendar,
  AlertCircle,
  AlertTriangle,
  FileSpreadsheet,
  Clock,
  Briefcase,
  TrendingUp,
  Download,
  X,
  Printer,
  Edit2,
  Trash2,
  Save,
  PlusCircle,
  LayoutGrid,
  List,
  Camera,
  Award,
  Sparkles
} from "lucide-react";
import { jsPDF } from "jspdf";

const isLate = (timeInStr: string | null | undefined, workHourStartStr: string, workHourEndStr: string = "06:00") => {
  if (!timeInStr) return false;
  const parseToMinutes = (tStr: string) => {
    if (typeof tStr !== 'string') return 0;
    const parts = tStr.split(":").map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  };
  const mins = parseToMinutes(timeInStr);
  const schedInMins = parseToMinutes(workHourStartStr);
  const schedOutMins = parseToMinutes(workHourEndStr);
  
  let adjustedMins = mins;
  const boundary = schedOutMins < schedInMins ? schedOutMins : 360;
  if (mins <= boundary) {
    adjustedMins += 1440;
  }
  
  return adjustedMins > schedInMins;
};


const getWorkDurationString = (record: Attendance | undefined, currentTime: Date, workHourStartStr: string = "22:00", workHourEndStr: string = "07:00", dstOffset: number = 0) => {
  if (!record || !record.timeIn) return "00:00:00";
  if (record.status === "Absent") return "00:00:00";

  if (record.timeOut) {
    const hw = record.hoursWorked || 0;
    const totalSecs = Math.round(hw * 3600);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  const currentTimeStr = currentTime.toTimeString().split(" ")[0];
  const secs = getLiveTimerSeconds(
      currentTimeStr,
      record.timeIn,
      record.breakStart,
      record.breakEnd,
      record.shiftStart || workHourStartStr,
      record.shiftEnd || workHourEndStr,
      record.accumulatedBreakSeconds || 0,
      record.currentBreakStart || null,
      record.earlyInApproved || false,
      record.approvedEarlyTime
    );
  
  if (secs <= 0) {
    return "00:00:00";
  }
  
  const hrs = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const finalS = Math.floor(secs % 60);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(finalS).padStart(2, "0")}`;
};
interface AttendanceManagerProps {
  employees: Employee[];
  attendance: Attendance[];
  onRefresh: () => void;
  workHourStart: string;
  workHourEnd: string;
  dstOffset?: number;
  gracePeriodMinutes?: number;
  periods?: PayrollPeriod[];
  requests?: LeaveRequest[];
  noWorkDays?: NoWorkDay[];
}

export default function AttendanceManager({
  employees,
  attendance,
  onRefresh,
  workHourStart,
  workHourEnd,
  dstOffset = 0,
  gracePeriodMinutes = 0,
  periods = [],
  requests = [],
  noWorkDays = []
}: AttendanceManagerProps) {
  const [selectedDate, setSelectedDate] = useState(getBusinessDate());
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const parts = getBusinessDate().split('-');
    return parseInt(parts[0], 10) || new Date().getFullYear();
  });

  const handleYearSelect = (yr: number) => {
    setSelectedYear(yr);
    const parts = selectedDate.split('-');
    const mm = parts[1] || '01';
    const dd = parts[2] || '01';
    const maxDays = new Date(yr, parseInt(mm, 10), 0).getDate();
    const validDay = Math.min(parseInt(dd, 10) || 1, maxDays);
    const newDateStr = `${yr}-${mm}-${String(validDay).padStart(2, '0')}`;
    setSelectedDate(newDateStr);
    setNewDate(newDateStr);
    setPdfStartDate(`${yr}-01-01`);
    setPdfEndDate(`${yr}-12-31`);
  };
  const [activeLedgerTab, setActiveLedgerTab] = useState<"daily" | "cutoff" | "history">("daily");
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("All");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [time, setTime] = useState(new Date());

  const handlePhotoUpload = async (empId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1.5 * 1024 * 1024) {
      alert("Image is too large. Image file must be under 1.5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      if (typeof reader.result === "string") {
        try {
          await updateDoc(doc(db, "employees", empId), {
            profilePicture: reader.result
          });
          onRefresh();
        } catch (err) {
          console.error("Error updating profile photo:", err);
          alert("Could not update profile photo.");
        }
      }
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const [processing, setProcessing] = useState<string | null>(null);

  // --- MANUAL EDIT ATTENDANCE SHIFT STATE ---
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editTimeIn, setEditTimeIn] = useState("");
  const [editBreakStart, setEditBreakStart] = useState("");
  const [editBreakEnd, setEditBreakEnd] = useState("");
  const [editTimeOut, setEditTimeOut] = useState("");
  const [editStatus, setEditStatus] = useState<Attendance["status"]>("Present");
  const [editHoursWorked, setEditHoursWorked] = useState("0");
  const [editOtHours, setEditOtHours] = useState("0");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Custom dialogs to bypass cross-origin iframe browser confirm blocks
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  const triggerConfirm = (title: string, message: string, onConfirm: () => void | Promise<void>) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: async () => {
        await onConfirm();
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  // --- AI ATTENDANCE SCANNER MODAL STATE ---
  const [isAIScannerOpen, setIsAIScannerOpen] = useState(false);

  // --- MANUAL ADD ATTENDANCE SHIFT STATE ---
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [newDate, setNewDate] = useState(() => getBusinessDate());
  const [newTimeIn, setNewTimeIn] = useState("09:00");
  const [newTimeOut, setNewTimeOut] = useState("18:00");
  const [newBreakStart, setNewBreakStart] = useState("12:00");
  const [newBreakEnd, setNewBreakEnd] = useState("13:00");
  const [newStatus, setNewStatus] = useState<Attendance["status"]>("Present");
  const [newHoursWorked, setNewHoursWorked] = useState("8.00");
  const [newOtHours, setNewOtHours] = useState("0.00");
  const [addError, setAddError] = useState("");
  const [isAddingLog, setIsAddingLog] = useState(false);
  const [attendanceToExcuse, setAttendanceToExcuse] = useState<Attendance | null>(null);
  const [excuseReason, setExcuseReason] = useState("");
  const [excuseNotes, setExcuseNotes] = useState("");

  // --- HISTORICAL REGISTRY TIMELINE FILTER STATE ---
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerDate, setLedgerDate] = useState("");

  // PDF report configuration states
  const [isPDFModalOpen, setIsPDFModalOpen] = useState(false);
  const [pdfEmployeeId, setPdfEmployeeId] = useState("All");
  const [pdfStartDate, setPdfStartDate] = useState(() => {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${month}-01`;
  });
  const [pdfEndDate, setPdfEndDate] = useState(() => getBusinessDate());
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  // PDF Generator Engine for Oligarch Media Graphic Design Studio
  const handleGeneratePDFReport = () => {
    setIsGeneratingPDF(true);
    try {
      const doc = new jsPDF();
      
      // 1. Filter logs matching selection state
      let filteredLogs = attendance.filter((log) => {
        return log.date >= pdfStartDate && log.date <= pdfEndDate;
      });

      let selectedEmpName = "All Personnel Registry";
      let selectedEmpDesc = "All Departments & Roles";

      if (pdfEmployeeId !== "All") {
        const emp = employees.find(e => e.id === pdfEmployeeId);
        if (emp) {
          selectedEmpName = emp.fullName;
          selectedEmpDesc = `${emp.position} — ${emp.department}`;
          filteredLogs = filteredLogs.filter(log => log.employeeId === pdfEmployeeId);
        }
      }

      // Chronological sort ascending (oldest first for timesheets!)
      const sortedRecords = [...filteredLogs].sort((a, b) => {
        const nameA = a.employeeName || "";
        const nameB = b.employeeName || "";
        const nameComparison = nameA.localeCompare(nameB);
        if (nameComparison !== 0) return nameComparison;
        return a.date.localeCompare(b.date);
      });

      // 2. Metrics calculation
      const totalWorkingDays = sortedRecords.length;
      const presentDays = sortedRecords.filter(r => r.status === "Present" || r.status === "Timed Out" || r.status === "On Break" || r.status === "Late").length;
      const absentDays = sortedRecords.filter(r => r.status === "Absent").length;
      const totalHours = sortedRecords.reduce((sum, r) => sum + (r.hoursWorked || 0), 0);
      const totalOT = sortedRecords.reduce((sum, r) => sum + (r.otHours || 0), 0);
      const totalLateness = sortedRecords.reduce((sum, r) => sum + (r.lateMinutes || 0), 0);

      // 3. Render PDF document
      // Header Banner Section (Oligarch Media branding slate dark style)
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(0, 0, 210, 38, "F");
      
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text("OLIGARCH MEDIA", 15, 23);
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(129, 140, 248); // indigo-400
      doc.text("CREATIVE & OPERATIONS SERVICES", 15, 29);
      
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("OFFICIAL ATTENDANCE REPORT", 142, 23);

      // Metadata card wrapper
      doc.setFillColor(248, 250, 252); // slate-50
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.rect(15, 45, 180, 48, "FD");
      
      // Metadata Details Text Labels
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("REPORT SPECIFICATIONS", 20, 52);
      
      doc.setFontSize(8);
      doc.text("Target Employee:", 20, 59);
      doc.setFont("helvetica", "normal");
      doc.text(selectedEmpName, 50, 59);
      
      doc.setFont("helvetica", "bold");
      doc.text("Department/Title:", 20, 65);
      doc.setFont("helvetica", "normal");
      doc.text(selectedEmpDesc, 50, 65);
      
      doc.setFont("helvetica", "bold");
      doc.text("Reporting Range:", 20, 71);
      doc.setFont("helvetica", "normal");
      doc.text(`${pdfStartDate} to ${pdfEndDate}`, 50, 71);
      
      doc.setFont("helvetica", "bold");
      doc.text("Generated On Date:", 20, 77);
      doc.setFont("helvetica", "normal");
      doc.text(`${new Date().toLocaleString()}`, 50, 77);
      
      doc.setFont("helvetica", "bold");
      doc.text("Authorization ID:", 20, 83);
      doc.setFont("helvetica", "normal");
      doc.text(`AUD-${Math.floor(100000 + Math.random() * 900000)}`, 50, 83);

      // Summaries Metrics Text Labels (Right-aligned inside wrapper)
      doc.setFont("helvetica", "bold");
      doc.text("ATTENDANCE METRICS SUMMARY:", 115, 52);
      
      doc.setFont("helvetica", "bold");
      doc.text("Total Shift Logs:", 115, 59);
      doc.setFont("helvetica", "normal");
      doc.text(`${totalWorkingDays} logs`, 160, 59);
      
      doc.setFont("helvetica", "bold");
      doc.text("Hours Accumulated:", 115, 65);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(37, 99, 235); // blue-650
      doc.text(`${(totalHours || 0).toFixed(2)} hrs`, 160, 65);
      doc.setTextColor(15, 23, 42);
      
      doc.setFont("helvetica", "bold");
      doc.text("Approved Overtime (OT):", 115, 71);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(22, 163, 74); // green-600
      doc.text(`${(totalOT || 0).toFixed(2)} hrs`, 160, 71);
      doc.setTextColor(15, 23, 42);
      
      doc.setFont("helvetica", "bold");
      doc.text("Overdue / Late Time:", 115, 77);
      doc.setFont("helvetica", "normal");
      if (totalLateness > 0) {
        doc.setTextColor(220, 38, 38); // red-600
        doc.text(`${totalLateness} mins`, 160, 77);
        doc.setTextColor(15, 23, 42);
      } else {
        doc.text("0 mins", 160, 77);
      }
      
      doc.setFont("helvetica", "bold");
      doc.text("Attendance Ratio:", 115, 83);
      doc.setFont("helvetica", "normal");
      doc.text(`${presentDays} Pres. / ${absentDays} Abs.`, 160, 83);

      // Setup list headers
      let y = 100;

      // Table Header row banner (Slate heavy grey)
      doc.setFillColor(30, 41, 59); // slate-800
      doc.rect(15, y, 180, 8, "F");
      
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text("DATE", 18, y + 5.5);
      doc.text("SHIFT STATUS", 40, y + 5.5);
      doc.text("CLOCK IN", 75, y + 5.5);
      doc.text("BREAK PERIOD", 100, y + 5.5);
      doc.text("CLOCK OUT", 132, y + 5.5);
      doc.text("NET HOURS", 158, y + 5.5);
      doc.text("PAYOUT OT", 180, y + 5.5);
      
      y += 8;

      doc.setFontSize(7.5);
      if (sortedRecords.length === 0) {
        doc.setTextColor(100, 116, 139);
        doc.setFont("helvetica", "italic");
        doc.text("No active shifts registered inside the specified date parameters.", 20, y + 8);
        y += 15;
      } else {
        sortedRecords.forEach((rec, index) => {
          // Pagination threshold checks
          if (y > 265) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(7);
            doc.setTextColor(100, 116, 139);
            doc.text("Oligarch Media Corporate • Official Attendance Audit Ledger", 15, 287);
            doc.text("Confidential validation document issued under HR system clearance.", 138, 287);

            doc.addPage();
            
            // tiny elegant repeat header
            doc.setFillColor(15, 23, 42);
            doc.rect(0, 0, 210, 18, "F");
            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.text("OLIGARCH MEDIA", 15, 12);
            doc.setFontSize(8);
            doc.setTextColor(147, 197, 253);
            doc.text("Attendance Report (Log Continued)", 135, 12);

            y = 24;

            // table header again on page 2
            doc.setFillColor(30, 41, 59);
            doc.rect(15, y, 180, 8, "F");
            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(7.5);
            doc.text("DATE", 18, y + 5.5);
            doc.text("SHIFT STATUS", 40, y + 5.5);
            doc.text("CLOCK IN", 75, y + 5.5);
            doc.text("BREAK PERIOD", 100, y + 5.5);
            doc.text("CLOCK OUT", 132, y + 5.5);
            doc.text("NET HOURS", 158, y + 5.5);
            doc.text("PAYOUT OT", 180, y + 5.5);
            
            y += 8;
          }

          // Row background color toggles
          if (index % 2 === 0) {
            doc.setFillColor(248, 250, 252);
          } else {
            doc.setFillColor(255, 255, 255);
          }
          doc.rect(15, y, 180, 8, "F");

          // Row divider line
          doc.setDrawColor(241, 245, 249);
          doc.line(15, y + 8, 195, y + 8);

          doc.setTextColor(15, 23, 42);
          doc.setFont("helvetica", "bold");
          doc.text(rec.date, 18, y + 5.5);

          // Status custom printing styles
          doc.setFont("helvetica", "normal");
          if (rec.status === "Present" || rec.status === "Timed Out") {
            doc.setTextColor(22, 163, 74);
            doc.text(rec.status, 40, y + 5.5);
          } else if (rec.status === "Late") {
            doc.setTextColor(217, 119, 6);
            doc.text(`Late (+${rec.lateMinutes}m)`, 40, y + 5.5);
          } else if (rec.status === "Absent") {
            doc.setTextColor(220, 38, 38);
            doc.text("Absent", 40, y + 5.5);
          } else {
            doc.setTextColor(37, 99, 235);
            doc.text(rec.status || "Present", 40, y + 5.5);
          }

          doc.setTextColor(71, 85, 105);
          doc.text(rec.timeIn ? formatTo12Hour(rec.timeIn) : "—", 75, y + 5.5);

          const breakString = rec.breakStart || rec.breakEnd ? `${rec.breakStart ? formatTo12Hour(rec.breakStart) : "—"} to ${rec.breakEnd ? formatTo12Hour(rec.breakEnd) : "—"}` : "—";
          doc.text(breakString, 100, y + 5.5);

          doc.text(rec.timeOut ? formatTo12Hour(rec.timeOut) : "—", 132, y + 5.5);

          doc.setTextColor(15, 23, 42);
          doc.setFont("helvetica", "bold");
          doc.text(`${(rec?.hoursWorked ?? 0).toFixed(2)} hrs`, 158, y + 5.5);

          if ((rec?.otHours ?? 0) > 0) {
            doc.setTextColor(22, 163, 74);
            doc.text(`+${(rec.otHours ?? 0).toFixed(2)} hrs`, 180, y + 5.5);
          } else {
            doc.setTextColor(148, 163, 184);
            doc.text("—", 180, y + 5.5);
          }

          y += 8;
        });
      }

      // Add signature line guarantees
      if (y + 35 > 280) {
        doc.addPage();
        y = 25;
      } else {
        y += 12;
      }

      doc.setDrawColor(203, 213, 225);
      doc.line(20, y + 16, 95, y + 16);
      doc.line(115, y + 16, 190, y + 16);

      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text("Report Compiled By:", 20, y + 5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("Oligarch Media Payroll & HR Manager", 20, y + 20);
      doc.setFont("helvetica", "normal");
      doc.text("Internal Studio Systems Dispatch", 20, y + 24);

      doc.setTextColor(100, 116, 139);
      doc.text("Approved & Audited By:", 115, y + 5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("Lead Creative Director Coordinator", 115, y + 20);
      doc.setFont("helvetica", "normal");
      doc.text("Oligarch Media Administrative Clearance", 115, y + 24);

      // File release saving command
      doc.save(`oligarch_media_attendance_${selectedEmpName.toLowerCase().replace(/\s+/g, '_')}_${pdfStartDate}_to_${pdfEndDate}.pdf`);
      setIsPDFModalOpen(false);
    } catch (error) {
      console.error(error);
      alert("Encountered an issue preparing PDF Report output.");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  // --- ATTENDANCE RECOMPUTATION & EDITING ENGINE --- All-Time ledger controller
  const formatTimeForDB = (timeStr: string | null) => {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const parts = timeStr.trim().split(":");
    if (parts.length === 3) return timeStr.trim();
    if (parts.length === 2) return `${timeStr.trim()}:00`;
    if (parts.length > 3) return parts.slice(0, 3).join(":");
    return timeStr.trim();
  };

    const handleAutoRecompute = (
    inTimeStr: string,
    outTimeStr: string,
    bStartStr: string,
    bEndStr: string,
    type: "add" | "edit"
  ) => {
    const timeInFormatted = formatTimeForDB(inTimeStr);
    const timeOutFormatted = formatTimeForDB(outTimeStr);
    const breakStartFormatted = formatTimeForDB(bStartStr);
    const breakEndFormatted = formatTimeForDB(bEndStr);

    let currentShiftStart = workHourStart;
    let currentShiftEnd = workHourEnd;
    let currentRequiredHours = 8;

    if (type === "edit" && editingLogId) {
      const log = attendance.find(a => a.id === editingLogId);
      if (log) {
        const emp = employees.find(e => (log.employeeId && e.id === log.employeeId) || (log.employeeNumber && e.employeeNumber === log.employeeNumber));
        const empSched = emp ? getEmployeeSchedule(emp, { workHourStart, workHourEnd }, log.date) : null;
        currentShiftStart = empSched?.isOverride ? empSched.workHourStart : (log.shiftStart || empSched?.workHourStart || workHourStart);
        currentShiftEnd = empSched?.isOverride ? empSched.workHourEnd : (log.shiftEnd || empSched?.workHourEnd || workHourEnd);
        currentRequiredHours = empSched?.isOverride ? empSched.requiredHours : (log.requiredHours || empSched?.requiredHours || 8);
      }
    } else if (type === "add" && newEmployeeId) {
      const emp = employees.find(e => e.id === newEmployeeId);
      if (emp) {
        const empSched = getEmployeeSchedule(emp, { workHourStart, workHourEnd }, selectedDate);
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
      0,
      null,
      false,
      gracePeriodMinutes,
      false,
      undefined,
      currentRequiredHours
    );

    if (type === "add") {
      setNewHoursWorked((math?.hoursWorked ?? 0).toFixed(2));
      setNewOtHours((math?.otHours ?? 0).toFixed(2));
    } else {
      setEditHoursWorked((math?.hoursWorked ?? 0).toFixed(2));
      setEditOtHours((math?.otHours ?? 0).toFixed(2));
    }
  };

  const handleMassTimeOut = async () => {
    if (!confirm("Are you sure you want to Mass Time-Out all active shifts for the selected date?")) return;
    setProcessing("bulk");
    try {
      const activeRecords = attendance.filter(a => a.date === selectedDate && a.timeIn && !a.timeOut && a.status !== "Absent");
      if (activeRecords.length === 0) {
        alert("No active shifts found for this date.");
        return;
      }
      const timeOutStr = new Date().toTimeString().split(" ")[0];
      for (const att of activeRecords) {
        const emp = employees.find(e => (att.employeeId && e.id === att.employeeId) || (att.employeeNumber && e.employeeNumber === att.employeeNumber));
        const empSched = emp ? getEmployeeSchedule(emp, { workHourStart, workHourEnd }, att.date) : null;
        const currentShiftStart = empSched?.isOverride ? empSched.workHourStart : (att.shiftStart || empSched?.workHourStart || workHourStart);
        const currentShiftEnd = empSched?.isOverride ? empSched.workHourEnd : (att.shiftEnd || empSched?.workHourEnd || workHourEnd);
        const currentRequiredHours = empSched?.isOverride ? empSched.requiredHours : (att.requiredHours || empSched?.requiredHours || 8);

        const math = calculateAttendanceHours(
          att.timeIn,
          att.breakStart,
          att.breakEnd,
          timeOutStr,
          currentShiftStart,
          currentShiftEnd,
          dstOffset,
          att.accumulatedBreakSeconds || 0,
          att.currentBreakStart || null,
          att.earlyInApproved || false,
          gracePeriodMinutes,
          att.isLateExcused || false,
          att.approvedEarlyTime,
          currentRequiredHours
        );
        const docRef = doc(db, "attendance", att.id!);
        await updateDoc(docRef, {
          timeOut: timeOutStr,
          hoursWorked: math.hoursWorked,
          otHours: math.otHours,
          lateMinutes: att.lateMinutes ?? math.lateMinutes ?? 0,
          status: "Timed Out",
          shiftStart: currentShiftStart,
          shiftEnd: currentShiftEnd,
          requiredHours: currentRequiredHours
        });
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Logged Attendance Time Out (Mass)",
          details: `${att.employeeName} timed out. Worked: ${math.hoursWorked} hrs. OT: ${math.otHours} hrs.`,
          timestamp: new Date().toISOString()
        });
      }
      onRefresh();
    } catch (err) {
      console.error(err);
      alert("Error mass timing out.");
    } finally {
      setProcessing(null);
    }
  };

    // Bulk Absent seed
  
  const saveEditedLog = async (record?: Attendance) => {
    if (!editingLogId) return;
    const log = record || attendance.find(a => a.id === editingLogId);
    if (!log) return;
    
    setIsSavingEdit(true);
    try {
      const emp = employees.find(e => (log.employeeId && e.id === log.employeeId) || (log.employeeNumber && e.employeeNumber === log.employeeNumber));
      const empSched = emp ? getEmployeeSchedule(emp, { workHourStart, workHourEnd }, log.date) : null;
      const currentShiftStart = empSched?.isOverride ? empSched.workHourStart : (log.shiftStart || empSched?.workHourStart || workHourStart);
      const currentShiftEnd = empSched?.isOverride ? empSched.workHourEnd : (log.shiftEnd || empSched?.workHourEnd || workHourEnd);
      const currentRequiredHours = empSched?.isOverride ? empSched.requiredHours : (log.requiredHours || empSched?.requiredHours || 8);

      const timeInVal = formatTimeForDB(editTimeIn);
      const breakStartVal = formatTimeForDB(editBreakStart);
      const breakEndVal = formatTimeForDB(editBreakEnd);
      const timeOutVal = formatTimeForDB(editTimeOut);

      const math = calculateAttendanceHours(
        timeInVal,
        breakStartVal,
        breakEndVal,
        timeOutVal,
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

      const docRef = doc(db, "attendance", editingLogId);
      const isLeave = editStatus === "Paid Leave" || editStatus === "Birthday Leave" || (typeof editStatus === "string" && editStatus.toLowerCase().includes("leave"));
      await updateDoc(docRef, {
        timeIn: isLeave ? null : timeInVal,
        breakStart: isLeave ? null : breakStartVal,
        breakEnd: isLeave ? null : breakEndVal,
        timeOut: isLeave ? null : timeOutVal,
        status: editStatus,
        hoursWorked: isLeave ? (editStatus === "Absent Notice" ? 0 : 8) : math.hoursWorked,
        otHours: isLeave ? 0 : math.otHours,
        lateMinutes: isLeave ? 0 : math.lateMinutes,
        isLateExcused: isLeave ? true : (log.isLateExcused || false),
        shiftStart: currentShiftStart,
        shiftEnd: currentShiftEnd,
        requiredHours: currentRequiredHours
      });

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Edited Attendance Log",
        details: `Edited log for ${log.employeeName} on ${log.date}`,
        timestamp: new Date().toISOString()
      });
      alert(`Updated log for ${log.employeeName}`);
      setEditingLogId(null);
      onRefresh();
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.UPDATE, `attendance/${editingLogId}`);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const startEditing = (record: Attendance) => {
    setEditingLogId(record.id || null);
    setEditTimeIn(record.timeIn || "");
    setEditBreakStart(record.breakStart || "");
    setEditBreakEnd(record.breakEnd || "");
    setEditTimeOut(record.timeOut || "");
    setEditStatus(record.status || "Present");
    setEditHoursWorked(record.hoursWorked?.toString() || "0");
    setEditOtHours(record.otHours?.toString() || "0");
  };

  const handleApproveEarly = (record: Attendance) => {
    triggerConfirm(
      "Approve Early Time-In",
      `Approve early time in for ${record.employeeName} at ${formatTo12Hour(record.timeIn)}?`,
      async () => {
        try {
          const docRef = doc(db, "attendance", record.id!);
          await updateDoc(docRef, {
            earlyInApproved: true,
            approvedEarlyTime: record.timeIn,
            earlyApprovedBy: "Admin"
          });
          await addDoc(collection(db, "audit_logs"), {
            user: "Admin",
            action: "Approve Early Time",
            details: `Approved early time in (${formatTo12Hour(record.timeIn)}) for ${record.employeeName} on ${record.date}`,
            timestamp: new Date().toISOString()
          });
          triggerToast("✓ Early time in approved successfully.");
        } catch (err: any) {
          console.error(err);
          triggerToast("Failed to approve early time in: " + err.message);
        }
      }
    );
  };

  const parseTime = (tStr: string) => {
    if (!tStr || typeof tStr !== 'string') return 0;
    const [h, m, s = 0] = tStr.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  };

  const handleTimeIn = async (emp: Employee) => {
    try {
      setProcessing(emp.id);
      const timeStr = new Date().toLocaleTimeString("en-US", { hour12: false });
      const todayStr = selectedDate;

      const empSched = getEmployeeSchedule(emp, { workHourStart, workHourEnd }, selectedDate);

      const math = calculateAttendanceHours(
        timeStr, null, null, null,
        empSched.workHourStart, empSched.workHourEnd, dstOffset, 0, null, false, gracePeriodMinutes || 0,
        false, undefined, empSched.requiredHours
      );

      const payload: Omit<Attendance, "id"> = {
        employeeId: emp.id || "",
        employeeNumber: emp.employeeNumber,
        employeeName: emp.fullName,
        date: todayStr,
        timeIn: timeStr,
        breakStart: null,
        breakEnd: null,
        timeOut: null,
        hoursWorked: 0,
        lateMinutes: math.lateMinutes,
        otHours: 0,
        status: math.lateMinutes > 0 ? "Late" : "Present",
        shiftStart: empSched.workHourStart,
        shiftEnd: empSched.workHourEnd,
        requiredHours: empSched.requiredHours
      };

      const docId = `${emp.id}_${todayStr}`;
      await setDoc(doc(db, "attendance", docId), payload);
      triggerToast(`✓ Logged Time In for ${emp.fullName} (${formatTo12Hour(timeStr)})`);

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Admin Clocks In Employee",
        details: `Admin clocked in ${emp.fullName} (${emp.employeeNumber}) at ${timeStr}.`,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error("Error logging Time In:", err);
      triggerToast("Failed to log Time In.");
    } finally {
      setProcessing(null);
    }
  };

  const handleStartBreak = async (record: Attendance) => {
    try {
      setProcessing(record.employeeId);
      const timeStr = new Date().toLocaleTimeString("en-US", { hour12: false });
      const docRef = doc(db, "attendance", record.id);
      
      let payload: Partial<Attendance>;
      if (!record.breakStart) {
        payload = { breakStart: timeStr, status: "On Break" };
      } else {
        payload = { currentBreakStart: timeStr, status: "On Break" };
      }

      await updateDoc(docRef, payload);
      triggerToast(`☕ Rest break started for ${record.employeeName}`);

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Admin Starts Break",
        details: `Admin started break for ${record.employeeName} at ${timeStr}.`,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error("Error starting break:", err);
      triggerToast("Failed to start break.");
    } finally {
      setProcessing(null);
    }
  };

  const handleEndBreak = async (record: Attendance) => {
    try {
      setProcessing(record.employeeId);
      const timeStr = new Date().toLocaleTimeString("en-US", { hour12: false });
      const docRef = doc(db, "attendance", record.id);

      const breakStart = record.currentBreakStart || record.breakStart;
      let newAccumulated = record.accumulatedBreakSeconds || 0;
      if (breakStart) {
         const bStartParsed = parseTime(breakStart);
         const endParsed = parseTime(timeStr);
         if (endParsed >= bStartParsed) {
           newAccumulated += (endParsed - bStartParsed);
         }
      }

      let payload: Partial<Attendance>;
      if (!record.breakEnd && !record.currentBreakStart) {
         payload = { breakEnd: timeStr, status: "Present", accumulatedBreakSeconds: newAccumulated };
      } else {
         payload = { currentBreakStart: null, status: "Present", accumulatedBreakSeconds: newAccumulated };
      }

      await updateDoc(docRef, payload);
      triggerToast(`💼 Rest break ended for ${record.employeeName}`);

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Admin Ends Break",
        details: `Admin ended break for ${record.employeeName} at ${timeStr}.`,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error("Error ending break:", err);
      triggerToast("Failed to end break.");
    } finally {
      setProcessing(null);
    }
  };

  const handleTimeOut = async (record: Attendance) => {
    try {
      setProcessing(record.employeeId);
      const timeStr = new Date().toLocaleTimeString("en-US", { hour12: false });
      
      let newAccumulated = record.accumulatedBreakSeconds || 0;
      if (record.status === "On Break") {
        const breakStart = record.currentBreakStart || record.breakStart;
        if (breakStart) {
          const bStartParsed = parseTime(breakStart);
          const endParsed = parseTime(timeStr);
          if (endParsed >= bStartParsed) {
            newAccumulated += (endParsed - bStartParsed);
          }
        }
      }

      const bStartToUse = record.breakStart || null;
      const bEndToUse = record.status === "On Break" && !record.breakEnd ? timeStr : (record.breakEnd || null);

      const emp = employees.find(e => (record.employeeId && e.id === record.employeeId) || (record.employeeNumber && e.employeeNumber === record.employeeNumber));
      const empSched = emp ? getEmployeeSchedule(emp, { workHourStart, workHourEnd }, record.date) : null;
      const currentShiftStart = empSched?.isOverride ? empSched.workHourStart : (record.shiftStart || empSched?.workHourStart || workHourStart);
      const currentShiftEnd = empSched?.isOverride ? empSched.workHourEnd : (record.shiftEnd || empSched?.workHourEnd || workHourEnd);
      const currentRequiredHours = empSched?.isOverride ? empSched.requiredHours : (record.requiredHours || empSched?.requiredHours || 8);

      const math = calculateAttendanceHours(
        record.timeIn, bStartToUse, bEndToUse, timeStr,
        currentShiftStart, currentShiftEnd, dstOffset, newAccumulated, null, false, gracePeriodMinutes || 0,
        record.isLateExcused || false, record.approvedEarlyTime, currentRequiredHours
      );

      const payload: Partial<Attendance> = {
        timeOut: timeStr,
        hoursWorked: math.hoursWorked,
        otHours: math.otHours,
        lateMinutes: record.lateMinutes ?? math.lateMinutes ?? 0,
        status: "Timed Out",
        accumulatedBreakSeconds: newAccumulated,
        shiftStart: currentShiftStart,
        shiftEnd: currentShiftEnd,
        requiredHours: currentRequiredHours
      };

      if (record.status === "On Break") {
         if (!record.breakEnd && !record.currentBreakStart) {
            payload.breakEnd = timeStr;
         } else {
            payload.currentBreakStart = null;
         }
      }

      const docRef = doc(db, "attendance", record.id);
      await updateDoc(docRef, payload);
      triggerToast(`✓ Logged Time Out for ${record.employeeName} (${formatTo12Hour(timeStr)})`);

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Admin Clocks Out Employee",
        details: `Admin clocked out ${record.employeeName} at ${timeStr}.`,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error("Error logging Time Out:", err);
      triggerToast("Failed to log Time Out.");
    } finally {
      setProcessing(null);
    }
  };

  const handleDocDelete = async (record: Attendance) => {
    if (!confirm("Are you sure you want to permanently delete this attendance record?")) return;
    try {
      await deleteDoc(doc(db, "attendance", record.id));
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Admin Deleted Attendance Log",
        details: `Admin deleted attendance log for ${record.employeeName} on ${record.date}.`,
        timestamp: new Date().toISOString()
      });
      alert("Record deleted successfully.");
    } catch (err) {
      console.error(err);
      alert("Failed to delete record.");
    }
  };
  
  const handleAddManualLog = (e: any) => { e.preventDefault(); alert("Please use the Attendance Override tab to add historical logs or manual missing entries."); };
  const resetAddForm = () => {};

  const handleExcuseLate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attendanceToExcuse) return;
    try {
      const docRef = doc(db, "attendance", attendanceToExcuse.id!);
      await updateDoc(docRef, {
        isLateExcused: true,
        lateExcusedBy: "Admin",
        lateExcuseReason: excuseReason,
        lateExcuseNotes: excuseNotes,
        status: "Present",
        lateMinutes: 0
      });
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Excuse Late",
        details: `Excused late for ${attendanceToExcuse.employeeName} on ${attendanceToExcuse.date}. Reason: ${excuseReason}`,
        timestamp: new Date().toISOString()
      });
      setAttendanceToExcuse(null);
      setExcuseReason("");
      setExcuseNotes("");
      alert("Late has been excused.");
    } catch (err: any) {
      console.error(err);
      alert("Failed to excuse late: " + err.message);
    }
  };

  const handleResetTimer = async (record: Attendance) => {
    if (!confirm(`Are you sure you want to completely RESET the timer for ${record.employeeName}?`)) return;
    setProcessing(record.id!);
    try {
      const docRef = doc(db, "attendance", record.id!);
      await updateDoc(docRef, {
        timeIn: null,
        timeOut: null,
        breakStart: null,
        breakEnd: null,
        status: "Absent",
        hoursWorked: 0,
        otHours: 0,
        lateMinutes: 0,
        accumulatedBreakSeconds: 0,
        currentBreakStart: null
      });
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Reset Attendance Timer",
        details: `Reset timer for ${record.employeeName} on ${record.date}`,
        timestamp: new Date().toISOString()
      });
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(null);
    }
  };

  const handleDeleteLog = async (record: Attendance) => {
    if (!confirm(`Are you sure you want to permanently DELETE the log for ${record.employeeName} on ${record.date}?`)) return;
    setProcessing(record.id!);
    try {
      const docRef = doc(db, "attendance", record.id!);
      await deleteDoc(docRef);
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Deleted Attendance Log",
        details: `Deleted log for ${record.employeeName} on ${record.date}`,
        timestamp: new Date().toISOString()
      });
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(null);
    }
  };

  const handleCreateMissing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmployeeId) { setAddError("Select an employee"); return; }
    
    setIsAddingLog(true);
    try {
      const emp = employees.find(e => e.id === newEmployeeId);
      if (!emp) throw new Error("Employee not found");
      
      const empSched = getEmployeeSchedule(emp, { workHourStart, workHourEnd });
      const currentShiftStart = empSched.workHourStart;
      const currentShiftEnd = empSched.workHourEnd;
      const currentRequiredHours = empSched.requiredHours;

      const math = calculateAttendanceHours(
        newTimeIn,
        newBreakStart,
        newBreakEnd,
        newTimeOut,
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
      
      const newRec = {
        employeeId: emp.id,
        employeeNumber: emp.employeeNumber,
        employeeName: emp.fullName,
        date: newDate,
        timeIn: formatTimeForDB(newTimeIn),
        timeOut: formatTimeForDB(newTimeOut),
        breakStart: formatTimeForDB(newBreakStart),
        breakEnd: formatTimeForDB(newBreakEnd),
        status: newStatus,
        hoursWorked: math.hoursWorked,
        otHours: math.otHours,
        lateMinutes: math.lateMinutes,
        shiftStart: currentShiftStart,
        shiftEnd: currentShiftEnd,
        requiredHours: currentRequiredHours
      };
      
      await addDoc(collection(db, "attendance"), newRec);
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Manually Created Log",
        details: `Created log for ${emp.fullName} on ${newDate}`,
        timestamp: new Date().toISOString()
      });
      
      setIsAddOpen(false);
      onRefresh();
    } catch(err: any) {
      console.error(err);
      setAddError(err.message);
    } finally {
      setIsAddingLog(false);
    }
  };

  const markUnloggedAsAbsent = async () => {
    if (!confirm("Would you like to mark all remaining active unlogged staff as 'Absent' for this date?")) return;
    setProcessing("bulk");

    try {
      const batchList: any[] = [];
      const activeStaff = employees.filter(e => e.status === "Active");
      const loggedEmpIds = new Set(attendance.filter(a => a.date === selectedDate).map(a => a.employeeId));

      for (const staff of activeStaff) {
        if (!loggedEmpIds.has(staff.id || "")) {
          batchList.push({
            employeeId: staff.id,
            employeeNumber: staff.employeeNumber,
            employeeName: staff.fullName,
            date: selectedDate,
            timeIn: null,
            breakStart: null,
            breakEnd: null,
            timeOut: null,
            hoursWorked: 0,
            lateMinutes: 0,
            otHours: 0,
            status: "Absent"
          });
        }
      }

      if (batchList.length > 0) {
        // Since batch writes might trigger constraints, let's write them cleanly
        for (const record of batchList) {
          await addDoc(collection(db, "attendance"), record);
        }
        alert(`Successfully marked ${batchList.length} employees as Absent.`);
        onRefresh();
      } else {
        alert("All employees have already registered active attendance logs for today.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(null);
    }
  };

  // Cumulative Attendance Statistics calculations for selectedDate
  const stats = React.useMemo(() => {
    const activeStaff = employees.filter(e => e.status === "Active");
    let countIn = 0;
    let countOnBreak = 0;
    let countOut = 0;

    activeStaff.forEach(emp => {
      const record = attendance.find(a => (a.employeeId === emp.id || a.employeeNumber === emp.employeeNumber || a.employeeId === emp.employeeNumber) && a.date === selectedDate);
      if (!record) {
        countOut++;
      } else {
        if (record.status === "Present" || record.status === "Late") {
          countIn++;
        } else if (record.status === "On Break") {
          countOnBreak++;
        } else {
          countOut++;
        }
      }
    });

    return { In: countIn, OnBreak: countOnBreak, Out: countOut };
  }, [employees, attendance, selectedDate]);

  // Filters staff by search and department
  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch = 
      (emp.fullName || "").toLowerCase().includes(search.toLowerCase()) ||
      (emp.employeeNumber || "").toLowerCase().includes(search.toLowerCase());
    const matchesDept = filterDept === "All" || emp.department === filterDept;
    
    return matchesSearch && matchesDept && emp.status === "Active";
  });

  const uniqueDepts = Array.from(new Set(employees.map(e => e.department)));

  const displayedEmployees = React.useMemo(() => {
    return filteredEmployees;
  }, [filteredEmployees]);

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Page Header and Module Switcher */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800 w-full min-w-0">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-500 shrink-0" /> 
            <span>Attendance Ledger Sheet</span>
          </h2>
          <p className="text-xs text-zinc-500 mt-1 font-mono">Shift Hours: {workHourStart} to {workHourEnd}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 max-w-full">
          {/* Year Switcher (Matches uploaded image exactly) */}
          <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-900 p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
            <span className="text-[11px] font-bold text-zinc-500 uppercase px-1 font-mono">YEAR:</span>
            {[2024, 2025, 2026, 2027].map((yr) => (
              <button
                key={yr}
                type="button"
                onClick={() => handleYearSelect(yr)}
                className={`px-2.5 py-1 text-xs font-black rounded-lg transition-all cursor-pointer ${
                  selectedYear === yr
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                {yr}
              </button>
            ))}
          </div>

          {/* Dynamic Navigation Mode Button Selector */}
          <div className="flex flex-wrap bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl border border-zinc-200/50 dark:border-zinc-800/40 max-w-full">
            <button
              onClick={() => setActiveLedgerTab("daily")}
              className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 flex items-center gap-1.5 shrink-0 ${
                activeLedgerTab === "daily"
                  ? "bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm font-black"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
              <span>Daily Sheet</span>
            </button>
            <button
              onClick={() => setActiveLedgerTab("cutoff")}
              className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 flex items-center gap-1.5 shrink-0 ${
                activeLedgerTab === "cutoff"
                  ? "bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 shadow-sm font-black"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="hidden sm:inline">Cutoff Summary (Boss View)</span>
              <span className="sm:hidden">Cutoff Summary</span>
            </button>
            <button
              onClick={() => setActiveLedgerTab("history")}
              className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 flex items-center gap-1.5 shrink-0 ${
                activeLedgerTab === "history"
                  ? "bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm font-black"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>All-Time History</span>
            </button>
          </div>
        </div>
      </div>

      {activeLedgerTab === "daily" && (
        <div className="space-y-6 animate-in fade-in duration-200 w-full min-w-0">
          {/* Year Notice Banner for 2025 or non-current year */}
          {selectedYear !== new Date().getFullYear() && (
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 rounded-xl flex items-center justify-between text-xs text-indigo-900 dark:text-indigo-300 font-mono gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>
                  <strong>Calendar Year {selectedYear} Active:</strong> Viewing and logging attendance for Year {selectedYear}. Records entered here feed directly into the {selectedYear} 13th Month Pay calculations!
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleYearSelect(new Date().getFullYear())}
                className="px-2.5 py-1 bg-white dark:bg-zinc-900 hover:bg-indigo-100 dark:hover:bg-zinc-800 text-[10px] font-bold rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 transition-colors cursor-pointer shrink-0"
              >
                Return to {new Date().getFullYear()}
              </button>
            </div>
          )}

          {/* Date picking row */}
          <div className="flex flex-wrap items-center gap-2 w-full min-w-0">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedDate(val);
                if (val) {
                  const yr = parseInt(val.split('-')[0], 10);
                  if (!isNaN(yr)) setSelectedYear(yr);
                }
              }}
              className="text-xs font-semibold px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none dark:text-zinc-100 font-mono font-bold"
            />

            {/* AI Sheet Scanner & Batch Importer (Gemini Vision OCR) */}
            <button
              type="button"
              onClick={() => setIsAIScannerOpen(true)}
              className="px-3.5 py-2 text-xs bg-linear-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-purple-500/20 shrink-0"
              title="Batch import 2025/2026 attendance directly from spreadsheet screenshot images using AI OCR"
            >
              <Sparkles className="w-3.5 h-3.5 text-yellow-300 animate-pulse shrink-0" />
              <span>AI Sheet Scanner & Importer</span>
            </button>
            <button
              onClick={() => {
                setNewDate(selectedDate);
                setIsAddOpen(true);
              }}
              className="px-3.5 py-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-500/10 shrink-0"
              title="Log attendance logs manually"
            >
              <PlusCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Manual Add</span>
            </button>
            <button
              onClick={markUnloggedAsAbsent}
              disabled={processing === "bulk"}
              className="px-3.5 py-2 text-xs bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl cursor-pointer shadow-xs disabled:opacity-50 shrink-0"
            >
              Mark Absent Remaining
            </button>
            
            <button
              onClick={() => setActiveLedgerTab("cutoff")}
              className="px-3.5 py-2 text-xs bg-amber-600 hover:bg-amber-500 text-white font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm shrink-0"
              title="View Boss Cutoff Summary (Present/Absent/OT) and download 1-PDF"
            >
              <Award className="w-3.5 h-3.5 text-amber-200 shrink-0" />
              <span>Boss Cutoff Summary & OT</span>
            </button>
            <button
              onClick={() => {
                // Intelligently prepopulate target employee if they searched an employee name
                if (search.trim()) {
                  const matched = employees.find(e => 
                    e.fullName.toLowerCase().includes(search.toLowerCase()) && 
                    e.status === "Active"
                  );
                  if (matched && matched.id) {
                    setPdfEmployeeId(matched.id);
                  } else {
                    setPdfEmployeeId("All");
                  }
                } else {
                  setPdfEmployeeId("All");
                }
                setIsPDFModalOpen(true);
              }}
              className="px-3.5 py-2 text-xs bg-indigo-650 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-505 text-white font-bold font-mono uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-md shrink-0"
              title="Download timesheet reports"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>Download PDF</span>
            </button>
          </div>

          {/* Real-time Status Summary Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/60 dark:border-zinc-800/80 p-4 rounded-2xl shadow-xs font-mono">
            <div className="bg-white dark:bg-zinc-950 p-3.5 rounded-xl border border-zinc-200/60 dark:border-zinc-805/60 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">Currently In</span>
                <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block">{stats.In} Employees</span>
              </div>
              <div className="p-2 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 rounded-lg">
                <Play className="w-4 h-4 fill-emerald-600" />
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-950 p-3.5 rounded-xl border border-zinc-200/60 dark:border-zinc-805/60 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">On Break</span>
                <span className="text-xl font-black text-blue-600 dark:text-blue-400 mt-1 block">{stats.OnBreak} Employees</span>
              </div>
              <div className="p-2 bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 rounded-lg">
                <Coffee className="w-4 h-4" />
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-950 p-3.5 rounded-xl border border-zinc-200/60 dark:border-zinc-805/60 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">Currently Out</span>
                <span className="text-xl font-black text-zinc-650 dark:text-zinc-350 mt-1 block">{stats.Out} Employees</span>
              </div>
              <div className="p-2 bg-zinc-100 dark:bg-zinc-805 text-zinc-650 dark:text-zinc-300 rounded-lg">
                <XCircle className="w-4 h-4 text-red-500" />
              </div>
            </div>
          </div>

          {/* Internal Filter tools & View Mode Toggle */}
          <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="relative w-full md:flex-1">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search matching employee..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full text-xs pl-9 pr-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-100"
              />
            </div>

            {/* Department selector and View Switcher */}
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
              <select
                value={filterDept}
                onChange={(e) => setFilterDept(e.target.value)}
                className="text-xs font-semibold px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 rounded-xl focus:outline-none dark:text-zinc-100 font-mono"
              >
                <option value="All">All Departments</option>
                {uniqueDepts.map((dPrefix) => (
                  <option key={dPrefix} value={dPrefix}>{dPrefix}</option>
                ))}
              </select>

              <div className="flex bg-zinc-100 dark:bg-zinc-901 p-1 rounded-xl border border-zinc-200/50 dark:border-zinc-800/40 shrink-0">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 flex items-center gap-1.5 ${
                    viewMode === "grid"
                      ? "bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-xs font-black"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900"
                  }`}
                  title="Grid visual view"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Cards Mode</span>
                </button>
                <button
                  onClick={() => setViewMode("table")}
                  className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 flex items-center gap-1.5 ${
                    viewMode === "table"
                      ? "bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-xs font-black"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900"
                  }`}
                  title="Traditional spreadsheet view"
                >
                  <List className="w-3.5 h-3.5" />
                  <span>Table Mode</span>
                </button>
              </div>
            </div>
          </div>
            {/* Display Mode Selection: Grid vs Table Spreadsheet */}
          {viewMode === "grid" ? (
            <div className="space-y-6">
              {/* Responsive Cards Grid */}
              <div aria-label="Punch Cards Grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {displayedEmployees.map((emp) => {
                  const record = attendance.find(
                    (a) => (a.employeeId === emp.id || a.employeeNumber === emp.employeeNumber || a.employeeId === emp.employeeNumber) && a.date === selectedDate
                  );
                  const empSched = getEmployeeSchedule(emp, { workHourStart, workHourEnd }, selectedDate);

                  // Compute active status flags
                  const isTimedOut = record && (record.status === "Timed Out" || Boolean(record.timeOut));
                  const isWorking = record && !isTimedOut && (record.status === "Present" || record.status === "Late" || record.status === "On Break");
                  const isOnBreak = record && !isTimedOut && record.status === "On Break";
                  const isAbsent = record && record.status === "Absent";
                  const isUnlogged = !record;
                  const isLogProcessing = processing === emp.id;

                  const currentStatusLabel = isWorking 
                    ? (isOnBreak ? "• ON REST BREAK" : "• CURRENTLY WORKING") 
                    : (isTimedOut ? "• TIMED OUT" : (isAbsent ? "• ABSENT" : "• OFFLINE"));

                  const badgeColorClass = isOnBreak
                    ? "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900/40"
                    : isWorking
                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-250 dark:border-emerald-950/40"
                    : isTimedOut
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-650 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"
                    : isAbsent
                    ? "bg-red-50 dark:bg-red-950/30 text-red-650 dark:text-red-400 border-red-200 dark:border-red-900/40"
                    : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-805/40";

                  return (
                    <div 
                      key={emp.id} 
                      className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-5 shadow-xs hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full relative"
                    >
                      {/* Top Row - Status Badge & Punch Time In / Time Out */}
                      <div className="flex items-center justify-between gap-2">
                        <span className={`px-2.5 py-1 text-[9px] font-bold font-mono tracking-wide uppercase rounded-full border ${badgeColorClass}`}>
                          {currentStatusLabel}
                        </span>
                        <div className="flex items-center gap-3 text-right">
                          <div>
                            <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-wider uppercase font-mono block mb-0.5">
                              TIME IN
                            </span>
                            <span className="text-[11px] font-black text-zinc-800 dark:text-zinc-200 font-mono tracking-tight block">
                              {record?.timeIn ? formatTo12Hour(record.timeIn) : "—— ——"}
                            </span>
                          </div>
                          {record?.timeOut && (
                            <div className="pl-2 border-l border-zinc-200 dark:border-zinc-800">
                              <span className="text-[9px] font-bold text-rose-500 dark:text-rose-400 tracking-wider uppercase font-mono block mb-0.5">
                                TIME OUT
                              </span>
                              <span className="text-[11px] font-black text-rose-600 dark:text-rose-400 font-mono tracking-tight block">
                                {formatTo12Hour(record.timeOut)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <hr className="border-t border-zinc-100 dark:border-zinc-900 my-3.5" />

                      {/* Photo & Name Main Area */}
                      <div className="flex flex-col items-center flex-grow py-1">
                        <h4 className="font-extrabold text-xs text-zinc-800 dark:text-zinc-200 uppercase font-mono tracking-wider mb-2 text-center">
                          {emp.fullName}
                        </h4>

                        {/* Beautiful responsive employee image portal card container as requested: full-face circular portraits */}
                        <div className="flex flex-col items-center justify-center relative mb-3 group/pic">
                          <div className="w-28 h-28 relative rounded-full overflow-hidden bg-zinc-50 dark:bg-zinc-900 border-2 border-zinc-205 dark:border-zinc-800 shrink-0">
                            <img 
                              src={emp.profilePicture || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"} 
                              className="w-full h-full object-cover object-center transition-transform duration-500 group-hover/pic:scale-105" 
                              alt={emp.fullName}
                              referrerPolicy="no-referrer"
                            />
                            {/* Change Photo Button overlay */}
                            <label className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover/pic:opacity-100 transition-opacity duration-200 cursor-pointer rounded-full z-10" title="Change profile picture">
                              <Camera className="w-5 h-5 text-white/90 hover:scale-110 active:scale-95 transition-transform" />
                              <input 
                                type="file" 
                                accept="image/*" 
                                className="hidden" 
                                onChange={(e) => handlePhotoUpload(emp.id, e)}
                              />
                            </label>
                          </div>
                          {/* Role tag tag below circular avatar */}
                          <div className="mt-1.5 px-2.5 py-0.5 bg-zinc-100 dark:bg-zinc-900/60 rounded-full border border-zinc-200 dark:border-zinc-800">
                            <p className="text-[9px] text-zinc-500 dark:text-zinc-400 font-mono tracking-wide text-center uppercase leading-tight font-semibold">{emp.position}</p>
                          </div>
                        </div>

                        {/* Monospace live ticking clock block as pictured in the user's mockup */}
                        <div className="text-center w-full mb-3 py-2 bg-zinc-50/50 dark:bg-zinc-900/30 rounded-2xl border border-zinc-150/40 dark:border-zinc-900/50">
                          <p className="text-2xl font-black text-zinc-800 dark:text-zinc-100 font-mono tracking-widest pl-1 leading-none">
                            {getWorkDurationString(record, time, empSched.workHourStart, empSched.workHourEnd, dstOffset)}
                          </p>
                          <p className="text-[10px] text-zinc-455 dark:text-zinc-400 font-bold tracking-wider mt-1.5 leading-none">
                            PH Time: {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}
                          </p>
                          <div className="text-[9px] text-zinc-400 font-medium tracking-tight mt-1.5 px-2 flex items-center justify-center gap-1 flex-wrap">
                            <span>Shift: <strong className="font-mono text-zinc-700 dark:text-zinc-200">{empSched.label}</strong></span>
                            <span className="text-zinc-300 dark:text-zinc-650">•</span>
                            <span>{empSched.requiredHours}h req</span>
                            {empSched.isOverride ? (
                              <span className="text-[8px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.2 rounded font-bold uppercase tracking-wider border border-amber-300 dark:border-amber-800">
                                ⚡ Override
                              </span>
                            ) : empSched.source === "weekly" ? (
                              <span className="text-[8px] bg-purple-500/15 text-purple-600 dark:text-purple-400 px-1.5 py-0.2 rounded font-bold uppercase tracking-wider border border-purple-200 dark:border-purple-800">
                                Weekly
                              </span>
                            ) : empSched.isCustom ? (
                              <span className="text-[8px] bg-blue-500/15 text-blue-600 dark:text-blue-400 px-1 py-0.2 rounded font-bold uppercase tracking-wider">
                                Custom
                              </span>
                            ) : null}
                            {empSched.isRestDay && (
                              <span className="text-[8px] bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1 py-0.2 rounded font-bold uppercase">
                                Rest Day
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <hr className="border-t border-zinc-100 dark:border-zinc-900 my-3.5" />

                      {/* Card Bottom interactive buttons panel */}
                      <div className="grid grid-cols-3 gap-2">
                        {/* 1. TIME IN Action button */}
                        <button
                          onClick={() => handleTimeIn(emp)}
                          disabled={!isUnlogged || isLogProcessing}
                          className={`px-1.5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-200 flex flex-col items-center justify-center gap-1.5 leading-none cursor-pointer ${
                            isUnlogged && !isLogProcessing
                              ? "bg-zinc-100 hover:bg-blue-50 hover:text-blue-600 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800"
                              : "bg-zinc-50 dark:bg-zinc-900/40 text-zinc-350 dark:text-zinc-650 border border-zinc-100 dark:border-zinc-900/30 cursor-not-allowed opacity-40"
                          }`}
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Time In</span>
                        </button>

                        {/* 2. BREAK START or BREAK END action button */}
                        {isOnBreak ? (
                          <button
                            onClick={() => handleEndBreak(record)}
                            disabled={isLogProcessing}
                            className="px-1.5 py-3 bg-amber-500 hover:bg-amber-655 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-200 flex flex-col items-center justify-center gap-1.5 leading-none cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Break End</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => record && handleStartBreak(record)}
                            disabled={!record || isLogProcessing || isTimedOut}
                            className={`px-1.5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-200 flex flex-col items-center justify-center gap-1.5 leading-none ${
                              record && !isLogProcessing && !isTimedOut
                                ? "bg-zinc-100 hover:bg-amber-50 hover:text-amber-600 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 cursor-pointer"
                                : "bg-zinc-50 dark:bg-zinc-900/40 text-zinc-350 dark:text-zinc-650 border border-zinc-100 dark:border-zinc-900/30 cursor-not-allowed opacity-40"
                            }`}
                          >
                            <Coffee className="w-3.5 h-3.5" />
                            <span>Break Start</span>
                          </button>
                        )}

                        {/* 3. TIME OUT action button with robust rose style as in user mockup */}
                        <button
                          onClick={() => record && handleTimeOut(record)}
                          disabled={!record || isLogProcessing || isTimedOut}
                          className={`px-1.5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-200 flex flex-col items-center justify-center gap-1.5 leading-none ${
                            isTimedOut
                              ? "bg-zinc-100 dark:bg-zinc-850 text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-800 cursor-not-allowed"
                              : record && isWorking && !isLogProcessing
                              ? "bg-rose-600 hover:bg-rose-700 text-white shadow-sm border border-rose-500/30 cursor-pointer"
                              : "bg-zinc-50 dark:bg-zinc-900/40 text-zinc-350 dark:text-zinc-650 border border-zinc-100 dark:border-zinc-900/30 cursor-not-allowed opacity-40"
                          }`}
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>{isTimedOut ? "Timed Out" : "Time Out"}</span>
                        </button>
                      </div>

                      {/* Admin Quick override hover tools overlay inside card Context */}
                      {record && (
                        <div className="absolute top-2.5 right-2.5 flex items-center bg-white/95 dark:bg-zinc-900/95 rounded-xl p-0.5 border border-zinc-200 dark:border-zinc-800 shadow-sm backdrop-blur-xs opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200 z-10">
                          <button
                            onClick={() => startEditing(record)}
                            className="p-1.5 text-zinc-450 hover:text-blue-600 rounded transition-all cursor-pointer"
                            title="Shift Override override editor"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleDocDelete(record)}
                            className="p-1.5 text-zinc-450 hover:text-red-500 rounded transition-all cursor-pointer"
                            title="Delete shift log permanently"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Traditional Spreadsheet Table View Mode */
            <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse min-w-[720px]">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-904 border-b border-zinc-200 dark:border-zinc-805 text-[10px] tracking-wider uppercase font-mono font-bold text-zinc-650 dark:text-zinc-400">
                      <th className="py-3 px-4">EMPLOYEE</th>
                      <th className="py-3 px-4 text-center">STATUS</th>
                      <th className="py-3 px-4 text-center">TIME IN</th>
                      <th className="py-3 px-4 text-center">BREAK START</th>
                      <th className="py-3 px-4 text-center">BREAK END</th>
                      <th className="py-3 px-4 text-center">TIME OUT</th>
                      <th className="py-3 px-4 text-center font-mono">HOURS / LATE</th>
                      <th className="py-3 px-4 text-center">MANAGEMENT ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                    {filteredEmployees.map((emp) => {
                      const record = attendance.find(
                        (a) => (a.employeeId === emp.id || a.employeeNumber === emp.employeeNumber || a.employeeId === emp.employeeNumber) && a.date === selectedDate
                      );

                      
                      const isEditingThisRow = record && editingLogId === record.id;
                      const isLogProcessing = processing === emp.id;
                      const empSched = getEmployeeSchedule(emp, { workHourStart, workHourEnd }, selectedDate);
                      const shiftStartToCompare = empSched.isOverride ? empSched.workHourStart : (record?.shiftStart || empSched.workHourStart);
                      const shiftEndToCompare = empSched.isOverride ? empSched.workHourEnd : (record?.shiftEnd || empSched.workHourEnd);

                      return (
                        <tr key={emp.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/10 transition-colors">
                          <td className="py-3.5 px-4 font-semibold">
                            <div>
                              <p className="font-bold text-zinc-900 dark:text-zinc-105">{emp.fullName}</p>
                              <div className="text-[10px] text-zinc-400 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                                <span>{emp.employeeNumber} • {emp.position}</span>
                                <span className="text-zinc-300 dark:text-zinc-650">•</span>
                                <span className={`px-1.5 py-0.2 rounded text-[9px] ${
                                  empSched.isOverride
                                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold border border-amber-300 dark:border-amber-800"
                                    : empSched.source === "weekly"
                                    ? "bg-purple-500/15 text-purple-600 dark:text-purple-400 font-semibold border border-purple-200 dark:border-purple-800"
                                    : empSched.isCustom
                                    ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold"
                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                                }`}>
                                  {empSched.isOverride ? "⚡ " : ""}{empSched.label}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Status Badge */}
                          <td className="py-3.5 px-4 text-center font-semibold">
                            {isEditingThisRow ? (
                              <select
                                value={editStatus}
                                onChange={(e) => {
                                  const val = e.target.value as any;
                                  setEditStatus(val);
                                  if (val === "Absent") {
                                    setEditHoursWorked("0.00");
                                    setEditOtHours("0.00");
                                    setEditTimeIn("");
                                    setEditTimeOut("");
                                    setEditBreakStart("");
                                    setEditBreakEnd("");
                                  } else if (val === "Paid Leave" || val === "Birthday Leave" || (typeof val === "string" && val.toLowerCase().includes("leave"))) {
                                    setEditHoursWorked("8.00");
                                    setEditOtHours("0.00");
                                    setEditTimeIn("");
                                    setEditTimeOut("");
                                    setEditBreakStart("");
                                    setEditBreakEnd("");
                                  } else {
                                    handleAutoRecompute(editTimeIn || empSched.workHourStart, editTimeOut || empSched.workHourEnd, editBreakStart || "12:00", editBreakEnd || "13:00", "edit");
                                  }
                                }}
                                className="text-[10px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-0.5 text-zinc-800 dark:text-zinc-100 font-mono focus:outline-none focus:border-blue-500 font-bold"
                              >
                                <option value="Present">Present</option>
                                <option value="Late">Late</option>
                                <option value="On Break">On Break</option>
                                <option value="Timed Out">Timed Out</option>
                                <option value="Absent">Absent</option>
                                <option value="Paid Leave">Paid Leave</option>
                                <option value="Birthday Leave">Birthday Leave</option>
                              </select>
                            ) : (
                              <AttendanceStatusBadges record={record} globalWorkHourStart={empSched.workHourStart} globalWorkHourEnd={empSched.workHourEnd} />
                            )}
                          </td>
                          {/* Checkin times formats */}
                          <td className="py-3.5 px-4 text-center font-mono">
                            {isEditingThisRow ? (
                              <input
                                type="time"
                                value={editTimeIn}
                                disabled={editStatus === "Absent" || editStatus === "Paid Leave" || editStatus === "Birthday Leave"}
                                onChange={(e) => {
                                  setEditTimeIn(e.target.value);
                                  handleAutoRecompute(e.target.value, editTimeOut, editBreakStart, editBreakEnd, "edit");
                                }}
                                className="text-[11px] font-mono font-bold bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-0.5 text-zinc-900 dark:text-zinc-100 max-w-[70px] text-center focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                            ) : (
                              <span className="text-zinc-700 dark:text-zinc-350 flex items-center justify-center gap-1">
                                <span>{record?.status === "Absent" || record?.status === "Paid Leave" || record?.status === "Birthday Leave" || (typeof record?.status === "string" && record?.status.toLowerCase().includes("leave")) ? "—" : (record?.timeIn ? formatTo12Hour(record.timeIn) : "—")}</span>
                                {record?.status !== "Absent" && record?.status !== "Paid Leave" && record?.status !== "Birthday Leave" && !record?.status?.toLowerCase().includes("leave") && record?.timeIn && isLate(record.timeIn, shiftStartToCompare, shiftEndToCompare) && (
                                  <span title={`Arrived after scheduled shift: ${formatTo12Hour(shiftStartToCompare)}`} id={`warning-attendance-${record?.id || emp.id}`} className="inline-flex items-center">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 hover:text-amber-600 transition-colors shrink-0" />
                                  </span>
                                )}
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-center font-mono">
                            {isEditingThisRow ? (
                              <input
                                type="time"
                                value={editBreakStart}
                                disabled={editStatus === "Absent"}
                                onChange={(e) => {
                                  setEditBreakStart(e.target.value);
                                  handleAutoRecompute(editTimeIn, editTimeOut, e.target.value, editBreakEnd, "edit");
                                }}
                                className="text-[11px] font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-0.5 text-zinc-650 dark:text-zinc-300 max-w-[70px] text-center focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                            ) : (
                              <span className="text-zinc-500 dark:text-zinc-400">{record?.status === "Absent" ? "—" : (record?.breakStart ? formatTo12Hour(record.breakStart) : "—")}</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-center font-mono">
                            {isEditingThisRow ? (
                              <input
                                type="time"
                                value={editBreakEnd}
                                disabled={editStatus === "Absent"}
                                onChange={(e) => {
                                  setEditBreakEnd(e.target.value);
                                  handleAutoRecompute(editTimeIn, editTimeOut, editBreakStart, e.target.value, "edit");
                                }}
                                className="text-[11px] font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-0.5 text-zinc-650 dark:text-zinc-300 max-w-[70px] text-center focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                            ) : (
                              <span className="text-zinc-500 dark:text-zinc-400">{record?.status === "Absent" ? "—" : (record?.breakEnd ? formatTo12Hour(record.breakEnd) : "—")}</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-center font-mono">
                            {isEditingThisRow ? (
                              <input
                                type="time"
                                value={editTimeOut}
                                disabled={editStatus === "Absent"}
                                onChange={(e) => {
                                  setEditTimeOut(e.target.value);
                                  handleAutoRecompute(editTimeIn, e.target.value, editBreakStart, editBreakEnd, "edit");
                                }}
                                className="text-[11px] font-mono font-bold bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-0.5 text-zinc-900 dark:text-zinc-100 max-w-[70px] text-center focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                            ) : (
                              <span className="text-zinc-700 dark:text-zinc-350">{record?.status === "Absent" ? "—" : (record?.timeOut ? formatTo12Hour(record.timeOut) : "—")}</span>
                            )}
                          </td>

                          {/* Lateness details columns */}
                          <td className="py-3.5 px-4 text-center font-mono">
                            {isEditingThisRow ? (
                              <div className="flex flex-col gap-1 items-center scale-95 origin-center">
                                <div className="flex items-center gap-1">
                                  <span className="text-[8px] text-zinc-400 font-mono uppercase font-bold">Hrs:</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    disabled={editStatus === "Absent"}
                                    value={editHoursWorked}
                                    onChange={(e) => setEditHoursWorked(e.target.value)}
                                    className="text-[10px] font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-0.5 max-w-[45px] text-center font-bold text-zinc-800 dark:text-zinc-200 focus:outline-none disabled:opacity-50"
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-[8px] text-zinc-400 font-mono uppercase font-bold">OT:</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    disabled={editStatus === "Absent"}
                                    value={editOtHours}
                                    onChange={(e) => setEditOtHours(e.target.value)}
                                    className="text-[10px] font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-0.5 max-w-[45px] text-center text-green-600 focus:outline-none disabled:opacity-50"
                                  />
                                </div>
                              </div>
                            ) : record ? (
                              <div>
                                <p className="font-bold text-zinc-800 dark:text-zinc-200">{record.status === "Absent" ? "0.00" : record.hoursWorked} hrs</p>
                                {record.status !== "Absent" && record.status !== "Paid Leave" && record.status !== "Birthday Leave" && !record.status?.toLowerCase().includes("leave") && record.lateMinutes > 0 && (
                                  <span className="text-[10px] text-yellow-600 font-bold block">
                                    +{record.lateMinutes} min Late
                                  </span>
                                )}
                                {record.status !== "Absent" && record.otHours > 0 && (
                                  <span className="text-[10px] text-green-600 font-semibold font-mono block">
                                    +{record.otHours} hr OT
                                  </span>
                                )}
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>

                          {/* Management Action Columns */}
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {isEditingThisRow ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => saveEditedLog(record)}
                                    disabled={isSavingEdit}
                                    className="p-1 px-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all text-[10px] font-bold flex items-center gap-0.5 cursor-pointer"
                                    title="Save override shifts"
                                  >
                                    <Save className="w-3.5 h-3.5" />
                                    <span>Save</span>
                                  </button>
                                  <button
                                    onClick={() => setEditingLogId(null)}
                                    className="p-1 px-1.5 bg-zinc-500 hover:bg-zinc-650 text-white rounded-lg transition-all text-[10px] flex items-center gap-0.5 cursor-pointer"
                                    title="Cancel override"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                    <span>Cancel</span>
                                  </button>
                                </div>
                              ) : isLogProcessing ? (
                                <span className="text-[10px] text-zinc-400 font-mono">Processing...</span>
                              ) : !record ? (
                                <button
                                  onClick={() => handleTimeIn(emp)}
                                  className="px-2.5 py-1 text-[10px] bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg uppercase tracking-wider cursor-pointer"
                                >
                                  Time In
                                </button>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  {(!record.timeOut && record.status !== "Timed Out" && (record.status === "Present" || record.status === "Late")) ? (
                                    <>
                                      <button
                                        onClick={() => handleStartBreak(record)}
                                        className="px-2 py-0.5 text-[10px] bg-blue-650 hover:bg-blue-700 text-white font-bold rounded-lg uppercase tracking-wider flex items-center gap-0.5 cursor-pointer"
                                        title="Go on REST break"
                                      >
                                        <Coffee className="w-3 h-3" /> Break
                                      </button>
                                      <button
                                        onClick={() => handleTimeOut(record)}
                                        className="px-2 py-0.5 text-[10px] bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-750 text-white font-bold rounded-lg uppercase tracking-wider cursor-pointer font-bold"
                                        title="Timeout duty shift"
                                      >
                                        Time Out
                                      </button>
                                    </>
                                  ) : record.status === "On Break" ? (
                                    <button
                                      onClick={() => handleEndBreak(record)}
                                      className="px-2 py-0.5 text-[10px] bg-green-605 hover:bg-green-700 text-white font-bold rounded-lg uppercase tracking-wider cursor-pointer"
                                    >
                                      Resume Shift
                                    </button>
                                  ) : (record.status === "Timed Out" || Boolean(record.timeOut)) ? (
                                    <span className="text-[9px] font-mono rounded bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 text-zinc-500 dark:text-zinc-400 uppercase tracking-widest font-black leading-relaxed inline-flex items-center gap-1">
                                      <CheckCircle className="w-2.5 h-2.5 text-emerald-500" />
                                      <span>Timed Out {record.timeOut ? `(${formatTo12Hour(record.timeOut)})` : ""}</span>
                                    </span>
                                  ) : (
                                    <span className="text-[9px] font-mono rounded bg-red-50 dark:bg-red-950/20 px-1.5 py-0.5 text-red-650 uppercase tracking-widest font-black leading-relaxed">Absent</span>
                                  )}

                                  {/* Additional Management override buttons */}
                                  <div className="flex items-center gap-1 pl-1.5 ml-1.5 border-l border-zinc-200 dark:border-zinc-805">
                                    <button
                                      onClick={() => startEditing(record)}
                                      className="p-1 text-zinc-420 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-zinc-850 rounded transition-all cursor-pointer"
                                      title="Interactive Shift Override"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDocDelete(record)}
                                      className="p-1 text-zinc-425 hover:text-red-500 hover:bg-red-50 dark:hover:bg-zinc-850 rounded transition-all cursor-pointer"
                                      title="Delete shift record permanently"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
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
      )}

      {/* Corporate PDF Export Dialog Modal */}
      {isPDFModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 animate-duration-200">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-indigo-500" />
                <h3 className="font-extrabold text-xs text-zinc-900 dark:text-zinc-150 uppercase tracking-widest font-mono">EXPORT ATTENDANCE REGISTER</h3>
              </div>
              <button 
                onClick={() => setIsPDFModalOpen(false)} 
                className="p-1 px-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-805 rounded-lg text-zinc-400 dark:text-zinc-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-center p-3 bg-zinc-900 text-white rounded-xl">
                <p className="text-[10px] uppercase font-bold tracking-widest text-indigo-400 font-mono">PRINT CORPORATE BRANDING</p>
                <p className="text-sm font-extrabold tracking-tight text-zinc-100 mt-1">OLIGARCH MEDIA</p>
              </div>

              {/* Choose Scope */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Target Personnel Profile</label>
                <select
                  value={pdfEmployeeId}
                  onChange={(e) => setPdfEmployeeId(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 rounded-xl outline-none dark:text-zinc-100 font-semibold"
                >
                  <option value="All">All Active Personnel Members</option>
                  {employees
                    .filter(emp => emp.status === "Active")
                    .map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName} ({emp.employeeNumber}) — {emp.position}
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-zinc-400 leading-normal">
                  Select a specific creative associate to pull their direct calendar timing history or export a general operations ledger sheet.
                </p>
              </div>

              {/* Start Date & End Date range picking sliders */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Date From</label>
                  <input
                    type="date"
                    value={pdfStartDate}
                    onChange={(e) => setPdfStartDate(e.target.value)}
                    className="w-full text-xs px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 rounded-xl dark:text-zinc-100 font-bold font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Date To</label>
                  <input
                    type="date"
                    value={pdfEndDate}
                    onChange={(e) => setPdfEndDate(e.target.value)}
                    className="w-full text-xs px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 rounded-xl dark:text-zinc-100 font-bold font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsPDFModalOpen(false)}
                  className="flex-1 px-4 py-2.5 bg-zinc-105 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-bold font-mono uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGeneratePDFReport}
                  disabled={isGeneratingPDF}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-bold font-mono uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-indigo-500/10"
                >
                  {isGeneratingPDF ? (
                    <span>Formulating...</span>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      <span>Release PDF</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL RECORD ADD OVERRIDE DIALOG MODAL */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#111224] border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-zinc-150 dark:border-white/10 bg-zinc-50 dark:bg-[#16172e] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-emerald-555 dark:text-emerald-400 animate-pulse" />
                <h3 className="font-extrabold text-xs text-zinc-900 dark:text-white uppercase tracking-widest font-mono">Manually Clock Attendance Card</h3>
              </div>
              <button 
                onClick={() => { setIsAddOpen(false); resetAddForm(); }} 
                className="p-1 px-1.5 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddManualLog} className="p-6 space-y-4">
              {addError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5 font-sans">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{addError}</span>
                </div>
              )}

              {/* Personnel list Selection */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-550 dark:text-zinc-400 uppercase tracking-wider font-mono">Select Active Workforce Profile</label>
                <select
                  required
                  value={newEmployeeId}
                  onChange={(e) => setNewEmployeeId(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-sans"
                >
                  <option value="" className="text-zinc-500 dark:text-zinc-450 bg-white dark:bg-zinc-900">-- Choose Employee to clock --</option>
                  {employees
                    .filter(e => e.status === "Active")
                    .map((emp) => (
                      <option key={emp.id} value={emp.id} className="text-zinc-900 dark:text-white bg-white dark:bg-zinc-950 font-sans">
                        {emp.fullName} ({emp.employeeNumber} • {emp.department})
                      </option>
                    ))
                  }
                </select>
              </div>

              {/* Row: Date + Status */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-zinc-550 dark:text-zinc-400 uppercase tracking-wider font-mono font-bold">Shift Date Card</label>
                    <div className="flex items-center gap-1">
                      {[2024, 2025, 2026, 2027].map((yr) => (
                        <button
                          key={yr}
                          type="button"
                          onClick={() => {
                            const parts = (newDate || selectedDate).split('-');
                            const mm = parts[1] || '01';
                            const dd = parts[2] || '01';
                            setNewDate(`${yr}-${mm}-${dd}`);
                          }}
                          className={`px-1.5 py-0.5 text-[9px] font-mono font-bold rounded cursor-pointer ${
                            (newDate || "").startsWith(String(yr))
                              ? "bg-indigo-600 text-white"
                              : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
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
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-555 font-mono font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-550 dark:text-zinc-400 uppercase tracking-wider font-mono">Initial Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as any)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none font-sans font-bold"
                  >
                    <option value="Present">Present</option>
                    <option value="Late">Late</option>
                    <option value="On Break">On Break</option>
                    <option value="Timed Out">Timed Out</option>
                    <option value="Absent">Absent</option>
                    <option value="Paid Leave">Paid Leave</option>
                    <option value="Birthday Leave">Birthday Leave</option>
                  </select>
                </div>
              </div>

              {/* Row: Clock in / Out */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-550 dark:text-zinc-400 uppercase tracking-wider font-mono">Shift Time In</label>
                  <input
                    type="time"
                    required
                    value={newTimeIn}
                    onChange={(e) => {
                      setNewTimeIn(e.target.value);
                      handleAutoRecompute(e.target.value, newTimeOut, newBreakStart, newBreakEnd, "add");
                    }}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none font-mono font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-550 dark:text-zinc-400 uppercase tracking-wider font-mono">Shift Time Out</label>
                  <input
                    type="time"
                    value={newTimeOut}
                    onChange={(e) => {
                      setNewTimeOut(e.target.value);
                      handleAutoRecompute(newTimeIn, e.target.value, newBreakStart, newBreakEnd, "add");
                    }}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Row: Break Start / End */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-sky-700 dark:text-[#9ccbf3] uppercase tracking-wider font-mono">Break Period Start</label>
                  <input
                    type="time"
                    value={newBreakStart}
                    onChange={(e) => {
                      setNewBreakStart(e.target.value);
                      handleAutoRecompute(newTimeIn, newTimeOut, e.target.value, newBreakEnd, "add");
                    }}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-sky-700 dark:text-[#9ccbf3] uppercase tracking-wider font-mono">Break Period End</label>
                  <input
                    type="time"
                    value={newBreakEnd}
                    onChange={(e) => {
                      setNewBreakEnd(e.target.value);
                      handleAutoRecompute(newTimeIn, newTimeOut, newBreakStart, e.target.value, "add");
                    }}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Info Block showing dynamic calculus */}
              <div className="p-3 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl space-y-1">
                <p className="text-[9px] uppercase font-mono tracking-widest text-indigo-650 dark:text-[#a5b4fc] font-bold font-bold">Auto-calculated shift metrics:</p>
                <div className="grid grid-cols-2 text-xs text-zinc-600 dark:text-zinc-350">
                  <p>Regular Hours Worked: <strong className="text-zinc-900 dark:text-white font-mono">{newHoursWorked} hrs</strong></p>
                  <p>Overtime Registered: <strong className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">+{newOtHours} hrs</strong></p>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-150 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => { setIsAddOpen(false); resetAddForm(); }}
                  className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Discard Card
                </button>
                <button
                  type="submit"
                  disabled={isAddingLog}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
                >
                  {isAddingLog ? "Recording clocks..." : "File Attendance Log"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- BOSS CUTOFF ATTENDANCE, ABSENTEEISM & OVERTIME SUMMARY --- */}
      {activeLedgerTab === "cutoff" && (
        <BossCutoffAttendanceSummary
          employees={employees}
          attendance={attendance}
          periods={periods}
          requests={requests}
          noWorkDays={noWorkDays}
          workHourStart={workHourStart}
          workHourEnd={workHourEnd}
          dstOffset={dstOffset}
          onRefresh={onRefresh}
        />
      )}

      {/* --- ALL-TIME COMPANEY ATTENDANCE TRACKER LEDGER --- Section displaying historical database */}
      {activeLedgerTab === "history" && (
        <div className="bg-white dark:bg-[#111224] border border-zinc-200 dark:border-white/10 rounded-2xl p-6 shadow-md space-y-5 animate-in fade-in duration-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-zinc-100 dark:border-white/5">
          <div>
            <h3 className="text-lg font-extrabold text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
              <Clock className="w-5 h-5 text-indigo-505 dark:text-blue-400" /> All-Time Attendance Ledger History
            </h3>
            <p className="text-xs text-zinc-500 mt-1 font-sans">Complete database archive of all timesheet trackers. Search and audit historical logs instantly.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:flex-initial">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-400" />
              <input
                type="text"
                placeholder="Search ledger by employee..."
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                className="pl-9 pr-3 py-2 text-xs bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/10 rounded-xl w-full md:w-64 text-zinc-800 dark:text-white focus:outline-none focus:border-indigo-500 placeholder-zinc-400 font-medium"
              />
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-zinc-400 uppercase font-black uppercase tracking-wider shrink-0">Filter Date:</span>
              <input
                type="date"
                value={ledgerDate}
                onChange={(e) => setLedgerDate(e.target.value)}
                className="px-3 py-1.5 text-xs bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/10 rounded-xl text-zinc-800 dark:text-white focus:outline-none font-mono"
              />
              {ledgerDate && (
                <button 
                  onClick={() => setLedgerDate("")} 
                  className="px-2 py-1.5 text-[10px] text-zinc-500 hover:text-red-500 font-bold uppercase rounded border border-zinc-200 dark:border-white/5 cursor-pointer hover:bg-red-500/5 font-mono"
                  title="Clear Date Filter"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Ledger logs render table */}
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-150 dark:border-white/5 text-[10px] tracking-wider uppercase font-mono font-bold text-zinc-550 dark:text-zinc-400">
                <th className="py-2.5 px-3">RECORD DATE</th>
                <th className="py-2.5 px-3">EMPLOYEE</th>
                <th className="py-2.5 px-3 text-center">STATUS</th>
                <th className="py-2.5 px-3 text-center">TIME IN</th>
                <th className="py-2.5 px-3 text-center">REST BREAKS (START/END)</th>
                <th className="py-2.5 px-3 text-center">TIME OUT</th>
                <th className="py-2.5 px-3 text-center">METRICS</th>
                <th className="py-2.5 px-3 text-center">LEDGER AUDIT ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5 text-xs text-zinc-700 dark:text-zinc-300">
              {(() => {
                let filteredLedger = [...attendance];
                
                // 1. Search ledger filter
                if (ledgerSearch.trim()) {
                  filteredLedger = filteredLedger.filter(l => 
                    l.employeeName.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
                    l.employeeNumber.toLowerCase().includes(ledgerSearch.toLowerCase())
                  );
                }

                // 2. Date ledger filter
                if (ledgerDate) {
                  filteredLedger = filteredLedger.filter(l => l.date === ledgerDate);
                }

                // Sort descending so the most recent clocks appear first!
                filteredLedger.sort((a, b) => b.date.localeCompare(a.date));

                if (filteredLedger.length === 0) {
                  return (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-zinc-400 italic font-mono uppercase text-[10px] tracking-wide">
                        🔍 Zero historical attendance cards match your search criteria.
                      </td>
                    </tr>
                  );
                }

                return filteredLedger.map((record) => {
                  const isEditingThisLedgerRow = editingLogId === record.id;
                  
                  return (
                    <tr key={record.id} className="hover:bg-zinc-50/40 dark:hover:bg-white/5 transition-colors">
                      <td className="py-3 px-3 font-mono font-semibold dark:text-zinc-400">
                        {record.date}
                      </td>
                      <td className="py-3 px-3">
                        <div>
                          <p className="font-bold text-zinc-900 dark:text-zinc-100">{record.employeeName}</p>
                          <p className="text-[9.5px] text-zinc-400 font-mono">{record.employeeNumber}</p>
                        </div>
                      </td>

                      {/* STATUS */}
                      <td className="py-3 px-3 text-center">
                        {isEditingThisLedgerRow ? (
                          <select
                            value={editStatus}
                            onChange={(e) => {
                              const val = e.target.value as any;
                              setEditStatus(val);
                              if (val === "Absent") {
                                setEditHoursWorked("0.00");
                                setEditOtHours("0.00");
                                setEditTimeIn("");
                                setEditTimeOut("");
                                setEditBreakStart("");
                                setEditBreakEnd("");
                              } else {
                                handleAutoRecompute(editTimeIn || "09:00", editTimeOut || "18:00", editBreakStart || "12:00", editBreakEnd || "13:00", "edit");
                              }
                            }}
                            className="text-[10px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1.5 py-0.5 text-zinc-800 dark:text-zinc-100 font-mono"
                          >
                            <option value="Present">Present</option>
                            <option value="Late">Late</option>
                            <option value="On Break">On Break</option>
                            <option value="Timed Out">Timed Out</option>
                            <option value="Absent">Absent</option>
                            <option value="Paid Leave">Paid Leave</option>
                            <option value="Birthday Leave">Birthday Leave</option>
                          </select>
                        ) : (
                          <AttendanceStatusBadges record={record} globalWorkHourStart={workHourStart} />
                        )}
                      </td>

                      {/* TIME IN */}
                      <td className="py-3 px-3 text-center font-mono">
                        {isEditingThisLedgerRow ? (
                          <input
                            type="time"
                            value={editTimeIn}
                            disabled={editStatus === "Absent"}
                            onChange={(e) => {
                              setEditTimeIn(e.target.value);
                              handleAutoRecompute(e.target.value, editTimeOut, editBreakStart, editBreakEnd, "edit");
                            }}
                            className="text-[11px] font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-0.5 mt-0.5 text-zinc-900 dark:text-zinc-100 max-w-[65px] text-center focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        ) : (
                          <span className="text-zinc-700 dark:text-zinc-350 flex items-center justify-center gap-1">
                            <span>{record.status === "Absent" || record.status === "Paid Leave" || record.status === "Birthday Leave" || (typeof record.status === "string" && record.status.toLowerCase().includes("leave")) ? "—" : (record.timeIn ? formatTo12Hour(record.timeIn) : "—")}</span>
                            {record.status !== "Absent" && record.status !== "Paid Leave" && record.status !== "Birthday Leave" && !record.status?.toLowerCase().includes("leave") && record.timeIn && isLate(record.timeIn, workHourStart, workHourEnd) && (
                              <span title={`Arrived after shift configuration: ${formatTo12Hour(workHourStart)}`} id={`ledger-warning-attendance-${record.id}`} className="inline-flex items-center">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 hover:text-amber-600 transition-colors shrink-0" />
                              </span>
                            )}
                          </span>
                        )}
                      </td>

                      {/* BREAKS */}
                      <td className="py-3 px-3 text-center font-mono">
                        {isEditingThisLedgerRow ? (
                          <div className="flex items-center gap-1 justify-center">
                            <input
                              type="time"
                              value={editBreakStart}
                              disabled={editStatus === "Absent"}
                              onChange={(e) => {
                                setEditBreakStart(e.target.value);
                                handleAutoRecompute(editTimeIn, editTimeOut, e.target.value, editBreakEnd, "edit");
                              }}
                              className="text-[11px] font-mono bg-white dark:bg-zinc-900 border border-zinc-205 dark:border-zinc-800 rounded px-1 py-0.5 text-zinc-600 dark:text-zinc-300 max-w-[65px] text-center disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <span className="text-zinc-400">to</span>
                            <input
                              type="time"
                              value={editBreakEnd}
                              disabled={editStatus === "Absent"}
                              onChange={(e) => {
                                setEditBreakEnd(e.target.value);
                                handleAutoRecompute(editTimeIn, editTimeOut, editBreakStart, e.target.value, "edit");
                              }}
                              className="text-[11px] font-mono bg-white dark:bg-zinc-900 border border-zinc-205 dark:border-zinc-800 rounded px-1 py-0.5 text-zinc-600 dark:text-zinc-300 max-w-[65px] text-center disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                          </div>
                        ) : (
                          <span className="text-zinc-500 dark:text-zinc-400 text-[10.5px]">
                            {record.status === "Absent" ? "—" : (record.breakStart ? `${formatTo12Hour(record.breakStart)} to ${record.breakEnd ? formatTo12Hour(record.breakEnd) : "Ongoing"}` : "No Breaks")}
                          </span>
                        )}
                      </td>

                      {/* TIME OUT */}
                      <td className="py-3 px-3 text-center font-mono">
                        {isEditingThisLedgerRow ? (
                          <input
                            type="time"
                            value={editTimeOut}
                            disabled={editStatus === "Absent"}
                            onChange={(e) => {
                              setEditTimeOut(e.target.value);
                              handleAutoRecompute(editTimeIn, e.target.value, editBreakStart, editBreakEnd, "edit");
                            }}
                            className="text-[11px] font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-0.5 text-zinc-900 dark:text-zinc-100 max-w-[65px] text-center focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        ) : (
                          <span className="text-zinc-700 dark:text-zinc-350">{record.status === "Absent" ? "—" : (record.timeOut ? formatTo12Hour(record.timeOut) : "—")}</span>
                        )}
                      </td>

                      {/* METRICS */}
                      <td className="py-3 px-3 text-center font-mono">
                        {isEditingThisLedgerRow ? (
                          <div className="flex flex-col gap-1 items-center scale-90">
                            <div className="flex items-center gap-1">
                              <span className="text-[8px] text-zinc-400 font-mono font-bold">Hrs:</span>
                              <input
                                type="number"
                                step="0.01"
                                disabled={editStatus === "Absent"}
                                value={editHoursWorked}
                                onChange={(e) => setEditHoursWorked(e.target.value)}
                                className="text-[10px] font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 rounded px-1 max-w-[40px] text-center font-bold text-zinc-800 dark:text-zinc-100 disabled:opacity-50"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[8px] text-zinc-400 font-mono font-bold">OT:</span>
                              <input
                                type="number"
                                step="0.01"
                                disabled={editStatus === "Absent"}
                                value={editOtHours}
                                onChange={(e) => setEditOtHours(e.target.value)}
                                className="text-[10px] font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-855 rounded px-1 max-w-[40px] text-center text-green-500 disabled:opacity-50"
                              />
                            </div>
                          </div>
                        ) : (
                          <div>
                            <p className="font-bold text-zinc-805 dark:text-zinc-200">{record.status === "Absent" ? "0.00" : record.hoursWorked} hrs</p>
                            {record.status !== "Absent" && record.otHours > 0 && (
                              <span className="text-[9.5px] text-green-600 block leading-none mt-0.5">+{record.otHours} hr OT</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* LEDGER ACTIONS */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {isEditingThisLedgerRow ? (
                            <div className="flex items-center gap-1 scale-95">
                              <button
                                onClick={() => saveEditedLog(record)}
                                className="p-1 px-2 bg-green-650 hover:bg-green-700 text-white rounded-lg font-bold flex items-center gap-0.5 text-[9.5px] cursor-pointer"
                              >
                                <Save className="w-3.5 h-3.5" />
                                <span>Save</span>
                              </button>
                              <button
                                onClick={() => setEditingLogId(null)}
                                className="p-1 px-1.5 bg-zinc-505 text-white rounded-lg text-[9.5px] flex items-center gap-0.5 cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>X</span>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => startEditing(record)}
                                className="p-1 bg-zinc-100 hover:bg-blue-50 hover:text-blue-600 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded transition-all cursor-pointer inline-flex items-center gap-0.5 text-[10px] border border-transparent hover:border-blue-500/10"
                                title="Override historical log record"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                <span className="text-[10px]">Override</span>
                              </button>
                              <button
                                onClick={() => handleDocDelete(record)}
                                className="p-1 bg-red-500/5 hover:bg-red-500 hover:text-white rounded text-red-505 transition-all cursor-pointer"
                                title="Delete historical ledger card"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Sleek Custom Confirm Modal Bypassing IFrame Dialog Sandbox restrictions */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#111224] border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-200 text-zinc-900 dark:text-white">
            <h3 className="text-sm font-extrabold uppercase tracking-wider font-mono flex items-center gap-2 text-amber-500">
              <AlertCircle className="w-5 h-5 text-amber-500" /> {confirmModal.title}
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed font-sans">
              {confirmModal.message}
            </p>
            <div className="flex justify-end gap-3 pt-2 font-mono">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-white/5 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-350 text-xs font-bold uppercase rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 bg-red-500 hover:bg-red-650 text-white text-xs font-black uppercase rounded-xl transition-all cursor-pointer shadow-md shadow-red-500/15"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating System Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-55 max-w-xs bg-zinc-950 dark:bg-zinc-50 text-white dark:text-zinc-950 px-4 py-3 rounded-xl shadow-lg border border-zinc-800 dark:border-zinc-200 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-xs font-semibold font-mono">{toastMessage}</span>
        </div>
      )}

      {/* AI Attendance Screenshot Scanner & Batch Importer Modal */}
      <AIAttendanceScannerModal
        isOpen={isAIScannerOpen}
        onClose={() => setIsAIScannerOpen(false)}
        employees={employees}
        workHourStart={workHourStart}
        workHourEnd={workHourEnd}
        onSuccess={() => {
          triggerToast("Batch attendance import complete!");
          onRefresh();
        }}
        initialYear={selectedYear}
      />

    </div>
  );
}
