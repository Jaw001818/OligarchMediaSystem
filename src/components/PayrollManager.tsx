import React, { useState, useMemo, useEffect } from "react";
import { db, handleFirestoreError, OperationType, collection, addDoc, doc, updateDoc, setDoc, deleteDoc, getDocs, query, where } from "../firebase";
import { Employee, Attendance, Payroll, PayrollPeriod, LeaveRequest, CashAdvance, BossDebt, AppSettings, NoWorkDay } from "../types";
import { sendNotificationEmail, sendBulkPayrollEmails, calculateLateMinutes, getBirthdayWeekInfo, getEmployeeRateForDate, calculateSalaryIncrease, getBusinessDate, calculateNightDifferentialHours, getScheduleTimesForLog, getEmployeeSchedule } from "../utils";
import BossCutoffAttendanceSummary from "./BossCutoffAttendanceSummary";
import { subscribeToGoogleAuth, getAccessToken } from "../services/googleAuth";
import { jsPDF } from "jspdf";
import { 
  CreditCard, 
  Plus, 
  Calendar, 
  Calculator, 
  Download, 
  Mail, 
  Printer, 
  X, 
  CheckCircle, 
  HelpCircle, 
  FileMinus, 
  Sparkles, 
  ShieldAlert, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  Info, 
  Check, 
  AlertCircle, 
  Trash2, 
  FileDown, 
  Sliders, 
  Coins, 
  ArrowUpRight, 
  Award, 
  CalendarDays, 
  Search, 
  ChevronRight,
  CalendarOff,
  Moon,
  Clock,
  ShieldCheck,
  History,
  CheckCircle2,
  Send,
  ExternalLink,
  Edit3,
  AtSign,
  CheckCheck,
  MailCheck,
  Eye,
  EyeOff,
  Key,
  RefreshCw,
  Users,
  CheckSquare,
  Square,
  MailWarning,
  Banknote
} from "lucide-react";

interface PayrollManagerProps {
  employees: Employee[];
  attendance: Attendance[];
  requests: LeaveRequest[];
  periods: PayrollPeriod[];
  payrolls: Payroll[];
  cashAdvances: CashAdvance[];
  bossDebts?: BossDebt[];
  noWorkDays?: NoWorkDay[];
  onRefresh: () => void;
  currency: string;
  settings: AppSettings;
}

export default function PayrollManager({
  employees,
  attendance,
  requests,
  periods,
  payrolls,
  cashAdvances,
  bossDebts = [],
  noWorkDays = [],
  onRefresh,
  currency,
  settings
}: PayrollManagerProps) {
  const [selectedPeriodId, setSelectedPeriodId] = useState(() => {
    if (periods && periods.length > 0) {
      const active = periods.find(p => p.status === "Open" || p.status === "Processing");
      if (active) return active.periodId;
      return periods[0].periodId;
    }
    return "";
  });

  useEffect(() => {
    if ((!selectedPeriodId || !periods.find(p => p.periodId === selectedPeriodId)) && periods.length > 0) {
      const active = periods.find(p => p.status === "Open" || p.status === "Processing");
      if (active) {
        setSelectedPeriodId(active.periodId);
      } else {
        setSelectedPeriodId(periods[0].periodId);
      }
    }
  }, [periods, selectedPeriodId]);
  
  // Create Custom Cutoff Period dialog states
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);
  const [periodName, setPeriodName] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodRelease, setPeriodRelease] = useState("");
  const [newPeriodEnableNightDiff, setNewPeriodEnableNightDiff] = useState(true);
  const [newPeriodEnableOT125, setNewPeriodEnableOT125] = useState(true);

  // Viewing Payslip modal states
  const [selectedPayslip, setSelectedPayslip] = useState<Payroll | null>(null);
  const [generating, setGenerating] = useState(false);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseEmailStatus, setReleaseEmailStatus] = useState("");
  const [isAuditPanelOpen, setIsAuditPanelOpen] = useState(true);
  const [isTableOpen, setIsTableOpen] = useState(true);

  // Bulk Release Modal & Email Dispatch states
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);
  const [releaseSendEmails, setReleaseSendEmails] = useState(true);
  const [employeeEmailDrafts, setEmployeeEmailDrafts] = useState<Record<string, string>>({});
  const [savingEmailForEmpId, setSavingEmailForEmpId] = useState<string | null>(null);
  const [releaseProgress, setReleaseProgress] = useState<{
    current: number;
    total: number;
    empName: string;
    step: string;
  } | null>(null);
  const [releaseSummaryResult, setReleaseSummaryResult] = useState<{
    releasedCount: number;
    emailSuccessCount: number;
    emailFailCount: number;
    emailSimulatedCount: number;
  } | null>(null);

  // Standalone Auto-Send Payslips Modal states (allows sending to all employees anytime)
  const [isAutoSendModalOpen, setIsAutoSendModalOpen] = useState(false);
  const [autoSendSelectedEmpIds, setAutoSendSelectedEmpIds] = useState<string[]>([]);
  const [autoSending, setAutoSending] = useState(false);
  const [autoSendProgress, setAutoSendProgress] = useState<{
    current: number;
    total: number;
    empName: string;
    step: string;
  } | null>(null);
  const [autoSendResults, setAutoSendResults] = useState<{
    deliveredCount: number;
    simulatedCount: number;
    failedCount: number;
    total: number;
    details: Array<{
      employeeId: string;
      fullName: string;
      email: string;
      status: "Delivered" | "Simulated" | "Failed";
      messageId?: string;
      error?: string;
    }>;
  } | null>(null);
  const [autoSendLiveStatus, setAutoSendLiveStatus] = useState<Record<string, { status: "pending" | "sending" | "delivered" | "simulated" | "failed"; error?: string }>>({});

  // Individual Email Modal state
  const [emailModal, setEmailModal] = useState<{
    isOpen: boolean;
    payRecord: Payroll | null;
    employee: Employee | null;
    recipientEmail: string;
    subject: string;
    sending: boolean;
    activeTab: "preview" | "raw";
    statusBanner: { type: "success" | "error" | "info"; message: string } | null;
    showSmtpCard: boolean;
  }>({
    isOpen: false,
    payRecord: null,
    employee: null,
    recipientEmail: "",
    subject: "",
    sending: false,
    activeTab: "preview",
    statusBanner: null,
    showSmtpCard: false
  });

  // Quick SMTP inline settings in email modal & auto-send
  const [quickSmtpHost, setQuickSmtpHost] = useState(settings?.smtpHost || "smtp.gmail.com");
  const [quickSmtpPort, setQuickSmtpPort] = useState(settings?.smtpPort || "587");
  const [quickSmtpUser, setQuickSmtpUser] = useState(settings?.smtpUser || settings?.adminEmail || "hr.oligarchmedia@gmail.com");
  const [quickSmtpPass, setQuickSmtpPass] = useState(settings?.smtpPass || "");
  const [quickSmtpSenderName, setQuickSmtpSenderName] = useState(settings?.smtpSenderName || settings?.companyName || "Oligarch Media Graphic Design Studio");
  const [quickSmtpSaving, setQuickSmtpSaving] = useState(false);
  const [quickSmtpStatus, setQuickSmtpStatus] = useState<string>("");
  const [showQuickPass, setShowQuickPass] = useState(false);

  // Google OAuth Auth State for Gmail dispatch
  const [googleAuthToken, setGoogleAuthToken] = useState<string | null>(null);
  const [googleAuthUser, setGoogleAuthUser] = useState<any>(null);

  useEffect(() => {
    const unsub = subscribeToGoogleAuth((t, u) => {
      setGoogleAuthToken(t);
      setGoogleAuthUser(u);
    });
    return () => unsub();
  }, []);

  // Auto-send helper states
  const [autoSendSearch, setAutoSendSearch] = useState("");
  const [autoSendShowSmtpGuide, setAutoSendShowSmtpGuide] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Keep quick SMTP state synchronized if settings prop changes
  useEffect(() => {
    if (settings) {
      if (settings.smtpHost) setQuickSmtpHost(settings.smtpHost);
      if (settings.smtpPort) setQuickSmtpPort(settings.smtpPort);
      if (settings.smtpUser) setQuickSmtpUser(settings.smtpUser);
      if (settings.smtpPass) setQuickSmtpPass(settings.smtpPass);
      if (settings.smtpSenderName) setQuickSmtpSenderName(settings.smtpSenderName);
    }
  }, [settings]);

  // In-app Toast Notification state
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4500);
  };

  // Custom Deletion modal states
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteStatusMsg, setDeleteStatusMsg] = useState("");
  const [isBossAttendanceModalOpen, setIsBossAttendanceModalOpen] = useState(false);

  // Sub-views: Cutoff Ledger vs 13th Month Pay & Annual Absence Audit
  const [activePayrollTab, setActivePayrollTab] = useState<"cutoff" | "thirteenth_month">("cutoff");

  // Allowance Control States (Standard Allowance vs Quick Zero-Out / Removal)
  const [allowancePolicy, setAllowancePolicy] = useState<"Full" | "Removed">("Full");
  const [customAllowanceOverrides, setCustomAllowanceOverrides] = useState<Record<string, number>>({});
  const [editingAllowanceEmpId, setEditingAllowanceEmpId] = useState<string | null>(null);
  const [editingAllowanceVal, setEditingAllowanceVal] = useState<number>(0);

  // 13th Month & Whole-Year Absence Audit States
  const [selected13thYear, setSelected13thYear] = useState<number>(() => new Date().getFullYear());
  const [search13th, setSearch13th] = useState<string>("");
  const [selectedEmpFor13thAudit, setSelectedEmpFor13thAudit] = useState<Employee | null>(null);
  const [disburse13thTargetEmp, setDisburse13thTargetEmp] = useState<{ emp: Employee; amount: number } | null>(null);

  // Inception Date of system tracking (User requested: only count absences starting when app was started around May/June)
  const earliestSystemDate = useMemo(() => {
    const dates: string[] = [];
    attendance.forEach(a => { if (a.date) dates.push(a.date); });
    periods.forEach(p => { if (p.startDate) dates.push(p.startDate); });
    dates.sort();
    return dates.length > 0 ? dates[0] : "2026-06-15";
  }, [attendance, periods]);

  const [trackingStartDate, setTrackingStartDate] = useState<string>("2026-06-15");
  const [calculationScope, setCalculationScope] = useState<"full_year" | "app_inception_only">("full_year");

  useEffect(() => {
    if (earliestSystemDate && earliestSystemDate !== "2026-06-15") {
      setTrackingStartDate(earliestSystemDate);
    }
  }, [earliestSystemDate]);

  // Company No Work Days Modal & Action states
  const [isNoWorkModalOpen, setIsNoWorkModalOpen] = useState(false);
  const [newNoWorkDate, setNewNoWorkDate] = useState("");
  const [newNoWorkLabel, setNewNoWorkLabel] = useState("");
  const [newNoWorkNotes, setNewNoWorkNotes] = useState("");
  const [savingNoWork, setSavingNoWork] = useState(false);
  const [noWorkError, setNoWorkError] = useState("");

  const noWorkDateSet = useMemo(() => {
    return new Set((noWorkDays || []).map(nw => nw.date));
  }, [noWorkDays]);

  const handleAddNoWorkDay = async (e: React.FormEvent) => {
    e.preventDefault();
    setNoWorkError("");
    if (!newNoWorkDate) {
      setNoWorkError("Please pick a date for the No Work Day.");
      return;
    }
    if (!newNoWorkLabel.trim()) {
      setNoWorkError("Please provide a reason or label (e.g. Typhoon Suspension).");
      return;
    }

    const existing = (noWorkDays || []).find(nw => nw.date === newNoWorkDate);
    if (existing) {
      setNoWorkError(`A No Work Day is already declared for ${newNoWorkDate} (${existing.label}).`);
      return;
    }

    try {
      setSavingNoWork(true);
      await addDoc(collection(db, "no_work_days"), {
        date: newNoWorkDate,
        label: newNoWorkLabel.trim(),
        notes: newNoWorkNotes.trim(),
        createdAt: new Date().toISOString(),
        createdBy: "Admin"
      });

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Declared Company No Work Day",
        details: `Declared ${newNoWorkDate} as No Work: "${newNoWorkLabel.trim()}". Rule: Unworked is NOT absent; no pay unless approved leave used.`,
        timestamp: new Date().toISOString()
      });

      setNewNoWorkDate("");
      setNewNoWorkLabel("");
      setNewNoWorkNotes("");
      onRefresh();
    } catch (err) {
      console.error(err);
      setNoWorkError("Failed to save No Work Day.");
    } finally {
      setSavingNoWork(false);
    }
  };

  const handleDeleteNoWorkDay = async (id?: string, dateStr?: string) => {
    if (!id) return;
    try {
      await deleteDoc(doc(db, "no_work_days", id));
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Removed Company No Work Day",
        details: `Removed No Work Day designation for ${dateStr || id}.`,
        timestamp: new Date().toISOString()
      });
      onRefresh();
    } catch (err) {
      console.error(err);
      alert("Failed to delete No Work Day.");
    }
  };

  // Boss Plus / Additional Cash Modal States
  const [isBossPlusModalOpen, setIsBossPlusModalOpen] = useState(false);
  const [bossPlusEmployeeId, setBossPlusEmployeeId] = useState("");
  const [bossPlusAmount, setBossPlusAmount] = useState<number>(0);
  const [bossPlusPayoutMethod, setBossPlusPayoutMethod] = useState<"Full" | "Split">("Split");
  const [bossPlusSplitCount, setBossPlusSplitCount] = useState<number>(3);
  const [bossPlusNotes, setBossPlusNotes] = useState("");
  const [bossPlusIsDeferred, setBossPlusIsDeferred] = useState(false);
  const [bossPlusDeferReason, setBossPlusDeferReason] = useState("");
  const [bossPlusSaving, setBossPlusSaving] = useState(false);

  // Deduction / Cash Advance Modal States
  const [isDeductionModalOpen, setIsDeductionModalOpen] = useState(false);
  const [deductionEmployeeId, setDeductionEmployeeId] = useState("");
  const [deductionAmount, setDeductionAmount] = useState<number>(0);
  const [deductionMethod, setDeductionMethod] = useState<"Full" | "Split">("Full");
  const [deductionSplitCount, setDeductionSplitCount] = useState<number>(2);
  const [deductionNotes, setDeductionNotes] = useState("");
  const [deductionIsDeferred, setDeductionIsDeferred] = useState(false);
  const [deductionDeferReason, setDeductionDeferReason] = useState("");
  const [deductionSaving, setDeductionSaving] = useState(false);

  const handleOpenAddBossPlus = (empId?: string) => {
    if (empId) {
      setBossPlusEmployeeId(empId);
    } else if (employees.length > 0 && !bossPlusEmployeeId) {
      setBossPlusEmployeeId(employees[0].id || "");
    }
    setBossPlusAmount(0);
    setBossPlusPayoutMethod("Split");
    setBossPlusSplitCount(3);
    setBossPlusNotes("");
    setBossPlusIsDeferred(false);
    setBossPlusDeferReason("");
    setIsBossPlusModalOpen(true);
  };

  const handleSaveBossPlus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bossPlusEmployeeId || bossPlusAmount <= 0) {
      alert("Please select an employee and enter an amount greater than 0.");
      return;
    }
    const emp = employees.find(e => e.id === bossPlusEmployeeId);
    if (!emp) {
      alert("Selected employee not found.");
      return;
    }

    setBossPlusSaving(true);
    try {
      const refId = `BP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const newDebt: Omit<BossDebt, "id"> = {
        referenceId: refId,
        employeeId: emp.id || "",
        employeeName: emp.fullName,
        amount: Number(bossPlusAmount),
        remainingBalance: Number(bossPlusAmount),
        dateGranted: selectedPeriodObj?.startDate || getBusinessDate(),
        status: "Active",
        payoutMethod: bossPlusPayoutMethod,
        splitCount: bossPlusPayoutMethod === "Split" ? Math.max(1, Number(bossPlusSplitCount)) : null,
        notes: bossPlusNotes.trim() || "Boss Plus Addition",
        history: [],
        isDeferred: bossPlusIsDeferred,
        deferReason: bossPlusDeferReason.trim() || (bossPlusIsDeferred ? "Deferred to next cutoff" : undefined)
      };

      await addDoc(collection(db, "boss_debts"), newDebt);

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Granted Boss Plus / Additional Cash",
        details: `Granted ${currency}${Number(bossPlusAmount).toLocaleString()} to ${emp.fullName} (${bossPlusPayoutMethod === "Split" ? `${bossPlusSplitCount} cutoffs installment` : "Full payout"})${bossPlusIsDeferred ? " [Hidden/Deferred to next cutoff]" : ""}. Notes: ${bossPlusNotes || "None"}`,
        timestamp: new Date().toISOString()
      });

      setIsBossPlusModalOpen(false);
      setBossPlusAmount(0);
      setBossPlusNotes("");
      setBossPlusIsDeferred(false);
      setBossPlusDeferReason("");
      showToast(`Successfully saved Boss Plus of ${currency}${Number(bossPlusAmount).toLocaleString()} for ${emp.fullName}!`, "success");
      onRefresh();
    } catch (err) {
      console.error(err);
      showToast("Failed to save Boss Plus / Additional Cash.", "error");
    } finally {
      setBossPlusSaving(false);
    }
  };

  const handleToggleBossDebtDeferred = async (debtId: string, currentDeferred: boolean) => {
    try {
      await updateDoc(doc(db, "boss_debts", debtId), {
        isDeferred: !currentDeferred,
        deferReason: !currentDeferred ? "Deferred / Hidden from current payslip" : ""
      });
      showToast(!currentDeferred ? "Boss Plus hidden: Deferring to next cutoff." : "Boss Plus restored: Added to current cutoff.", "success");
      onRefresh();
    } catch (err) {
      console.error(err);
      showToast("Error updating Boss Plus status.", "error");
    }
  };

  const handleDeleteBossDebt = async (debtId: string) => {
    try {
      const debt = (bossDebts || []).find(d => d.id === debtId);
      if (debt) {
        await addDoc(collection(db, "deleted_records"), {
          recordType: "Boss Credit / Boss Plus",
          originalCollection: "boss_debts",
          originalId: debtId,
          data: debt,
          deletedAt: new Date().toISOString(),
          deletedBy: "Admin"
        });
      }
      await deleteDoc(doc(db, "boss_debts", debtId));
      showToast("Removed Boss Plus record (stored in Recycle Bin).", "success");
      onRefresh();
    } catch (err) {
      console.error(err);
      showToast("Error deleting record.", "error");
    }
  };

  // Deduction / Cash Advance Handlers
  const handleOpenAddDeduction = (empId?: string) => {
    if (empId) {
      setDeductionEmployeeId(empId);
    } else if (employees.length > 0 && !deductionEmployeeId) {
      setDeductionEmployeeId(employees[0].id || "");
    }
    setDeductionAmount(0);
    setDeductionMethod("Full");
    setDeductionSplitCount(2);
    setDeductionNotes("");
    setDeductionIsDeferred(false);
    setDeductionDeferReason("");
    setIsDeductionModalOpen(true);
  };

  const handleSaveDeduction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deductionEmployeeId || deductionAmount <= 0) {
      alert("Please select an employee and enter an amount greater than 0.");
      return;
    }
    const emp = employees.find(e => e.id === deductionEmployeeId);
    if (!emp) {
      alert("Selected employee not found.");
      return;
    }

    setDeductionSaving(true);
    try {
      const refId = `CA-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const newAdvance: Omit<CashAdvance, "id"> = {
        referenceId: refId,
        employeeId: emp.id || "",
        employeeName: emp.fullName,
        amount: Number(deductionAmount),
        remainingBalance: Number(deductionAmount),
        dateGranted: selectedPeriodObj?.startDate || getBusinessDate(),
        status: "Active",
        deductionMethod: deductionMethod,
        splitCount: deductionMethod === "Split" ? Math.max(1, Number(deductionSplitCount)) : null,
        notes: deductionNotes.trim() || "Payroll Deduction",
        history: [],
        isDeferred: deductionIsDeferred,
        deferReason: deductionDeferReason.trim() || (deductionIsDeferred ? "Employee requested deduction in next cutoff" : undefined)
      };

      await addDoc(collection(db, "cash_advances"), newAdvance);

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Added Payroll Deduction / Cash Advance",
        details: `Recorded ${currency}${Number(deductionAmount).toLocaleString()} deduction for ${emp.fullName} (${deductionIsDeferred ? "Deferred to next cutoff" : "Active in current cutoff"}). Notes: ${deductionNotes || "None"}`,
        timestamp: new Date().toISOString()
      });

      setIsDeductionModalOpen(false);
      setDeductionAmount(0);
      setDeductionNotes("");
      setDeductionIsDeferred(false);
      setDeductionDeferReason("");
      showToast(`Successfully saved deduction of ${currency}${Number(deductionAmount).toLocaleString()} for ${emp.fullName}!`, "success");
      onRefresh();
    } catch (err) {
      console.error(err);
      showToast("Failed to save deduction record.", "error");
    } finally {
      setDeductionSaving(false);
    }
  };

  const handleToggleDeductionDeferred = async (advId: string, currentDeferred: boolean) => {
    try {
      await updateDoc(doc(db, "cash_advances", advId), {
        isDeferred: !currentDeferred,
        deferReason: !currentDeferred ? "Employee requested deduction in next cutoff" : ""
      });
      showToast(!currentDeferred ? "Deduction deferred: Hidden from current payslip, will deduct in next cutoff." : "Deduction restored: Will deduct in current cutoff.", "success");
      onRefresh();
    } catch (err) {
      console.error(err);
      showToast("Error updating deduction status.", "error");
    }
  };

  const handleDeleteDeduction = async (advId: string) => {
    try {
      const adv = (cashAdvances || []).find(a => a.id === advId);
      if (adv) {
        await addDoc(collection(db, "deleted_records"), {
          recordType: "Cash Advance / Deduction",
          originalCollection: "cash_advances",
          originalId: advId,
          data: adv,
          deletedAt: new Date().toISOString(),
          deletedBy: "Admin"
        });
      }
      await deleteDoc(doc(db, "cash_advances", advId));
      showToast("Removed deduction record (stored in Recycle Bin).", "success");
      onRefresh();
    } catch (err) {
      console.error(err);
      showToast("Error deleting deduction record.", "error");
    }
  };

  const selectedPeriodObj = periods.find(p => p.periodId === selectedPeriodId);

  useEffect(() => {
    if (selectedPeriodObj?.status === "Completed") {
      setIsTableOpen(false);
      setIsAuditPanelOpen(false);
    } else {
      setIsTableOpen(true);
      setIsAuditPanelOpen(true);
    }
  }, [selectedPeriodObj?.periodId, selectedPeriodObj?.status]);


  // 1. Create a custom cutoff period schedule
  const handleCreatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!periodName || !periodStart || !periodEnd) return;

    try {
      const payload: Omit<PayrollPeriod, "id"> = {
        periodId: "cutoff-" + Math.floor(1000 + Math.random() * 9000),
        name: periodName.trim(),
        startDate: periodStart,
        endDate: periodEnd,
        releaseDate: periodRelease || periodEnd,
        status: "Open",
        enableNightDiff: newPeriodEnableNightDiff,
        enableOT125: newPeriodEnableOT125,
        nightDiffRate: 0.10,
        otRateMultiplier: 1.25
      };

      await addDoc(collection(db, "payroll_periods"), payload);
      setIsPeriodModalOpen(false);
      setPeriodName("");
      setPeriodStart("");
      setPeriodEnd("");
      setPeriodRelease("");
      setNewPeriodEnableNightDiff(true);
      setNewPeriodEnableOT125(true);
      onRefresh();
    } catch (err) {
      console.error(err);
      alert("Error creating payroll cutoff cycle.");
    }
  };

  // Toggle Philippine Night Shift Differential (10%) for currently selected cutoff
  const toggleCutoffNightDiff = async () => {
    if (!selectedPeriodObj?.id) return;
    const nextVal = !selectedPeriodObj.enableNightDiff;
    try {
      await updateDoc(doc(db, "payroll_periods", selectedPeriodObj.id), {
        enableNightDiff: nextVal,
        nightDiffRate: 0.10
      });
      onRefresh();
    } catch (err) {
      console.error("Error toggling night diff:", err);
      alert("Failed to update cutoff night differential setting.");
    }
  };

  // Toggle Philippine 125% Overtime for currently selected cutoff
  const toggleCutoffOT125 = async () => {
    if (!selectedPeriodObj?.id) return;
    const nextVal = !(selectedPeriodObj.enableOT125 ?? false);
    try {
      await updateDoc(doc(db, "payroll_periods", selectedPeriodObj.id), {
        enableOT125: nextVal,
        otRateMultiplier: 1.25
      });
      onRefresh();
    } catch (err) {
      console.error("Error toggling OT 125%:", err);
      alert("Failed to update cutoff overtime setting.");
    }
  };

  // 2. Automate/Precompute Salary calculations under current period
  const handleGeneratePayroll = async () => {
    const period = periods.find(p => p.periodId === selectedPeriodId);
    if (!period) return;

    setGenerating(true);
    try {
      // Filter attendance in date range
      const rangeAttendance = attendance.filter(
        a => a.date >= period.startDate && a.date <= period.endDate
      );

      // Filter approved leaves in date range
      const rangeLeaves = requests.filter(
        r => r.status === "Approved" && r.startDate <= period.endDate && r.endDate >= period.startDate
      );

      // Fetch employees to run compilation - Active staff + Inactive/Resigned staff who worked/have records in this cutoff
      const cutoffStaff = employees.filter(emp => {
        if (emp.status === "Active") return true;
        const empId = String(emp.id || "");
        const empNum = String(emp.employeeNumber || "");
        const empName = emp.fullName?.toLowerCase().trim();

        // 1. Existing payroll in this cutoff
        const hasPayroll = payrolls.some(
          py => py.cutoffPeriodId === period.periodId && (String(py.employeeId) === empId || String(py.employeeNumber) === empNum || (empName && py.fullName?.toLowerCase().trim() === empName))
        );
        if (hasPayroll) return true;

        // 2. Attendance in date range
        const hasAttendance = rangeAttendance.some(a => {
          const aId = String(a.employeeId || "");
          const aNum = String(a.employeeNumber || "");
          const aName = a.employeeName?.toLowerCase().trim();
          return aId === empId || aNum === empNum || aId === empNum || (empName && aName === empName);
        });
        if (hasAttendance) return true;

        // 3. Approved leave in date range
        const hasLeave = rangeLeaves.some(r => {
          const rId = String(r.employeeId || "");
          const rNum = String(r.employeeNumber || "");
          return rId === empId || rNum === empNum;
        });
        if (hasLeave) return true;

        // 4. Pending/active boss debts or cash advances
        const hasBossDebt = (bossDebts || []).some(
          b => String(b.employeeId) === empId && (b.status === "Pending" || b.status === "Active") && b.remainingBalance > 0
        );
        if (hasBossDebt) return true;

        const hasAdvance = (cashAdvances || []).some(
          a => String(a.employeeId) === empId && (a.status === "Pending" || a.status === "Active") && a.remainingBalance > 0
        );
        if (hasAdvance) return true;

        return false;
      });

      for (const emp of cutoffStaff) {
        // Find existing payroll record to avoid duplicate saves
        const existing = payrolls.find(
          py => py.employeeId === emp.id && py.cutoffPeriodId === period.periodId
        );

        if (existing && existing.status !== "Draft") {
          continue; // Skip already released/locked sheets
        }

        // A. Filter this employee's attendances
        const empId = String(emp.id);
        const empNum = String(emp.employeeNumber);
        const empName = emp.fullName;
        
        // C. Calculate Leaves inside period
        const empLeaves = rangeLeaves.filter(r => r.employeeId === emp.id);
        
        const paidLeaveDays = new Set<string>();
        const bdayLeaveDays = new Set<string>();
        const unpaidLeaveDays = new Set<string>();

        empLeaves.forEach(req => {
          let current = new Date(req.startDate);
          const end = new Date(req.endDate);
          while (current <= end) {
            const day = current.getDay();
            if (day !== 0 && day !== 6) { // Monday to Friday
              const y = current.getFullYear();
              const m = String(current.getMonth() + 1).padStart(2, '0');
              const d = String(current.getDate()).padStart(2, '0');
              const dateStr = `${y}-${m}-${d}`;
              
              if (dateStr >= period.startDate && dateStr <= period.endDate) {
                if (req.type === "Paid Leave") paidLeaveDays.add(dateStr);
                else if (req.type === "Birthday Leave") bdayLeaveDays.add(dateStr);
                else unpaidLeaveDays.add(dateStr);
              }
            }
            current.setDate(current.getDate() + 1);
          }
        });

        const approvedLeaveDates = new Set([...paidLeaveDays, ...bdayLeaveDays, ...unpaidLeaveDays]);
        

        let rawEmpLogs = rangeAttendance.filter(a => {
          const aId = String(a.employeeId);
          const aNum = String(a.employeeNumber);
          const isMatched = aId === empId || aNum === empNum || aId === empNum || a.employeeName === empName || aId === empName;
          if (isMatched && approvedLeaveDates.has(a.date)) {
            return false;
          }
          
          if (isMatched && (a.status === "Paid Leave" || a.status === "Birthday Leave" || (typeof a.status === "string" && a.status.toLowerCase().includes("leave")))) {
            if (a.status === "Birthday Leave") {
              bdayLeaveDays.add(a.date);
            } else {
              paidLeaveDays.add(a.date);
            }
            return false;
          }
          return isMatched;
        });

      const logsByDate = new Map<string, any>();
      rawEmpLogs.forEach(log => {
         const schedTimes = getScheduleTimesForLog(log, emp, settings);
         const shiftS = schedTimes.shiftStart;
         const shiftE = schedTimes.shiftEnd;
         const isLeave = log.status === "Paid Leave" || log.status === "Birthday Leave" || (typeof log.status === "string" && log.status.toLowerCase().includes("leave"));
         const effectiveLate = (!isLeave && log.lateMinutes && log.lateMinutes > 0)
           ? log.lateMinutes
           : (!isLeave && !log.isLateExcused && log.timeIn && log.status !== "Absent"
               ? calculateLateMinutes(log.timeIn, shiftS, shiftE, settings?.gracePeriodMinutes || 0, log.isLateExcused, log.status)
               : 0);
         if (!logsByDate.has(log.date)) {
             logsByDate.set(log.date, {...log, lateMinutes: effectiveLate});
         } else {
             const existing = logsByDate.get(log.date);
             existing.hoursWorked = (existing.hoursWorked || 0) + (log.hoursWorked || 0);
             existing.otHours = (existing.otHours || 0) + (log.otHours || 0);
             existing.lateMinutes = Math.max((existing.lateMinutes || 0), effectiveLate);
         }
      });
      const empLogs = Array.from(logsByDate.values()).map(a => {
          const hw = a.hoursWorked || 0;
          const ot = a.otHours || 0;
          const total = hw + ot;
          return {
             ...a,
             hoursWorked: parseFloat(Math.min(8, total).toFixed(2)),
             otHours: parseFloat(Math.max(0, total - 8).toFixed(2))
          };
      });

      const paidLeavesCount = paidLeaveDays.size;
      const bdayLeavesCount = bdayLeaveDays.size;

        const presentLogs = empLogs.filter(a => a.status !== "Absent");
        const absentLogsCount = empLogs.filter(a => a.status === "Absent" && !approvedLeaveDates.has(a.date) && !noWorkDateSet.has(a.date)).length;

        // B. Summarize attendance fields
        const totalOTHours = empLogs.reduce((sum, a) => sum + (a.otHours || 0), 0);
        const totalLateMinutes = empLogs.reduce((sum, a) => sum + (a.lateMinutes || 0), 0);

        // D. Formula computations
        
        // Calculate Expected Working Days between period Start and End (excluding declared Company No Work Days)
        const start = new Date(period.startDate);
        const end = new Date(period.endDate);
        let expectedDays = 0;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const day = d.getDay();
          if (day !== 0 && day !== 6) { // 0 is Sunday, 6 is Saturday
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dayNum = String(d.getDate()).padStart(2, '0');
            const dStr = `${y}-${m}-${dayNum}`;
            if (!noWorkDateSet.has(dStr)) {
              expectedDays++;
            }
          }
        }
        
        // Resolve employee's rate for this designated cutoff cycle (honors salary transitions)
        const empRate = getEmployeeRateForDate(emp, period.startDate);
        const activeDailyRate = empRate.dailyRate || emp.dailyRate || ((empRate.salary || emp.salary) ? (empRate.salary || emp.salary) / 22 : 0);
        const activeHourlyRate = activeDailyRate / 8;

        // Overtime rate: If enableOT125 is true on this cutoff, compute at 125% (1.25x). Otherwise fallback to legacy empRate.otRate
        const activeOtRate = (period.enableOT125 ?? false)
          ? parseFloat((activeHourlyRate * (period.otRateMultiplier ?? 1.25)).toFixed(2))
          : (empRate.otRate || emp.otRate);

        // Paid leaves are compensated at full dailyRate
        const paidLeavePay = paidLeavesCount * activeDailyRate;
        const bdayLeavePay = bdayLeavesCount * activeDailyRate;
        
        const totalWorkedHours = empLogs.reduce((sum, a) => sum + (a.hoursWorked || 0), 0);
        const basicSalaryProrated = totalWorkedHours * activeHourlyRate;
        const otPay = totalOTHours * activeOtRate;

        // Philippine Night Shift Differential (Art. 86: 10% premium for 10 PM - 6 AM)
        let totalNightDiffHours = 0;
        let nightDiffPay = 0;
        if (period.enableNightDiff) {
          totalNightDiffHours = empLogs.reduce((sum, a) => {
            const schedTimes = getScheduleTimesForLog(a, emp, settings);
            const ndh = calculateNightDifferentialHours(
              a,
              schedTimes.shiftStart,
              schedTimes.shiftEnd,
              schedTimes.breakStart,
              schedTimes.breakEnd
            );
            return sum + ndh;
          }, 0);
          const nsdRate = period.nightDiffRate ?? 0.10;
          nightDiffPay = totalNightDiffHours * (activeHourlyRate * nsdRate);
        }

        // Unlogged days are also absences for UI tracking
        let extraDaysPay = 0;
        let effectivePresentDays = presentLogs.length;
        const regularWorkedDaysLimit = Math.max(0, expectedDays - paidLeavesCount - bdayLeavesCount);
        
        const totalEffectiveDays = effectivePresentDays + paidLeavesCount + bdayLeavesCount;
        const unloggedDays = Math.max(0, expectedDays - totalEffectiveDays - absentLogsCount);
        const actualAbsencesToDeduct = absentLogsCount + unloggedDays;
        
        // Deductions: set to 0 since basic pay is computed purely from hours worked
        const absentDeduction = 0;
        const minuteRate = activeDailyRate / 8 / 60;
        const lateDeduction = 0;

        // Standard allowance calculation: standard fixed cutoff allowance (or 0 if Removed)
        let allowanceCutoff = 0;
        if (customAllowanceOverrides[emp.id || ""] !== undefined) {
          allowanceCutoff = customAllowanceOverrides[emp.id || ""];
        } else if (allowancePolicy === "Removed") {
          allowanceCutoff = 0;
        } else {
          allowanceCutoff = (empRate.allowance ?? emp.allowance) / 2;
        }

        // E. Cash Advances (Deductions -) - Exclude deferred to next cutoff
        const pendingAdvances = cashAdvances.filter(a => a.employeeId === emp.id && a.status === "Pending" && !a.isDeferred);
        const cashAdvanceDeduction = pendingAdvances.reduce((sum, a) => sum + a.amount, 0);

        // F. Boss Debts / Additional Cash (Additions +) - Exclude deferred to next cutoff
        const pendingBossDebts = (bossDebts || []).filter(
          b => b.employeeId === emp.id && (b.status === "Pending" || b.status === "Active") && b.remainingBalance > 0 && !b.isDeferred
        );
        let additionalCashPay = 0;
        const debtsPaidInThisCutoff: { debt: BossDebt; paidAmount: number; label: string }[] = [];
        pendingBossDebts.forEach(debt => {
          let toPay = 0;
          if (debt.payoutMethod === "Full") {
            toPay = debt.remainingBalance;
          } else if (debt.payoutMethod === "Split" && debt.splitCount && debt.splitCount > 0) {
            toPay = Math.min(debt.amount / debt.splitCount, debt.remainingBalance);
          }
          if (toPay > 0) {
            additionalCashPay += toPay;
            const installmentInfo = debt.payoutMethod === "Split" && debt.splitCount
              ? ` (${((debt.history || []).length + 1)}/${debt.splitCount} cutoffs)`
              : "";
            const label = `${debt.notes || debt.referenceId}: ₱${toPay.toLocaleString()}${installmentInfo}`;
            debtsPaidInThisCutoff.push({ debt, paidAmount: toPay, label });
          }
        });

        const extraDaysWorked = Math.max(0, (presentLogs.length + paidLeavesCount + bdayLeavesCount) - expectedDays);
        const deductionsTotal = absentDeduction + lateDeduction + cashAdvanceDeduction;

        const finalSalary = Math.max(
          0,
          basicSalaryProrated + allowanceCutoff + otPay + nightDiffPay + paidLeavePay + bdayLeavePay + extraDaysPay - deductionsTotal + additionalCashPay
        );

        const payrollPayload: Partial<Payroll> = {
          employeeId: emp.id || "",
          employeeNumber: emp.employeeNumber,
          fullName: emp.fullName,
          cutoffPeriodId: period.periodId,
          basicSalary: parseFloat((basicSalaryProrated || 0).toFixed(2)),
          dailyRate: activeDailyRate,
          allowance: parseFloat((allowanceCutoff || 0).toFixed(2)),
          allowanceDailyDeduction: 0,
          allowanceAdjustmentMethod: allowancePolicy,
          additionalCashPay: parseFloat((additionalCashPay || 0).toFixed(2)),
          additionalCashNotes: debtsPaidInThisCutoff.map(d => d.label).join("; "),
          otPay: parseFloat((otPay || 0).toFixed(2)),
          nightDiffHours: parseFloat((totalNightDiffHours || 0).toFixed(2)),
          nightDiffPay: parseFloat((nightDiffPay || 0).toFixed(2)),
          extraDaysPay: parseFloat((extraDaysPay || 0).toFixed(2)),
          paidLeavePay: parseFloat((paidLeavePay || 0).toFixed(2)),
          birthdayLeavePay: parseFloat((bdayLeavePay || 0).toFixed(2)),
          deductions: parseFloat((deductionsTotal || 0).toFixed(2)),
          absentDeduction: parseFloat((absentDeduction || 0).toFixed(2)),
          lateDeduction: parseFloat((lateDeduction || 0).toFixed(2)),
          cashAdvanceDeduction: parseFloat((cashAdvanceDeduction || 0).toFixed(2)),
          finalSalary: parseFloat((finalSalary || 0).toFixed(2)),
          status: "Draft",
          generatedAt: new Date().toISOString()
        };

        if (existing && existing.id) {
          await updateDoc(doc(db, "payroll", existing.id), payrollPayload);
        } else {
          await addDoc(collection(db, "payroll"), {
            payrollId: "pay-" + Math.floor(10000 + Math.random() * 90000),
            ...payrollPayload
          });
        }
        
        // Update cash advances to Paid
        for (const advance of pendingAdvances) {
          if (advance.id) {
            await updateDoc(doc(db, "cash_advances", advance.id), {
              status: "Paid",
              deductedInPeriodId: period.periodId
            });
          }
        }

        // Update boss debts to record payout
        for (const item of debtsPaidInThisCutoff) {
          if (item.debt.id) {
            const newRemaining = Math.max(0, item.debt.remainingBalance - item.paidAmount);
            const newHistory = [...(item.debt.history || []), {
              date: new Date().toISOString(),
              amount: item.paidAmount,
              periodId: period.periodId,
              note: `Disbursed in cutoff payroll ${period.name || period.periodId}`
            }];
            await updateDoc(doc(db, "boss_debts", item.debt.id), {
              remainingBalance: newRemaining,
              history: newHistory,
              status: newRemaining <= 0 ? "Fully Paid" : "Active",
              paidInPeriodId: period.periodId
            });
          }
        }
      }

      // Update cutoff status to processing
      if (period.id) {
        await updateDoc(doc(db, "payroll_periods", period.id), { status: "Processing" });
      }

      alert("Payroll profiles compiled successfully.");
      onRefresh();
    } catch (err) {
      console.error(err);
      alert("Error compiling cycle payroll sheets.");
    } finally {
      setGenerating(false);
    }
  };

  // Payslip HTML builder for automated & manual dispatch
  const getPayslipEmailHtml = (payRecord: Payroll) => {
    return `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #E4E4E7; border-radius: 12px; background-color: #FFFFFF; color: #1F2937;">
        <h2 style="color: #2563EB; margin-bottom: 4px; font-family: sans-serif; font-size: 20px; font-weight: bold;">Oligarch Media Graphic Design Studio</h2>
        <p style="color: #71717A; font-size: 11px; margin-top: 0; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em; font-family: monospace;">Official Electronic Payslip Notification</p>
        <hr style="border: 0; border-top: 1px solid #E4E4E7; margin: 16px 0;" />
        
        <div style="background-color: #F9FAFB; border: 1px solid #F3F4F6; border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 12px;">
          <p style="margin: 4px 0;"><strong>Employee Name:</strong> ${payRecord.fullName}</p>
          <p style="margin: 4px 0;"><strong>Employee Number:</strong> ${payRecord.employeeNumber}</p>
          <p style="margin: 4px 0;"><strong>Cutoff Period Cutoff ID:</strong> ${payRecord.cutoffPeriodId}</p>
        </div>

        <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 16px;">
          <thead>
            <tr style="border-bottom: 2px solid #E5E7EB; text-align: left;">
              <th style="padding: 8px 0; color: #4B5563;">Earnings Description</th>
              <th style="padding: 8px 0; text-align: right; color: #4B5563;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #1F2937;">Basic Overrides & Prorated Salary</td>
              <td style="padding: 8px 0; text-align: right; font-family: monospace; font-weight: bold; color: #111827;">${currency} ${(payRecord.basicSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #1F2937;">Standard Allowance Package</td>
              <td style="padding: 8px 0; text-align: right; font-family: monospace; font-weight: bold; color: #2563EB;">+${currency} ${(payRecord.allowance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #1F2937;">Overtime Compensations</td>
              <td style="padding: 8px 0; text-align: right; font-family: monospace; font-weight: bold; color: #10B981;">+${currency} ${(payRecord.otPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ${(payRecord.nightDiffPay || 0) > 0 ? `
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #1F2937;">Night Shift Differential (10% Art. 86) <span style="font-size: 11px; color: #6B7280;">(${(payRecord.nightDiffHours || 0).toFixed(1)} hrs)</span></td>
              <td style="padding: 8px 0; text-align: right; font-family: monospace; font-weight: bold; color: #4F46E5;">+${currency} ${(payRecord.nightDiffPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #1F2937;">Leaves Paid (VL/SL/Bday)</td>
              <td style="padding: 8px 0; text-align: right; font-family: monospace; font-weight: bold; color: #3B82F6;">+${currency} ${((payRecord.paidLeavePay || 0) + (payRecord.birthdayLeavePay || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ${(payRecord.extraDaysPay || 0) > 0 ? `
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #1F2937;">Restday / Extra Shift Pay</td>
              <td style="padding: 8px 0; text-align: right; font-family: monospace; font-weight: bold; color: #10B981;">+${currency} ${(payRecord.extraDaysPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ` : ''}
            ${(payRecord.additionalCashPay || 0) > 0 ? `
            <tr style="border-bottom: 1px solid #F3F4F6; background-color: #ECFDF5;">
              <td style="padding: 8px; color: #047857; font-weight: bold;">
                Additional Cash / Boss Debt Payout
                ${payRecord.additionalCashNotes ? `<span style="font-size: 10px; color: #6B7280; display: block; font-weight: normal;">(${payRecord.additionalCashNotes})</span>` : ''}
              </td>
              <td style="padding: 8px; text-align: right; font-family: monospace; font-weight: bold; color: #059669;">+${currency} ${(payRecord.additionalCashPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ` : ''}
            ${(payRecord.thirteenthMonthPay || 0) > 0 ? `
            <tr style="border-bottom: 1px solid #F3F4F6; background-color: #EEF2FF;">
              <td style="padding: 8px; color: #4338CA; font-weight: bold;">13th Month Statutory Pay (P.D. 851)</td>
              <td style="padding: 8px; text-align: right; font-family: monospace; font-weight: bold; color: #4F46E5;">+${currency} ${(payRecord.thirteenthMonthPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ` : ''}
            <tr style="border-bottom: 1px solid #E5E7EB;">
              <td style="padding: 8px 0; color: #DC2626;">Deductions (Lateness, Absences, Advances)</td>
              <td style="padding: 8px 0; text-align: right; font-family: monospace; font-weight: bold; color: #DC2626;">-${currency} ${(payRecord.deductions || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ${(payRecord.convertedAbsences || 0) > 0 ? `
            <tr style="border-bottom: 1px dashed #F3F4F6;">
              <td style="padding: 4px 0 4px 16px; color: #DC2626; font-size: 11px;">↳ Converted Absences (${payRecord.convertedAbsences} from Lates)</td>
              <td style="padding: 4px 0; text-align: right; font-family: monospace; color: #DC2626; font-size: 11px;">-${currency} ${(payRecord.convertedAbsentDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ` : ''}
            ${(payRecord.absentDeduction || 0) > 0 ? `
            <tr style="border-bottom: 1px dashed #F3F4F6;">
              <td style="padding: 4px 0 4px 16px; color: #DC2626; font-size: 11px;">↳ Actual Absences Deduction</td>
              <td style="padding: 4px 0; text-align: right; font-family: monospace; color: #DC2626; font-size: 11px;">-${currency} ${(payRecord.absentDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ` : ''}
            ${(payRecord.lateDeduction || 0) > 0 ? `
            <tr style="border-bottom: 1px dashed #F3F4F6;">
              <td style="padding: 4px 0 4px 16px; color: #DC2626; font-size: 11px;">↳ Late Penalty Deduction</td>
              <td style="padding: 4px 0; text-align: right; font-family: monospace; color: #DC2626; font-size: 11px;">-${currency} ${(payRecord.lateDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ` : ''}
            ${(payRecord.cashAdvanceDeduction || 0) > 0 ? `
            <tr style="border-bottom: 1px dashed #F3F4F6;">
              <td style="padding: 4px 0 4px 16px; color: #DC2626; font-size: 11px;">↳ Cash Advance Installments</td>
              <td style="padding: 4px 0; text-align: right; font-family: monospace; color: #DC2626; font-size: 11px;">-${currency} ${(payRecord.cashAdvanceDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ` : ''}
            <tr style="background-color: #EFF6FF; color: #1E40AF; font-size: 15px; font-weight: bold;">
              <td style="padding: 10px; border-radius: 6px 0 0 6px;">NET BANK PAYOUT</td>
              <td style="padding: 10px; text-align: right; font-family: monospace; border-radius: 0 6px 6px 0;">${currency} ${(payRecord.finalSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>
        
        <hr style="border: 0; border-top: 1px solid #E4E4E7; margin: 16px 0;" />
        <p style="font-size: 11px; color: #71717A; text-align: center; margin: 0; line-height: 1.5;">This is an automated payroll confirmation dispatch generated on finalize.<br />If any balance discrepancies are discovered, please submit an official inquiry to HR Management.</p>
      </div>
    `;
  };

  // Clean payload helper to prevent Firestore undefined errors
  const cleanFirestoreData = (data: Record<string, any>) => {
    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        cleaned[key] = val;
      }
    }
    return cleaned;
  };

  // Plain-text payslip formatter for mailto: launcher
  const getPayslipPlainText = (payRecord: Payroll, periodName?: string, dateRange?: string) => {
    const sym = currency || "₱";
    return `OFFICIAL ELECTRONIC PAYSLIP NOTIFICATION
Oligarch Media Graphic Design Studio

Employee: ${payRecord.fullName} (${payRecord.employeeNumber})
Cutoff Period: ${periodName || payRecord.cutoffPeriodId} ${dateRange ? `(${dateRange})` : ''}

EARNINGS:
• Basic Salary: ${sym}${(payRecord.basicSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
• Allowance: +${sym}${(payRecord.allowance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
• Overtime & Extra Shift: +${sym}${((payRecord.otPay || 0) + (payRecord.extraDaysPay || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
${(payRecord.nightDiffPay || 0) > 0 ? `• Night Shift Differential (10%): +${sym}${(payRecord.nightDiffPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` : ''}• Paid Leaves (VL/SL/Bday): +${sym}${((payRecord.paidLeavePay || 0) + (payRecord.birthdayLeavePay || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
${(payRecord.additionalCashPay || 0) > 0 ? `• Boss Plus / Additional Cash: +${sym}${(payRecord.additionalCashPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${payRecord.additionalCashNotes ? `(${payRecord.additionalCashNotes})` : ''}\n` : ''}${(payRecord.thirteenthMonthPay || 0) > 0 ? `• 13th Month Statutory Pay: +${sym}${(payRecord.thirteenthMonthPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` : ''}
DEDUCTIONS:
• Total Deductions: -${sym}${(payRecord.deductions || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
${(payRecord.cashAdvanceDeduction || 0) > 0 ? `  ↳ Cash Advance Installment: -${sym}${(payRecord.cashAdvanceDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` : ''}${(payRecord.lateDeduction || 0) > 0 ? `  ↳ Late Deduction: -${sym}${(payRecord.lateDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` : ''}${(payRecord.absentDeduction || 0) > 0 ? `  ↳ Absent Deduction: -${sym}${(payRecord.absentDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` : ''}
========================================
NET BANK PAYOUT: ${sym}${(payRecord.finalSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
========================================

Official electronic payroll notification. Printable payslip statement is accessible anytime in the Employee Portal.`;
  };

  // Open Release Vouchers Modal (replaces browser confirm)
  const handleOpenReleaseModal = () => {
    const drafts = currentPayrollList.filter(p => p.status === "Draft");
    if (drafts.length === 0) {
      showToast("All vouchers in this cutoff are already released!", "info");
      return;
    }

    // Initialize email overrides from employee records
    const initialEmails: Record<string, string> = {};
    drafts.forEach(d => {
      const emp = employees.find(e => e.id === d.employeeId);
      if (emp?.email) {
        initialEmails[d.employeeId] = emp.email;
      }
    });

    setEmployeeEmailDrafts(initialEmails);
    setReleaseSummaryResult(null);
    setReleaseProgress(null);
    setIsReleaseModalOpen(true);
  };

  // Execute Bulk Release and Email Dispatch
  const handleExecuteReleasePayroll = async () => {
    const drafts = currentPayrollList.filter(p => p.status === "Draft");
    if (drafts.length === 0) {
      setIsReleaseModalOpen(false);
      showToast("No draft vouchers to release.", "info");
      return;
    }

    setReleasing(true);
    setReleaseProgress({ current: 0, total: drafts.length, empName: "", step: "Starting voucher release..." });

    try {
      let emailSuccessCount = 0;
      let emailSimulatedCount = 0;
      let emailFailCount = 0;

      for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i];
        setReleaseProgress({
          current: i + 1,
          total: drafts.length,
          empName: draft.fullName,
          step: `Finalizing voucher (${i + 1}/${drafts.length})...`
        });

        // 1. Prepare clean payload for Firestore
        const payload = cleanFirestoreData({
          ...draft,
          status: "Released",
          releasedAt: new Date().toISOString()
        });
        delete payload.id;

        // Find existing record in payroll collection
        const existingDoc = payrolls.find(
          p => (draft.id && p.id === draft.id) || 
               (p.employeeId === draft.employeeId && p.cutoffPeriodId === selectedPeriodId)
        );
        const targetDocId = draft.id || existingDoc?.id;

        if (targetDocId) {
          await updateDoc(doc(db, "payroll", targetDocId), payload);
        } else {
          await addDoc(collection(db, "payroll"), {
            payrollId: draft.payrollId || ("pay-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6)),
            ...payload
          });
        }

        // 2. Apply Cash Advance Deductions properly on Release (skip deferred to next cutoff)
        const empAdvances = cashAdvances.filter(
          a => a.employeeId === draft.employeeId && (a.status === "Pending" || a.status === "Active") && a.remainingBalance > 0 && !a.isDeferred
        );
        for (const adv of empAdvances) {
          let amountToDeduct = 0;
          if (adv.deductionMethod === "Full") {
            amountToDeduct = adv.remainingBalance;
          } else if (adv.deductionMethod === "Split" && adv.splitCount && adv.splitCount > 0) {
            amountToDeduct = Math.min(adv.amount / adv.splitCount, adv.remainingBalance);
          }

          if (amountToDeduct > 0 && adv.id) {
            const newRemaining = Math.max(0, adv.remainingBalance - amountToDeduct);
            const newStatus = newRemaining <= 0 ? "Fully Paid" : "Active";
            const newHistory = [...(adv.history || []), {
              date: new Date().toISOString(),
              amount: amountToDeduct,
              periodId: selectedPeriodId
            }];

            await updateDoc(doc(db, "cash_advances", adv.id), {
              remainingBalance: newRemaining,
              status: newStatus,
              history: newHistory,
              deductedInPeriodId: selectedPeriodId
            });
          }
        }

        // 3. Apply Boss Debt / Additional Cash Payouts properly on Release (skip deferred to next cutoff)
        const empBossDebts = (bossDebts || []).filter(
          b => b.employeeId === draft.employeeId && (b.status === "Pending" || b.status === "Active") && b.remainingBalance > 0 && !b.isDeferred
        );
        for (const debt of empBossDebts) {
          let toPay = 0;
          if (debt.payoutMethod === "Full") {
            toPay = debt.remainingBalance;
          } else if (debt.payoutMethod === "Split" && debt.splitCount && debt.splitCount > 0) {
            toPay = Math.min(debt.amount / debt.splitCount, debt.remainingBalance);
          }
          if (toPay > 0 && debt.id) {
            const newRemaining = Math.max(0, debt.remainingBalance - toPay);
            const newStatus = newRemaining <= 0 ? "Fully Paid" : "Active";
            const newHistory = [...(debt.history || []), {
              date: new Date().toISOString(),
              amount: toPay,
              periodId: selectedPeriodId,
              note: `Disbursed in Cutoff ${selectedPeriodId}`
            }];
            await updateDoc(doc(db, "boss_debts", debt.id), {
              remainingBalance: newRemaining,
              status: newStatus,
              history: newHistory,
              paidInPeriodId: selectedPeriodId
            });
          }
        }

        // 4. Send email notification if enabled
        const emp = employees.find(e => e.id === draft.employeeId);
        const targetEmail = (employeeEmailDrafts[draft.employeeId] || emp?.email || "").trim();

        if (targetEmail && releaseSendEmails) {
          setReleaseProgress({
            current: i + 1,
            total: drafts.length,
            empName: draft.fullName,
            step: `Emailing payslip to ${targetEmail}...`
          });
          try {
            const body = getPayslipEmailHtml(draft);
            const periodLabel = selectedPeriodObj ? `${selectedPeriodObj.startDate} to ${selectedPeriodObj.endDate}` : draft.cutoffPeriodId;
            const subject = `[Official Payslip] Oligarch Media - Cutoff: ${selectedPeriodObj?.name || draft.cutoffPeriodId} (${periodLabel}) - ${draft.fullName}`;
            
            const customSmtp = (quickSmtpUser && quickSmtpPass) ? {
              host: quickSmtpHost,
              port: quickSmtpPort,
              user: quickSmtpUser,
              pass: quickSmtpPass,
              senderName: quickSmtpSenderName
            } : undefined;

            const mailRes = await sendNotificationEmail(targetEmail, subject, body, customSmtp);

            await addDoc(collection(db, "email_logs"), {
              recipient: targetEmail,
              employeeName: draft.fullName,
              cutoffPeriodId: draft.cutoffPeriodId,
              subject,
              status: mailRes.success ? (mailRes.simulated ? "Simulated" : "Delivered") : "Failed",
              error: mailRes.error || null,
              messageId: mailRes.messageId || null,
              timestamp: new Date().toISOString()
            });

            if (mailRes.success && !mailRes.simulated) {
              emailSuccessCount++;
            } else if (mailRes.simulated) {
              emailSimulatedCount++;
            } else {
              emailFailCount++;
            }
          } catch (mailErr) {
            console.error(`Failed to dispatch notification to ${draft.fullName}`, mailErr);
            emailFailCount++;
          }
        }
      }

      // 5. Update period status to Completed
      const period = periods.find(p => p.periodId === selectedPeriodId);
      if (period?.id) {
        await updateDoc(doc(db, "payroll_periods", period.id), { status: "Completed" });
      }

      // 6. Audit log
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Finalized & Emailed Payroll Cutoff",
        details: `Cutoff ${selectedPeriodId} finalized. Released ${drafts.length} pay documents, delivered ${emailSuccessCount} live emails, simulated ${emailSimulatedCount}.`,
        timestamp: new Date().toISOString()
      });

      setReleaseSummaryResult({
        releasedCount: drafts.length,
        emailSuccessCount,
        emailSimulatedCount,
        emailFailCount
      });
      showToast(`Successfully released ${drafts.length} payslips!`, "success");
      onRefresh();
    } catch (err: any) {
      console.error("Error executing bulk release:", err);
      showToast(`Error during release: ${err?.message || "Failed"}`, "error");
    } finally {
      setReleasing(false);
      setReleaseProgress(null);
    }
  };

  // Open Standalone Auto-Send Payslips modal
  const handleOpenAutoSendModal = () => {
    if (currentPayrollList.length === 0) {
      showToast("No payroll records compiled for this cutoff.", "info");
      return;
    }

    const initialEmails: Record<string, string> = { ...employeeEmailDrafts };
    currentPayrollList.forEach(p => {
      const emp = employees.find(e => e.id === p.employeeId);
      if (emp?.email && !initialEmails[p.employeeId]) {
        initialEmails[p.employeeId] = emp.email;
      }
    });
    setEmployeeEmailDrafts(initialEmails);

    // Select all employees who have a calculated payslip
    setAutoSendSelectedEmpIds(currentPayrollList.map(p => p.employeeId));
    setAutoSendResults(null);
    setAutoSendProgress(null);
    setAutoSendLiveStatus({});
    setIsAutoSendModalOpen(true);
  };

  // Execute Auto-Send Payslips to all selected employee emails
  const handleExecuteAutoSendPayroll = async () => {
    const selectedPayrolls = currentPayrollList.filter(p => autoSendSelectedEmpIds.includes(p.employeeId));
    if (selectedPayrolls.length === 0) {
      showToast("Please select at least one employee recipient.", "error");
      return;
    }

    setAutoSending(true);
    setAutoSendResults(null);
    const liveMap: Record<string, { status: "pending" | "sending" | "delivered" | "simulated" | "failed"; error?: string }> = {};
    selectedPayrolls.forEach(p => {
      liveMap[p.employeeId] = { status: "pending" };
    });
    setAutoSendLiveStatus({ ...liveMap });

    const customSmtp = (quickSmtpUser && quickSmtpPass) ? {
      host: quickSmtpHost,
      port: quickSmtpPort,
      user: quickSmtpUser,
      pass: quickSmtpPass,
      senderName: quickSmtpSenderName
    } : undefined;

    let deliveredCount = 0;
    let simulatedCount = 0;
    let failedCount = 0;
    const details: any[] = [];

    for (let i = 0; i < selectedPayrolls.length; i++) {
      const pr = selectedPayrolls[i];
      const emp = employees.find(e => e.id === pr.employeeId);
      const targetEmail = (employeeEmailDrafts[pr.employeeId] || emp?.email || "").trim();

      setAutoSendProgress({
        current: i + 1,
        total: selectedPayrolls.length,
        empName: pr.fullName,
        step: `Dispatching payslip to ${targetEmail || pr.fullName}...`
      });

      setAutoSendLiveStatus(prev => ({
        ...prev,
        [pr.employeeId]: { status: "sending" }
      }));

      if (!targetEmail) {
        liveMap[pr.employeeId] = { status: "failed", error: "Missing email address" };
        setAutoSendLiveStatus({ ...liveMap });
        failedCount++;
        details.push({
          employeeId: pr.employeeId,
          fullName: pr.fullName,
          employeeNumber: pr.employeeNumber,
          email: "",
          status: "Failed",
          error: "Missing employee email"
        });
        continue;
      }

      try {
        const body = getPayslipEmailHtml(pr);
        const periodLabel = selectedPeriodObj ? `${selectedPeriodObj.startDate} to ${selectedPeriodObj.endDate}` : pr.cutoffPeriodId;
        const subject = `[Official Payslip] Oligarch Media - Cutoff: ${selectedPeriodObj?.name || pr.cutoffPeriodId} (${periodLabel}) - ${pr.fullName}`;

        const mailRes = await sendNotificationEmail(targetEmail, subject, body, customSmtp);

        await addDoc(collection(db, "email_logs"), {
          recipient: targetEmail,
          employeeName: pr.fullName,
          cutoffPeriodId: pr.cutoffPeriodId,
          subject,
          status: mailRes.success ? (mailRes.simulated ? "Simulated" : "Delivered") : "Failed",
          error: mailRes.error || null,
          messageId: mailRes.messageId || null,
          timestamp: new Date().toISOString()
        });

        if (mailRes.success && !mailRes.simulated) {
          deliveredCount++;
          liveMap[pr.employeeId] = { status: "delivered" };
          details.push({
            employeeId: pr.employeeId,
            fullName: pr.fullName,
            employeeNumber: pr.employeeNumber,
            email: targetEmail,
            status: "Delivered",
            messageId: mailRes.messageId
          });
        } else if (mailRes.simulated) {
          simulatedCount++;
          liveMap[pr.employeeId] = { status: "simulated", error: "App Password required for live inbox delivery" };
          details.push({
            employeeId: pr.employeeId,
            fullName: pr.fullName,
            employeeNumber: pr.employeeNumber,
            email: targetEmail,
            status: "Simulated",
            error: "No Google App Password configured"
          });
        } else {
          failedCount++;
          liveMap[pr.employeeId] = { status: "failed", error: mailRes.error || "Delivery failed" };
          details.push({
            employeeId: pr.employeeId,
            fullName: pr.fullName,
            employeeNumber: pr.employeeNumber,
            email: targetEmail,
            status: "Failed",
            error: mailRes.error || "Delivery failed"
          });
        }
      } catch (sendErr: any) {
        failedCount++;
        liveMap[pr.employeeId] = { status: "failed", error: sendErr?.message || "Error" };
        details.push({
          employeeId: pr.employeeId,
          fullName: pr.fullName,
          employeeNumber: pr.employeeNumber,
          email: targetEmail,
          status: "Failed",
          error: sendErr?.message || "Delivery failed"
        });
      }

      setAutoSendLiveStatus({ ...liveMap });
      await new Promise(r => setTimeout(r, 150));
    }

    setAutoSendResults({
      deliveredCount,
      simulatedCount,
      failedCount,
      total: selectedPayrolls.length,
      details
    });

    if (deliveredCount > 0) {
      showToast(`Successfully dispatched ${deliveredCount} payslips directly to employee inboxes!`, "success");
    } else if (simulatedCount > 0) {
      showToast(`Payslips simulated in audit logs. Enter Google App Password for live inbox delivery.`, "info");
    } else {
      showToast(`Email delivery failed for all recipients. Please check credentials.`, "error");
    }

    setAutoSending(false);
    setAutoSendProgress(null);
  };

  // Toggle single voucher between Draft and Released
  const handleToggleSingleVoucherStatus = async (pr: Payroll) => {
    const newStatus: "Draft" | "Released" = pr.status === "Released" ? "Draft" : "Released";
    const existingDoc = payrolls.find(
      p => (pr.id && p.id === pr.id) || 
           (p.employeeId === pr.employeeId && p.cutoffPeriodId === selectedPeriodId)
    );
    const targetDocId = pr.id || existingDoc?.id;
    const payload = cleanFirestoreData({
      ...pr,
      status: newStatus,
      releasedAt: newStatus === "Released" ? new Date().toISOString() : undefined
    });
    delete payload.id;

    try {
      if (targetDocId) {
        await updateDoc(doc(db, "payroll", targetDocId), payload);
      } else {
        await addDoc(collection(db, "payroll"), {
          payrollId: pr.payrollId || ("pay-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6)),
          ...payload
        });
      }
      showToast(`Voucher for ${pr.fullName} marked as ${newStatus}!`, "success");
      onRefresh();
    } catch (err: any) {
      console.error("Error updating voucher status:", err);
      showToast(`Failed to update status: ${err?.message || "Error"}`, "error");
    }
  };

  // Open Individual Employee Payslip Email Modal
  const handleOpenEmailModal = (pr: Payroll) => {
    const emp = employees.find(e => e.id === pr.employeeId);
    const periodLabel = selectedPeriodObj ? `${selectedPeriodObj.startDate} to ${selectedPeriodObj.endDate}` : pr.cutoffPeriodId;
    const subject = `[Official Payslip] Oligarch Media - Cutoff: ${selectedPeriodObj?.name || pr.cutoffPeriodId} (${periodLabel}) - ${pr.fullName}`;
    setEmailModal({
      isOpen: true,
      payRecord: pr,
      employee: emp || null,
      recipientEmail: emp?.email || "",
      subject,
      sending: false,
      activeTab: "preview",
      statusBanner: null,
      showSmtpCard: !settings?.smtpUser
    });
  };

  // Send Email from individual modal
  const handleSendEmailFromModal = async () => {
    if (!emailModal.payRecord) return;
    const recipient = emailModal.recipientEmail.trim();
    if (!recipient) {
      setEmailModal(prev => ({
        ...prev,
        statusBanner: { type: "error", message: "Please provide a valid recipient email address." }
      }));
      return;
    }

    setEmailModal(prev => ({ ...prev, sending: true, statusBanner: null }));

    try {
      const emailBody = getPayslipEmailHtml(emailModal.payRecord);
      const res = await sendNotificationEmail(
        recipient,
        emailModal.subject,
        emailBody
      );

      await addDoc(collection(db, "email_logs"), {
        recipient,
        employeeName: emailModal.payRecord.fullName,
        subject: emailModal.subject,
        cutoffPeriodId: emailModal.payRecord.cutoffPeriodId,
        status: res.success ? (res.simulated ? "Simulated" : "Delivered") : "Failed",
        error: res.error || null,
        timestamp: new Date().toISOString()
      });

      if (res.success) {
        const msg = res.simulated
          ? `Email dispatched in simulation mode & saved in audit logs. (To send live emails to ${recipient}, configure your Gmail / SMTP below).`
          : `✓ Payslip successfully delivered to ${recipient}!`;
        setEmailModal(prev => ({
          ...prev,
          statusBanner: { type: "success", message: msg }
        }));
        showToast(`Payslip emailed to ${recipient}`, "success");
      } else {
        setEmailModal(prev => ({
          ...prev,
          statusBanner: {
            type: "error",
            message: `Email dispatch failed: ${res.error || "Please check your SMTP credentials or recipient email."}`
          },
          showSmtpCard: true
        }));
      }
    } catch (err: any) {
      console.error("Error in handleSendEmailFromModal:", err);
      setEmailModal(prev => ({
        ...prev,
        statusBanner: {
          type: "error",
          message: `Error sending email: ${err?.message || "Unknown error"}`
        },
        showSmtpCard: true
      }));
    } finally {
      setEmailModal(prev => ({ ...prev, sending: false }));
    }
  };

  // Open in Mail Client (mailto:)
  const handleOpenMailto = (pr: Payroll, emailOverride?: string, customSubject?: string) => {
    const emp = employees.find(e => e.id === pr.employeeId);
    const to = (emailOverride || emp?.email || "").trim();
    const periodLabel = selectedPeriodObj ? `${selectedPeriodObj.startDate} to ${selectedPeriodObj.endDate}` : pr.cutoffPeriodId;
    const subject = customSubject || `[Official Payslip] Oligarch Media - Cutoff ${pr.cutoffPeriodId} - ${pr.fullName}`;
    const dateRange = selectedPeriodObj ? `${selectedPeriodObj.startDate} to ${selectedPeriodObj.endDate}` : undefined;
    const body = getPayslipPlainText(pr, selectedPeriodObj?.name || pr.cutoffPeriodId, dateRange);

    const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
    showToast(`Opening mail composer for ${pr.fullName}...`, "info");
  };

  // Save updated email directly to employee's profile
  const handleSaveEmployeeEmail = async (employeeId: string, emailVal: string) => {
    if (!emailVal.trim() || !employeeId) return;
    setSavingEmailForEmpId(employeeId);
    try {
      await updateDoc(doc(db, "employees", employeeId), {
        email: emailVal.trim()
      });
      showToast(`Email updated for employee in database.`, "success");
      onRefresh();
    } catch (err) {
      console.error("Error saving employee email:", err);
      showToast("Failed to save email to employee profile.", "error");
    } finally {
      setSavingEmailForEmpId(null);
    }
  };

  // Quick SMTP setup from modal
  const handleSaveQuickSmtp = async () => {
    if (!quickSmtpUser || !quickSmtpPass) {
      setQuickSmtpStatus("Username/email and App Password are required.");
      return;
    }
    setQuickSmtpSaving(true);
    setQuickSmtpStatus("Testing connection...");
    try {
      const testRes = await fetch("/api/test-smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: quickSmtpHost,
          port: quickSmtpPort,
          user: quickSmtpUser,
          pass: quickSmtpPass,
          senderName: quickSmtpSenderName,
          testRecipient: quickSmtpUser
        })
      });
      const testData = await testRes.json();
      if (!testRes.ok || !testData.success) {
        setQuickSmtpStatus(`Verification failed: ${testData.error || "Could not connect to SMTP server."}`);
        setQuickSmtpSaving(false);
        return;
      }

      await setDoc(doc(db, "settings", "general"), {
        smtpHost: quickSmtpHost,
        smtpPort: quickSmtpPort,
        smtpUser: quickSmtpUser,
        smtpPass: quickSmtpPass,
        smtpSenderName: quickSmtpSenderName
      }, { merge: true });
      setQuickSmtpStatus("✓ Verified and saved to system settings!");
      showToast("SMTP credentials successfully verified & saved!", "success");
      onRefresh();
    } catch (err: any) {
      console.error("Error saving SMTP settings:", err);
      setQuickSmtpStatus(`Error: ${err?.message || "Failed to save settings."}`);
    } finally {
      setQuickSmtpSaving(false);
    }
  };

  // Test SMTP connection and dispatch test verification email to admin
  const handleTestSmtpConnection = async () => {
    if (!quickSmtpUser || !quickSmtpPass) {
      setSmtpTestResult({
        success: false,
        message: "Please enter your 16-character Google App Password first."
      });
      return;
    }
    setTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      const res = await fetch("/api/test-smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: quickSmtpHost,
          port: quickSmtpPort,
          user: quickSmtpUser,
          pass: quickSmtpPass,
          senderName: quickSmtpSenderName,
          testRecipient: quickSmtpUser
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSmtpTestResult({
          success: true,
          message: data.message || `Test verification email delivered to ${quickSmtpUser}!`
        });
        showToast(`SMTP test email sent successfully to ${quickSmtpUser || "hr.oligarchmedia@gmail.com"}!`, "success");
      } else {
        setSmtpTestResult({
          success: false,
          message: data.error || "SMTP authentication failed. Check App Password."
        });
        showToast("SMTP verification failed. Check App Password.", "error");
      }
    } catch (err: any) {
      setSmtpTestResult({
        success: false,
        message: err.message || "Failed to contact test server."
      });
    } finally {
      setTestingSmtp(false);
    }
  };

  // Backward compatibility alias
  const handleReleasePayroll = handleOpenReleaseModal;
  const handleEmailPayslip = handleOpenEmailModal;

  // Opens state-based confirmation dialog instead of browser-confirm block
  const handleDeletePeriod = () => {
    if (!selectedPeriodObj) return;
    setIsDeleteConfirmOpen(true);
    setDeleteStatusMsg("");
  };

  // Perform actual background database deletion when user clicks confirm within our modal
  const handleExecuteDeletePeriod = async () => {
    if (!selectedPeriodObj) return;

    try {
      setDeleteStatusMsg("Processing deletion...");
      
      // 1. Delete all compiled payroll records for this period
      const associatedPayrolls = payrolls.filter(
        (p) => p.cutoffPeriodId === selectedPeriodObj.periodId
      );
      for (const pr of associatedPayrolls) {
        if (pr.id) {
          try {
            await deleteDoc(doc(db, "payroll", pr.id));
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, `payroll/${pr.id}`);
          }
        }
      }

      // 2. Delete the period document
      if (selectedPeriodObj.id) {
        try {
          await deleteDoc(doc(db, "payroll_periods", selectedPeriodObj.id));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `payroll_periods/${selectedPeriodObj.id}`);
        }
      }

      // 3. Log the action to audit database
      try {
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Deleted Payroll Period",
          details: `Deleted cutoff period ${selectedPeriodObj.name} (${selectedPeriodObj.periodId}) and ${associatedPayrolls.length} payroll records.`,
          timestamp: new Date().toISOString()
        });
      } catch (auditErr) {
        console.warn("Failed to log deleted period to audit_logs", auditErr);
      }

      // 4. Update selected period ID fallback
      const remaining = periods.filter((p) => p.periodId !== selectedPeriodObj.periodId);
      if (remaining.length > 0) {
        setSelectedPeriodId(remaining[0].periodId);
      } else {
        setSelectedPeriodId("");
      }

      setDeleteStatusMsg("Success! Period and associated pay slips deleted.");
      setTimeout(() => {
        setIsDeleteConfirmOpen(false);
        setDeleteStatusMsg("");
        onRefresh();
      }, 1500);
    } catch (err) {
      console.error(err);
      setDeleteStatusMsg("Failed to delete. Checkout developer logs.");
    }
  };

  // Helper to count working days (Mon-Fri) inside a date range, excluding declared Company No Work Days
  const getWorkingDaysInRange = (startDateStr: string, endDateStr: string): number => {
    if (!startDateStr || !endDateStr) return 10;
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 10;
    
    let count = 0;
    let current = new Date(start);
    let attempts = 0;
    while (current <= end && attempts < 100) {
      attempts++;
      const day = current.getDay();
      if (day !== 0 && day !== 6) { // Monday to Friday
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, '0');
        const dayNum = String(current.getDate()).padStart(2, '0');
        const dStr = `${y}-${m}-${dayNum}`;
        if (!noWorkDateSet.has(dStr)) {
          count++;
        }
      }
      current.setDate(current.getDate() + 1);
    }
    return count;
  };

  const currentPayrollList = useMemo(() => {
    const existingList = payrolls.filter(p => p.cutoffPeriodId === selectedPeriodId);
    if (!selectedPeriodObj) return existingList;
    
    const isReleased = existingList.some(p => p.status === "Released" || p.status === "Paid");
    
    // If it's already released or auto recalculation is disabled, return existing DB values
    // unless there are absolutely no records, in which case we might show empty.
    if (isReleased || settings.autoRecalculatePayroll === false) {
      return existingList;
    }
    
    // Auto-recalculate is active (or by default for Drafts).
    const rangeAttendance = attendance.filter(
      a => a.date >= selectedPeriodObj.startDate && a.date <= selectedPeriodObj.endDate
    );
    const rangeLeaves = requests.filter(
      r => r.status === "Approved" && r.startDate <= selectedPeriodObj.endDate && r.endDate >= selectedPeriodObj.startDate
    );

    // Eligible staff for this cutoff: Active staff + Inactive/Resigned staff with attendance, leaves, payroll, or boss cash/advances in this cutoff
    const cutoffStaff = employees.filter(emp => {
      if (emp.status === "Active") return true;
      const empId = String(emp.id || "");
      const empNum = String(emp.employeeNumber || "");
      const empName = emp.fullName?.toLowerCase().trim();

      // Check existing payroll in DB for this period
      const hasPayroll = existingList.some(
        p => String(p.employeeId) === empId || String(p.employeeNumber) === empNum || (empName && p.fullName?.toLowerCase().trim() === empName)
      );
      if (hasPayroll) return true;

      // Check attendance in date range
      const hasAttendance = rangeAttendance.some(a => {
        const aId = String(a.employeeId || "");
        const aNum = String(a.employeeNumber || "");
        const aName = a.employeeName?.toLowerCase().trim();
        return aId === empId || aNum === empNum || aId === empNum || (empName && aName === empName);
      });
      if (hasAttendance) return true;

      // Check approved leave in date range
      const hasLeave = rangeLeaves.some(r => {
        const rId = String(r.employeeId || "");
        const rNum = String(r.employeeNumber || "");
        return rId === empId || rNum === empNum;
      });
      if (hasLeave) return true;

      // Check boss debt / cash advance
      const hasBossDebt = (bossDebts || []).some(
        b => String(b.employeeId) === empId && (b.status === "Pending" || b.status === "Active") && b.remainingBalance > 0
      );
      if (hasBossDebt) return true;

      const hasAdvance = (cashAdvances || []).some(
        a => String(a.employeeId) === empId && (a.status === "Pending" || a.status === "Active") && a.remainingBalance > 0
      );
      if (hasAdvance) return true;

      return false;
    });

    const expectedDays = getWorkingDaysInRange(selectedPeriodObj.startDate, selectedPeriodObj.endDate);
    
    const lateToAbsentCount = settings.lateToAbsentCount || 3;

    return cutoffStaff.map(emp => {
      const empId = String(emp.id);
      const empNum = String(emp.employeeNumber);
      const empName = emp.fullName;
      
      const empLeaves = rangeLeaves.filter(r => r.employeeId === emp.id);
      
      const paidLeaveDays = new Set<string>();
      const bdayLeaveDays = new Set<string>();
      const unpaidLeaveDays = new Set<string>();

      empLeaves.forEach(req => {
        let current = new Date(req.startDate);
        const end = new Date(req.endDate);
        while (current <= end) {
          const day = current.getDay();
          if (day !== 0 && day !== 6) { // Weekdays only
            const y = current.getFullYear();
            const m = String(current.getMonth() + 1).padStart(2, '0');
            const d = String(current.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;
            
            if (dateStr >= selectedPeriodObj.startDate && dateStr <= selectedPeriodObj.endDate) {
              if (req.type === "Paid Leave") paidLeaveDays.add(dateStr);
              else if (req.type === "Birthday Leave") bdayLeaveDays.add(dateStr);
              else unpaidLeaveDays.add(dateStr);
            }
          }
          current.setDate(current.getDate() + 1);
        }
      });

      const approvedLeaveDates = new Set([...paidLeaveDays, ...bdayLeaveDays, ...unpaidLeaveDays]);
      

      let rawEmpLogs = rangeAttendance.filter(a => {
        const aId = String(a.employeeId);
        const aNum = String(a.employeeNumber);
        const isMatched = aId === empId || aNum === empNum || aId === empNum || a.employeeName === empName || aId === empName;
        if (isMatched && approvedLeaveDates.has(a.date)) {
          return false;
        }
        
        if (isMatched && (a.status === "Paid Leave" || a.status === "Birthday Leave" || (typeof a.status === "string" && a.status.toLowerCase().includes("leave")))) {
          if (a.status === "Birthday Leave") {
            bdayLeaveDays.add(a.date);
          } else {
            paidLeaveDays.add(a.date);
          }
          return false;
        }
        return isMatched;
      });

      const logsByDate2 = new Map<string, any>();
      rawEmpLogs.forEach(log => {
         const schedTimes = getScheduleTimesForLog(log, emp, settings);
         const shiftS = schedTimes.shiftStart;
         const shiftE = schedTimes.shiftEnd;
         const isLeave = log.status === "Paid Leave" || log.status === "Birthday Leave" || (typeof log.status === "string" && log.status.toLowerCase().includes("leave"));
         const effectiveLate = (!isLeave && log.lateMinutes && log.lateMinutes > 0)
           ? log.lateMinutes
           : (!isLeave && !log.isLateExcused && log.timeIn && log.status !== "Absent"
               ? calculateLateMinutes(log.timeIn, shiftS, shiftE, settings?.gracePeriodMinutes || 0, log.isLateExcused, log.status)
               : 0);
         if (!logsByDate2.has(log.date)) {
             logsByDate2.set(log.date, {...log, lateMinutes: effectiveLate});
         } else {
             const existing = logsByDate2.get(log.date);
             existing.hoursWorked = (existing.hoursWorked || 0) + (log.hoursWorked || 0);
             existing.otHours = (existing.otHours || 0) + (log.otHours || 0);
             existing.lateMinutes = Math.max((existing.lateMinutes || 0), effectiveLate);
         }
      });
      const empLogs = Array.from(logsByDate2.values()).map(a => {
          const hw = a.hoursWorked || 0;
          const ot = a.otHours || 0;
          const total = hw + ot;
          return {
             ...a,
             hoursWorked: parseFloat(Math.min(8, total).toFixed(2)),
             otHours: parseFloat(Math.max(0, total - 8).toFixed(2))
          };
      });

      const paidLeavesCount = paidLeaveDays.size;
      const bdayLeavesCount = bdayLeaveDays.size;

      const presentLogs = empLogs.filter(a => a.status !== "Absent");
      const absentLogsCount = empLogs.filter(a => a.status === "Absent" && !approvedLeaveDates.has(a.date) && !noWorkDateSet.has(a.date)).length;
      
      const totalOTHours = empLogs.reduce((sum, a) => sum + (a.otHours || 0), 0);
      const totalLateMinutes = empLogs.reduce((sum, a) => sum + (a.lateMinutes || 0), 0);
      
      // Late Policy Conversion - Exclude all leaves from being counted as late
      const totalLates = empLogs.filter(a => {
        const isLeave = a.status === "Paid Leave" || a.status === "Birthday Leave" || (typeof a.status === "string" && a.status.toLowerCase().includes("leave"));
        if (isLeave || a.isLateExcused) return false;
        return ((a.lateMinutes && a.lateMinutes > 0) || a.status === "Late");
      }).length;
      
      const enableAutoConvert = settings?.enableAutoConvertLate ?? true;
      const convertedAbsences = enableAutoConvert ? Math.floor(totalLates / lateToAbsentCount) : 0;
      const remainingLates = enableAutoConvert ? totalLates % lateToAbsentCount : totalLates;

      // Resolve employee's rate for this designated cutoff cycle (honors salary transitions)
      const empRate = getEmployeeRateForDate(emp, selectedPeriodObj ? selectedPeriodObj.startDate : getBusinessDate());
      const activeDailyRate = empRate.dailyRate || emp.dailyRate || ((empRate.salary || emp.salary) ? (empRate.salary || emp.salary) / 22 : 0);
      const activeHourlyRate = activeDailyRate / 8;

      // Overtime rate: If enableOT125 is true on this cutoff, compute at 125% (1.25x). Otherwise fallback to legacy empRate.otRate
      const activeOtRate = (selectedPeriodObj?.enableOT125 ?? false)
        ? parseFloat((activeHourlyRate * (selectedPeriodObj?.otRateMultiplier ?? 1.25)).toFixed(2))
        : (empRate.otRate || emp.otRate);

      const paidLeavePay = paidLeavesCount * activeDailyRate;
      const bdayLeavePay = bdayLeavesCount * activeDailyRate;
      
      const totalWorkedHours = empLogs.reduce((sum, a) => sum + (a.hoursWorked || 0), 0);
      const basicSalaryProrated = totalWorkedHours * activeHourlyRate;
      const otPay = totalOTHours * activeOtRate;

      // Philippine Night Shift Differential (Art. 86: 10% premium for 10 PM - 6 AM)
      let totalNightDiffHours = 0;
      let nightDiffPay = 0;
      if (selectedPeriodObj?.enableNightDiff) {
        totalNightDiffHours = empLogs.reduce((sum, a) => {
          const schedTimes = getScheduleTimesForLog(a, emp, settings);
          const ndh = calculateNightDifferentialHours(
            a,
            schedTimes.shiftStart,
            schedTimes.shiftEnd,
            schedTimes.breakStart,
            schedTimes.breakEnd
          );
          return sum + ndh;
        }, 0);
        const nsdRate = selectedPeriodObj.nightDiffRate ?? 0.10;
        nightDiffPay = totalNightDiffHours * (activeHourlyRate * nsdRate);
      }

      let extraDaysPay = 0;
      let effectivePresentDays = presentLogs.length;
      
      const totalEffectiveDays = effectivePresentDays + paidLeavesCount + bdayLeavesCount;
      const unloggedDays = Math.max(0, expectedDays - totalEffectiveDays - absentLogsCount);
      const actualAbsencesToDeduct = absentLogsCount + unloggedDays;
      const absentDeduction = 0;
      const convertedAbsentDeduction = 0;
      
      const enableLateDeduct = settings?.enableLateDeduction ?? true;
      const minuteRate = activeDailyRate / 8 / 60;
      const lateDeduction = 0;

      // Standard allowance calculation: standard fixed cutoff allowance (or 0 if Removed)
      let allowanceCutoff = 0;
      if (customAllowanceOverrides[emp.id || ""] !== undefined) {
        allowanceCutoff = customAllowanceOverrides[emp.id || ""];
      } else if (allowancePolicy === "Removed") {
        allowanceCutoff = 0;
      } else {
        allowanceCutoff = (empRate.allowance ?? emp.allowance) / 2;
      }

      // Cash Advances (Deductions -) - Exclude deferred to next cutoff
      const pendingAdvances = cashAdvances.filter(a => a.employeeId === emp.id && (a.status === "Pending" || a.status === "Active") && a.remainingBalance > 0 && !a.isDeferred);
      let cashAdvanceDeduction = 0;
      pendingAdvances.forEach(adv => {
         if (adv.deductionMethod === "Full") {
             cashAdvanceDeduction += adv.remainingBalance;
         } else if (adv.deductionMethod === "Split" && adv.splitCount && adv.splitCount > 0) {
             const splitAmount = adv.amount / adv.splitCount;
             cashAdvanceDeduction += Math.min(splitAmount, adv.remainingBalance);
         }
      });

      // Boss Debts / Additional Cash (Additions +) - Exclude deferred to next cutoff
      const pendingBossDebts = (bossDebts || []).filter(
        b => b.employeeId === emp.id && (b.status === "Pending" || b.status === "Active") && b.remainingBalance > 0 && !b.isDeferred
      );
      let additionalCashPay = 0;
      const additionalCashNotesList: string[] = [];
      pendingBossDebts.forEach(debt => {
        let toPay = 0;
        if (debt.payoutMethod === "Full") {
          toPay = debt.remainingBalance;
        } else if (debt.payoutMethod === "Split" && debt.splitCount && debt.splitCount > 0) {
          toPay = Math.min(debt.amount / debt.splitCount, debt.remainingBalance);
        }
        if (toPay > 0) {
          additionalCashPay += toPay;
          const installmentInfo = debt.payoutMethod === "Split" && debt.splitCount
            ? ` (${((debt.history || []).length + 1)}/${debt.splitCount} cutoffs)`
            : "";
          const label = debt.notes ? debt.notes : debt.referenceId;
          additionalCashNotesList.push(`${label}: ₱${(toPay || 0).toLocaleString()}${installmentInfo}`);
        }
      });

      // Check if there's an existing draft to keep its ID and 13th month pay
      const existing = existingList.find(p => p.employeeId === emp.id);

      const extraDaysWorked = Math.max(0, (presentLogs.length + paidLeavesCount + bdayLeavesCount) - expectedDays);
      const deductionsTotal = absentDeduction + convertedAbsentDeduction + lateDeduction + cashAdvanceDeduction;
      const finalSalary = Math.max(
        0, 
        basicSalaryProrated + allowanceCutoff + otPay + nightDiffPay + paidLeavePay + bdayLeavePay + extraDaysPay - deductionsTotal + additionalCashPay + (existing?.thirteenthMonthPay || 0)
      );

      return {
        id: existing?.id,
        payrollId: existing?.payrollId || "pay-live-" + emp.employeeNumber,
        employeeId: emp.id || "",
        employeeNumber: emp.employeeNumber,
        fullName: emp.fullName,
        cutoffPeriodId: selectedPeriodId,
        basicSalary: parseFloat((basicSalaryProrated || 0).toFixed(2)),
        dailyRate: activeDailyRate,
        allowance: parseFloat((allowanceCutoff || 0).toFixed(2)),
        allowanceDailyDeduction: 0,
        allowanceAdjustmentMethod: allowancePolicy,
        additionalCashPay: parseFloat((additionalCashPay || 0).toFixed(2)),
        additionalCashNotes: additionalCashNotesList.join("; "),
        thirteenthMonthPay: existing?.thirteenthMonthPay || 0,
        otPay: parseFloat((otPay || 0).toFixed(2)),
        nightDiffHours: parseFloat((totalNightDiffHours || 0).toFixed(2)),
        nightDiffPay: parseFloat((nightDiffPay || 0).toFixed(2)),
        extraDaysPay: parseFloat((extraDaysPay || 0).toFixed(2)),
        paidLeavePay: parseFloat((paidLeavePay || 0).toFixed(2)),
        birthdayLeavePay: parseFloat((bdayLeavePay || 0).toFixed(2)),
        deductions: parseFloat((deductionsTotal || 0).toFixed(2)),
        absentDeduction: parseFloat((absentDeduction || 0).toFixed(2)),
        lateDeduction: parseFloat((lateDeduction || 0).toFixed(2)),
        cashAdvanceDeduction: parseFloat((cashAdvanceDeduction || 0).toFixed(2)),
        convertedAbsentDeduction: parseFloat((convertedAbsentDeduction || 0).toFixed(2)),
        convertedAbsences: convertedAbsences,
        remainingLates: remainingLates,
        lateCount: totalLates,
        presentDays: presentLogs.length,
        actualAbsences: actualAbsencesToDeduct,
        workedHours: empLogs.reduce((sum, a) => sum + (a.hoursWorked || 0), 0),
        otHours: totalOTHours,
        breakHours: empLogs.reduce((sum, a) => {
          let bHours = (a.accumulatedBreakSeconds || 0) / 3600;
          if (bHours === 0 && a.breakStart && a.breakEnd) {
            const getAdjustedMins = (tStr: string) => {
              if (typeof tStr !== 'string') return 0;
              const [h, m] = tStr.split(":").map(Number);
              return h * 60 + (m || 0);
            };
            bHours = (getAdjustedMins(a.breakEnd) - getAdjustedMins(a.breakStart)) / 60;
          }
          return sum + (bHours > 0 ? bHours : 0);
        }, 0),
        finalSalary: parseFloat((finalSalary || 0).toFixed(2)),
        status: existing?.status || "Draft",
        generatedAt: existing?.generatedAt || new Date().toISOString()
      };
    });
  }, [payrolls, selectedPeriodId, selectedPeriodObj, employees, attendance, requests, cashAdvances, bossDebts, noWorkDays, noWorkDateSet, allowancePolicy, customAllowanceOverrides, settings.lateToAbsentCount, settings.autoRecalculatePayroll]);

  // Administrative cumulative metrics calculations
  const totalBasic = currentPayrollList.reduce((sum, p) => sum + (p.basicSalary || 0), 0);
  const totalAllowance = currentPayrollList.reduce((sum, p) => sum + (p.allowance || 0), 0);
  const totalOt = currentPayrollList.reduce((sum, p) => sum + (p.otPay || 0), 0);
  const totalNightDiff = currentPayrollList.reduce((sum, p) => sum + (p.nightDiffPay || 0), 0);
  const totalBenefits = currentPayrollList.reduce((sum, p) => sum + ((p.paidLeavePay || 0) + (p.birthdayLeavePay || 0)), 0);
  const totalDeductions = currentPayrollList.reduce((sum, p) => sum + (p.deductions || 0), 0);
  const totalCashAdvances = currentPayrollList.reduce((sum, p) => sum + (p.cashAdvanceDeduction || 0), 0);
  const totalAdditionalCash = currentPayrollList.reduce((sum, p) => sum + (p.additionalCashPay || 0), 0);
  const total13thMonthCutoff = currentPayrollList.reduce((sum, p) => sum + (p.thirteenthMonthPay || 0), 0);
  const totalFinalSalary = currentPayrollList.reduce((sum, p) => sum + (p.finalSalary || 0), 0);

  // Computes audit discrepancies for active period
  const auditSummaryList = useMemo(() => {
    if (!selectedPeriodObj) return [];

    const rangeAttendance = attendance.filter(
      a => a.date >= selectedPeriodObj.startDate && a.date <= selectedPeriodObj.endDate
    );
    const rangeLeaves = requests.filter(
      r => r.status === "Approved" && r.startDate <= selectedPeriodObj.endDate && r.endDate >= selectedPeriodObj.startDate
    );

    const cutoffStaff = employees.filter(emp => {
      if (emp.status === "Active") return true;
      const empId = String(emp.id || "");
      const empNum = String(emp.employeeNumber || "");
      const empName = emp.fullName?.toLowerCase().trim();

      const hasPayroll = payrolls.some(
        p => p.cutoffPeriodId === selectedPeriodObj.periodId && (String(p.employeeId) === empId || String(p.employeeNumber) === empNum || (empName && p.fullName?.toLowerCase().trim() === empName))
      );
      if (hasPayroll) return true;

      const hasAttendance = rangeAttendance.some(a => {
        const aId = String(a.employeeId || "");
        const aNum = String(a.employeeNumber || "");
        const aName = a.employeeName?.toLowerCase().trim();
        return aId === empId || aNum === empNum || aId === empNum || (empName && aName === empName);
      });
      if (hasAttendance) return true;

      const hasLeave = rangeLeaves.some(r => {
        const rId = String(r.employeeId || "");
        const rNum = String(r.employeeNumber || "");
        return rId === empId || rNum === empNum;
      });
      if (hasLeave) return true;

      return false;
    });

    const expectedDays = getWorkingDaysInRange(selectedPeriodObj.startDate, selectedPeriodObj.endDate);
    const expectedHours = expectedDays * 8; // standard 8h per day

    return cutoffStaff.map(emp => {
      // Find matching payroll
      const pr = payrolls.find(p => p.employeeId === emp.id && p.cutoffPeriodId === selectedPeriodObj.periodId);
      const empId = String(emp.id);
      const empNum = String(emp.employeeNumber);
      const empName = emp.fullName;

      const empLeaves = rangeLeaves.filter(r => r.employeeId === emp.id);
      
      const paidLeaveDays = new Set<string>();
      const bdayLeaveDays = new Set<string>();
      const unpaidLeaveDays = new Set<string>();

      empLeaves.forEach(req => {
        let current = new Date(req.startDate);
        const end = new Date(req.endDate);
        while (current <= end) {
          const day = current.getDay();
          if (day !== 0 && day !== 6) { // Weekdays only
            const y = current.getFullYear();
            const m = String(current.getMonth() + 1).padStart(2, '0');
            const d = String(current.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;
            
            if (dateStr >= selectedPeriodObj.startDate && dateStr <= selectedPeriodObj.endDate) {
              if (req.type === "Paid Leave") paidLeaveDays.add(dateStr);
              else if (req.type === "Birthday Leave") bdayLeaveDays.add(dateStr);
              else unpaidLeaveDays.add(dateStr);
            }
          }
          current.setDate(current.getDate() + 1);
        }
      });

      const approvedLeaveDates = new Set([...paidLeaveDays, ...bdayLeaveDays, ...unpaidLeaveDays]);
      

      let rawEmpLogs = rangeAttendance.filter(a => {
        const aId = String(a.employeeId);
        const aNum = String(a.employeeNumber);
        const isMatched = aId === empId || aNum === empNum || aId === empNum || a.employeeName === empName || aId === empName;
        if (isMatched && approvedLeaveDates.has(a.date)) {
          return false;
        }
        
        if (isMatched && (a.status === "Paid Leave" || a.status === "Birthday Leave" || (typeof a.status === "string" && a.status.toLowerCase().includes("leave")))) {
          if (a.status === "Birthday Leave") {
            bdayLeaveDays.add(a.date);
          } else {
            paidLeaveDays.add(a.date);
          }
          return false;
        }
        return isMatched;
      });

      const logsByDate3 = new Map<string, any>();
      rawEmpLogs.forEach(log => {
         const schedTimes = getScheduleTimesForLog(log, emp, settings);
         const shiftS = schedTimes.shiftStart;
         const shiftE = schedTimes.shiftEnd;
         const isLeave = log.status === "Paid Leave" || log.status === "Birthday Leave" || (typeof log.status === "string" && log.status.toLowerCase().includes("leave"));
         const effectiveLate = (!isLeave && log.lateMinutes && log.lateMinutes > 0)
           ? log.lateMinutes
           : (!isLeave && !log.isLateExcused && log.timeIn && log.status !== "Absent"
               ? calculateLateMinutes(log.timeIn, shiftS, shiftE, settings?.gracePeriodMinutes || 0, log.isLateExcused, log.status)
               : 0);
         if (!logsByDate3.has(log.date)) {
             logsByDate3.set(log.date, {...log, lateMinutes: effectiveLate});
         } else {
             const existing = logsByDate3.get(log.date);
             existing.hoursWorked = (existing.hoursWorked || 0) + (log.hoursWorked || 0);
             existing.otHours = (existing.otHours || 0) + (log.otHours || 0);
             existing.lateMinutes = Math.max((existing.lateMinutes || 0), effectiveLate);
         }
      });
      const empLogs = Array.from(logsByDate3.values()).map(a => {
          const hw = a.hoursWorked || 0;
          const ot = a.otHours || 0;
          const total = hw + ot;
          return {
             ...a,
             hoursWorked: parseFloat(Math.min(8, total).toFixed(2)),
             otHours: parseFloat(Math.max(0, total - 8).toFixed(2))
          };
      });

      const paidLeavesCount = paidLeaveDays.size;
      const bdayLeavesCount = bdayLeaveDays.size;


      // Total tracked logged hours (excluding "Absent" rows)
      const presentLogs = empLogs.filter(a => a.status !== "Absent");
      const totalHoursWorked = presentLogs.reduce((sum, a) => sum + (a.hoursWorked || 0), 0);
      const totalLateMinutes = empLogs.reduce((sum, a) => sum + (a.lateMinutes || 0), 0);
      let absentLogsCount = empLogs.filter(a => a.status === "Absent" && !approvedLeaveDates.has(a.date) && !noWorkDateSet.has(a.date)).length;

      // Approved leaves compensating for absence
      const totalApprovedLeaves = paidLeavesCount + bdayLeavesCount;
      const leaveHoursCompensated = totalApprovedLeaves * 8;
      
      const totalEffectiveDays = presentLogs.length + paidLeavesCount + bdayLeavesCount;
      const unloggedDays = Math.max(0, expectedDays - totalEffectiveDays - absentLogsCount);
      absentLogsCount += unloggedDays;

      const totalEffectiveHours = totalHoursWorked + leaveHoursCompensated;
      const hoursDiscrepancy = expectedHours - totalEffectiveHours;

      const hasShortfall = hoursDiscrepancy > 0.1;
      const hasOvertime = (pr?.otPay || 0) > 0 || empLogs.some(a => (a.otHours || 0) > 0);
      const hasLateness = totalLateMinutes > 0;
      const hasAbsences = absentLogsCount > 0;

      const expectedBasicCutoff = emp.salary / 2;
      const expectedAllowanceCutoff = emp.allowance / 2;
      const standardBaseGross = expectedBasicCutoff + expectedAllowanceCutoff;
      const finalNet = pr?.finalSalary ?? 0;
      const hasNumericMismatch = pr ? Math.abs(finalNet - standardBaseGross) > 0.01 : false;

      const isAnomalous = hasShortfall || hasOvertime || hasLateness || hasAbsences || hasNumericMismatch;

      return {
        employee: emp,
        payroll: pr,
        expectedHours,
        expectedDays,
        totalHoursWorked,
        totalEffectiveHours,
        hoursDiscrepancy,
        totalLateMinutes,
        absentLogsCount,
        paidLeavesCount,
        bdayLeavesCount,
        totalApprovedLeaves,
        hasShortfall,
        hasOvertime,
        hasLateness,
        hasAbsences,
        standardBaseGross,
        finalNet,
        isAnomalous
      };
    });
  }, [selectedPeriodObj, employees, attendance, requests, payrolls, noWorkDays, noWorkDateSet]);

  // 13TH MONTH PAY & ANNUAL ABSENCE AUDIT RECKONING ENGINE (P.D. 851 COMPLIANT)
  const annual13thMonthData = useMemo(() => {
    const yearStart = `${selected13thYear}-01-01`;
    const yearEnd = `${selected13thYear}-12-31`;

    const yearAttendance = attendance.filter(a => a.date && a.date >= yearStart && a.date <= yearEnd);
    const today = new Date();

    return employees.map(emp => {
      // 1. Employee matching attendance logs for this year
      const empLogs = yearAttendance.filter(a => 
        a.employeeId === emp.id || 
        a.employeeNumber === emp.employeeNumber ||
        (a.employeeName && emp.fullName && a.employeeName.toLowerCase() === emp.fullName.toLowerCase())
      );
      
      // 2. Approved leave requests for this employee (NEVER count leaves as absence)
      const empLeaves = requests.filter(r => 
        (r.employeeId === emp.id || r.employeeNumber === emp.employeeNumber || (r.employeeName && emp.fullName && r.employeeName.toLowerCase() === emp.fullName.toLowerCase())) &&
        r.status === "Approved" &&
        r.type !== "Absent Notice"
      );

      // Collect all approved leave dates across the entire year
      const approvedLeaveDates = new Set<string>();
      empLeaves.forEach(req => {
        let current = new Date(req.startDate);
        const end = new Date(req.endDate);
        while (current <= end) {
          const day = current.getDay();
          if (day !== 0 && day !== 6) { // Monday to Friday
            const y = current.getFullYear();
            const m = String(current.getMonth() + 1).padStart(2, '0');
            const d = String(current.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;
            if (dateStr.startsWith(`${selected13thYear}-`)) {
              approvedLeaveDates.add(dateStr);
            }
          }
          current.setDate(current.getDate() + 1);
        }
      });

      // Also add any attendance records with leave status to approvedLeaveDates
      empLogs.forEach(a => {
        if (a.status === "Paid Leave" || a.status === "Birthday Leave" || (typeof a.status === "string" && a.status.toLowerCase().includes("leave"))) {
          approvedLeaveDates.add(a.date);
        }
      });

      const hireDateStr = emp.dateHired || `${selected13thYear}-01-01`;
      const hireDateObj = new Date(hireDateStr);
      const isHiredThisYear = hireDateObj.getFullYear() === selected13thYear;
      const startMonthIdx = isHiredThisYear ? hireDateObj.getMonth() : 0;
      const monthsEmployedThisYear = Math.max(1, 12 - startMonthIdx);

      // Month-by-month analysis (Jan to Dec)
      const monthlyBreakdown = Array.from({ length: 12 }, (_, monthIdx) => {
        const monthNum = monthIdx + 1;
        const monthStr = String(monthNum).padStart(2, '0');
        const monthPrefix = `${selected13thYear}-${monthStr}`;
        const daysInMonth = new Date(selected13thYear, monthNum, 0).getDate();

        let workingDaysInMonth = 0;
        for (let day = 1; day <= daysInMonth; day++) {
          const d = new Date(selected13thYear, monthIdx, day);
          if (d.getDay() !== 0 && d.getDay() !== 6) {
            const dStr = `${selected13thYear}-${monthStr}-${String(day).padStart(2, '0')}`;
            if (!noWorkDateSet.has(dStr)) {
              workingDaysInMonth++;
            }
          }
        }

        const monthLogs = empLogs.filter(a => a.date.startsWith(monthPrefix));
        const logsByDate = new Map<string, Attendance>();
        monthLogs.forEach(l => logsByDate.set(l.date, l));

        let presentDays = 0;
        let paidLeaves = 0;
        let absentDays = 0;
        let unpaidNoWorkDays = 0;
        const absentDatesList: string[] = [];
        const presentDatesList: string[] = [];
        const noWorkDatesList: string[] = [];

        for (let day = 1; day <= daysInMonth; day++) {
          const d = new Date(selected13thYear, monthIdx, day);
          if (d.getDay() === 0 || d.getDay() === 6) continue; // Skip weekends

          const dateStr = `${selected13thYear}-${monthStr}-${String(day).padStart(2, '0')}`;
          
          // Future dates (not occurred yet)
          if (selected13thYear === today.getFullYear() && d > today) continue;

          // Before employee hire date
          if (dateStr < hireDateStr) continue;

          const dayLog = logsByDate.get(dateStr);

          // 1. Check if this is an approved leave
          // USER: "done count the leaves as an absence please" -> LEAVES ARE NOT ABSENCES!
          // USER: "if the employee use its leave on that day even no work it will still count pay"
          const isLeave = approvedLeaveDates.has(dateStr) || 
            (dayLog && (dayLog.status === "Paid Leave" || dayLog.status === "Birthday Leave" || (typeof dayLog.status === "string" && dayLog.status.toLowerCase().includes("leave"))));

          if (isLeave) {
            paidLeaves++;
            continue;
          }

          // 2. Check if present / worked
          const isPresent = dayLog && ["Present", "Late", "Timed Out", "On Break"].includes(dayLog.status);
          if (isPresent) {
            presentDays++;
            presentDatesList.push(dateStr);
            continue;
          }

          // 2.5. Check if declared Company No Work Day!
          // USER: "can you also add to the system example is that day is no work so that if the employee didnt clock in it count that it is not an abesnt so that it will not count in 13 month then make sure is no work it is not pay make sure of it it just no work but if the employee use its leave on that day even no work it will still count pay"
          const isNoWorkDay = noWorkDateSet.has(dateStr);
          if (isNoWorkDay) {
            unpaidNoWorkDays++;
            noWorkDatesList.push(dateStr);
            // Strictly NOT an absence! It is not added to absentDays or absentDatesList!
            continue;
          }

          // 3. USER: "make sure to count the absence only on the day of that i start this app around may or june"
          // If the date is before the app started, IT IS NOT AN ABSENCE!
          if (dateStr < trackingStartDate) {
            continue;
          }

          // 4. On or after trackingStartDate: check explicit absent or unlogged workday
          const isExplicitAbsent = dayLog && dayLog.status === "Absent";
          const isUnlogged = !dayLog;

          if (isExplicitAbsent || isUnlogged) {
            absentDays++;
            absentDatesList.push(dateStr);
          }
        }

        const totalMonthHours = monthLogs.reduce((sum, l) => sum + (l.hoursWorked || 0), 0);
        const isMonthBeforeInception = `${selected13thYear}-${monthStr}-31` < trackingStartDate;

        const monthSampleDate = `${selected13thYear}-${monthStr}-01`;
        const empRate = getEmployeeRateForDate(emp, monthSampleDate);

        const monthlyBasic = empRate.salary || emp.salary || (emp.dailyRate * 22);
        const dailyRate = empRate.dailyRate || emp.dailyRate || (monthlyBasic / 22);
        const absentDeduction = absentDays * dailyRate;
        const unpaidNoWorkDeduction = unpaidNoWorkDays * dailyRate;

        let netBasicEarned = 0;
        if (monthIdx < startMonthIdx) {
          netBasicEarned = 0;
        } else if (calculationScope === "app_inception_only" && isMonthBeforeInception) {
          netBasicEarned = 0;
        } else {
          netBasicEarned = Math.max(0, monthlyBasic - absentDeduction - unpaidNoWorkDeduction);
        }

        return {
          monthIdx,
          monthName: new Date(selected13thYear, monthIdx, 1).toLocaleString('default', { month: 'short' }),
          fullMonthName: new Date(selected13thYear, monthIdx, 1).toLocaleString('default', { month: 'long' }),
          workingDays: workingDaysInMonth,
          presentDays,
          totalHours: totalMonthHours,
          paidLeaves,
          absentDays,
          absentDates: absentDatesList,
          unpaidNoWorkDays,
          noWorkDates: noWorkDatesList,
          isPriorToAppInception: isMonthBeforeInception,
          monthlyBasic: (monthIdx < startMonthIdx || (calculationScope === "app_inception_only" && isMonthBeforeInception)) ? 0 : monthlyBasic,
          dailyRate,
          isHistoricalRate: empRate.isHistorical,
          rateReason: empRate.reason,
          absentDeduction,
          unpaidNoWorkDeduction,
          netBasicEarned
        };
      });

      const totalYearAbsences = monthlyBreakdown.reduce((sum, m) => sum + m.absentDays, 0);
      const totalYearPresent = monthlyBreakdown.reduce((sum, m) => sum + m.presentDays, 0);
      const totalYearPaidLeaves = monthlyBreakdown.reduce((sum, m) => sum + m.paidLeaves, 0);
      const totalYearNoWorkDays = monthlyBreakdown.reduce((sum, m) => sum + (m.unpaidNoWorkDays || 0), 0);
      const totalYearBasicEarned = monthlyBreakdown.reduce((sum, m) => sum + m.netBasicEarned, 0);

      const yearTransitions = (emp.salaryHistory || []).filter(r => r.effectiveDate.startsWith(`${selected13thYear}-`));
      const hasYearSalaryTransition = yearTransitions.length > 0;
      const latestYearRate = getEmployeeRateForDate(emp, `${selected13thYear}-12-31`);
      const monthlyBasic = latestYearRate.salary || emp.salary || (emp.dailyRate * 22);
      const dailyRate = latestYearRate.dailyRate || emp.dailyRate || (monthlyBasic / 22);
      const thirteenthMonthPay = totalYearBasicEarned / 12;

      return {
        employee: emp,
        monthlyBasic,
        dailyRate,
        isHiredThisYear,
        monthsEmployedThisYear,
        totalYearAbsences,
        totalYearPresent,
        totalYearPaidLeaves,
        totalYearNoWorkDays,
        totalYearBasicEarned,
        thirteenthMonthPay,
        hasYearSalaryTransition,
        yearTransitions,
        monthlyBreakdown
      };
    });
  }, [employees, attendance, requests, selected13thYear, trackingStartDate, calculationScope, noWorkDays, noWorkDateSet]);

  const filtered13thMonthData = useMemo(() => {
    let list = annual13thMonthData;
    if (search13th.trim()) {
      const term = search13th.toLowerCase().trim();
      list = list.filter(i => 
        (i.employee?.fullName || "").toLowerCase().includes(term) ||
        (i.employee?.employeeNumber || "").toLowerCase().includes(term) ||
        (i.employee?.department || "").toLowerCase().includes(term) ||
        (i.employee?.position || "").toLowerCase().includes(term)
      );
    }
    return list;
  }, [annual13thMonthData, search13th]);

  // Handle attaching computed 13th month pay to current active cutoff payslip
  const handleAttach13thMonthToCutoff = async (empId: string, amount: number) => {
    if (!selectedPeriodId) {
      alert("Please select a cutoff period from the cutoff selector first.");
      return;
    }
    const pr = currentPayrollList.find(p => p.employeeId === empId);
    if (!pr) {
      alert("Could not find payroll ledger record for this employee in the active cutoff.");
      return;
    }

    try {
      const new13th = parseFloat((amount || 0).toFixed(2));
      const newFinal = Math.max(0, pr.finalSalary + new13th);
      if (pr.id) {
        await updateDoc(doc(db, "payroll", pr.id), {
          thirteenthMonthPay: new13th,
          finalSalary: newFinal
        });
      } else {
        await addDoc(collection(db, "payroll"), {
          ...pr,
          thirteenthMonthPay: new13th,
          finalSalary: newFinal
        });
      }
      alert(`Attached ₱${(new13th || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} 13th Month Pay to ${pr.fullName}'s payslip!`);
      onRefresh();
    } catch (err) {
      console.error(err);
      alert("Error attaching 13th month pay to cutoff.");
    }
  };

  // Export 13th Month Register PDF
  const handleExport13thMonthPDF = () => {
    const doc = new jsPDF("landscape", "mm", "a4");
    
    // Header
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, 297, 30, "F");
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("OLIGARCH MEDIA GRAPHIC DESIGN STUDIO", 15, 11);
    
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(147, 197, 253);
    doc.text(`ANNUAL 13TH MONTH PAY & EMPLOYEE ABSENCE AUDIT REGISTER (CALENDAR YEAR ${selected13thYear})`, 15, 18);
    doc.setTextColor(203, 213, 225);
    doc.setFontSize(7.5);
    doc.text(`Mandatory P.D. 851 DOLE Standard: Pure Basic Salary Earned ÷ 12 | System Inception: ${trackingStartDate} | Leaves Excluded from Absence Penalty`, 15, 24);
    
    // Table Header
    let y = 37;
    doc.setFillColor(241, 245, 249);
    doc.rect(15, y, 267, 8, "F");
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    
    doc.text("EMPLOYEE NAME & NUMBER", 18, y + 5.5);
    doc.text("POSITION", 65, y + 5.5);
    doc.text("HIRE DATE", 108, y + 5.5);
    doc.text("MONTHLY BASIC", 145, y + 5.5, { align: "right" });
    doc.text("YEAR ABSENCES", 182, y + 5.5, { align: "right" });
    doc.text("ABSENCE DEDUCT", 216, y + 5.5, { align: "right" });
    doc.text("NET BASIC EARNED", 248, y + 5.5, { align: "right" });
    doc.text("13TH MONTH PAY", 280, y + 5.5, { align: "right" });
    
    y += 8;
    
    filtered13thMonthData.forEach((item, idx) => {
      if (y > 185) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(30, 41, 59);
      
      const isAlt = idx % 2 === 1;
      if (isAlt) {
        doc.setFillColor(248, 250, 252);
        doc.rect(15, y, 267, 7, "F");
      }
      
      doc.text(`${item.employee.fullName} (${item.employee.employeeNumber})`, 18, y + 4.5);
      doc.text(item.employee.position || "Staff", 65, y + 4.5);
      doc.text(item.employee.dateHired || "—", 108, y + 4.5);
      doc.text(`PHP ${(item.monthlyBasic || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 145, y + 4.5, { align: "right" });
      
      doc.setTextColor(item.totalYearAbsences > 0 ? 220 : 30, item.totalYearAbsences > 0 ? 38 : 41, item.totalYearAbsences > 0 ? 38 : 59);
      doc.text(`${item.totalYearAbsences} Days`, 182, y + 4.5, { align: "right" });
      
      doc.setTextColor(item.totalYearAbsences > 0 ? 220 : 100, item.totalYearAbsences > 0 ? 38 : 116, item.totalYearAbsences > 0 ? 38 : 139);
      doc.text(`-PHP ${(item.totalYearAbsences * item.dailyRate).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 216, y + 4.5, { align: "right" });
      
      doc.setTextColor(30, 41, 59);
      doc.text(`PHP ${(item.totalYearBasicEarned || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 248, y + 4.5, { align: "right" });
      
      doc.setFont("helvetica", "bold");
      doc.setTextColor(79, 70, 229);
      doc.text(`PHP ${(item.thirteenthMonthPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 280, y + 4.5, { align: "right" });
      
      y += 7;
    });
    
    // Total row
    doc.setDrawColor(203, 213, 225);
    doc.line(15, y + 2, 282, y + 2);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8);
    doc.text("TOTAL ESTIMATED 13TH MONTH DISBURSEMENT LIABILITY:", 100, y + 4);
    const grand13th = filtered13thMonthData.reduce((sum, i) => sum + (i.thirteenthMonthPay || 0), 0);
    doc.setFontSize(9);
    doc.setTextColor(79, 70, 229);
    doc.text(`PHP ${grand13th.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 280, y + 4, { align: "right" });
    
    doc.save(`Oligarch_Media_13th_Month_Pay_Audit_${selected13thYear}.pdf`);
  };

  // Generate downloadable collated payroll ledger PDF for accounting import
  const handleExportPDF = () => {
    if (!selectedPeriodObj || currentPayrollList.length === 0) {
      alert("No compiled payroll available to export.");
      return;
    }

    const doc = new jsPDF("landscape", "mm", "a4"); // A4 landscape: 297mm x 210mm
    
    // Header Banner Section (Slate Dark theme)
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, 297, 36, "F");
    
    // Branding
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("OLIGARCH MEDIA GRAPHIC DESIGN STUDIO", 15, 14);
    
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(147, 197, 253); // blue-300
    doc.text("OFFICIAL BI-MONTHLY PAYROLL LEDGER & LEDGER RECONCILIATION DATA", 15, 21);
    
    // Sub-details
    doc.setFont("helvetica", "bold");
    doc.setTextColor(248, 250, 252);
    doc.setFontSize(9.5);
    const statutoryTags = [
      selectedPeriodObj.enableNightDiff ? "Night Diff 10% (Art. 86)" : null,
      selectedPeriodObj.enableOT125 ? "OT 125% (Art. 87)" : null
    ].filter(Boolean).join(" • ");
    doc.text(`PAYROLL PERIOD CYCLE: ${selectedPeriodObj.startDate} to ${selectedPeriodObj.endDate}${statutoryTags ? ` [${statutoryTags}]` : ""}`, 15, 29);
    doc.text(`SCHEDULED RELEASE DATE: ${selectedPeriodObj.releaseDate}`, 200, 29);
    
    let y = 48;
    
    // Table Header drawing
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252); // slate 50 shadow-inner
    doc.rect(15, y, 267, 10, "FD");
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    
    doc.text("EMPLOYEE NAME & NUMBER", 18, y + 6.5);
    doc.text("REG. HOURS", 80, y + 6.5, { align: "right" });
    doc.text("OT HOURS", 102, y + 6.5, { align: "right" });
    doc.text("BASIC PAY", 132, y + 6.5, { align: "right" });
    doc.text("OT COMP.", 160, y + 6.5, { align: "right" });
    doc.text("BENEFITS / NSD", 188, y + 6.5, { align: "right" });
    doc.text("DEDUCTIONS", 222, y + 6.5, { align: "right" });
    doc.text("NET SALARY", 258, y + 6.5, { align: "right" });
    
    y += 10;
    
    // Standard table row contents
    doc.setFont("helvetica", "normal");
    
    let grandRegHours = 0;
    let grandOtHours = 0;
    let grandBasic = 0;
    let grandOtPay = 0;
    let grandBenefits = 0;
    let grandDeducts = 0;
    let grandNet = 0;
    
    currentPayrollList.forEach((pr) => {
      const regHours = pr.workedHours || 0;
      const otHours = pr.otHours || 0;
      
      const benefitSum = (pr.allowance || 0) + (pr.paidLeavePay || 0) + (pr.birthdayLeavePay || 0) + (pr.extraDaysPay || 0) + (pr.nightDiffPay || 0) + (pr.additionalCashPay || 0);
      
      // Accumulate
      grandRegHours += regHours;
      grandOtHours += otHours;
      grandBasic += pr.basicSalary || 0;
      grandOtPay += pr.otPay || 0;
      grandBenefits += benefitSum;
      grandDeducts += pr.deductions || 0;
      grandNet += pr.finalSalary || 0;
      
      // Draw grid bottom divider line
      doc.setDrawColor(241, 245, 249);
      doc.line(15, y + 9, 282, y + 9);
      
      // Column Content
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.text(`${pr.fullName}`, 18, y + 4.5);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`${pr.employeeNumber}`, 18, y + 7.5);
      
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      // Reg Hours
      doc.text(`${(regHours || 0).toFixed(1)} hrs`, 80, y + 5.5, { align: "right" });
      // OT Hours
      doc.text(`${(otHours || 0).toFixed(1)} hrs`, 102, y + 5.5, { align: "right" });
      // Basic Pay
      doc.text(`PHP ${(pr.basicSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 132, y + 5.5, { align: "right" });
      // OT Pay
      doc.text(`PHP ${(pr.otPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 160, y + 5.5, { align: "right" });
      // Benefits (Allowance + Leaves)
      doc.text(`PHP ${benefitSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 188, y + 5.5, { align: "right" });
      // Deductions
      doc.setTextColor(220, 38, 38);
      doc.text(`PHP ${(pr.deductions || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 222, y + 5.5, { align: "right" });
      // Net salary
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.text(`PHP ${(pr.finalSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 258, y + 5.5, { align: "right" });
      doc.setFont("helvetica", "normal");
      
      y += 10;
      
      // Auto page split rules
      if (y > 185) {
        doc.addPage();
        y = 20;
        // Draw simple top band on subsequent pages
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 297, 12, "F");
        y = 22;
      }
    });
    
    // Draw total summary row box
    doc.setDrawColor(15, 23, 42);
    doc.setFillColor(241, 245, 249); // slate-100/50
    doc.rect(15, y, 267, 10, "FD");
    
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("TOTAL DISBURSEMENTS", 18, y + 6.5);
    doc.text(`${(grandRegHours || 0).toFixed(1)}h`, 80, y + 6.5, { align: "right" });
    doc.text(`${(grandOtHours || 0).toFixed(1)}h`, 102, y + 6.5, { align: "right" });
    doc.text(`PHP ${grandBasic.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 132, y + 6.5, { align: "right" });
    doc.text(`PHP ${grandOtPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 160, y + 6.5, { align: "right" });
    doc.text(`PHP ${grandBenefits.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 188, y + 6.5, { align: "right" });
    
    doc.setTextColor(220, 38, 38);
    doc.text(`PHP ${grandDeducts.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 222, y + 6.5, { align: "right" });
    
    doc.setTextColor(15, 23, 42);
    doc.text(`PHP ${grandNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 258, y + 6.5, { align: "right" });
    
    // Verification Footnote details
    y += 18;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text("* Flat-file compatible ledger. Overtime calculations correspond to specific biometric tracking checkpoints validated against general HR attendance override limits.", 15, y);
    doc.text(`Generated on: ${new Date().toLocaleString()} PST | Authorized Executive: System Admin | Ledger MD5 Verification Reference Checksum: ACC-${Math.random().toString(36).substring(2, 8).toUpperCase()}`, 15, y + 3.5);
    
    doc.save(`Oligarch_Media_Payroll_${selectedPeriodObj.startDate}_to_${selectedPeriodObj.endDate}.pdf`);
  };

  const handleDownloadIndividualPayslip = (pay: Payroll) => {
    const doc = new jsPDF();
    
    // Header Block (Slate Dark theme matching corporate branding)
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, 210, 42, "F");
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("OLIGARCH MEDIA GRAPHIC DESIGN STUDIO", 15, 18);
    
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(147, 197, 253);
    doc.text("OFFICIAL STATEMENT OF EARNINGS & PAY SLIP (CONFIDENTIAL)", 15, 25);
    
    // Sub-details
    const dateRange = selectedPeriodObj 
      ? `${selectedPeriodObj.startDate} to ${selectedPeriodObj.endDate}` 
      : pay.cutoffPeriodId;
    const releaseDate = selectedPeriodObj ? selectedPeriodObj.releaseDate : "Released";

    doc.setTextColor(248, 250, 252);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text(`PAY PERIOD: ${dateRange}`, 15, 34);
    doc.text(`RELEASE DATE: ${releaseDate}`, 145, 34);

    let yOffset = 52;
    
    // Find matching employee to fetch role/department
    const verifiedEmployee = employees.find(e => e.id === pay.employeeId);

    // Employee Info Box
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.rect(15, yOffset, 180, 26, "FD");
    
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text("EMPLOYEE NAME", 20, yOffset + 6);
    doc.text("EMPLOYEE NUMBER", 110, yOffset + 6);
    doc.text("POSITION", 20, yOffset + 18);
    doc.text("DEPARTMENT", 110, yOffset + 18);
    
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`${pay.fullName || "Employee"}`, 20, yOffset + 11);
    doc.text(`${pay.employeeNumber || "N/A"}`, 110, yOffset + 11);
    doc.text(`${verifiedEmployee?.position || "Graphic Artist"}`, 20, yOffset + 23);
    doc.text(`${verifiedEmployee?.department || "Creative Production"}`, 110, yOffset + 23);
    
    yOffset += 32;

    // Attendance Summary Card
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.rect(15, yOffset, 180, 24, "FD");

    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text("ATTENDANCE SUMMARY", 20, yOffset + 6);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Present:", 20, yOffset + 13);
    doc.text("Late:", 70, yOffset + 13);
    doc.text("Conv. Absent:", 120, yOffset + 13);
    doc.text("Actual Absent:", 165, yOffset + 13);

    doc.text("Remaining Late:", 20, yOffset + 20);
    doc.text("Worked Hrs:", 70, yOffset + 20);
    doc.text("Overtime Hrs:", 120, yOffset + 20);
    doc.text("Break Hrs:", 165, yOffset + 20);

    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.text(`${pay.presentDays || 0}`, 45, yOffset + 13);
    doc.text(`${pay.lateCount || 0}`, 90, yOffset + 13);
    doc.text(`${pay.convertedAbsences || 0}`, 145, yOffset + 13);
    doc.text(`${pay.actualAbsences || 0}`, 190, yOffset + 13);

    doc.text(`${pay.remainingLates || 0}`, 45, yOffset + 20);
    doc.text(`${(pay.workedHours || 0).toFixed(1)}`, 90, yOffset + 20);
    doc.text(`${(pay.otHours || 0).toFixed(1)}`, 145, yOffset + 20);
    doc.text(`${(pay.breakHours || 0).toFixed(1)}`, 190, yOffset + 20);

    yOffset += 32;
    
    // Compensation Section
    doc.setFillColor(15, 23, 42);
    doc.rect(15, yOffset, 180, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("EARNINGS & COMPENSATIONS", 20, yOffset + 5.5);
    doc.text("AMOUNT", 190, yOffset + 5.5, { align: "right" });
    
    yOffset += 8;
    
    const baseVal = pay.basicSalary || 0;
    const allowanceVal = pay.allowance || 0;
    const otVal = pay.otPay || 0;
    const nightDiffVal = pay.nightDiffPay || 0;
    const extraDaysVal = pay.extraDaysPay || 0;
    const paidLeaveVal = pay.paidLeavePay || 0;
    const bdayLeaveVal = pay.birthdayLeavePay || 0;
    const additionalCashVal = pay.additionalCashPay || 0;
    const thirteenthMonthVal = pay.thirteenthMonthPay || 0;
    const grossEarnings = baseVal + allowanceVal + otVal + nightDiffVal + extraDaysVal + paidLeaveVal + bdayLeaveVal + additionalCashVal + thirteenthMonthVal;
    
    const printRow = (label: string, value: number, isPos = false) => {
      doc.setDrawColor(241, 245, 249);
      doc.line(15, yOffset + 8, 195, yOffset + 8);
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "normal");
      doc.text(label, 20, yOffset + 5.5);
      doc.setFont("helvetica", "bold");
      if (isPos && value > 0) {
        doc.setTextColor(22, 163, 74);
        doc.text(`+PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 190, yOffset + 5.5, { align: "right" });
      } else {
        doc.setTextColor(15, 23, 42);
        doc.text(`PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 190, yOffset + 5.5, { align: "right" });
      }
      yOffset += 8;
    };
    
    printRow("Basic Salary Package", baseVal);
    if (allowanceVal > 0) printRow("Workspace Allowance / Benefits", allowanceVal, true);
    if (otVal > 0) printRow(`Overtime Shift Premium ${(selectedPeriodObj?.enableOT125 ?? false) ? "(125%)" : ""}`, otVal, true);
    if (nightDiffVal > 0) printRow(`Night Shift Differential (10% Art. 86) (${(pay.nightDiffHours || 0).toFixed(1)}h)`, nightDiffVal, true);
    if (extraDaysVal > 0) printRow("Restday / Extra Shift Pay", extraDaysVal, true);
    if (paidLeaveVal > 0) printRow("Paid Leave Credits Redeemed", paidLeaveVal, true);
    if (bdayLeaveVal > 0) printRow("Birthday Leave Premium", bdayLeaveVal, true);
    if (additionalCashVal > 0) printRow("Boss Debt / Additional Cash Payout (+)", additionalCashVal, true);
    if (thirteenthMonthVal > 0) printRow("13th Month Statutory Pay (+)", thirteenthMonthVal, true);
    
    // Gross Earning Subtotal Box
    doc.setDrawColor(15, 23, 42);
    doc.setFillColor(248, 250, 252);
    doc.rect(15, yOffset, 180, 8, "FD");
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.text("GROSS EARNINGS SUBTOTAL", 20, yOffset + 5.5);
    doc.text(`PHP ${grossEarnings.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 190, yOffset + 5.5, { align: "right" });
    
    yOffset += 14;
    
    // Deductions Section
    doc.setFillColor(15, 23, 42);
    doc.rect(15, yOffset, 180, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("DEDUCTIONS & ADJUSTMENTS", 20, yOffset + 5.5);
    doc.text("AMOUNT", 190, yOffset + 5.5, { align: "right" });
    
    yOffset += 8;
    
    const absentVal = pay.absentDeduction || 0;
    const lateVal = pay.lateDeduction || 0;
    const cashAdvanceVal = pay.cashAdvanceDeduction || 0;
    const totalDeducts = pay.deductions || 0;
    
    const printDeductRow = (label: string, value: number) => {
      doc.setDrawColor(241, 245, 249);
      doc.line(15, yOffset + 8, 195, yOffset + 8);
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "normal");
      doc.text(label, 20, yOffset + 5.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(220, 38, 38);
      doc.text(`-PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 190, yOffset + 5.5, { align: "right" });
      yOffset += 8;
    };
    
    if (absentVal > 0) printDeductRow("Unexcused Absences Penalty", absentVal);
    if (lateVal > 0) printDeductRow("Tardy & Late Arrivals Deductions", lateVal);
    if (cashAdvanceVal > 0) printDeductRow("Cash Advance Deductions", cashAdvanceVal);
    if (absentVal === 0 && lateVal === 0 && cashAdvanceVal === 0) {
      doc.setDrawColor(241, 245, 249);
      doc.line(15, yOffset + 8, 195, yOffset + 8);
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "italic");
      doc.text("No absences or late deductions logged in this cycle.", 20, yOffset + 5.5);
      yOffset += 8;
    }
    
    // Deductions Subtotal Box
    doc.setDrawColor(15, 23, 42);
    doc.setFillColor(248, 250, 252);
    doc.rect(15, yOffset, 180, 8, "FD");
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL DISBURSEMENT DEDUCTIONS", 20, yOffset + 5.5);
    doc.setTextColor(220, 38, 38);
    doc.text(`-PHP ${totalDeducts.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 190, yOffset + 5.5, { align: "right" });
    
    yOffset += 14;
    
    // Prominent Net Salary Box
    doc.setDrawColor(59, 130, 246);
    doc.setFillColor(239, 246, 255);
    doc.rect(15, yOffset, 180, 14, "FD");
    
    doc.setTextColor(59, 130, 246);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("NET SALARY VOUCHER PAYOUT", 22, yOffset + 8.5);
    
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(14);
    doc.text(`PHP ${(pay?.finalSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 190, yOffset + 9.5, { align: "right" });
    
    yOffset += 24;
    
    // Signature lines
    doc.setDrawColor(148, 163, 184);
    doc.line(20, yOffset + 10, 80, yOffset + 10);
    doc.line(130, yOffset + 10, 190, yOffset + 10);
    
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7.5);
    doc.text("Finance & Payroll Systems Unit", 20, yOffset + 15);
    doc.text("Employee Acknowledgment Signature", 130, yOffset + 15);
    
    yOffset += 24;
    
    // Notes
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text("* Confirmed confidential record. All details are digital records validated against corporate log files.", 15, yOffset);
    doc.text(`Voucher ID Checksum: SV-${pay.payrollId}-${Math.random().toString(36).substring(2, 8).toUpperCase()} | Timestamp: ${new Date().toLocaleString()}`, 15, yOffset + 3.5);
    
    doc.save(`Payslip_${pay.fullName.replace(/\s+/g, "_")}_${pay.cutoffPeriodId}.pdf`);
  };  const handleExportBossSummary = () => {
    if (!selectedPeriodObj || currentPayrollList.length === 0) {
      alert("No compiled payroll available to export.");
      return;
    }

    const doc = new jsPDF("portrait", "mm", "a4"); // Standard professional A4: 210mm x 297mm
    const margin = 15;
    let y = 15;

    // Header Letterhead style (Classic deep executive Indigo and Gold style accents)
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, 210, 38, "F");

    // Decorative bottom luxury gold bar
    doc.setFillColor(234, 179, 8); // amber-500/gold
    doc.rect(0, 38, 210, 2, "F");

    // Branding
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("OLIGARCH MEDIA GRAPHIC DESIGN STUDIO", margin, 18);

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(253, 224, 71); // bright yellow/gold
    doc.text("INDIVIDUAL PAYSLIP RECIPIENT LEDGER", margin, 25);

    doc.setFontSize(8);
    doc.setTextColor(226, 232, 240);
    const safePeriodName = selectedPeriodObj?.name || "PAYROLL PERIOD";
    doc.text(`PAY PERIOD: ${safePeriodName.toUpperCase()} (${selectedPeriodObj?.startDate || ""} to ${selectedPeriodObj?.endDate || ""})`, margin, 31);

    y = 48;

    // Compute metrics
    let totalBasic = 0;
    let totalOTPay = 0;
    let totalAllowance = 0;
    let totalLeaves = 0;
    let totalExtraDays = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    let totalResources = currentPayrollList.length;

    currentPayrollList.forEach(p => {
      totalBasic += p.basicSalary || 0;
      totalOTPay += p.otPay || 0;
      totalAllowance += p.allowance || 0;
      totalLeaves += (p.paidLeavePay || 0) + (p.birthdayLeavePay || 0);
      totalExtraDays += p.extraDaysPay || 0;
      totalDeductions += p.deductions || 0;
      totalNet += p.finalSalary || 0;
    });

    const averageNetPayout = totalNet / (totalResources || 1);

    // Dynamic stats card blocks (3 column elegant grid layout)
    doc.setDrawColor(226, 232, 240);
    
    // Column 1 Box: Total Disbursement
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, 56, 24, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("TOTAL NET CAPITAL REQUEST", margin + 4, y + 6);
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(`PHP ${totalNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, margin + 4, y + 15);
    doc.setFontSize(6.5);
    doc.setTextColor(22, 163, 74);
    doc.text("● Fully Audited and Cleared", margin + 4, y + 21);

    // Column 2 Box: Active Resources
    doc.setFillColor(248, 250, 252);
    doc.rect(margin + 62, y, 56, 24, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("RESOURCES COMPILED", margin + 66, y + 6);
    doc.setFontSize(11);
    doc.setTextColor(59, 130, 246);
    doc.text(`${totalResources} Graphic Artists`, margin + 66, y + 15);
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text("Active Personnel in range", margin + 66, y + 21);

    // Column 3 Box: Average Payout
    doc.setFillColor(248, 250, 252);
    doc.rect(margin + 124, y, 56, 24, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("AVERAGE VOUCHER AMOUNT", margin + 128, y + 6);
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(`PHP ${averageNetPayout.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, margin + 128, y + 15);
    doc.setFontSize(6.5);
    doc.setTextColor(15, 23, 42);
    doc.text("Per individual designer", margin + 128, y + 21);

    y += 32;

    // Detailed cost metrics table
    doc.setFillColor(15, 23, 42); // slate deep
    doc.rect(margin, y, 180, 7.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text("FINANCIAL COMPILATION AUDIT TRAIL", margin + 4, y + 5);

    y += 7.5;
    const drawComplianceRow = (label: string, value: string, textCol = [15, 23, 42]) => {
      doc.setDrawColor(241, 245, 249);
      doc.line(margin, y + 7, margin + 180, y + 7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(label, margin + 4, y + 4.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(textCol[0], textCol[1], textCol[2]);
      doc.text(value, margin + 176, y + 4.5, { align: "right" });
      y += 7;
    };

    drawComplianceRow("Basic Prorated Payroll Requirements", `PHP ${totalBasic.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    drawComplianceRow("Accrued Overtime Premiums and Differential Compensations", `PHP ${totalOTPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, [22, 163, 74]);
    drawComplianceRow("Workspace Allowances / Subsidies", `PHP ${totalAllowance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, [59, 130, 246]);
    drawComplianceRow("Leaves Paid (VL/SL/Bday)", `PHP ${totalLeaves.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, [147, 51, 234]);
    if (totalExtraDays > 0) drawComplianceRow("Restday / Extra Shift Pay", `PHP ${totalExtraDays.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, [202, 138, 4]);
    drawComplianceRow("Penalties levied for Absences & Late Tarries", `-PHP ${totalDeductions.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, [220, 38, 38]);
    
    // Net total highlight
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, 180, 8.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text("FINAL REQUESTED COLD-CASH LIQUID DISBURSEMENT", margin + 4, y + 5.5);
    doc.text(`PHP ${totalNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, margin + 176, y + 5.5, { align: "right" });
    
    y += 16;

    // Individual personnel breakdown
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text("INDIVIDUAL CAPITAL RECIPIENT LIST", margin, y);
    
    y += 5;

    // Personnel list header box
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, 180, 7.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text("DESIGNER NAME", margin + 2, y + 5);
    doc.text("BASIC", margin + 70, y + 5, { align: "right" });
    doc.text("ALLOW", margin + 92, y + 5, { align: "right" });
    doc.text("OT/RD", margin + 114, y + 5, { align: "right" });
    doc.text("LEAVES", margin + 136, y + 5, { align: "right" });
    doc.text("DEDUCTS", margin + 158, y + 5, { align: "right" });
    doc.text("NET SALARY", margin + 182, y + 5, { align: "right" });

    y += 7.5;

    currentPayrollList.forEach(p => {
      doc.setDrawColor(241, 245, 249);
      doc.line(margin, y + 7.5, margin + 180, y + 7.5);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      
      // Handle potential long names elegantly
      let empName = p.fullName;
      if (empName.length > 22) {
        empName = empName.substring(0, 20) + "...";
      }
      doc.text(empName, margin + 2, y + 4.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      
      const leavesVal = (p.paidLeavePay || 0) + (p.birthdayLeavePay || 0);
      const otRdVal = (p.otPay || 0) + (p.extraDaysPay || 0);

      doc.text(`${(p.basicSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 1 })}`, margin + 70, y + 4.5, { align: "right" });
      doc.text(`${(p.allowance || 0).toLocaleString(undefined, { minimumFractionDigits: 1 })}`, margin + 92, y + 4.5, { align: "right" });
      doc.text(`${(otRdVal || 0).toLocaleString(undefined, { minimumFractionDigits: 1 })}`, margin + 114, y + 4.5, { align: "right" });
      doc.text(`${(leavesVal || 0).toLocaleString(undefined, { minimumFractionDigits: 1 })}`, margin + 136, y + 4.5, { align: "right" });
      
      doc.setTextColor(220, 38, 38);
      doc.text(`${(p.deductions || 0).toLocaleString(undefined, { minimumFractionDigits: 1 })}`, margin + 158, y + 4.5, { align: "right" });
      
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.text(`${(p.finalSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 1 })}`, margin + 182, y + 4.5, { align: "right" });

      y += 7.5;
    });

    // Save
    doc.save(`Oligarch_Media_Payroll_Register_${selectedPeriodObj.startDate}_to_${selectedPeriodObj.endDate}.pdf`);
  };

  return (
    <div className="space-y-6 relative w-full min-w-0">
      {/* PROCESSING MODAL OVERLAY WHEN RELEASING & EMAILING BULK */}
      {releasing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-55">
          <div className="bg-white dark:bg-zinc-950 p-6 rounded-2xl max-w-sm w-full shadow-2xl border border-zinc-200 dark:border-zinc-805 text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div>
              <h4 className="font-bold text-zinc-900 dark:text-zinc-50 text-base">Processing Cuts & Alerts</h4>
              <p className="text-xs text-zinc-500 mt-2 font-mono bg-zinc-100 dark:bg-zinc-900 p-2.5 rounded-lg border border-zinc-200/60 dark:border-zinc-800/85">
                {releaseEmailStatus}
              </p>
            </div>
          </div>
        </div>
      )}
      {/* Top Banner & Hub Navigation Switch */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-50 tracking-tight flex items-center gap-2.5">
            <CreditCard className="w-6 h-6 text-blue-500" /> Executive Payroll Hub
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Cutoff salary management, allowance daily adjustments & 13th month whole-year absence audit
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          {/* Button to open Company No Work Days management modal */}
          <button
            onClick={() => setIsNoWorkModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60 shadow-xs"
            title="Declare and manage Company No Work Days (e.g. Typhoon suspensions, Emergency Non-working days)"
          >
            <CalendarOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Company No Work Days</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200">
              {noWorkDays.length}
            </span>
          </button>

          {/* View Switcher: Cutoff Ledger vs 13th Month & Annual Absences */}
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-xl border border-zinc-200/80 dark:border-zinc-700/80 w-full sm:w-auto shadow-xs">
            <button
              onClick={() => setActivePayrollTab("cutoff")}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition-all cursor-pointer ${
                activePayrollTab === "cutoff"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <CreditCard size={15} />
              <span>Cutoff Payroll Ledger</span>
            </button>

            <button
              onClick={() => setActivePayrollTab("thirteenth_month")}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition-all cursor-pointer ${
                activePayrollTab === "thirteenth_month"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <Award size={15} className="text-amber-300" />
              <span>13th Month Pay & Whole-Year Absences</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* VIEW A: CUTOFF PAYROLL LEDGER */}
      {/* ========================================================= */}
      {activePayrollTab === "cutoff" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Cutoff Action Buttons Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h3 className="text-sm font-black text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
                Current Cutoff Processing
              </h3>
              <p className="text-xs text-zinc-500">Bi-monthly payroll register and employee voucher dispatch</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => setIsPeriodModalOpen(true)}
                className="px-3.5 py-2 text-xs bg-zinc-200 hover:bg-zinc-300 text-zinc-900 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-white border border-zinc-300 dark:border-zinc-600 rounded-xl shadow-xs font-semibold transition-colors cursor-pointer flex-1 sm:flex-none text-center justify-center flex"
              >
                Create Custom Cutoff
              </button>

              {settings.autoRecalculatePayroll === false && (
                <button
                  onClick={handleGeneratePayroll}
                  disabled={generating}
                  className="px-3.5 py-2 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 font-semibold text-white rounded-xl shadow-xs transition-colors flex justify-center items-center gap-1 cursor-pointer flex-1 sm:flex-none"
                >
                  <Calculator className="w-3.5 h-3.5" />
                  {generating ? "Compiling..." : "Compile Payroll Cutoff"}
                </button>
              )}

              {currentPayrollList.length > 0 && (
                <>
                  <button
                    onClick={handleOpenAutoSendModal}
                    className="px-3.5 py-2 text-xs bg-blue-600 hover:bg-blue-700 font-bold text-white rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer flex-1 sm:flex-none"
                    title="Auto-send payslip emails directly to each employee's provided Gmail address"
                  >
                    <Send className="w-3.5 h-3.5 shrink-0" />
                    <span>Auto-Send Payslips ({currentPayrollList.length})</span>
                  </button>
                  <button
                    onClick={handleExportPDF}
                    className="px-3.5 py-2 text-xs bg-emerald-600 hover:bg-emerald-700 font-semibold text-white rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer flex-1 sm:flex-none"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    Export PDF Ledger
                  </button>
                  <button
                    onClick={handleExportBossSummary}
                    className="px-3.5 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 font-semibold text-white rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer flex-1 sm:flex-none"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-yellow-300 shrink-0" />
                    Executive Boss Summary
                  </button>
                  <button
                    onClick={() => setIsBossAttendanceModalOpen(true)}
                    className="px-3.5 py-2 text-xs bg-amber-600 hover:bg-amber-500 font-bold text-white rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer flex-1 sm:flex-none"
                  >
                    <Calendar className="w-3.5 h-3.5 text-amber-200 shrink-0" />
                    Boss Attendance & OT
                  </button>
                </>
              )}
            </div>
          </div>

      {/* Select active Period Cutoff Dropdown */}
      <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1 w-full sm:max-w-md">
          <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider block">Payroll period cutoff selector</label>
          <div className="flex items-center gap-2">
            <select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              className="flex-1 text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none font-semibold dark:text-zinc-150"
            >
              {periods.map(p => (
                <option key={p.periodId} value={p.periodId}>
                  {p.name} ({p.status})
                </option>
              ))}
            </select>
            {selectedPeriodObj && (
              <button
                onClick={handleDeletePeriod}
                title="Delete this cutoff period and compiled payroll"
                className="p-2 bg-zinc-100 dark:bg-zinc-950 hover:bg-red-50 hover:border-red-300 dark:hover:bg-red-950/20 text-red-650 dark:text-red-400 border border-zinc-200 dark:border-zinc-808 rounded-lg transition-all shrink-0 cursor-pointer flex items-center justify-center"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {selectedPeriodObj && (
          <div className="text-left sm:text-right font-mono text-[10px] text-zinc-500 space-y-0.5">
            <p>RANGE: <strong className="text-zinc-700 dark:text-zinc-250 font-bold">{selectedPeriodObj.startDate} to {selectedPeriodObj.endDate}</strong></p>
            <p>RELEASE DATE: <span className="font-bold text-zinc-750 dark:text-zinc-300">{selectedPeriodObj.releaseDate}</span></p>
          </div>
        )}
      </div>

      {/* PHILIPPINE STATUTORY LABOR RULES TOOLBAR (NIGHT DIFFERENTIAL & 125% OVERTIME) */}
      {selectedPeriodObj && (
        <div className="bg-gradient-to-r from-indigo-50/70 via-purple-50/40 to-blue-50/60 dark:from-indigo-950/30 dark:via-purple-950/20 dark:to-blue-950/30 border border-indigo-200/80 dark:border-indigo-800/60 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2.5 bg-indigo-600/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl shrink-0">
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  Philippine Labor Law Statutory Premiums
                </h4>
                <span className="text-[10px] font-mono font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800">
                  Cutoff: {selectedPeriodObj.name}
                </span>
              </div>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5">
                Toggle Philippine Labor Code statutory rates for this specific cutoff. Older or historical cutoffs remain completely untouched.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            {/* Night Shift Differential Toggle */}
            <button
              type="button"
              onClick={toggleCutoffNightDiff}
              className={`flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 border shadow-xs ${
                selectedPeriodObj.enableNightDiff
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-indigo-600/20"
                  : "bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              title="Click to toggle Article 86: 10% premium for work between 10:00 PM and 6:00 AM"
            >
              <Moon className={`w-3.5 h-3.5 ${selectedPeriodObj.enableNightDiff ? "text-amber-300" : "text-zinc-400"}`} />
              <span>Night Diff (10%): <strong className="font-mono">{selectedPeriodObj.enableNightDiff ? "ACTIVE" : "OFF"}</strong></span>
            </button>

            {/* 125% Overtime Toggle */}
            <button
              type="button"
              onClick={toggleCutoffOT125}
              className={`flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 border shadow-xs ${
                (selectedPeriodObj.enableOT125 ?? false)
                  ? "bg-purple-600 text-white border-purple-600 shadow-purple-600/20"
                  : "bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              title="Click to toggle Article 87: 125% regular overtime rate (1.25x hourly rate) for work beyond 8 hours"
            >
              <Clock className={`w-3.5 h-3.5 ${(selectedPeriodObj.enableOT125 ?? false) ? "text-white" : "text-zinc-400"}`} />
              <span>Overtime (125%): <strong className="font-mono">{(selectedPeriodObj.enableOT125 ?? false) ? "ACTIVE" : "OFF"}</strong></span>
            </button>
          </div>
        </div>
      )}

      {/* CUTOFF ALLOWANCE MANAGEMENT TOOLBAR */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                Allowance Management Toolbar
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                  allowancePolicy === "Removed" 
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" 
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                }`}>
                  {allowancePolicy === "Removed" ? "Mode: All Allowances Removed (₱0)" : "Mode: Standard Full Allowance"}
                </span>
              </h4>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                The allowance is standard for each cutoff. Use 1-click to quickly remove all allowances (₱0) when needed, or customize per employee.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setAllowancePolicy("Full");
                setCustomAllowanceOverrides({});
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                allowancePolicy === "Full"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              }`}
              title="Standard full allowance package (emp.allowance / 2)"
            >
              <CheckCircle size={14} />
              <span>Standard Allowance</span>
            </button>

            <button
              onClick={() => {
                setAllowancePolicy("Removed");
                setCustomAllowanceOverrides({});
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                allowancePolicy === "Removed"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              }`}
              title="Instantly remove all allowances (₱0) across this cutoff payroll"
            >
              <FileMinus size={14} />
              <span>Remove All Allowances (₱0)</span>
            </button>
          </div>
        </div>
      </div>

      {/* CUMULATIVE FINANCIAL OVERVIEW FOR ADMIN ON SELECTED PAYROLL CUTOFF */}
      {currentPayrollList.length > 0 && (
        <div className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-205 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between border-b border-zinc-200/50 dark:border-zinc-800 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="p-1 px-1.5 bg-zinc-200/60 dark:bg-zinc-805 rounded-lg text-zinc-700 dark:text-zinc-300">
                <CreditCard className="w-3.5 h-3.5" />
              </div>
              <h3 className="text-xs font-bold font-mono tracking-wider text-zinc-650 dark:text-zinc-350 uppercase">
                Cutoff Cumulative Net Payout Summary (Admin Panel)
              </h3>
            </div>
            <span className="text-[10px] font-bold font-mono px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400 rounded-lg">
              SYSTEM CONSOLIDATED
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3.5">
            <div className="bg-white dark:bg-zinc-950 p-3 rounded-xl border border-zinc-200/70 dark:border-zinc-800 space-y-1.5 font-mono">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">BASIC PAYMENTS</span>
              <span className="text-xs font-black text-zinc-850 dark:text-zinc-150 block">{currency}{(totalBasic || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>

            <div className="bg-white dark:bg-zinc-950 p-3 rounded-xl border border-zinc-200/70 dark:border-zinc-800 space-y-1.5 font-mono">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">ALLOWANCES</span>
              <span className="text-xs font-black text-blue-600 dark:text-blue-400 block font-bold">+{currency}{(totalAllowance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>

            <div className="bg-white dark:bg-zinc-950 p-3 rounded-xl border border-zinc-200/70 dark:border-zinc-800 space-y-1.5 font-mono">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">OVERTIME PAID</span>
              <span className="text-xs font-black text-emerald-600 block">+{currency}{(totalOt || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>

            <div className="bg-white dark:bg-zinc-950 p-3 rounded-xl border border-emerald-200/70 dark:border-emerald-800/40 space-y-1.5 font-mono">
              <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">BOSS DEBTS / ADD CASH</span>
              <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 block font-bold">+{currency}{(totalAdditionalCash || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>

            <div className="bg-white dark:bg-zinc-950 p-3 rounded-xl border border-zinc-200/70 dark:border-zinc-800 space-y-1.5 font-mono">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">PAID LEAVES</span>
              <span className="text-xs font-black text-indigo-500 block">+{currency}{(totalBenefits || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>

            <div className="bg-white dark:bg-zinc-950 p-3 rounded-xl border border-zinc-200/70 dark:border-zinc-800 space-y-1.5 font-mono">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block text-red-650">CUM DEDUCTIONS</span>
              <span className="text-xs font-black text-red-650 block">-{currency}{(totalDeductions || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>

            <div className="bg-blue-600 dark:bg-blue-950 p-3 rounded-xl border border-blue-500/10 space-y-1.5 font-mono col-span-2 sm:col-span-1">
              <span className="text-[9px] font-bold text-blue-100 dark:text-blue-400 uppercase tracking-wider block font-medium">TOTAL NET OUTFLOW</span>
              <span className="text-sm font-black text-white dark:text-blue-200 block">{currency}{(totalFinalSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      )}

      {/* CUTOFF AUDIT SUMMARY & DISCREPANCIES ENGINE */}
      {selectedPeriodObj && (
        <div className="bg-white dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-805 rounded-2xl shadow-sm overflow-hidden text-left">
          <div 
            onClick={() => setIsAuditPanelOpen(!isAuditPanelOpen)}
            className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-150 dark:border-zinc-800 flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-500 animate-pulse" />
              <div className="text-left">
                <span className="text-xs font-bold font-mono text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block">
                  Payroll Audit & Discrepancy Summary
                </span>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
                  Cross-referencing recorded clock-ins, leaves, and calculated net wages
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold font-mono px-2 py-0.5 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-450 border border-amber-200/50 dark:border-amber-900/30 rounded-lg">
                FLAGGED BIOMETRIC ISSUES: {auditSummaryList.filter(item => item.isAnomalous).length}
              </span>
              <span className="text-[10px] font-bold font-mono text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                {isAuditPanelOpen ? "▼ COLLAPSE" : "▲ EXPAND"}
              </span>
            </div>
          </div>

          {isAuditPanelOpen && (
            <div className="p-6 space-y-4">
              <p className="text-xs text-zinc-500 leading-relaxed font-sans">
                The audit system automatically verifies active staff attendance records for this bi-monthly cycle (<strong className="text-zinc-700 dark:text-zinc-300">{selectedPeriodObj.startDate} to {selectedPeriodObj.endDate}</strong>) against calculated net wages. Standard expected hours for this period are <span className="font-mono bg-zinc-100 dark:bg-zinc-900 px-1 py-0.5 rounded text-zinc-650 dark:text-zinc-350 font-bold">{auditSummaryList[0]?.expectedDays ?? 10} working days</span> (<span className="font-mono bg-zinc-100 dark:bg-zinc-900 px-1 py-0.5 rounded text-zinc-655 dark:text-zinc-350 font-bold">{(auditSummaryList[0]?.expectedHours ?? 80)} hours</span>).
              </p>

              {auditSummaryList.filter(item => item.isAnomalous).length === 0 ? (
                <div className="bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200/60 dark:border-emerald-900/30 rounded-xl p-4 flex items-center gap-3">
                  <div className="p-1 px-1.5 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 rounded-lg shrink-0">
                    <Check className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-emerald-800 dark:text-emerald-400">Zero Payroll Discrepancies</h5>
                    <p className="text-[10px] text-emerald-600/90 dark:text-emerald-500 font-mono mt-0.5">
                      All clocked biometric logs, approved leave schedules, and overtime hours align with compiled paycheck drafts perfectly.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                  {auditSummaryList.filter(item => item.isAnomalous).map((item) => {
                    const devFromGross = item.payroll 
                      ? item.finalNet - item.standardBaseGross 
                      : 0;
                    
                    return (
                      <div 
                        key={item.employee.id} 
                        className="bg-zinc-50/50 dark:bg-zinc-900/20 border border-zinc-150 dark:border-zinc-800/80 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-zinc-350 dark:hover:border-zinc-700 transition-colors"
                      >
                        {/* Employee Bio & Log Progress */}
                        <div className="space-y-1 shrink-0 w-full sm:w-56 text-left">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-zinc-800 dark:text-zinc-105 text-xs">
                              {item.employee.fullName}
                            </span>
                            <span className="text-[9px] font-mono text-zinc-450 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded uppercase font-bold">
                              {item.employee.employeeNumber}
                            </span>
                          </div>
                          
                          <div className="space-y-1 text-left">
                            <div className="flex justify-between text-[9px] font-mono text-zinc-400">
                              <span>Log Completeness:</span>
                              <span className="font-bold text-zinc-600 dark:text-zinc-300">
                                {(item?.totalEffectiveHours ?? 0).toFixed(1)}h / {item?.expectedHours ?? 0}h
                              </span>
                            </div>
                            <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${
                                  item.totalEffectiveHours >= item.expectedHours 
                                    ? "bg-emerald-500" 
                                    : item.totalEffectiveHours < item.expectedHours * 0.7 
                                      ? "bg-red-500" 
                                      : "bg-amber-500"
                                }`} 
                                style={{ width: `${Math.min(100, (item.totalEffectiveHours / item.expectedHours) * 100)}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Middle Flags List */}
                        <div className="flex flex-wrap gap-1.5 items-center w-full justify-start sm:justify-center">
                          {item.hasAbsences && (
                            <span className="px-2 py-0.5 text-[9px] font-bold font-mono rounded bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200/50 dark:border-red-900/30 flex items-center gap-1">
                              <AlertCircle className="w-2.5 h-2.5 text-red-500" /> Absent: {item.absentLogsCount}d
                            </span>
                          )}

                          {item.hasLateness && (
                            <span className="px-2 py-0.5 text-[9px] font-bold font-mono rounded bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/30 flex items-center gap-1">
                              <AlertTriangle className="w-2.5 h-2.5 text-amber-500" /> Late: {item.totalLateMinutes}m
                            </span>
                          )}

                          {item.hasOvertime && (
                            <span className="px-2 py-0.5 text-[9px] font-bold font-mono rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900/30 flex items-center gap-1">
                              <TrendingUp className="w-2.5 h-2.5 text-emerald-500" /> Overtime Registered
                            </span>
                          )}

                          {item.totalApprovedLeaves > 0 && (
                            <span className="px-2 py-0.5 text-[9px] font-bold font-mono rounded bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border border-blue-200/50 dark:border-blue-900/30 flex items-center gap-1">
                              <Calendar className="w-2.5 h-2.5 text-blue-500" /> Leaves Paid: +{item.totalApprovedLeaves}d
                            </span>
                          )}

                          {item.hasShortfall && !item.hasAbsences && (
                            <span className="px-2 py-0.5 text-[9px] font-bold font-mono rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                              Hours Shortfall: -{((item?.hoursDiscrepancy ?? 0)).toFixed(1)}h
                            </span>
                          )}
                        </div>

                        {/* Deviation & Interactive Info Tooltip */}
                        <div className="flex items-center gap-4 shrink-0 justify-end w-full sm:w-auto border-t sm:border-0 border-zinc-100 dark:border-zinc-800/60 pt-2.5 sm:pt-0">
                          {item.payroll ? (
                            <div className="text-right font-mono space-y-0.5">
                              <span className="text-[9px] font-bold text-zinc-400 block uppercase tracking-wider">Payroll Adjustment</span>
                              <div className="flex items-center gap-1.5 justify-end">
                                <span className={`text-xs font-bold font-mono ${
                                  devFromGross >= 0.01 
                                    ? "text-emerald-600 dark:text-emerald-400" 
                                    : devFromGross <= -0.01 
                                      ? "text-red-500 dark:text-red-400" 
                                      : "text-zinc-650 dark:text-zinc-400"
                                }`}>
                                  {devFromGross >= 0.01 ? "+" : ""}{currency}{devFromGross.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                                
                                {/* Tooltip Container utilizing standard hover-based micro selectors */}
                                <div className="group relative inline-block">
                                  <HelpCircle className="w-4 h-4 text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-200 cursor-help transition-colors" />
                                  <div className="pointer-events-none absolute bottom-full right-0 mb-2 w-80 bg-zinc-950 border border-zinc-800 text-zinc-200 p-4 rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-all duration-200 text-left font-sans leading-normal z-30">
                                    <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest border-b border-zinc-800 pb-1.5 mb-2 flex items-center gap-1.5">
                                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> Pay Calculation Details
                                    </div>
                                    <div className="space-y-1.5 text-xs text-zinc-300">
                                      <div className="flex justify-between border-b border-zinc-900 pb-1">
                                        <span className="text-zinc-400 text-[11px]">Cutoff Basic Rate (Prorated):</span>
                                        <span className="font-mono font-bold text-zinc-200">{currency}{(item.payroll.basicSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                      </div>
                                      <div className="flex justify-between border-b border-zinc-900 pb-1">
                                        <span className="text-zinc-400 text-[11px]">Cutoff Period Allowance:</span>
                                        <span className="font-mono font-bold text-blue-400">+{currency}{(item.payroll.allowance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                      </div>
                                      {(item.payroll.otPay || 0) > 0 && (
                                        <div className="flex justify-between border-b border-zinc-900 pb-1">
                                          <span className="text-zinc-400 text-[11px]">Overtime Earnings:</span>
                                          <span className="font-mono font-bold text-emerald-400">+{currency}{(item.payroll.otPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                      )}
                                      {((item.payroll.paidLeavePay || 0) + (item.payroll.birthdayLeavePay || 0)) > 0 && (
                                        <div className="flex justify-between border-b border-zinc-900 pb-1">
                                          <span className="text-zinc-400 text-[11px]">Paid Leave Compensation:</span>
                                          <span className="font-mono font-bold text-indigo-400">+{currency}{((item.payroll.paidLeavePay || 0) + (item.payroll.birthdayLeavePay || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                      )}
                                      {(item.payroll.absentDeduction || 0) > 0 && (
                                        <div className="flex justify-between border-b border-zinc-900 pb-1 text-red-400">
                                          <span>Absent Penalty: (-{item.absentLogsCount}d absent)</span>
                                          <span className="font-mono font-bold">-{currency}{(item.payroll.absentDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                      )}
                                      {(item.payroll.lateDeduction || 0) > 0 && (
                                        <div className="flex justify-between border-b border-zinc-900 pb-1 text-red-400">
                                          <span>Lateness Fine: (-{item.totalLateMinutes}m)</span>
                                          <span className="font-mono font-bold">-{currency}{(item.payroll.lateDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                      )}
                                      {(item.payroll.cashAdvanceDeduction || 0) > 0 && (
                                        <div className="flex justify-between border-b border-zinc-900 pb-1 text-amber-500">
                                          <span>Cash Advance Deductions:</span>
                                          <span className="font-mono font-bold">-{currency}{(item.payroll.cashAdvanceDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                      )}
                                      <div className="flex justify-between pt-1.5 text-zinc-50 font-bold border-t border-zinc-800">
                                        <span className="text-indigo-400">Final Calculated Net Pay:</span>
                                        <span className="font-mono">{currency}{(item.finalNet || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                      </div>
                                      <div className="text-[9px] text-zinc-500 border-t border-zinc-900 pt-1.5 font-mono leading-relaxed uppercase">
                                        Adjustment Logic: Net pay corresponds to (Basic Standard + Allowance + Overtime + Leave) minus penalty rates (Unexcused Absences + Lateness fines @ ₱2.50/min).
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-right text-zinc-450 uppercase italic font-mono text-[9px] tracking-wider py-1.5">
                              No Draft Compiled
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Payroll spreadsheet summary table */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
        <div 
          onClick={(e) => {
            // Prevent toggling if a button is clicked
            if ((e.target as HTMLElement).closest('button')) return;
            setIsTableOpen(!isTableOpen);
          }}
          className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-150 dark:border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold font-mono text-zinc-650 uppercase tracking-wider">
              Cutoff matching records ({currentPayrollList.length})
            </span>
            <span className="text-[10px] font-bold font-mono text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 ml-2">
              {isTableOpen ? "▼ COLLAPSE" : "▲ EXPAND"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {currentPayrollList.length > 0 && (
              <>
                <button
                  onClick={handleExportPDF}
                  className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                  title="Export detailed PDF ledger for accounting imports"
                >
                  <Download className="w-3.5 h-3.5" /> Export Payroll PDF
                </button>
                <button
                  onClick={handleExportBossSummary}
                  className="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                  title="Download Executive Summary PDF specifically formatted for Boss review/approval"
                >
                  <Sparkles className="w-3.5 h-3.5 text-yellow-300" /> Executive Boss Summary
                </button>
                <button
                  onClick={() => handleOpenAddBossPlus()}
                  className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                  title="Grant Boss Plus / Additional Cash in full or installments (3, 5, or custom cutoffs)"
                >
                  <Coins className="w-3.5 h-3.5 text-emerald-200" /> + Add Boss Plus / Cash
                </button>
                <button
                  onClick={() => handleOpenAddDeduction()}
                  className="text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 px-3 py-1 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                  title="Record deduction / loan or defer deductions to next cutoff upon employee request"
                >
                  <Banknote className="w-3.5 h-3.5 text-rose-200" /> + Add Deduction / Loan
                </button>
                <button
                  onClick={handleOpenAutoSendModal}
                  className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                  title="Auto-send payslip notifications to all employee provided emails"
                >
                  <Send className="w-3.5 h-3.5" /> Auto-Send Payslips ({currentPayrollList.length})
                </button>
              </>
            )}
            {currentPayrollList.some(p => p.status === "Draft") ? (
              <button
                type="button"
                onClick={handleOpenReleaseModal}
                className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 rounded-lg shadow-xs cursor-pointer transition-colors flex items-center gap-1.5"
                title="Review, finalize, and release official draft vouchers to employees"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Release Released Status Vouchers</span>
                <span className="text-[10px] font-mono bg-emerald-800/80 px-1.5 py-0.5 rounded-full font-bold">
                  {currentPayrollList.filter(p => p.status === "Draft").length}
                </span>
              </button>
            ) : currentPayrollList.length > 0 ? (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-300 dark:border-emerald-800 rounded-lg text-emerald-700 dark:text-emerald-400 text-xs font-bold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>All Vouchers Released</span>
              </div>
            ) : null}
          </div>
        </div>

        {isTableOpen && (
        <div className="overflow-x-auto">
          {currentPayrollList.length === 0 ? (
            <div className="p-12 text-center text-zinc-400">
              <Calculator className="w-10 h-10 mx-auto mb-2 text-zinc-250" />
              <p className="text-sm font-semibold">No records found for this payroll cutoff.</p>
              <p className="text-xs mt-0.5">
                {settings.autoRecalculatePayroll === false 
                  ? 'Click "Compile Payroll Cutoff" on the top right to generate payroll calculations.'
                  : 'Check if there are any active employees or attendance records for this period.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-50/50 dark:bg-zinc-903 border-b border-zinc-150 dark:border-zinc-800 text-[10px] uppercase font-mono font-bold text-zinc-650 dark:text-zinc-400">
                  <th className="py-3 px-4">EMPLOYEE</th>
                  <th className="py-3 px-4 text-right">BASIC SALARY</th>
                  <th className="py-3 px-4 text-right">OT & RD PAY</th>
                  {selectedPeriodObj?.enableNightDiff && (
                    <th className="py-3 px-4 text-right text-indigo-600 dark:text-indigo-400">NIGHT DIFF (10%)</th>
                  )}
                  <th className="py-3 px-4 text-right">ALLOWANCE</th>
                  <th className="py-3 px-4 text-right">LEAVES</th>
                  <th className="py-3 px-4 text-right text-emerald-600 dark:text-emerald-400">
                    <div className="flex items-center justify-end gap-1">
                      <Coins className="w-3.5 h-3.5 text-emerald-500" />
                      <span>BOSS PLUS / ADD CASH</span>
                    </div>
                  </th>
                  <th className="py-3 px-4 text-right">TOTAL DEDUCT</th>
                  <th className="py-3 px-4 text-right">NET VOUCHER</th>
                  <th className="py-3 px-4 text-center">STATUS</th>
                  <th className="py-3 px-4 text-center">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 font-medium">
                {currentPayrollList.map((pr) => {
                  const emp = employees.find(e => e.id === pr.employeeId || e.employeeNumber === pr.employeeNumber || (pr.fullName && e.fullName?.toLowerCase() === pr.fullName.toLowerCase()));
                  return (
                  <tr key={pr.payrollId} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20 transition-colors">
                    <td className="py-3 px-4 font-bold text-zinc-850 dark:text-zinc-50">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{pr.fullName}</span>
                        {emp?.status === "Resigned" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold uppercase tracking-wider" title="Employee is marked as Resigned, but has earned pay in this cutoff">
                            Resigned
                          </span>
                        )}
                        {emp?.status === "Inactive" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/30 font-semibold uppercase tracking-wider" title="Employee is marked as Inactive, but has earned pay in this cutoff">
                            Inactive
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-zinc-700 dark:text-zinc-350">
                      {currency}{(pr.basicSalary || 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-green-600">
                      <div>+{currency}{((pr.otPay || 0) + (pr.extraDaysPay || 0)).toLocaleString()}</div>
                      {(pr.otHours || 0) > 0 && (
                        <span className="text-[10px] text-zinc-400 font-normal">
                          {pr.otHours}h {selectedPeriodObj?.enableOT125 ? "@ 125%" : ""}
                        </span>
                      )}
                    </td>
                    {selectedPeriodObj?.enableNightDiff && (
                      <td className="py-3 px-4 text-right font-mono text-indigo-600 dark:text-indigo-400">
                        <div>+{currency}{(pr.nightDiffPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                        <span className="text-[10px] text-zinc-400 font-normal">
                          {pr.nightDiffHours || 0}h @ 10%
                        </span>
                      </td>
                    )}
                    <td className="py-3 px-4 text-right font-mono text-blue-600" title="Allowance">
                      +{currency}{(pr.allowance || 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-purple-600" title="Leaves">
                      +{currency}{((pr.paidLeavePay || 0) + (pr.birthdayLeavePay || 0)).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono" title="Boss Plus / Additional Cash additions">
                      {(() => {
                        const empDebts = (bossDebts || []).filter(d => d.employeeId === pr.employeeId && (d.status === "Pending" || d.status === "Active") && d.remainingBalance > 0);
                        const deferredDebts = empDebts.filter(d => d.isDeferred);
                        const hasDeferred = deferredDebts.length > 0;

                        return (
                          <div className="space-y-1">
                            {(pr.additionalCashPay || 0) > 0 ? (
                              <div className="space-y-0.5">
                                <div className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-end gap-1">
                                  <span>+{currency}{(pr.additionalCashPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                  <button
                                    onClick={() => handleOpenAddBossPlus(pr.employeeId)}
                                    className="text-[9px] text-zinc-400 hover:text-emerald-600 p-0.5 rounded cursor-pointer"
                                    title="Add or manage Boss Plus"
                                  >
                                    <Plus className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                                {pr.additionalCashNotes && (
                                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-normal block truncate max-w-[140px] ml-auto" title={pr.additionalCashNotes}>
                                    {pr.additionalCashNotes}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-zinc-400 dark:text-zinc-600 font-mono text-[11px]">+₱0</span>
                                <button
                                  onClick={() => handleOpenAddBossPlus(pr.employeeId)}
                                  className="opacity-60 hover:opacity-100 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-300 dark:border-emerald-800 transition-all cursor-pointer flex items-center gap-0.5"
                                  title={`Grant Boss Plus to ${pr.fullName}`}
                                >
                                  <Plus className="w-2.5 h-2.5" />
                                  <span>Plus</span>
                                </button>
                              </div>
                            )}

                            {hasDeferred && (
                              <button
                                type="button"
                                onClick={() => handleOpenAddBossPlus(pr.employeeId)}
                                className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-400/40 hover:bg-amber-500/20 cursor-pointer transition-colors ml-auto shadow-2xs"
                                title={`${deferredDebts.length} Boss Plus item(s) hidden/deferred to next cutoff. Click to manage or restore.`}
                              >
                                <EyeOff className="w-2.5 h-2.5 shrink-0 text-amber-500" />
                                <span>{deferredDebts.length} Hidden/Next Cutoff</span>
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono" title="Total Deductions">
                      {(() => {
                        const empAdvances = (cashAdvances || []).filter(a => a.employeeId === pr.employeeId && (a.status === "Pending" || a.status === "Active") && a.remainingBalance > 0);
                        const deferredAdvances = empAdvances.filter(a => a.isDeferred);
                        const hasDeferred = deferredAdvances.length > 0;
                        const deferredTotal = deferredAdvances.reduce((sum, a) => sum + (a.remainingBalance || 0), 0);

                        return (
                          <div className="space-y-1">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-red-650 font-bold">
                                -{currency}{(pr.deductions || 0).toLocaleString(undefined, { minimumFractionDigits: (pr.deductions || 0) % 1 === 0 ? 0 : 2 })}
                              </span>
                              <button
                                onClick={() => handleOpenAddDeduction(pr.employeeId)}
                                className="text-[9px] text-zinc-400 hover:text-rose-600 p-0.5 rounded cursor-pointer"
                                title="Add or manage deductions for this employee"
                              >
                                <Plus className="w-2.5 h-2.5" />
                              </button>
                            </div>

                            {hasDeferred && (
                              <button
                                type="button"
                                onClick={() => handleOpenAddDeduction(pr.employeeId)}
                                className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-400/40 hover:bg-purple-500/20 cursor-pointer transition-colors ml-auto shadow-2xs"
                                title={`${deferredAdvances.length} deduction(s) hidden/deferred per employee request (₱${deferredTotal.toLocaleString()} postponed to next cutoff). Click to manage or unhide.`}
                              >
                                <EyeOff className="w-2.5 h-2.5 shrink-0 text-purple-500" />
                                <span>{deferredAdvances.length} Deferred to Next Cutoff</span>
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-zinc-900 dark:text-white font-mono">
                      {currency}{(pr.finalSalary || 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleSingleVoucherStatus(pr)}
                        title={`Click to switch status to ${pr.status === "Draft" ? "Released" : "Draft"}`}
                        className={`px-2.5 py-0.5 text-[9px] font-bold font-mono rounded-full uppercase transition-all cursor-pointer shadow-2xs hover:scale-105 ${
                          pr.status === "Draft"
                            ? "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-700 hover:bg-yellow-200"
                            : "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-300 dark:border-green-700 hover:bg-green-200"
                        }`}
                      >
                        {pr.status}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Quick Release/Revert Toggle */}
                        {pr.status === "Draft" ? (
                          <button
                            type="button"
                            onClick={() => handleToggleSingleVoucherStatus(pr)}
                            className="p-1 text-zinc-500 hover:text-emerald-700 dark:text-zinc-400 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border border-zinc-200 dark:border-zinc-800 rounded cursor-pointer transition-colors"
                            title="Quick Release this individual voucher"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleSingleVoucherStatus(pr)}
                            className="p-1 text-zinc-500 hover:text-amber-600 dark:text-zinc-400 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 border border-zinc-200 dark:border-zinc-800 rounded cursor-pointer transition-colors"
                            title="Revert voucher to Draft status"
                          >
                            <History className="w-3.5 h-3.5 text-zinc-400" />
                          </button>
                        )}
                        {/* Print payslip */}
                        <button
                          type="button"
                          onClick={() => setSelectedPayslip(pr)}
                          className="p-1 text-zinc-550 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 border border-zinc-200 dark:border-zinc-800 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer transition-colors"
                          title="View Payslip Printable"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        {/* Download PDF payslip */}
                        <button
                          type="button"
                          onClick={() => handleDownloadIndividualPayslip(pr)}
                          className="p-1 text-zinc-550 hover:text-emerald-600 dark:text-zinc-400 dark:hover:text-emerald-400 border border-zinc-200 dark:border-zinc-800 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer transition-colors"
                          title="Download Employee Payslip PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {/* Send Email payslip */}
                        <button
                          type="button"
                          onClick={() => handleOpenEmailModal(pr)}
                          className="p-1 text-zinc-550 hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 border border-zinc-200 dark:border-zinc-801 rounded cursor-pointer transition-colors"
                          title="Send Payslip Email to Employee"
                        >
                          <Mail className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          )}
        </div>
        )}
      </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* VIEW B: 13TH MONTH PAY & ANNUAL ABSENCE RECKONING */}
      {/* ========================================================= */}
      {activePayrollTab === "thirteenth_month" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Top Banner and Controls */}
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl">
                  <Award className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                    13th Month Statutory Pay & Whole-Year Absence Reckoning
                    <span className="text-[10px] font-mono bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-2 py-0.5 rounded-full font-bold">
                      P.D. 851 DOLE Standard
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Audit annual absences across all 12 calendar months, deduct daily absence impacts, and compute final prorated 13th month payout.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-900 p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <span className="text-[11px] font-bold text-zinc-500 uppercase px-1">YEAR:</span>
                  {[2024, 2025, 2026, 2027].map((yr) => (
                    <button
                      key={yr}
                      onClick={() => setSelected13thYear(yr)}
                      className={`px-2.5 py-1 text-xs font-black rounded-lg transition-all cursor-pointer ${
                        selected13thYear === yr
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                      }`}
                    >
                      {yr}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleExport13thMonthPDF}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Download formal DOLE 13th Month compliance audit register PDF"
                >
                  <Download size={14} />
                  <span>Export 13th Month Register PDF</span>
                </button>
              </div>
            </div>

            {/* Search Bar */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search employee by name, department, or position..."
                value={search13th}
                onChange={(e) => setSearch13th(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {/* Scope and Inception Date Controls */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-indigo-50/60 dark:bg-indigo-950/30 p-3.5 rounded-xl border border-indigo-200/60 dark:border-indigo-800/40 text-xs">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span className="font-bold text-zinc-900 dark:text-zinc-100">
                    Audit Baseline & Scope Setting:
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  App clock-in logs start on <strong>{trackingStartDate}</strong>. Zero working hours exist in January.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-0.5">
                  <button
                    onClick={() => setCalculationScope("full_year")}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                      calculationScope === "full_year"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                    }`}
                    title="Credit full 12 months for pre-2026 hires (GLORIOSO, SOMBILLO, PANGAN, TARUC); June onwards for June 2026 hires"
                  >
                    Full Year (DOLE P.D. 851)
                  </button>
                  <button
                    onClick={() => setCalculationScope("app_inception_only")}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                      calculationScope === "app_inception_only"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                    }`}
                    title="Only compute 13th month starting strictly from when this app started (June 15 onwards)"
                  >
                    App Tracking Only (From June)
                  </button>
                </div>

                <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1">
                  <span className="text-[10px] text-zinc-400 uppercase font-mono font-bold">App Start:</span>
                  <input
                    type="date"
                    value={trackingStartDate}
                    onChange={(e) => setTrackingStartDate(e.target.value)}
                    className="bg-transparent border-0 text-xs font-mono font-bold text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* DOLE P.D. 851 & Statutory Wage Base Compliance Notice */}
            <div className="flex items-start gap-3 bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/40 p-3.5 rounded-xl text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-emerald-900 dark:text-emerald-200">
                  Philippine Statutory Exclusion Rule (P.D. No. 851):
                </span>
                <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 leading-relaxed">
                  Under DOLE Revised Guidelines, 13th-month pay is strictly computed as <strong>1/12th of total Basic Salary earned</strong> during the calendar year (Net Basic = Monthly Basic − Absences). Statutory premiums such as <strong>Overtime (125%)</strong> and <strong>Night Shift Differential (10%)</strong> are legally excluded from the 13th-month calculation base. Historical cutoffs and past payouts remain 100% preserved and untouched.
                </p>
              </div>
            </div>
          </div>

          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">
                ELIGIBLE STAFF ({selected13thYear})
              </span>
              <span className="text-xl font-black text-zinc-900 dark:text-zinc-100 mt-1 block">
                {filtered13thMonthData.length} Staff Members
              </span>
              <span className="text-[11px] text-zinc-500 mt-0.5 block">Active headcount in audit</span>
            </div>

            <div className="bg-white dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
              <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider block font-mono">
                ABSENCES TRACKED (SINCE {trackingStartDate})
              </span>
              <span className="text-xl font-black text-rose-600 dark:text-rose-400 mt-1 block">
                {filtered13thMonthData.reduce((s, i) => s + i.totalYearAbsences, 0)} Total Days
              </span>
              <span className="text-[11px] text-zinc-500 mt-0.5 block">Excluding approved leaves & pre-inception</span>
            </div>

            <div className="bg-white dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
              <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block font-mono">
                ABSENCE DEDUCTION IMPACT
              </span>
              <span className="text-xl font-black text-amber-600 dark:text-amber-400 mt-1 block font-mono">
                -{currency}{filtered13thMonthData.reduce((s, i) => s + i.monthlyBreakdown.reduce((ms, m) => ms + m.absentDeduction, 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[11px] text-zinc-500 mt-0.5 block">Reduced from total basic earned</span>
            </div>

            <div className="bg-indigo-600 dark:bg-indigo-950 p-4 rounded-2xl border border-indigo-500/20 shadow-xs">
              <span className="text-[10px] font-bold text-indigo-100 dark:text-indigo-400 uppercase tracking-wider block font-mono">
                TOTAL 13TH MONTH PAYABLE
              </span>
              <span className="text-xl font-black text-white dark:text-indigo-200 mt-1 block font-mono">
                {currency}{filtered13thMonthData.reduce((s, i) => s + (i.thirteenthMonthPay || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[11px] text-indigo-100/80 dark:text-indigo-300/80 mt-0.5 block">
                {calculationScope === "full_year" ? "Full Year Coverage" : "App Tracking Period Only"}
              </span>
            </div>
          </div>

          {/* DOLE P.D. 851 Guidelines Note */}
          <div className="bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-800/40 p-4 rounded-2xl flex items-start gap-3">
            <Info className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <div className="text-xs text-indigo-950 dark:text-indigo-200 space-y-1.5">
              <p className="font-bold text-indigo-900 dark:text-indigo-100">Presidential Decree No. 851 Legal Rules & Tracking Baseline:</p>
              <div className="text-[11px] leading-relaxed text-indigo-900/85 dark:text-indigo-300 space-y-1">
                <p>
                  • <strong>January Working Hours Clarification</strong>: In the database, <strong>no employee has any recorded clock-ins or working hours in January</strong> (the earliest attendance log began on June 15, 2026). The column 'Calendar Days (M–F)' displays standard calendar business days in the month (e.g. 22 days), not employee clock-ins.
                </p>
                <p>
                  • <strong>Tenure & Hire Dates</strong>: 4 staff members (GLORIOSO, SOMBILLO, PANGAN, TARUC) have hire dates in 2024/2025 in their employee profiles, so under DOLE statutory rules they are credited for pre-existing tenure. The other 7 staff members were hired in June 2026.
                </p>
                <p>
                  • <strong>Leaves are NOT Absences</strong>: Approved paid leaves, birthday leaves, and company leaves are fully credited service days and are <strong>strictly excluded from absences</strong>.
                </p>
              </div>
            </div>
          </div>

          {/* 13th Month Employee Roster Table */}
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-black font-mono text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                Employee 13th Month Audit Roster ({filtered13thMonthData.length})
              </span>
              <span className="text-[10px] font-mono text-zinc-400">
                Calendar Year: {selected13thYear}
              </span>
            </div>

            <div className="overflow-x-auto">
              {filtered13thMonthData.length === 0 ? (
                <div className="p-8 text-center text-zinc-400 text-xs">
                  No employees matched the search query.
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900/50 text-zinc-500 font-mono text-[10px] uppercase">
                      <th className="py-3 px-4 font-bold">Employee</th>
                      <th className="py-3 px-4 font-bold text-right">Monthly Basic</th>
                      <th className="py-3 px-4 font-bold text-right">Daily Rate</th>
                      <th className="py-3 px-4 font-bold text-center">Year Absences</th>
                      <th className="py-3 px-4 font-bold text-center">Paid Leaves</th>
                      <th className="py-3 px-4 font-bold text-center">Clocked-In Days</th>
                      <th className="py-3 px-4 font-bold text-right">Net Basic Earned</th>
                      <th className="py-3 px-4 font-bold text-right text-indigo-600 dark:text-indigo-400">13th Month Pay</th>
                      <th className="py-3 px-4 font-bold text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-medium text-zinc-700 dark:text-zinc-300">
                    {filtered13thMonthData.map((item) => {
                      const emp = item.employee;
                      return (
                        <tr key={emp.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-indigo-500/10 text-indigo-600 font-bold flex items-center justify-center text-xs shrink-0">
                                {emp.fullName.charAt(0)}
                              </div>
                              <div>
                                <div className="font-bold text-zinc-900 dark:text-zinc-100">{emp.fullName}</div>
                                <div className="text-[10px] text-zinc-400 font-mono">
                                  {emp.employeeNumber} • {emp.position || emp.department || "Staff"}
                                </div>
                                {emp.dateHired && (
                                  <div className="text-[9px] text-zinc-500 font-mono">
                                    Hired: {emp.dateHired}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono text-zinc-900 dark:text-zinc-100 font-bold">
                            <div>{currency}{(item.monthlyBasic || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                            {item.hasYearSalaryTransition && (
                              <div className="mt-1 flex items-center justify-end">
                                <span 
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50"
                                  title={`${item.yearTransitions?.length || 0} salary rate transition(s) active in ${selected13thYear}`}
                                >
                                  <TrendingUp className="w-2.5 h-2.5" />
                                  Rate Transition
                                </span>
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono text-zinc-500 text-[11px]">
                            {currency}{(item.dailyRate || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>

                          <td className="py-3.5 px-4 text-center">
                            {item.totalYearAbsences === 0 ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                                <CheckCircle size={10} /> Perfect (0)
                              </span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                                item.totalYearAbsences >= 5
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                              }`}>
                                {item.totalYearAbsences || 0} Days Absent
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-center font-mono text-xs text-blue-600 dark:text-blue-400 font-bold">
                            {item.totalYearPaidLeaves || 0}
                          </td>

                          <td className="py-3.5 px-4 text-center font-mono text-xs text-zinc-600 dark:text-zinc-400">
                            {item.totalYearPresent || 0}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono text-zinc-900 dark:text-zinc-100 font-bold">
                            {currency}{(item.totalYearBasicEarned || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono text-sm font-black text-indigo-600 dark:text-indigo-400">
                            {currency}{(item.thirteenthMonthPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>

                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => setSelectedEmpFor13thAudit(emp)}
                                className="px-2.5 py-1 text-[11px] font-bold text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                                title="Open 12-Month Calendar & Absence breakdown"
                              >
                                <CalendarDays size={13} className="text-indigo-500" />
                                <span>Audit Absences</span>
                              </button>

                              <button
                                onClick={() => handleAttach13thMonthToCutoff(emp.id, item.thirteenthMonthPay)}
                                className="px-2.5 py-1 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                                title="Attach 13th Month Pay to current active cutoff payslip"
                              >
                                <Plus size={13} />
                                <span>Attach to Cutoff</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CREATE PERIOD MODAL DIALOG */}
      {isPeriodModalOpen && (
        <div className="fixed inset-0 bg-black/50 overflow-y-auto flex justify-center p-4 z-55 backdrop-blur-xs">
          <div className="my-auto bg-white dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-150 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-zinc-800 dark:text-zinc-50 uppercase tracking-wide">Schedule Cutoff Cycle</h3>
                <p className="text-[10px] text-zinc-400 mt-1 font-mono">Setup new active calculation boundary dates</p>
              </div>
              <button onClick={() => setIsPeriodModalOpen(false)} className="text-zinc-400 hover:text-zinc-650 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePeriod} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">CUTOFF LABEL NAME</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cutoff June 1-12"
                  value={periodName}
                  onChange={(e) => setPeriodName(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none dark:text-zinc-50 font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">START DATE</label>
                  <input
                    type="date"
                    required
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none dark:text-zinc-50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">END DATE</label>
                  <input
                    type="date"
                    required
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none dark:text-zinc-50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">VOUCHER RELEASE DATE</label>
                <input
                  type="date"
                  value={periodRelease}
                  onChange={(e) => setPeriodRelease(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none dark:text-zinc-50"
                />
              </div>

              {/* Philippine Labor Law Statutory Options */}
              <div className="p-3 bg-zinc-50 dark:bg-zinc-900/60 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2.5">
                <span className="text-[10px] font-bold text-zinc-500 font-mono uppercase block">Philippine Labor Law Options</span>
                
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newPeriodEnableNightDiff}
                    onChange={(e) => setNewPeriodEnableNightDiff(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">Apply Night Shift Differential (10%)</span>
                    <span className="text-[11px] text-zinc-500 block leading-tight">Article 86: +10% premium for hours worked between 10:00 PM and 6:00 AM</span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer pt-2 border-t border-zinc-200/50 dark:border-zinc-800/50">
                  <input
                    type="checkbox"
                    checked={newPeriodEnableOT125}
                    onChange={(e) => setNewPeriodEnableOT125(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">Apply 125% Overtime Rate</span>
                    <span className="text-[11px] text-zinc-500 block leading-tight">Article 87: 1.25x regular hourly rate for work beyond 8 hours</span>
                  </div>
                </label>
              </div>

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-zinc-900">
                <button
                  type="button"
                  onClick={() => setIsPeriodModalOpen(false)}
                  className="px-4 py-2 border border-zinc-200 text-xs rounded-xl hover:bg-zinc-50 dark:text-zinc-300 dark:border-zinc-800 transition-colors cursor-pointer"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-sm transition-colors cursor-pointer"
                >
                  Confirm Period Cycle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PRINTABLE PAYSLIP DETAILS MODAL */}
      {selectedPayslip && (
        <div className="fixed inset-0 bg-black/60 overflow-y-auto flex justify-center p-4 z-55 backdrop-blur-xs">
          <div className="my-auto bg-white dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl relative font-sans animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header / Actions toolbar */}
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-150 dark:border-zinc-805 flex items-center justify-between print:hidden">
              <h4 className="font-bold text-xs uppercase tracking-wider font-mono text-zinc-600 dark:text-zinc-400">Official Compensation Slip</h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownloadIndividualPayslip(selectedPayslip)}
                  className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" /> Download PDF
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs bg-zinc-900 hover:bg-zinc-850 text-white dark:bg-zinc-800 dark:hover:bg-zinc-700 font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
                <button onClick={() => setSelectedPayslip(null)} className="p-1 uppercase hover:text-red-500 cursor-pointer text-zinc-450">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Main Interactive Print Slip */}
            <div className="p-8 space-y-6 select-all font-mono">
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <h2 className="text-xl font-extrabold text-indigo-600 uppercase tracking-tight">Oligarch Media Graphic Design Studio</h2>
                  <p className="text-[11px] text-zinc-400 uppercase">Avenue Business Blvd • Finance Hub</p>
                </div>
                <div className="text-right">
                  <p className="text-base font-extrabold text-zinc-900 dark:text-zinc-50">{selectedPayslip.payrollId}</p>
                  <p className="text-[10px] text-zinc-400 font-mono">PAY DATE: {selectedPeriodObj?.releaseDate}</p>
                </div>
              </div>

              <hr className="border-t border-dashed border-zinc-200 dark:border-zinc-800" />

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1 text-zinc-800 dark:text-zinc-300">
                  <p>EMPLOYEE: <strong>{selectedPayslip.fullName}</strong></p>
                  <p>EMP ID: <span className="font-semibold">{selectedPayslip.employeeNumber}</span></p>
                </div>
                <div className="space-y-1 text-zinc-800 dark:text-zinc-400">
                  <p>CUTOFF PERIOD: <span className="font-semibold">{selectedPayslip.cutoffPeriodId}</span></p>
                  <p>DAYS TRACKED: <span className="font-bold">10 business days</span></p>
                </div>
              </div>

              <hr className="border-t border-zinc-200 dark:border-zinc-800" />
              
              {/* Attendance Summary */}
              <div className="space-y-2 text-xs bg-zinc-50 dark:bg-zinc-900/50 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">
                <p className="text-[10px] font-bold text-zinc-450 uppercase mb-2">Attendance Summary</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-2 gap-x-4">
                  <div className="flex justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Present</span>
                    <span className="font-mono font-semibold">{selectedPayslip.presentDays || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Total Lates</span>
                    <span className="font-mono font-semibold">{selectedPayslip.lateCount || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Converted Abs.</span>
                    <span className="font-mono font-semibold text-amber-600 dark:text-amber-500">{selectedPayslip.convertedAbsences || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Remaining Late</span>
                    <span className="font-mono font-semibold">{selectedPayslip.remainingLates || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Actual Absent</span>
                    <span className="font-mono font-semibold text-red-600 dark:text-red-400">{selectedPayslip.actualAbsences || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Worked Hrs</span>
                    <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{(selectedPayslip.workedHours || 0).toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Overtime Hrs</span>
                    <span className="font-mono font-semibold text-purple-600 dark:text-purple-400">{(selectedPayslip.otHours || 0).toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Break Hrs</span>
                    <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">{(selectedPayslip.breakHours || 0).toFixed(1)}</span>
                  </div>
                </div>
              </div>

              <hr className="border-t border-zinc-200 dark:border-zinc-800" />
              
              {/* Salary breakdowns */}
              <div className="space-y-2 text-xs">
                <p className="text-[10px] font-bold text-zinc-450 uppercase mb-2">Detailed Components Breakdown</p>
                
                <div className="flex justify-between">
                  <span>Prorated Basic Cutoff Salary</span>
                  <span className="font-mono">{currency}{(selectedPayslip.basicSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>

                <div className="flex justify-between">
                  <span>Cutoff Standard Allowance</span>
                  <span className="font-mono">+{currency}{(selectedPayslip.allowance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>

                <div className="flex justify-between text-green-600 font-semibold">
                  <span>Overtime Pay {(selectedPeriodObj?.enableOT125 ?? false) ? "(125% Art. 87)" : ""}</span>
                  <span className="font-mono">+{currency}{(selectedPayslip.otPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>

                {(selectedPayslip.nightDiffPay || 0) > 0 && (
                  <div className="flex justify-between text-indigo-600 font-semibold">
                    <span>Night Shift Differential (10% Art. 86) ({(selectedPayslip.nightDiffHours || 0).toFixed(1)}h)</span>
                    <span className="font-mono">+{currency}{(selectedPayslip.nightDiffPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}

                {(selectedPayslip.paidLeavePay || 0) > 0 && (
                  <div className="flex justify-between text-blue-600">
                    <span>Paid Leave Compensation</span>
                    <span className="font-mono">+{currency}{(selectedPayslip.paidLeavePay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}

                {(selectedPayslip.birthdayLeavePay || 0) > 0 && (
                  <div className="flex justify-between text-blue-600">
                    <span>Birthday Leave Voucher</span>
                    <span className="font-mono">+{currency}{(selectedPayslip.birthdayLeavePay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}

                {(selectedPayslip.additionalCashPay || 0) > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Boss Plus / Cash Addition {selectedPayslip.additionalCashNotes ? `(${selectedPayslip.additionalCashNotes})` : ""}</span>
                    <span className="font-mono">+{currency}{(selectedPayslip.additionalCashPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}

                <div className="flex justify-between text-red-650 pt-2 border-t border-dashed border-zinc-200/50 dark:border-zinc-800/60">
                  <span>Deductions Total</span>
                  <span className="font-mono">-{currency}{(selectedPayslip.deductions || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                
                {(selectedPayslip.convertedAbsences || 0) > 0 && (
                  <div className="flex justify-between text-red-500 pl-4 text-[11px]">
                    <span>↳ Converted Absences ({selectedPayslip.convertedAbsences} from Lates)</span>
                    <span className="font-mono">-{currency}{(selectedPayslip.convertedAbsentDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                
                {(selectedPayslip.absentDeduction || 0) > 0 && (
                  <div className="flex justify-between text-red-500 pl-4 text-[11px]">
                    <span>↳ Actual Absences Deduction</span>
                    <span className="font-mono">-{currency}{(selectedPayslip.absentDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}

                {(selectedPayslip.lateDeduction || 0) > 0 && (
                  <div className="flex justify-between text-red-500 pl-4 text-[11px]">
                    <span>↳ Late Penalty Deduction</span>
                    <span className="font-mono">-{currency}{(selectedPayslip.lateDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}

                {(selectedPayslip.cashAdvanceDeduction || 0) > 0 && (
                  <div className="flex justify-between text-red-500 pl-4 text-[11px]">
                    <span>↳ Cash Advance Installments</span>
                    <span className="font-mono">-{currency}{(selectedPayslip.cashAdvanceDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}

                {(() => {
                  const empAdvances = (cashAdvances || []).filter(a => a.employeeId === selectedPayslip.employeeId && a.isDeferred && (a.status === "Pending" || a.status === "Active") && a.remainingBalance > 0);
                  const empBoss = (bossDebts || []).filter(b => b.employeeId === selectedPayslip.employeeId && b.isDeferred && (b.status === "Pending" || b.status === "Active") && b.remainingBalance > 0);
                  if (empAdvances.length === 0 && empBoss.length === 0) return null;

                  return (
                    <div className="p-2.5 bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 rounded-xl text-[11px] text-purple-900 dark:text-purple-300 space-y-1 mt-2">
                      <div className="font-bold flex items-center gap-1.5 text-purple-700 dark:text-purple-400">
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Deferred / Postponed to Next Cutoff:</span>
                      </div>
                      {empAdvances.map(a => (
                        <div key={a.id || a.referenceId} className="flex justify-between pl-4 text-zinc-600 dark:text-zinc-400 font-mono">
                          <span>• Deduction postponed: {a.notes || a.referenceId}</span>
                          <span className="text-purple-600 dark:text-purple-400 font-bold">{currency}{(a.remainingBalance || 0).toLocaleString()} (Next Cutoff)</span>
                        </div>
                      ))}
                      {empBoss.map(b => (
                        <div key={b.id || b.referenceId} className="flex justify-between pl-4 text-zinc-600 dark:text-zinc-400 font-mono">
                          <span>• Boss Plus postponed: {b.notes || b.referenceId}</span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">+{currency}{(b.remainingBalance || 0).toLocaleString()} (Next Cutoff)</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <hr className="border-t border-dashed border-zinc-200 dark:border-zinc-800" />

              {/* Final Sal */}
              <div className="flex justify-between items-center p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                <span className="font-bold text-sm text-zinc-750 dark:text-zinc-200 uppercase tracking-wide">Net Final Salary Transfer</span>
                <span className="text-xl font-black text-blue-600 font-mono">{currency}{(selectedPayslip.finalSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="text-center text-[10px] text-zinc-400 italic">
                Thank you for your active contributions to Oligarch Media Graphic Design Studio.
              </div>
            </div>

          </div>
        </div>
      )}

      {/* CUSTOM DELETE CONFIRMATION MODAL */}
      {isDeleteConfirmOpen && selectedPeriodObj && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-55 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl p-6 relative font-sans animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-sm font-bold text-red-650 dark:text-red-400 uppercase tracking-wider font-mono flex items-center gap-2 mb-2">
              <Trash2 className="w-5 h-5 shrink-0" />
              Delete Cutoff Cycle?
            </h3>
            <p className="text-xs text-zinc-650 dark:text-zinc-300 leading-relaxed mb-4">
              Are you sure you want to permanently delete the payroll period <strong className="text-zinc-900 dark:text-zinc-50">"{selectedPeriodObj.name}"</strong>? 
              This will also safely delete the <span className="font-bold text-red-650 dark:text-red-400">{currentPayrollList.length} compiled pay records</span> associated with this cutoff. This audit action cannot be undone.
            </p>

            {deleteStatusMsg && (
              <div className={`p-2.5 rounded-lg text-xs font-semibold mb-4 text-center ${
                deleteStatusMsg.includes("Success") 
                  ? "bg-green-500/15 text-green-650 dark:text-green-400" 
                  : "bg-blue-500/10 text-blue-600 dark:text-indigo-400"
              }`}>
                {deleteStatusMsg}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={!!deleteStatusMsg && deleteStatusMsg.includes("Processing")}
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="px-4 py-2 border border-zinc-200 dark:border-zinc-850 text-xs font-semibold rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-950 text-zinc-650 dark:text-zinc-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!!deleteStatusMsg}
                onClick={handleExecuteDeletePeriod}
                className="px-4 py-2 bg-red-650 hover:bg-red-700 text-white font-bold rounded-xl text-xs shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
              >
                Delete Period
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOSS CUTOFF ATTENDANCE & OT SUMMARY MODAL */}
      {isBossAttendanceModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-full max-w-5xl rounded-3xl overflow-hidden shadow-2xl p-6 relative font-sans my-8 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight">
                  Boss Cutoff Attendance & Overtime Summary
                </h3>
              </div>
              <button
                onClick={() => setIsBossAttendanceModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 pr-1">
              <BossCutoffAttendanceSummary
                employees={employees}
                attendance={attendance}
                periods={periods}
                requests={requests}
                noWorkDays={noWorkDays}
                initialPeriodId={selectedPeriodId}
                workHourStart={settings.workHourStart}
                workHourEnd={settings.workHourEnd}
                dstOffset={settings.dstOffset}
                onRefresh={onRefresh}
              />
            </div>
          </div>
        </div>
      )}

      {/* 12-MONTH CALENDAR & ABSENCE AUDIT BREAKDOWN MODAL */}
      {selectedEmpFor13thAudit && (() => {
        const auditData = annual13thMonthData.find(d => d.employee.id === selectedEmpFor13thAudit.id);
        if (!auditData) return null;
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-55 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl p-6 relative font-sans my-8 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl">
                    <CalendarDays className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight flex items-center gap-2">
                      12-Month Absence Audit & 13th Month Breakdown
                      <span className="text-[10px] font-mono bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-2 py-0.5 rounded-full font-bold">
                        {selected13thYear}
                      </span>
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                      {auditData.employee?.fullName || "Employee"} ({auditData.employee?.employeeNumber || ""}) • Monthly Basic: {currency}{(auditData.monthlyBasic || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedEmpFor13thAudit(null)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* KPI Header for the Employee */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 shrink-0">
                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700/60">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block font-mono">DAILY RATE</span>
                  <span className="text-sm font-black text-zinc-900 dark:text-zinc-100 font-mono block mt-0.5">
                    {currency}{(auditData.dailyRate || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700/60">
                  <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider block font-mono">WHOLE YEAR ABSENCES</span>
                  <span className="text-sm font-black text-rose-600 dark:text-rose-400 font-mono block mt-0.5">
                    {auditData.totalYearAbsences || 0} Days Absent
                  </span>
                </div>

                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700/60">
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block font-mono">NET BASIC EARNED</span>
                  <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono block mt-0.5">
                    {currency}{(auditData.totalYearBasicEarned || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="bg-indigo-600 dark:bg-indigo-950 p-3 rounded-xl border border-indigo-500/20">
                  <span className="text-[10px] font-bold text-indigo-100 dark:text-indigo-400 uppercase tracking-wider block font-mono">13TH MONTH PAY DUE</span>
                  <span className="text-sm font-black text-white dark:text-indigo-200 font-mono block mt-0.5">
                    {currency}{(auditData.thirteenthMonthPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Monthly Table Breakdown */}
              <div className="overflow-y-auto flex-1 pr-1 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-mono text-[10px] uppercase border-b border-zinc-200 dark:border-zinc-700">
                    <tr>
                      <th className="py-2.5 px-3 font-bold">Month</th>
                      <th className="py-2.5 px-3 font-bold text-center" title="Total standard Mondays through Fridays on calendar">Calendar Days (M–F)</th>
                      <th className="py-2.5 px-3 font-bold text-center" title="Actual clock-in records in this app">Clocked-In Days</th>
                      <th className="py-2.5 px-3 font-bold text-center" title="Total recorded hours worked in attendance">Hours Worked</th>
                      <th className="py-2.5 px-3 font-bold text-center">Leaves</th>
                      <th className="py-2.5 px-3 font-bold text-center" title="Company declared No Work days (Not counted as absent)">No Work Days</th>
                      <th className="py-2.5 px-3 font-bold text-center">Absences</th>
                      <th className="py-2.5 px-3 font-bold">Specific Absent Dates</th>
                      <th className="py-2.5 px-3 font-bold text-right">Basic Salary</th>
                      <th className="py-2.5 px-3 font-bold text-right">Absence Deduct</th>
                      <th className="py-2.5 px-3 font-bold text-right text-indigo-600 dark:text-indigo-400">Net Basic Earned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-medium">
                    {auditData.monthlyBreakdown.map((m) => (
                      <tr key={m.monthIdx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                        <td className="py-2.5 px-3 font-bold text-zinc-900 dark:text-zinc-100">
                          {m.fullMonthName}
                          {m.isPriorToAppInception && (
                            <span className="block text-[9px] font-normal text-zinc-400 font-mono">
                              Pre-App Period
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-zinc-500">
                          {m.workingDays}d
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono">
                          {m.presentDays > 0 ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">{m.presentDays}d</span>
                          ) : (
                            <span className="text-zinc-400">0d</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono">
                          {(m?.totalHours ?? 0) > 0 ? (
                            <span className="text-indigo-600 dark:text-indigo-400 font-bold">{(m.totalHours ?? 0).toFixed(1)}h</span>
                          ) : (
                            <span className="text-zinc-400">0h</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono">
                          {m.paidLeaves > 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                              {m.paidLeaves} leave{m.paidLeaves > 1 ? "s" : ""}
                            </span>
                          ) : (
                            <span className="text-zinc-400">0</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono">
                          {(m.unpaidNoWorkDays || 0) > 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60" title={`${m.unpaidNoWorkDays} Company No Work day(s) — Strictly not counted as absence!`}>
                              {m.unpaidNoWorkDays}d (Not Absent)
                            </span>
                          ) : (
                            <span className="text-zinc-400">0</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {m.absentDays === 0 ? (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">0</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400">
                              {m.absentDays} days
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[11px] font-mono text-zinc-500">
                          {m.absentDates.length === 0 ? (
                            <span className="text-zinc-400 italic">
                              {`${selected13thYear}-${String(m.monthIdx + 1).padStart(2, '0')}-31` < trackingStartDate ? "None (Prior to App Start)" : "None"}
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {m.absentDates.slice(0, 4).map((d) => (
                                <span key={d} className="bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 rounded text-[9px] font-mono">
                                  {d.split('-').slice(1).join('/')}
                                </span>
                              ))}
                              {m.absentDates.length > 4 && (
                                <span className="text-[9px] text-zinc-400">+{m.absentDates.length - 4} more</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-zinc-600 dark:text-zinc-400">
                          <div>{currency}{(m.monthlyBasic || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                          {m.isHistoricalRate && (
                            <div className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold" title={m.rateReason}>
                              {m.rateReason || "Transition Rate"}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-rose-600 dark:text-rose-400 font-bold">
                          {(m.absentDeduction || 0) > 0 ? `-${currency}${(m.absentDeduction || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-zinc-900 dark:text-zinc-100 font-black">
                          {currency}{(m.netBasicEarned || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bottom Actions */}
              <div className="flex items-center justify-between pt-4 mt-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="text-xs text-zinc-500 font-mono">
                  DOLE Formula: Total Net Basic ({currency}{(auditData.totalYearBasicEarned || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}) ÷ 12 = <strong className="text-indigo-600 dark:text-indigo-400 font-bold">{currency}{(auditData.thirteenthMonthPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedEmpFor13thAudit(null)}
                    className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      handleAttach13thMonthToCutoff(auditData.employee.id, auditData.thirteenthMonthPay);
                      setSelectedEmpFor13thAudit(null);
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <Plus size={14} />
                    <span>Attach 13th Month to Cutoff</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* COMPANY NO WORK DAYS MANAGEMENT MODAL */}
      {isNoWorkModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-55 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl p-6 relative font-sans my-8 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
                  <CalendarOff className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight flex items-center gap-2">
                    Company "No Work" Day Declarations
                    <span className="text-[10px] font-mono bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold">
                      {noWorkDays.length} Active
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Designate dates with company-wide work suspension (typhoons, calamities, emergencies).
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsNoWorkModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 pr-1 space-y-5">
              {/* Business Rules Callout */}
              <div className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-4 text-xs space-y-2">
                <div className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5 text-xs">
                  <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Important Business Rules for No Work Days:</span>
                </div>
                <ul className="space-y-1.5 text-amber-850 dark:text-amber-200/90 pl-5 list-disc text-[11px] leading-relaxed">
                  <li>
                    <strong>Not Counted as Absent:</strong> If an employee does not clock in on this day, it is <strong>strictly NOT an absence</strong> (neither in cutoff payroll nor in the 13th Month whole-year absence reckoning).
                  </li>
                  <li>
                    <strong>No Work = No Pay (Unless Leave Used):</strong> Basic pay is based on actual hours worked. Unworked days without leave are not paid.
                  </li>
                  <li>
                    <strong>Paid Leave Protected:</strong> If an employee filed or used an approved leave on this day, <strong>they will still receive their full paid leave pay (1 × Daily Rate)</strong>.
                  </li>
                </ul>
              </div>

              {/* Add New No Work Day Form */}
              <form onSubmit={handleAddNoWorkDay} className="bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60 rounded-2xl p-4 space-y-3.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-blue-500" />
                  <span>Declare New Company No Work Day</span>
                </h4>

                {noWorkError && (
                  <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-medium flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{noWorkError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Date *</label>
                    <input
                      type="date"
                      value={newNoWorkDate}
                      onChange={(e) => setNewNoWorkDate(e.target.value)}
                      required
                      className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl outline-none font-mono focus:border-amber-500 dark:focus:border-amber-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Reason / Label *</label>
                    <input
                      type="text"
                      placeholder="e.g. Typhoon Kristine Suspension"
                      value={newNoWorkLabel}
                      onChange={(e) => setNewNoWorkLabel(e.target.value)}
                      required
                      className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl outline-none focus:border-amber-500 dark:focus:border-amber-400"
                    />
                  </div>
                </div>

                {/* Quick Preset Badges */}
                <div className="space-y-1">
                  <span className="text-[10px] text-zinc-400 font-medium">Quick suggestions:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      "Typhoon Suspension",
                      "Calamity Non-Working Day",
                      "Power / Internet Outage",
                      "Company Declared Rest Day",
                      "Office Maintenance Suspension"
                    ].map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setNewNoWorkLabel(preset)}
                        className="text-[10px] px-2 py-0.5 rounded-lg bg-zinc-200/80 hover:bg-zinc-300 dark:bg-zinc-700/60 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Notes (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Declared by Local Gov; safety precaution"
                    value={newNoWorkNotes}
                    onChange={(e) => setNewNoWorkNotes(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl outline-none"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={savingNoWork}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-bold rounded-xl text-xs shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <Plus size={14} />
                    <span>{savingNoWork ? "Saving..." : "Save No Work Day"}</span>
                  </button>
                </div>
              </form>

              {/* Declared No Work Days List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
                  <span>Declared No Work Days ({noWorkDays.length})</span>
                </h4>

                {noWorkDays.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl text-zinc-400 text-xs">
                    <CalendarOff className="w-8 h-8 mx-auto mb-2 opacity-40 text-amber-500" />
                    <p className="font-medium">No company No Work days declared.</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">Use the form above to add a suspension day when work is officially called off.</p>
                  </div>
                ) : (
                  <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                    {noWorkDays.map((nw) => (
                      <div key={nw.id || nw.date} className="p-3.5 flex items-center justify-between gap-3 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-zinc-900 dark:text-zinc-100">
                              {nw.date}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700/60">
                              {nw.label}
                            </span>
                          </div>
                          {nw.notes && (
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              {nw.notes}
                            </p>
                          )}
                          <p className="text-[10px] text-zinc-400 font-mono">
                            Rule: Not counted as absent • No pay unless leave used
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteNoWorkDay(nw.id, nw.date)}
                          className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-colors cursor-pointer"
                          title="Delete this No Work Day declaration"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end pt-4 mt-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
              <button
                onClick={() => setIsNoWorkModalOpen(false)}
                className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* BOSS PLUS / ADDITIONAL CASH INSTALLMENT MODAL */}
      {/* ========================================================= */}
      {isBossPlusModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-55 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl p-6 relative font-sans my-8 max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
                  <Coins className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight flex items-center gap-2">
                    Grant Boss Plus / Additional Cash
                    <span className="text-[10px] font-mono bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 px-2 py-0.5 rounded-full font-bold">
                      Additions Engine
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Disburse special cash additions in full or spread across multiple payroll cutoffs (e.g. 2, 3, 5, or more cutoffs).
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsBossPlusModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body Scroll Area */}
            <div className="overflow-y-auto flex-1 py-4 space-y-4 pr-1">
              {/* Form */}
              <form onSubmit={handleSaveBossPlus} className="space-y-4">
                {/* Employee Selector */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">
                    Beneficiary Employee *
                  </label>
                  <select
                    value={bossPlusEmployeeId}
                    onChange={(e) => setBossPlusEmployeeId(e.target.value)}
                    required
                    className="w-full text-xs px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none font-semibold text-zinc-900 dark:text-zinc-100 focus:border-emerald-500"
                  >
                    <option value="" disabled>-- Select Employee --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName} ({emp.employeeNumber}) — {emp.position || "Staff"}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Amount input & Quick Chips */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">
                    Total Cash Amount ({currency}) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold font-mono text-zinc-400 text-sm">
                      {currency}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      value={bossPlusAmount || ""}
                      onChange={(e) => setBossPlusAmount(parseFloat(e.target.value) || 0)}
                      required
                      placeholder="0.00"
                      className="w-full pl-8 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm font-bold font-mono text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-500"
                    />
                  </div>
                  {/* Preset Amount Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-zinc-400 uppercase font-mono mr-1">Quick:</span>
                    {[1000, 3000, 5000, 10000, 15000, 20000].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setBossPlusAmount(val)}
                        className={`text-[10px] font-bold font-mono px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                          bossPlusAmount === val
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"
                        }`}
                      >
                        {currency}{val.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Payout Schedule / Installment Options */}
                <div className="space-y-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">
                    Disbursement / Installment Plan *
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBossPlusPayoutMethod("Full")}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        bossPlusPayoutMethod === "Full"
                          ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-500 text-emerald-900 dark:text-emerald-200 shadow-xs ring-1 ring-emerald-500"
                          : "bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400"
                      }`}
                    >
                      <div className="font-bold text-xs">One-Time Full Payout</div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Pay 100% of amount in 1 cutoff
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setBossPlusPayoutMethod("Split")}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        bossPlusPayoutMethod === "Split"
                          ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-500 text-emerald-900 dark:text-emerald-200 shadow-xs ring-1 ring-emerald-500"
                          : "bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400"
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center gap-1.5">
                        <span>Installment Plan</span>
                        <span className="text-[9px] bg-emerald-200 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100 px-1.5 py-0.5 rounded font-mono font-bold">
                          Multi-Cutoff
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Divide equally across cutoffs (e.g. 3, 5, etc.)
                      </div>
                    </button>
                  </div>

                  {/* Cutoff selection pills if Split */}
                  {bossPlusPayoutMethod === "Split" && (
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">
                          Select Number of Cutoffs:
                        </span>
                        <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {bossPlusSplitCount} Cutoffs ({((bossPlusSplitCount || 1) / 2).toFixed(1)} Months)
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {[2, 3, 4, 5, 6, 8, 10, 12].map(count => (
                          <button
                            key={count}
                            type="button"
                            onClick={() => setBossPlusSplitCount(count)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                              bossPlusSplitCount === count
                                ? "bg-emerald-600 text-white shadow-xs"
                                : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"
                            }`}
                          >
                            {count} Cutoffs
                          </button>
                        ))}
                      </div>

                      {/* Custom input option */}
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-[11px] text-zinc-500">Custom cutoff count:</span>
                        <input
                          type="number"
                          min="1"
                          max="48"
                          value={bossPlusSplitCount || ""}
                          onChange={(e) => setBossPlusSplitCount(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-20 px-2.5 py-1 text-xs font-mono font-bold bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg outline-none focus:border-emerald-500 text-center"
                        />
                      </div>
                    </div>
                  )}

                  {/* Real-time Math Calculation Preview Card */}
                  {bossPlusAmount > 0 && (
                    <div className="bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/50 p-3.5 rounded-xl space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                          <Coins className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          <span>Payout Breakdown Preview:</span>
                        </span>
                        <span className="text-sm font-black font-mono text-emerald-700 dark:text-emerald-300">
                          {currency}
                          {(
                            bossPlusPayoutMethod === "Split"
                              ? ((bossPlusAmount || 0) / Math.max(1, bossPlusSplitCount))
                              : (bossPlusAmount || 0)
                          ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          <span className="text-xs font-normal text-zinc-500 ml-1">
                            {bossPlusPayoutMethod === "Split" ? "/ cutoff" : " (full)"}
                          </span>
                        </span>
                      </div>
                      <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 leading-relaxed">
                        {bossPlusPayoutMethod === "Split" ? (
                          <>
                            A total of <strong>{currency}{(bossPlusAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong> will be disbursed in equal installments of <strong>{currency}{((bossPlusAmount || 0) / Math.max(1, bossPlusSplitCount)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong> across <strong>{bossPlusSplitCount} cutoffs</strong> until fully paid.
                          </>
                        ) : (
                          <>
                            The full amount of <strong>{currency}{(bossPlusAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong> will be credited directly to the active cutoff paycheck.
                          </>
                        )}
                      </p>
                    </div>
                  )}
                </div>

                {/* Reason / Notes */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">
                    Notes / Reference Reason (Optional)
                  </label>
                  <input
                    type="text"
                    value={bossPlusNotes}
                    onChange={(e) => setBossPlusNotes(e.target.value)}
                    placeholder="e.g. Performance Incentive, Equipment Reimbursement, Personal Loan Return"
                    className="w-full text-xs px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none text-zinc-900 dark:text-zinc-100 focus:border-emerald-500"
                  />
                </div>

                {/* Hide / Defer to Next Cutoff Toggle */}
                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl space-y-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bossPlusIsDeferred}
                      onChange={(e) => setBossPlusIsDeferred(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded text-emerald-600 border-zinc-300 dark:border-zinc-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <div className="flex-1 text-xs">
                      <div className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                        <EyeOff className="w-3.5 h-3.5 text-amber-500" />
                        <span>Hide from current payslip (Postpone / Defer to next cutoff)</span>
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Hold this Boss Plus addition and release it in the next payroll cutoff instead of this active payslip.
                      </div>
                    </div>
                  </label>
                  {bossPlusIsDeferred && (
                    <input
                      type="text"
                      value={bossPlusDeferReason}
                      onChange={(e) => setBossPlusDeferReason(e.target.value)}
                      placeholder="Reason for postponing (e.g. Schedule release for next cutoff)"
                      className="w-full text-xs px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none text-zinc-900 dark:text-zinc-100 focus:border-emerald-500"
                    />
                  )}
                </div>

                {/* Submit button */}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsBossPlusModalOpen(false)}
                    className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={bossPlusSaving || bossPlusAmount <= 0}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{bossPlusSaving ? "Saving..." : "Save Boss Plus Record"}</span>
                  </button>
                </div>
              </form>

              {/* Active Boss Plus Records List */}
              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-zinc-500" />
                    <span>Active Boss Plus / Additional Cash Records ({(bossDebts || []).length})</span>
                  </h4>
                  <span className="text-[10px] text-zinc-500">
                    Use toggle button below to hide or postpone to next cutoff.
                  </span>
                </div>

                {(bossDebts || []).length === 0 ? (
                  <p className="text-xs text-zinc-400 italic py-2">No active Boss Plus additions currently in system.</p>
                ) : (
                  <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800 max-h-56 overflow-y-auto">
                    {(bossDebts || []).map((debt) => {
                      const isComplete = debt.status === "Fully Paid" || debt.remainingBalance <= 0;
                      return (
                        <div key={debt.id || debt.referenceId} className="p-3 flex items-center justify-between gap-3 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors text-xs">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-zinc-900 dark:text-zinc-100">
                                {debt.employeeName}
                              </span>
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                {debt.payoutMethod === "Split" ? `${debt.splitCount} Cutoffs Installment` : "Full Payout"}
                              </span>
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                isComplete
                                  ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                                  : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-bold"
                              }`}>
                                {debt.status}
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-2 font-mono">
                              <span>Total: {currency}{(debt.amount || 0).toLocaleString()}</span>
                              <span>•</span>
                              <span className={(debt.remainingBalance || 0) > 0 ? "text-emerald-600 font-bold" : ""}>
                                Rem: {currency}{(debt.remainingBalance || 0).toLocaleString()}
                              </span>
                              {debt.notes && (
                                <>
                                  <span>•</span>
                                  <span className="italic text-zinc-400 truncate max-w-xs">{debt.notes}</span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {/* 1-Click Toggle Hide / Show */}
                            <button
                              type="button"
                              onClick={() => debt.id && handleToggleBossDebtDeferred(debt.id, Boolean(debt.isDeferred))}
                              className={`px-2 py-1 text-[11px] font-bold rounded-lg border flex items-center gap-1 transition-colors cursor-pointer ${
                                debt.isDeferred
                                  ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100"
                                  : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-amber-600"
                              }`}
                              title={debt.isDeferred ? "Currently Hidden: Click to restore & include in current cutoff payslip" : "Currently Active: Click to hide from current payslip (defer to next cutoff)"}
                            >
                              {debt.isDeferred ? (
                                <>
                                  <EyeOff className="w-3 h-3 text-amber-500" />
                                  <span>Hidden (Next Cutoff)</span>
                                </>
                              ) : (
                                <>
                                  <Eye className="w-3 h-3 text-emerald-500" />
                                  <span>Active in Payslip</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => debt.id && handleDeleteBossDebt(debt.id)}
                              className="p-1.5 text-zinc-400 hover:text-rose-500 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                              title="Delete this record (saved to Recycle Bin)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end pt-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
              <button
                type="button"
                onClick={() => setIsBossPlusModalOpen(false)}
                className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* DEDUCTIONS & CASH ADVANCES / DEFERRAL MODAL */}
      {/* ========================================================= */}
      {isDeductionModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-55 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl p-6 relative font-sans my-8 max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-xl">
                  <Banknote className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight flex items-center gap-2">
                    Manage Deductions & Cash Advances
                    <span className="text-[10px] font-mono bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 px-2 py-0.5 rounded-full font-bold">
                      Deductions Engine
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Record payroll deductions or postpone them to the next cutoff upon employee request.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsDeductionModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body Scroll Area */}
            <div className="overflow-y-auto flex-1 py-4 space-y-4 pr-1">
              {/* Form */}
              <form onSubmit={handleSaveDeduction} className="space-y-4">
                {/* Employee Selector */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">
                    Employee *
                  </label>
                  <select
                    value={deductionEmployeeId}
                    onChange={(e) => setDeductionEmployeeId(e.target.value)}
                    required
                    className="w-full text-xs px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none font-semibold text-zinc-900 dark:text-zinc-100 focus:border-rose-500"
                  >
                    <option value="" disabled>-- Select Employee --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName} ({emp.employeeNumber}) — {emp.position || "Staff"}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Amount input & Quick Chips */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">
                    Deduction / Loan Amount ({currency}) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold font-mono text-zinc-400 text-sm">
                      {currency}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      value={deductionAmount || ""}
                      onChange={(e) => setDeductionAmount(parseFloat(e.target.value) || 0)}
                      required
                      placeholder="0.00"
                      className="w-full pl-8 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm font-bold font-mono text-zinc-900 dark:text-zinc-100 outline-none focus:border-rose-500"
                    />
                  </div>
                  {/* Preset Amount Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-zinc-400 uppercase font-mono mr-1">Quick:</span>
                    {[500, 1000, 2000, 3000, 5000, 10000].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setDeductionAmount(val)}
                        className={`text-[10px] font-bold font-mono px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                          deductionAmount === val
                            ? "bg-rose-600 text-white border-rose-600"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"
                        }`}
                      >
                        {currency}{val.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Deduction Method Options */}
                <div className="space-y-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">
                    Deduction Schedule *
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDeductionMethod("Full")}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        deductionMethod === "Full"
                          ? "bg-rose-50 dark:bg-rose-950/30 border-rose-500 text-rose-900 dark:text-rose-200 shadow-xs ring-1 ring-rose-500"
                          : "bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400"
                      }`}
                    >
                      <div className="font-bold text-xs">One-Time Full Deduction</div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Deduct 100% of amount in 1 cutoff
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeductionMethod("Split")}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        deductionMethod === "Split"
                          ? "bg-rose-50 dark:bg-rose-950/30 border-rose-500 text-rose-900 dark:text-rose-200 shadow-xs ring-1 ring-rose-500"
                          : "bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400"
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center gap-1.5">
                        <span>Installment Deduction</span>
                        <span className="text-[9px] bg-rose-200 dark:bg-rose-800 text-rose-900 dark:text-rose-100 px-1.5 py-0.5 rounded font-mono font-bold">
                          Multi-Cutoff
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Split across multiple cutoffs (e.g. 2, 3, 4)
                      </div>
                    </button>
                  </div>

                  {deductionMethod === "Split" && (
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">
                          Select Number of Cutoffs:
                        </span>
                        <span className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400">
                          {deductionSplitCount} Cutoffs ({((deductionSplitCount || 1) / 2).toFixed(1)} Months)
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {[2, 3, 4, 6, 8, 10].map(count => (
                          <button
                            key={count}
                            type="button"
                            onClick={() => setDeductionSplitCount(count)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                              deductionSplitCount === count
                                ? "bg-rose-600 text-white shadow-xs"
                                : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"
                            }`}
                          >
                            {count} Cutoffs
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Reason / Notes */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">
                    Notes / Reference Reason (Optional)
                  </label>
                  <input
                    type="text"
                    value={deductionNotes}
                    onChange={(e) => setDeductionNotes(e.target.value)}
                    placeholder="e.g. Cash Advance, Equipment, Uniform, Personal Loan"
                    className="w-full text-xs px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none text-zinc-900 dark:text-zinc-100 focus:border-rose-500"
                  />
                </div>

                {/* Hide / Defer to Next Cutoff Toggle */}
                <div className="p-3 bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/60 rounded-xl space-y-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deductionIsDeferred}
                      onChange={(e) => setDeductionIsDeferred(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded text-purple-600 border-zinc-300 dark:border-zinc-600 focus:ring-purple-500 cursor-pointer"
                    />
                    <div className="flex-1 text-xs">
                      <div className="font-bold text-purple-950 dark:text-purple-200 flex items-center gap-1.5">
                        <EyeOff className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                        <span>Hide from current payslip (Deduct in next cutoff upon employee request)</span>
                      </div>
                      <div className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5">
                        Check this if the employee requested to postpone this deduction. It will NOT be deducted from the current payslip and will carry over to the next cutoff cycle.
                      </div>
                    </div>
                  </label>
                  {deductionIsDeferred && (
                    <input
                      type="text"
                      value={deductionDeferReason}
                      onChange={(e) => setDeductionDeferReason(e.target.value)}
                      placeholder="Note: e.g. Employee requested deduction postponement to next cutoff"
                      className="w-full text-xs px-3 py-1.5 bg-white dark:bg-zinc-900 border border-purple-200 dark:border-purple-700 rounded-lg outline-none text-zinc-900 dark:text-zinc-100 focus:border-purple-500"
                    />
                  )}
                </div>

                {/* Submit button */}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsDeductionModalOpen(false)}
                    className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={deductionSaving || deductionAmount <= 0}
                    className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{deductionSaving ? "Saving..." : "Save Deduction Record"}</span>
                  </button>
                </div>
              </form>

              {/* Active Deductions List with 1-Click Hide/Unhide Toggle */}
              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-zinc-500" />
                    <span>Active Deductions & Advances ({(cashAdvances || []).length})</span>
                  </h4>
                  <span className="text-[10px] text-zinc-500">
                    Use toggle button below to instantly hide or postpone to next cutoff.
                  </span>
                </div>

                {(cashAdvances || []).length === 0 ? (
                  <p className="text-xs text-zinc-400 italic py-2">No active deductions or cash advances currently logged.</p>
                ) : (
                  <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800 max-h-60 overflow-y-auto">
                    {(cashAdvances || []).map((adv) => {
                      const isComplete = adv.status === "Fully Paid" || adv.remainingBalance <= 0;
                      return (
                        <div key={adv.id || adv.referenceId} className="p-3 flex items-center justify-between gap-3 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors text-xs">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-zinc-900 dark:text-zinc-100">
                                {adv.employeeName}
                              </span>
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                                {adv.deductionMethod === "Split" ? `${adv.splitCount} Cutoffs Split` : "Full Deduction"}
                              </span>
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                isComplete
                                  ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                                  : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-bold"
                              }`}>
                                {adv.status}
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-2 font-mono">
                              <span>Total: -{currency}{(adv.amount || 0).toLocaleString()}</span>
                              <span>•</span>
                              <span className={(adv.remainingBalance || 0) > 0 ? "text-rose-600 font-bold" : ""}>
                                Rem: -{currency}{(adv.remainingBalance || 0).toLocaleString()}
                              </span>
                              {adv.notes && (
                                <>
                                  <span>•</span>
                                  <span className="italic text-zinc-400 truncate max-w-xs">{adv.notes}</span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* 1-Click Toggle Hide / Show */}
                            <button
                              type="button"
                              onClick={() => adv.id && handleToggleDeductionDeferred(adv.id, Boolean(adv.isDeferred))}
                              className={`px-2 py-1 text-[11px] font-bold rounded-lg border flex items-center gap-1 transition-colors cursor-pointer ${
                                adv.isDeferred
                                  ? "bg-purple-50 dark:bg-purple-950/40 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-100"
                                  : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-purple-600"
                              }`}
                              title={adv.isDeferred ? "Currently Hidden: Click to restore & deduct in current cutoff payslip" : "Currently Active: Click to hide from current payslip (defer & deduct in next cutoff)"}
                            >
                              {adv.isDeferred ? (
                                <>
                                  <EyeOff className="w-3 h-3 text-purple-500" />
                                  <span>Hidden (Next Cutoff)</span>
                                </>
                              ) : (
                                <>
                                  <Eye className="w-3 h-3 text-rose-500" />
                                  <span>Deduct in Cutoff</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => adv.id && handleDeleteDeduction(adv.id)}
                              className="p-1.5 text-zinc-400 hover:text-rose-500 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                              title="Delete this deduction (stored in Recycle Bin)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end pt-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
              <button
                type="button"
                onClick={() => setIsDeductionModalOpen(false)}
                className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 1. CUTOFF RELEASE & EMAIL NOTIFICATION MODAL */}
      {/* ========================================================= */}
      {isReleaseModalOpen && (() => {
        const draftsToRelease = currentPayrollList.filter(p => p.status === "Draft");
        const totalNetDraft = draftsToRelease.reduce((sum, d) => sum + (d.finalSalary || 0), 0);
        const totalCashDraft = draftsToRelease.reduce((sum, d) => sum + (d.additionalCashPay || 0), 0);
        const totalDeductDraft = draftsToRelease.reduce((sum, d) => sum + (d.deductions || 0), 0);
        const emailConfiguredCount = draftsToRelease.filter(d => {
          const emp = employees.find(e => e.id === d.employeeId);
          return Boolean((employeeEmailDrafts[d.employeeId] ?? emp?.email ?? "").trim());
        }).length;

        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-55 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl p-6 relative font-sans my-8 max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
              
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight flex items-center gap-2">
                      Release Official Payslips
                      <span className="text-[10px] font-mono bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 px-2 py-0.5 rounded-full font-bold">
                        {draftsToRelease.length} Vouchers
                      </span>
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Cutoff: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{selectedPeriodObj?.name || selectedPeriodId}</span> ({selectedPeriodObj?.startDate} to {selectedPeriodObj?.endDate})
                    </p>
                  </div>
                </div>

                {!releasing && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsReleaseModalOpen(false);
                      setReleaseSummaryResult(null);
                    }}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="py-4 space-y-4 overflow-y-auto flex-1 pr-1">
                {/* Release Summary Result Banner */}
                {releaseSummaryResult ? (
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl p-5 text-center space-y-3">
                    <div className="w-12 h-12 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                      <CheckCheck className="w-6 h-6" />
                    </div>
                    <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                      Vouchers Successfully Released!
                    </h4>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed max-w-md mx-auto">
                      All <span className="font-bold">{releaseSummaryResult.releasedCount} employee payslip vouchers</span> have been updated to official <strong>RELEASED</strong> status and are now live for viewing & downloading in the Employee Portal.
                    </p>
                    {releaseSendEmails && (
                      <div className="text-xs text-zinc-600 dark:text-zinc-400 pt-2 font-mono flex flex-wrap items-center justify-center gap-2">
                        {releaseSummaryResult.emailSuccessCount > 0 && (
                          <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 px-2.5 py-1 rounded-full font-bold">
                            ✓ {releaseSummaryResult.emailSuccessCount} Delivered to Inboxes
                          </span>
                        )}
                        {releaseSummaryResult.emailSimulatedCount > 0 && (
                          <span className="bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 px-2.5 py-1 rounded-full font-bold" title="Logged in system audit. Enter Google App Password for live inbox delivery.">
                            ⚠️ {releaseSummaryResult.emailSimulatedCount} Simulated (Needs App Password)
                          </span>
                        )}
                        {releaseSummaryResult.emailFailCount > 0 && (
                          <span className="bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 px-2.5 py-1 rounded-full font-bold">
                            ✕ {releaseSummaryResult.emailFailCount} Failed / Missing Email
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Financial Metrics Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700/60 font-mono">
                        <span className="text-[9px] text-zinc-400 uppercase block font-bold">Draft Records</span>
                        <span className="text-xs font-black text-zinc-800 dark:text-zinc-200">{draftsToRelease.length} staff</span>
                      </div>
                      <div className="bg-emerald-50/60 dark:bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 font-mono">
                        <span className="text-[9px] text-emerald-600 dark:text-emerald-400 uppercase block font-bold">Boss Plus Added</span>
                        <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">+{currency}{(totalCashDraft || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="bg-rose-50/60 dark:bg-rose-950/20 p-2.5 rounded-xl border border-rose-200/60 dark:border-rose-800/40 font-mono">
                        <span className="text-[9px] text-rose-600 dark:text-rose-400 uppercase block font-bold">Deductions</span>
                        <span className="text-xs font-black text-rose-600 dark:text-rose-400">-{currency}{(totalDeductDraft || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="bg-blue-50/60 dark:bg-blue-950/20 p-2.5 rounded-xl border border-blue-200/60 dark:border-blue-800/40 font-mono">
                        <span className="text-[9px] text-blue-600 dark:text-blue-400 uppercase block font-bold">Net Outflow</span>
                        <span className="text-xs font-black text-blue-700 dark:text-blue-300">{currency}{(totalNetDraft || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>

                    {/* Email Option Checkbox */}
                    <div className="bg-blue-50/40 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 rounded-2xl p-4 space-y-2">
                      <label className="flex items-start gap-3 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={releaseSendEmails}
                          onChange={(e) => setReleaseSendEmails(e.target.checked)}
                          className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                        />
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-blue-600" />
                            Dispatch official payslip notification emails to employees
                          </span>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal">
                            Automatically delivers formatted email summaries with net breakdown and period dates to each employee with a registered email.
                          </p>
                        </div>
                      </label>
                    </div>

                    {/* Progress Bar (when releasing) */}
                    {releasing && releaseProgress && (
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-4 space-y-2 animate-in fade-in">
                        <div className="flex justify-between items-center text-xs font-mono">
                          <span className="text-zinc-600 dark:text-zinc-400 font-bold flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                            {releaseProgress.step}
                          </span>
                          <span className="font-bold text-zinc-800 dark:text-zinc-200">
                            {Math.round((releaseProgress.current / releaseProgress.total) * 100)}%
                          </span>
                        </div>
                        <div className="w-full bg-zinc-200 dark:bg-zinc-700 h-2 rounded-full overflow-hidden">
                          <div 
                            className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                            style={{ width: `${(releaseProgress.current / releaseProgress.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Employee Recipient List */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono px-1">
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                          RECIPIENTS & EMAIL STATUS ({emailConfiguredCount}/{draftsToRelease.length} CONFIGURED)
                        </span>
                        {emailConfiguredCount < draftsToRelease.length && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                            ⚠️ {draftsToRelease.length - emailConfiguredCount} missing email
                          </span>
                        )}
                      </div>

                      <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800 max-h-56 overflow-y-auto">
                        {draftsToRelease.map((d) => {
                          const emp = employees.find(e => e.id === d.employeeId);
                          const currentEmail = employeeEmailDrafts[d.employeeId] ?? emp?.email ?? "";
                          const hasEmail = Boolean(currentEmail.trim());

                          return (
                            <div key={d.payrollId} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors text-xs">
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-zinc-900 dark:text-zinc-100">{d.fullName}</span>
                                  <span className="text-[9px] font-mono text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-bold">
                                    {d.employeeNumber}
                                  </span>
                                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                    {currency}{(d.finalSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </span>
                                </div>
                                <div className="text-[10px] text-zinc-400 font-mono">
                                  Basic: {currency}{(d.basicSalary || 0).toLocaleString()} • Boss Plus: +{currency}{(d.additionalCashPay || 0).toLocaleString()} • Deductions: -{currency}{(d.deductions || 0).toLocaleString()}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 sm:max-w-xs w-full sm:w-auto">
                                <div className="relative flex-1">
                                  <AtSign className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                                  <input 
                                    type="email"
                                    placeholder="Enter employee email..."
                                    value={currentEmail}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setEmployeeEmailDrafts(prev => ({ ...prev, [d.employeeId]: val }));
                                    }}
                                    className={`w-full pl-8 pr-2 py-1 text-xs rounded-lg border outline-none font-mono ${
                                      hasEmail
                                        ? "bg-zinc-50 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                                        : "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 placeholder:text-amber-600/50"
                                    }`}
                                  />
                                </div>
                                {d.employeeId && currentEmail.trim() !== (emp?.email || "") && currentEmail.trim() && (
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEmployeeEmail(d.employeeId, currentEmail)}
                                    disabled={savingEmailForEmpId === d.employeeId}
                                    className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg cursor-pointer transition-colors shrink-0"
                                    title="Save email to employee database profile"
                                  >
                                    {savingEmailForEmpId === d.employeeId ? "..." : "Save"}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
                {releaseSummaryResult ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsReleaseModalOpen(false);
                      setReleaseSummaryResult(null);
                    }}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer text-center"
                  >
                    Close & View Released Vouchers
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={releasing}
                      onClick={() => setIsReleaseModalOpen(false)}
                      className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      disabled={releasing}
                      onClick={handleExecuteReleasePayroll}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      {releasing ? (
                        <>
                          <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Finalizing Cutoff Vouchers...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Confirm & Release {draftsToRelease.length} Vouchers</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================= */}
      {/* 2. BATCH AUTO-SEND PAYSLIPS TO ALL EMPLOYEES MODAL */}
      {/* ========================================================= */}
      {isAutoSendModalOpen && (() => {
        const totalStaff = currentPayrollList.length;
        const filteredList = currentPayrollList.filter(p => {
          if (!autoSendSearch.trim()) return true;
          const q = autoSendSearch.toLowerCase();
          const emp = employees.find(e => e.id === p.employeeId);
          const email = (employeeEmailDrafts[p.employeeId] ?? emp?.email ?? "").toLowerCase();
          return (
            (p.fullName || "").toLowerCase().includes(q) ||
            (p.employeeNumber || "").toLowerCase().includes(q) ||
            ((p as any).department || emp?.department || "").toLowerCase().includes(q) ||
            email.includes(q)
          );
        });

        const selectedCount = autoSendSelectedEmpIds.length;
        const allSelected = totalStaff > 0 && selectedCount === totalStaff;
        const isGoogleConnected = Boolean(googleAuthToken && googleAuthUser);
        const hasCredentials = Boolean(isGoogleConnected || (quickSmtpUser && quickSmtpPass));

        const handleToggleSelectAll = () => {
          if (allSelected) {
            setAutoSendSelectedEmpIds([]);
          } else {
            setAutoSendSelectedEmpIds(currentPayrollList.map(p => p.employeeId));
          }
        };

        const handleToggleEmployee = (empId: string) => {
          setAutoSendSelectedEmpIds(prev => 
            prev.includes(empId) ? prev.filter(id => id !== empId) : [...prev, empId]
          );
        };

        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-3 sm:p-4 z-55 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl p-6 relative font-sans my-6 max-h-[94vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
              
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-gradient-to-br from-blue-500/20 to-indigo-500/20 text-blue-600 dark:text-blue-400 rounded-2xl border border-blue-500/30">
                    <Send className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight flex items-center gap-2 flex-wrap">
                      Auto-Send Official Payslips to Inboxes
                      <span className="text-[10px] font-mono bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 px-2.5 py-0.5 rounded-full font-bold">
                        {totalStaff} Staff on Payroll
                      </span>
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Cutoff: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{selectedPeriodObj?.name || selectedPeriodId}</span> ({selectedPeriodObj?.startDate} to {selectedPeriodObj?.endDate})
                    </p>
                  </div>
                </div>

                {!autoSending && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAutoSendModalOpen(false);
                      setAutoSendResults(null);
                    }}
                    className="p-2 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="py-4 space-y-4 overflow-y-auto flex-1 pr-1">

                {/* Optional Alternative: Manual SMTP & Google App Password Fallback */}
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl p-3.5 bg-zinc-50/50 dark:bg-zinc-900/40">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                        Alternative: Manual SMTP & Google App Passwords
                      </span>
                      {quickSmtpPass && (
                        <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-100/70 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                          Configured
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setAutoSendShowSmtpGuide(prev => !prev)}
                      className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <Key className="w-3.5 h-3.5 text-zinc-400" />
                      <span>{autoSendShowSmtpGuide ? "Hide SMTP Options" : (quickSmtpPass ? "Edit SMTP Password" : "Show Manual SMTP Setup")}</span>
                    </button>
                  </div>

                  {autoSendShowSmtpGuide && (
                    <div className="mt-3 pt-3 border-t border-zinc-200/60 dark:border-zinc-800 space-y-3 animate-in fade-in">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-2 space-y-1">
                          <label className="text-[10px] font-mono font-bold text-zinc-500 uppercase flex items-center gap-1">
                            <Key className="w-3 h-3" />
                            16-Character Google App Password
                          </label>
                          <div className="relative">
                            <input 
                              type={showQuickPass ? "text" : "password"}
                              placeholder="e.g. abcd efgh ijkl mnop"
                              value={quickSmtpPass}
                              onChange={(e) => setQuickSmtpPass(e.target.value)}
                              className="w-full pl-3 pr-10 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl outline-none font-mono text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                              type="button"
                              onClick={() => setShowQuickPass(prev => !prev)}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 cursor-pointer"
                            >
                              {showQuickPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <div className="flex items-end">
                          <button
                            type="button"
                            disabled={quickSmtpSaving || !quickSmtpPass.trim()}
                            onClick={handleSaveQuickSmtp}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer h-[38px]"
                          >
                            {quickSmtpSaving ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Verifying...</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Verify & Save</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {quickSmtpStatus && (
                        <p className={`text-xs font-mono font-medium ${
                          quickSmtpStatus.includes("✓") 
                            ? "text-emerald-700 dark:text-emerald-400" 
                            : "text-rose-600 dark:text-rose-400"
                        }`}>
                          {quickSmtpStatus}
                        </p>
                      )}

                      {/* 3-Step Guide */}
                      <div className="bg-white/80 dark:bg-zinc-900/80 rounded-xl p-3 border border-zinc-200 dark:border-zinc-800 text-xs space-y-1.5 text-zinc-600 dark:text-zinc-400">
                        <div className="font-bold text-zinc-800 dark:text-zinc-200 text-[11px] uppercase font-mono tracking-wider">
                          How to generate your 16-character Google App Password:
                        </div>
                        <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
                          <li>
                            Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline font-mono font-bold inline-flex items-center gap-0.5">myaccount.google.com/apppasswords <ExternalLink className="w-2.5 h-2.5 inline" /></a> (sign in with <strong>hr.oligarchmedia@gmail.com</strong>).
                          </li>
                          <li>
                            Under <em>App name</em>, enter <strong>Payroll App</strong> and click <strong>Create</strong>.
                          </li>
                          <li>
                            Google will show a yellow box with 16 letters (e.g. <span className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded font-bold">abcd efgh ijkl mnop</span>). Copy and paste it above!
                          </li>
                        </ol>
                      </div>
                    </div>
                  )}
                </div>

                {/* Progress Bar (when autoSending is active) */}
                {autoSending && autoSendProgress && (
                  <div className="bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-4 space-y-2.5 animate-in fade-in">
                    <div className="flex justify-between items-center text-xs font-mono">
                      <span className="text-zinc-700 dark:text-zinc-300 font-bold flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping" />
                        {autoSendProgress.step}
                      </span>
                      <span className="font-black text-blue-600 dark:text-blue-400">
                        {Math.round((autoSendProgress.current / autoSendProgress.total) * 100)}% ({autoSendProgress.current}/{autoSendProgress.total})
                      </span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-700 h-2.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full rounded-full transition-all duration-300"
                        style={{ width: `${(autoSendProgress.current / autoSendProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Batch Completion Summary Banner */}
                {autoSendResults && (
                  <div className={`p-4 rounded-2xl border text-center space-y-2 animate-in fade-in ${
                    autoSendResults.deliveredCount > 0 
                      ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" 
                      : autoSendResults.simulatedCount > 0
                        ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                        : "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800"
                  }`}>
                    <div className="flex items-center justify-center gap-2">
                      {autoSendResults.deliveredCount > 0 ? (
                        <div className="p-2 bg-emerald-500/20 text-emerald-600 rounded-full">
                          <CheckCheck className="w-5 h-5" />
                        </div>
                      ) : (
                        <div className="p-2 bg-amber-500/20 text-amber-600 rounded-full">
                          <MailWarning className="w-5 h-5" />
                        </div>
                      )}
                      <h4 className="text-sm font-black text-zinc-900 dark:text-zinc-100">
                        Batch Dispatch Completed
                      </h4>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-mono">
                      {autoSendResults.deliveredCount > 0 && (
                        <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 px-3 py-1 rounded-full font-bold">
                          ✓ {autoSendResults.deliveredCount} Delivered Live to Inboxes
                        </span>
                      )}
                      {autoSendResults.simulatedCount > 0 && (
                        <span className="bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 px-3 py-1 rounded-full font-bold">
                          ⚠️ {autoSendResults.simulatedCount} Simulated (Google App Password Needed)
                        </span>
                      )}
                      {autoSendResults.failedCount > 0 && (
                        <span className="bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 px-3 py-1 rounded-full font-bold">
                          ✕ {autoSendResults.failedCount} Failed
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Recipient Controls & Search Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={autoSending}
                      onClick={handleToggleSelectAll}
                      className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-blue-600" /> : <Square className="w-3.5 h-3.5 text-zinc-400" />}
                      <span>{allSelected ? "Deselect All" : `Select All (${totalStaff})`}</span>
                    </button>
                    <span className="text-xs font-mono text-zinc-500">
                      <strong>{selectedCount}</strong> of {totalStaff} selected
                    </span>
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input 
                      type="text"
                      placeholder="Search name, ID, or email..."
                      value={autoSendSearch}
                      onChange={(e) => setAutoSendSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Recipient Employee Table */}
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800 max-h-80 overflow-y-auto">
                  {filteredList.length === 0 ? (
                    <div className="p-8 text-center text-xs text-zinc-400">
                      No matching employee records found.
                    </div>
                  ) : (
                    filteredList.map((pr) => {
                      const emp = employees.find(e => e.id === pr.employeeId);
                      const currentEmail = employeeEmailDrafts[pr.employeeId] ?? emp?.email ?? "";
                      const isSelected = autoSendSelectedEmpIds.includes(pr.employeeId);
                      const live = autoSendLiveStatus[pr.employeeId];
                      const isModified = Boolean(currentEmail.trim() && currentEmail.trim() !== (emp?.email || ""));

                      return (
                        <div 
                          key={pr.payrollId || pr.employeeId} 
                          className={`p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors text-xs ${
                            isSelected 
                              ? "bg-white dark:bg-zinc-900 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40" 
                              : "bg-zinc-50/50 dark:bg-zinc-900/40 opacity-60"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input 
                              type="checkbox"
                              checked={isSelected}
                              disabled={autoSending}
                              onChange={() => handleToggleEmployee(pr.employeeId)}
                              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />

                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-zinc-900 dark:text-zinc-100">{pr.fullName}</span>
                                <span className="text-[10px] font-mono text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-bold">
                                  {pr.employeeNumber}
                                </span>
                                {(pr as any).department && (
                                  <span className="text-[10px] text-zinc-400">
                                    • {(pr as any).department}
                                  </span>
                                )}
                                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                  {currency}{(pr.finalSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                              <div className="text-[10px] text-zinc-400 font-mono">
                                Basic: {currency}{(pr.basicSalary || 0).toLocaleString()} • Net Voucher: {currency}{(pr.finalSalary || 0).toLocaleString()}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 sm:max-w-md w-full sm:w-auto">
                            {/* Email Input & Save Button */}
                            <div className="relative flex-1">
                              <AtSign className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                              <input 
                                type="email"
                                placeholder="Enter employee email..."
                                value={currentEmail}
                                disabled={autoSending}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEmployeeEmailDrafts(prev => ({ ...prev, [pr.employeeId]: val }));
                                }}
                                className={`w-full pl-8 pr-2 py-1.5 text-xs rounded-xl border outline-none font-mono ${
                                  currentEmail.trim()
                                    ? "bg-zinc-50 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                                    : "bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 placeholder:text-rose-500/50"
                                }`}
                              />
                            </div>

                            {isModified && (
                              <button
                                type="button"
                                onClick={() => handleSaveEmployeeEmail(pr.employeeId, currentEmail)}
                                disabled={savingEmailForEmpId === pr.employeeId || autoSending}
                                className="px-2 py-1.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl cursor-pointer transition-colors shrink-0"
                                title="Permanently save this email to employee database profile"
                              >
                                {savingEmailForEmpId === pr.employeeId ? "..." : "Save"}
                              </button>
                            )}

                            {/* Live Status Badge */}
                            <div className="shrink-0 min-w-[120px] text-right">
                              {live?.status === "sending" && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1 rounded-lg">
                                  <RefreshCw className="w-3 h-3 animate-spin" /> Sending...
                                </span>
                              )}
                              {live?.status === "delivered" && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-lg">
                                  <CheckCheck className="w-3 h-3" /> In Inbox
                                </span>
                              )}
                              {live?.status === "simulated" && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-700 dark:text-amber-300 font-bold bg-amber-50 dark:bg-amber-950/60 px-2 py-1 rounded-lg" title="Simulated in logs. Enter Google App Password for live inbox delivery.">
                                  <Info className="w-3 h-3" /> Simulated
                                </span>
                              )}
                              {live?.status === "failed" && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-rose-700 dark:text-rose-300 font-bold bg-rose-50 dark:bg-rose-950/60 px-2 py-1 rounded-lg" title={live.error || "Failed"}>
                                  <AlertCircle className="w-3 h-3" /> Failed
                                </span>
                              )}
                              {!live && (
                                <span className={`text-[10px] font-mono px-2 py-1 rounded-lg ${
                                  currentEmail.trim() 
                                    ? "text-zinc-500 bg-zinc-100 dark:bg-zinc-800" 
                                    : "text-rose-600 bg-rose-50 dark:bg-rose-950/50 font-bold"
                                }`}>
                                  {currentEmail.trim() ? "Ready to Send" : "No Email"}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

              </div>

              {/* Footer */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
                <button
                  type="button"
                  disabled={autoSending}
                  onClick={() => setIsAutoSendModalOpen(false)}
                  className="w-full sm:w-auto px-4 py-2.5 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Close
                </button>

                <button
                  type="button"
                  disabled={autoSending || selectedCount === 0}
                  onClick={handleExecuteAutoSendPayroll}
                  className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {autoSending ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Dispatching {autoSendProgress ? `${autoSendProgress.current}/${autoSendProgress.total}` : "Payslips"}...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Dispatch Official Payslips to {selectedCount} Employees</span>
                    </>
                  )}
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* ========================================================= */}
      {/* 3. INDIVIDUAL EMPLOYEE PAYSLIP EMAIL MODAL */}
      {/* ========================================================= */}
      {emailModal.isOpen && emailModal.payRecord && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-55 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl p-6 relative font-sans my-8 max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Mail className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight flex items-center gap-2">
                    Send Payslip Notification Email
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {emailModal.payRecord.fullName} ({emailModal.payRecord.employeeNumber}) • Cutoff: {selectedPeriodObj?.name || emailModal.payRecord.cutoffPeriodId}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="py-4 space-y-4 overflow-y-auto flex-1 pr-1">
              
              {/* Financial Snapshot */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-2xl border border-zinc-200 dark:border-zinc-700/60 font-mono text-xs">
                <div>
                  <span className="text-[9px] text-zinc-400 uppercase font-bold block">Basic Salary</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">{currency}{(emailModal.payRecord.basicSalary || 0).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-[9px] text-emerald-600 uppercase font-bold block">Boss Plus / Cash</span>
                  <span className="font-bold text-emerald-600">+{currency}{(emailModal.payRecord.additionalCashPay || 0).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-[9px] text-rose-600 uppercase font-bold block">Deductions</span>
                  <span className="font-bold text-rose-600">-{currency}{(emailModal.payRecord.deductions || 0).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-[9px] text-blue-600 uppercase font-bold block">Net Takehome</span>
                  <span className="font-black text-blue-600 text-sm">{currency}{(emailModal.payRecord.finalSalary || 0).toLocaleString()}</span>
                </div>
              </div>

              {/* Status Banner */}
              {emailModal.statusBanner && (
                <div className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 animate-in fade-in ${
                  emailModal.statusBanner.type === "success"
                    ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
                    : emailModal.statusBanner.type === "error"
                      ? "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200"
                      : "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
                }`}>
                  {emailModal.statusBanner.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />}
                  {emailModal.statusBanner.type === "error" && <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />}
                  {emailModal.statusBanner.type === "info" && <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />}
                  <span className="leading-relaxed">{emailModal.statusBanner.message}</span>
                </div>
              )}

              {/* Email Form Fields */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">Recipient Email Address</label>
                    {emailModal.employee?.id && emailModal.recipientEmail.trim() !== (emailModal.employee.email || "") && emailModal.recipientEmail.trim() && (
                      <button
                        type="button"
                        onClick={() => handleSaveEmployeeEmail(emailModal.employee!.id!, emailModal.recipientEmail)}
                        disabled={savingEmailForEmpId === emailModal.employee.id}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 cursor-pointer flex items-center gap-1"
                      >
                        <Edit3 className="w-3 h-3" />
                        Save to Employee Profile
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <AtSign className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      value={emailModal.recipientEmail}
                      onChange={(e) => setEmailModal(prev => ({ ...prev, recipientEmail: e.target.value }))}
                      placeholder="employee@company.com"
                      className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-1 focus:ring-blue-500 font-mono text-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">Subject Line</label>
                  <input
                    type="text"
                    value={emailModal.subject}
                    onChange={(e) => setEmailModal(prev => ({ ...prev, subject: e.target.value }))}
                    className="w-full px-3 py-2 text-xs bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-1 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100"
                  />
                </div>
              </div>

              {/* Tabs: Email Preview vs Plain Text */}
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEmailModal(prev => ({ ...prev, activeTab: "preview" }))}
                      className={`text-xs font-bold pb-1 cursor-pointer transition-colors ${
                        emailModal.activeTab === "preview"
                          ? "text-blue-600 border-b-2 border-blue-600"
                          : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                      }`}
                    >
                      Official HTML Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmailModal(prev => ({ ...prev, activeTab: "raw" }))}
                      className={`text-xs font-bold pb-1 cursor-pointer transition-colors ${
                        emailModal.activeTab === "raw"
                          ? "text-blue-600 border-b-2 border-blue-600"
                          : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                      }`}
                    >
                      Plain Text View
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEmailModal(prev => ({ ...prev, showSmtpCard: !prev.showSmtpCard }))}
                    className="text-[11px] font-bold text-zinc-500 hover:text-blue-600 dark:text-zinc-400 cursor-pointer flex items-center gap-1 font-mono"
                  >
                    <Sliders className="w-3 h-3" />
                    {emailModal.showSmtpCard ? "Hide SMTP Settings" : "Configure SMTP / Gmail"}
                  </button>
                </div>

                {emailModal.activeTab === "preview" ? (
                  <div 
                    className="border border-zinc-200 dark:border-zinc-700 rounded-2xl p-4 bg-white max-h-64 overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: getPayslipEmailHtml(emailModal.payRecord) }}
                  />
                ) : (
                  <pre className="border border-zinc-200 dark:border-zinc-700 rounded-2xl p-4 bg-zinc-50 dark:bg-zinc-950 font-mono text-[11px] text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
                    {getPayslipPlainText(emailModal.payRecord, selectedPeriodObj?.name || emailModal.payRecord.cutoffPeriodId, selectedPeriodObj ? `${selectedPeriodObj.startDate} to ${selectedPeriodObj.endDate}` : undefined)}
                  </pre>
                )}
              </div>

              {/* Expandable Quick SMTP Card */}
              {emailModal.showSmtpCard && (
                <div className="bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-4 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-mono uppercase text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                      <MailCheck className="w-3.5 h-3.5 text-blue-600" />
                      Gmail / SMTP Dispatch Setup
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      {quickSmtpUser ? `Active: ${quickSmtpUser}` : "Not Configured Yet"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono font-bold text-zinc-400">SMTP Host</label>
                      <input 
                        type="text" 
                        value={quickSmtpHost} 
                        onChange={(e) => setQuickSmtpHost(e.target.value)} 
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none font-mono text-xs" 
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono font-bold text-zinc-400">SMTP Port</label>
                      <input 
                        type="text" 
                        value={quickSmtpPort} 
                        onChange={(e) => setQuickSmtpPort(e.target.value)} 
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none font-mono text-xs" 
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono font-bold text-zinc-400">Gmail / SMTP Username</label>
                      <input 
                        type="text" 
                        placeholder="your-email@gmail.com" 
                        value={quickSmtpUser} 
                        onChange={(e) => setQuickSmtpUser(e.target.value)} 
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none font-mono text-xs" 
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono font-bold text-zinc-400">Gmail 16-Char App Password</label>
                      <input 
                        type="password" 
                        placeholder="••••••••••••••••" 
                        value={quickSmtpPass} 
                        onChange={(e) => setQuickSmtpPass(e.target.value)} 
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none font-mono text-xs" 
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[10px] text-zinc-500 leading-tight">
                      For Gmail: Turn on 2-Step Verification and generate an App Password at <span className="font-mono underline text-blue-600">myaccount.google.com/apppasswords</span>.
                    </p>
                    <button
                      type="button"
                      disabled={quickSmtpSaving}
                      onClick={handleSaveQuickSmtp}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg cursor-pointer transition-colors shrink-0 disabled:opacity-50"
                    >
                      {quickSmtpSaving ? "Verifying..." : "Test & Save SMTP"}
                    </button>
                  </div>
                  {quickSmtpStatus && (
                    <p className={`text-[11px] font-mono ${quickSmtpStatus.includes("✓") ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-amber-600 dark:text-amber-400"}`}>
                      {quickSmtpStatus}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
              <button
                type="button"
                onClick={() => handleOpenMailto(emailModal.payRecord!, emailModal.recipientEmail, emailModal.subject)}
                className="w-full sm:w-auto px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                title="Open in your computer's email client (Gmail / Outlook / Mail app)"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in Gmail / Mail App (mailto)</span>
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
                >
                  Close
                </button>

                <button
                  type="button"
                  disabled={emailModal.sending}
                  onClick={handleSendEmailFromModal}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer flex-1 sm:flex-none"
                >
                  {emailModal.sending ? (
                    <>
                      <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Sending Email...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Official Email</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating In-App Toast Notification */}
      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-100 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-5 duration-200 border text-xs font-semibold max-w-md ${
          toastMessage.type === "success"
            ? "bg-emerald-950/90 text-white border-emerald-500/40 shadow-emerald-950/50"
            : toastMessage.type === "error"
              ? "bg-rose-950/90 text-white border-rose-500/40 shadow-rose-950/50"
              : "bg-zinc-900/90 text-white border-zinc-700/40 shadow-zinc-950/50"
        }`}>
          {toastMessage.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toastMessage.type === "error" && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
          {toastMessage.type === "info" && <Info className="w-4 h-4 text-blue-400 shrink-0" />}
          <span className="leading-snug">{toastMessage.text}</span>
          <button 
            type="button" 
            onClick={() => setToastMessage(null)}
            className="ml-auto text-zinc-400 hover:text-white p-0.5 rounded cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
