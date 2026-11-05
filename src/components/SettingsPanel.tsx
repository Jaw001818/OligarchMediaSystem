import { getBusinessDate, generateMockEmployees, sendEmailViaBrevo } from "../utils";
import React, { useState, useRef } from "react";
import { 
  db, 
  handleFirestoreError, 
  OperationType, 
  doc, 
  setDoc, 
  updateDoc,
  addDoc, 
  collection, 
  getDocs, 
  deleteDoc,
  clearAllLocalData,
  clearDeletedTombstones,
  getLocalData,
  setLocalData
} from "../firebase";
import { 
  AppSettings, 
  Employee, 
  Attendance, 
  LeaveRequest, 
  AttendanceCopyRequest, 
  PayrollPeriod, 
  Payroll, 
  CashAdvance, 
  BossDebt, 
  NoWorkDay 
} from "../types";
import { 
  Key,
  Settings, 
  Database, 
  ShieldAlert, 
  RotateCcw, 
  Upload, 
  Download, 
  HelpCircle,
  Currency,
  Clock,
  Mail,
  CheckCircle,
  XCircle,
  Flame,
  ShieldCheck,
  Copy,
  ExternalLink,
  Calculator,
  RefreshCw,
  FileText,
  Check,
  AlertCircle,
  Layers,
  Sparkles,
  Eye,
  EyeOff,
  Send,
  Sun,
  Moon,
  Zap
} from "lucide-react";

interface SettingsPanelProps {
  settings: AppSettings;
  onRefresh: () => void;
  employees: Employee[];
  attendance: Attendance[];
  requests: LeaveRequest[];
  attendanceCopyRequests?: AttendanceCopyRequest[];
  payrollPeriods?: PayrollPeriod[];
  payrolls?: Payroll[];
  cashAdvances?: CashAdvance[];
  bossDebts?: BossDebt[];
  noWorkDays?: NoWorkDay[];
}

export default function SettingsPanel({
  settings,
  onRefresh,
  employees,
  attendance,
  requests,
  attendanceCopyRequests = [],
  payrollPeriods = [],
  payrolls = [],
  cashAdvances = [],
  bossDebts = [],
  noWorkDays = []
}: SettingsPanelProps) {
  // General Fields
  const [companyName, setCompanyName] = useState(settings.companyName || "Oligarch Media Graphic Design Studio");
  const [adminEmail, setAdminEmail] = useState(settings.adminEmail || "hr.oligarchmedia@gmail.com");
  const [workHourStart, setWorkHourStart] = useState(settings.workHourStart || "22:00");
  const [workHourEnd, setWorkHourEnd] = useState(settings.workHourEnd || "07:00");
  const [breakStart, setBreakStart] = useState(settings.breakStart || "03:00");
  const [breakEnd, setBreakEnd] = useState(settings.breakEnd || "04:00");
  const [currency, setCurrency] = useState(settings.currency || "₱");
  const [dstOffset, setDstOffset] = useState<number>(settings.dstOffset ?? 0);
  const [lateToAbsentCount, setLateToAbsentCount] = useState<number>(settings.lateToAbsentCount || 3);
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState<number>(settings.gracePeriodMinutes || 0);
  const [autoRecalculatePayroll, setAutoRecalculatePayroll] = useState<boolean>(settings.autoRecalculatePayroll ?? true);
  const [enableAutoConvertLate, setEnableAutoConvertLate] = useState<boolean>(settings.enableAutoConvertLate ?? true);
  const [enableLateDeduction, setEnableLateDeduction] = useState<boolean>(settings.enableLateDeduction ?? true);
  const [resetLateEveryPayrollCutoff, setResetLateEveryPayrollCutoff] = useState<boolean>(settings.resetLateEveryPayrollCutoff ?? true);

  // Mail settings Fields
  const [emailProvider, setEmailProvider] = useState<"brevo" | "resend" | "smtp" | "google_oauth">(
    settings.emailProvider || (settings.brevoApiKey ? "brevo" : "brevo")
  );
  const [brevoApiKey, setBrevoApiKey] = useState(settings.brevoApiKey || "");
  const [showBrevoKey, setShowBrevoKey] = useState(false);
  const [smtpHost, setSmtpHost] = useState(settings.smtpHost || "smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState(settings.smtpPort || "587");
  const [smtpUser, setSmtpUser] = useState(settings.smtpUser || settings.adminEmail || "hr.oligarchmedia@gmail.com");
  const [smtpPass, setSmtpPass] = useState(settings.smtpPass || "");
  const [smtpSenderName, setSmtpSenderName] = useState(settings.smtpSenderName || "Oligarch Media Graphic Design Studio");

  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [showAppPassGuide, setShowAppPassGuide] = useState(false);

  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{
    current: number;
    total: number;
    message: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Custom Confirmation Dialog for Reset and critical actions
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    requireCode?: string;
    codeValue?: string;
    onConfirm: (codeVal?: string) => void | Promise<void>;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  // Restore Preview & Confirmation Dialog
  const [restoreModal, setRestoreModal] = useState<{
    isOpen: boolean;
    fileName: string;
    parsedPayload: {
      employees: any[];
      attendance: any[];
      leave_requests: any[];
      attendance_copy_requests: any[];
      payroll_periods: any[];
      payroll: any[];
      cash_advances: any[];
      boss_debts: any[];
      no_work_days: any[];
      devotion_schedules: any[];
      devotion_settings: any[];
      announcements: any[];
      notifications: any[];
      audit_logs: any[];
      email_logs: any[];
      settings: any | null;
    } | null;
    restoreMode: "merge" | "clean";
    totalCount: number;
  }>({
    isOpen: false,
    fileName: "",
    parsedPayload: null,
    restoreMode: "merge",
    totalCount: 0
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  const triggerPromptConfirm = (title: string, message: string, requireCode: string, onConfirm: () => void | Promise<void>) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      requireCode,
      codeValue: "",
      onConfirm: async (val) => {
        if (val?.trim().toUpperCase() === requireCode.toUpperCase()) {
          await onConfirm();
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        } else {
          triggerToast(`Incorrect confirmation code. Expected "${requireCode}".`);
        }
      },
    });
  };

  // Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      await setDoc(doc(db, "settings", "general"), {
        companyName,
        adminEmail,
        workHourStart,
        workHourEnd,
        breakStart,
        breakEnd,
        currency,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPass,
        smtpSenderName,
        emailProvider,
        brevoApiKey: brevoApiKey.trim(),
        dstOffset,
        lateToAbsentCount,
        gracePeriodMinutes,
        autoRecalculatePayroll,
        enableAutoConvertLate,
        enableLateDeduction,
        resetLateEveryPayrollCutoff
      });

      // Log audit
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Updated System Settings",
        details: "Work shift hours, currency settings and SMTP carrier values altered.",
        timestamp: new Date().toISOString()
      });

      triggerToast("System configurations saved successfully!");
      onRefresh();
    } catch (err) {
      console.error(err);
      triggerToast("Error saving system settings: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Daylight Saving Time quick-switch handler
  const handleApplyDstToAllEmployees = async (shiftStart: string, shiftEnd: string, bStart: string, bEnd: string) => {
    try {
      setSaving(true);
      // 1. Update general settings in Firestore
      await setDoc(doc(db, "settings", "general"), {
        ...settings,
        companyName,
        adminEmail,
        workHourStart: shiftStart,
        workHourEnd: shiftEnd,
        breakStart: bStart,
        breakEnd: bEnd,
        gracePeriodMinutes: 0,
        currency
      }, { merge: true });

      // 2. Update local state
      setWorkHourStart(shiftStart);
      setWorkHourEnd(shiftEnd);
      setBreakStart(bStart);
      setBreakEnd(bEnd);
      setGracePeriodMinutes(0);

      // 3. Update all employee profiles in Firestore
      const empSnap = await getDocs(collection(db, "employees"));
      for (const d of empSnap.docs) {
        const data = d.data();
        const newFields: any = {
          workHourStart: shiftStart,
          workHourEnd: shiftEnd
        };
        if (data.weeklySchedule) {
          const newWeekly = { ...data.weeklySchedule };
          for (const day of Object.keys(newWeekly)) {
            if (newWeekly[day] && !newWeekly[day].isRestDay) {
              newWeekly[day] = {
                ...newWeekly[day],
                workHourStart: shiftStart,
                workHourEnd: shiftEnd,
                notes: shiftStart === "22:00" ? "DST Night Shift (10PM–7AM, Break 3AM)" : "Standard Night Shift (9PM–6AM, Break 2AM)"
              };
            }
          }
          newFields.weeklySchedule = newWeekly;
        }
        await updateDoc(doc(db, "employees", d.id), newFields);
      }

      // 4. Audit log
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Adjusted Shift Schedule",
        details: `Set company schedule to ${shiftStart} - ${shiftEnd} (Break: ${bStart} - ${bEnd}) and synchronized all ${empSnap.size} employee profiles.`,
        timestamp: new Date().toISOString()
      });

      triggerToast(`Schedule switched to ${shiftStart === "22:00" ? "Daylight Saving Time (10:00 PM – 7:00 AM, Break 3:00 AM)" : "Standard Night Shift (9:00 PM – 6:00 AM, Break 2:00 AM)"} and synchronized across all staff!`);
      onRefresh();
    } catch (err: any) {
      console.error("Error applying shift:", err);
      triggerToast("Failed to apply shift: " + (err.message || String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Test SMTP / Brevo connection and dispatch verification email
  const handleTestSmtpConnection = async () => {
    const targetRecipient = adminEmail || smtpUser || "hr.oligarchmedia@gmail.com";

    // 1. If using Brevo API
    if (emailProvider === "brevo") {
      if (!brevoApiKey.trim()) {
        setSmtpTestResult({
          success: false,
          message: "Please enter your free Brevo API Key (starts with xkeysib-...) before testing."
        });
        return;
      }
      setSmtpTesting(true);
      setSmtpTestResult(null);
      try {
        const testRes = await sendEmailViaBrevo({
          apiKey: brevoApiKey.trim(),
          senderName: smtpSenderName || "Oligarch Media Graphic Design Studio",
          senderEmail: smtpUser || "hr.oligarchmedia@gmail.com",
          to: targetRecipient,
          subject: `[Verified] Oligarch Media Brevo Delivery Test (${new Date().toLocaleTimeString()})`,
          html: `
            <div style="font-family: sans-serif; padding: 24px; border: 1px solid #10b981; border-radius: 12px; background-color: #f0fdf4; max-width: 540px; margin: 0 auto;">
              <h2 style="color: #059669; margin: 0 0 12px 0; font-size: 18px;">✓ Brevo Live Email Delivery Verified!</h2>
              <p style="margin: 0 0 12px 0; color: #1f2937; font-size: 14px; line-height: 1.5;">Your free Brevo integration for <strong>${smtpSenderName || 'Oligarch Media Graphic Design Studio'}</strong> is working 100%! Automated payslips can now be delivered directly to employee inboxes without any Google passwords or OAuth verification.</p>
              <div style="background-color: #ffffff; padding: 12px; border-radius: 8px; border: 1px solid #d1fae5; margin-bottom: 12px;">
                <p style="font-size: 12px; color: #374151; margin: 4px 0;"><strong>Sender:</strong> ${smtpUser || 'hr.oligarchmedia@gmail.com'}</p>
                <p style="font-size: 12px; color: #374151; margin: 4px 0;"><strong>Delivered to:</strong> ${targetRecipient}</p>
                <p style="font-size: 12px; color: #374151; margin: 4px 0;"><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
              </div>
              <p style="font-size: 11px; color: #047857; margin: 0;">Oligarch Media Executive HR & Payroll System</p>
            </div>
          `
        });

        if (testRes.success) {
          setSmtpTestResult({
            success: true,
            message: `Brevo connected successfully! Live test email delivered to ${targetRecipient}.`
          });
          // Auto-save verified Brevo key to settings
          await setDoc(doc(db, "settings", "general"), {
            companyName,
            adminEmail,
            workHourStart,
            workHourEnd,
            breakStart,
            breakEnd,
            currency,
            smtpHost,
            smtpPort,
            smtpUser,
            smtpPass,
            smtpSenderName,
            emailProvider: "brevo",
            brevoApiKey: brevoApiKey.trim(),
            dstOffset,
            lateToAbsentCount,
            gracePeriodMinutes,
            autoRecalculatePayroll,
            enableAutoConvertLate,
            enableLateDeduction,
            resetLateEveryPayrollCutoff
          });
          triggerToast("Brevo API key verified and saved to database!");
          onRefresh();
        } else {
          setSmtpTestResult({
            success: false,
            message: `Brevo delivery failed: ${testRes.error}`
          });
        }
      } catch (err: any) {
        setSmtpTestResult({
          success: false,
          message: `Brevo error: ${err?.message || "Failed to contact Brevo service."}`
        });
      } finally {
        setSmtpTesting(false);
      }
      return;
    }

    // 2. If using standard SMTP
    if (!smtpHost || !smtpUser || !smtpPass) {
      setSmtpTestResult({
        success: false,
        message: "Please enter Host, SMTP Username/Email, and App Password before testing."
      });
      return;
    }

    setSmtpTesting(true);
    setSmtpTestResult(null);

    try {
      const res = await fetch("/api/test-smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          pass: smtpPass,
          senderName: smtpSenderName,
          testRecipient: adminEmail || smtpUser
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSmtpTestResult({
          success: true,
          message: data.message || `Connected! Live test email successfully delivered to ${adminEmail || smtpUser}.`
        });
        // Auto-save verified SMTP to settings document
        await setDoc(doc(db, "settings", "general"), {
          companyName,
          adminEmail,
          workHourStart,
          workHourEnd,
          breakStart,
          breakEnd,
          currency,
          smtpHost,
          smtpPort,
          smtpUser,
          smtpPass,
          smtpSenderName,
          dstOffset,
          lateToAbsentCount,
          gracePeriodMinutes,
          autoRecalculatePayroll,
          enableAutoConvertLate,
          enableLateDeduction,
          resetLateEveryPayrollCutoff
        });
        triggerToast("SMTP verified and saved to database!");
        onRefresh();
      } else {
        setSmtpTestResult({
          success: false,
          message: data.error || "Failed to verify SMTP credentials."
        });
      }
    } catch (err: any) {
      setSmtpTestResult({
        success: false,
        message: `Network error: ${err?.message || "Failed to contact email test server."}`
      });
    } finally {
      setSmtpTesting(false);
    }
  };

  // Export JSON Backup file - comprehensive export of all Firestore tables, local cache, & devotion schedules
  const handleExportBackup = async () => {
    try {
      triggerToast("Gathering complete application data snapshot for export...");

      // Live fetch helper that merges Prop state + LocalStorage cache + Live Firestore database items so zero records are ever missed
      const fetchLiveAndMerge = async (colName: string, propFallback: any[] = []) => {
        const mergedMap = new Map<string, any>();
        const getKey = (item: any) => {
          if (colName === "devotion_schedules" && item?.date) return item.date;
          return item?.id || `${item?.employeeNumber || ""}-${item?.date || ""}-${item?.fullName || ""}-${Math.random()}`;
        };

        // 1. Seed fallback props
        propFallback.forEach((item) => {
          if (item) mergedMap.set(getKey(item), item);
        });

        // 2. Merge local storage cache
        try {
          const localItems = getLocalData(colName);
          if (Array.isArray(localItems)) {
            localItems.forEach((item) => {
              if (item) mergedMap.set(getKey(item), item);
            });
          }
        } catch {
          // ignore
        }

        // 3. Overwrite / merge live Firestore records
        try {
          const snap = await getDocs(collection(db, colName));
          if (snap && snap.docs) {
            const liveDocs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
            liveDocs.forEach((d: any) => {
              if (d) mergedMap.set(getKey(d), d);
            });
          }
        } catch (colErr) {
          console.warn(`Live collection fetch notice for ${colName}:`, colErr);
        }

        return Array.from(mergedMap.values());
      };

      const [
        allEmployees,
        allAttendance,
        allLeaveRequests,
        allCopyRequests,
        allPayrollPeriods,
        allPayrolls,
        allCashAdvances,
        allBossDebts,
        allNoWorkDays,
        allDevotionSchedules,
        allDevotionSettings,
        allAnnouncements,
        allNotifications,
        allAuditLogs,
        allEmailLogs
      ] = await Promise.all([
        fetchLiveAndMerge("employees", employees),
        fetchLiveAndMerge("attendance", attendance),
        fetchLiveAndMerge("leave_requests", requests),
        fetchLiveAndMerge("attendance_copy_requests", attendanceCopyRequests),
        fetchLiveAndMerge("payroll_periods", payrollPeriods),
        fetchLiveAndMerge("payroll", payrolls),
        fetchLiveAndMerge("cash_advances", cashAdvances),
        fetchLiveAndMerge("boss_debts", bossDebts),
        fetchLiveAndMerge("no_work_days", noWorkDays),
        fetchLiveAndMerge("devotion_schedules", []),
        fetchLiveAndMerge("devotion_settings", []),
        fetchLiveAndMerge("announcements", []),
        fetchLiveAndMerge("notifications", []),
        fetchLiveAndMerge("audit_logs", []),
        fetchLiveAndMerge("email_logs", [])
      ]);

      const totalCount = 
        allEmployees.length + 
        allAttendance.length + 
        allLeaveRequests.length + 
        allCopyRequests.length + 
        allPayrollPeriods.length + 
        allPayrolls.length + 
        allCashAdvances.length + 
        allBossDebts.length + 
        allNoWorkDays.length +
        allDevotionSchedules.length +
        allDevotionSettings.length +
        allAnnouncements.length +
        allNotifications.length +
        allAuditLogs.length +
        allEmailLogs.length;

      const fullState = {
        // Standard Canonical Collections
        employees: allEmployees,
        attendance: allAttendance,
        leave_requests: allLeaveRequests,
        attendance_copy_requests: allCopyRequests,
        cash_advances: allCashAdvances,
        boss_debts: allBossDebts,
        payroll_periods: allPayrollPeriods,
        payroll: allPayrolls,
        no_work_days: allNoWorkDays,
        devotion_schedules: allDevotionSchedules,
        devotion_settings: allDevotionSettings,
        announcements: allAnnouncements,
        notifications: allNotifications,
        audit_logs: allAuditLogs,
        email_logs: allEmailLogs,

        // Cross-compatibility aliases so any backup importer recognizes them
        requests: allLeaveRequests,
        advances: allCashAdvances,
        debts: allBossDebts,
        periods: allPayrollPeriods,
        payrolls: allPayrolls,
        holidays: allNoWorkDays,
        devotions: allDevotionSchedules,

        settings: {
          companyName,
          adminEmail,
          workHourStart,
          workHourEnd,
          breakStart,
          breakEnd,
          currency,
          dstOffset,
          lateToAbsentCount,
          gracePeriodMinutes,
          autoRecalculatePayroll,
          enableAutoConvertLate,
          enableLateDeduction,
          resetLateEveryPayrollCutoff,
          emailProvider,
          brevoApiKey: brevoApiKey.trim(),
          smtpHost,
          smtpPort,
          smtpUser,
          smtpPass,
          smtpSenderName
        },
        metadata: {
          exportedAt: new Date().toISOString(),
          app: "Oligarch Media Graphic Design Studio HR",
          version: "v3.0",
          totalRecords: totalCount,
          breakdown: {
            employees: allEmployees.length,
            attendance: allAttendance.length,
            leave_requests: allLeaveRequests.length,
            attendance_copy_requests: allCopyRequests.length,
            cash_advances: allCashAdvances.length,
            boss_debts: allBossDebts.length,
            payroll_periods: allPayrollPeriods.length,
            payroll: allPayrolls.length,
            no_work_days: allNoWorkDays.length,
            devotion_schedules: allDevotionSchedules.length,
            devotion_settings: allDevotionSettings.length,
            announcements: allAnnouncements.length,
            notifications: allNotifications.length,
            audit_logs: allAuditLogs.length,
            email_logs: allEmailLogs.length
          }
        }
      };

      // Save snapshot to Server Persistent Store as well
      fetch("/api/persistent-store/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collections: {
            employees: allEmployees,
            attendance: allAttendance,
            leave_requests: allLeaveRequests,
            attendance_copy_requests: allCopyRequests,
            cash_advances: allCashAdvances,
            boss_debts: allBossDebts,
            payroll_periods: allPayrollPeriods,
            payroll: allPayrolls,
            no_work_days: allNoWorkDays,
            devotion_schedules: allDevotionSchedules,
            devotion_settings: allDevotionSettings,
            announcements: allAnnouncements,
            notifications: allNotifications
          }
        })
      }).catch(() => {});

      // Client-side Blob download: unlimited size, never breaks on huge JSON files
      const jsonString = JSON.stringify(fullState, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `oligarch-database-full-backup-${getBusinessDate() || new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Silently sync with server backup endpoint
      fetch("/api/backup-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: { exportedCount: totalCount, timestamp: fullState.metadata.exportedAt } })
      }).catch(() => {});

      triggerToast(`All app data exported successfully (${totalCount} records, including Devotion & Prayer schedules, employees, attendance & payroll)!`);
    } catch (err) {
      console.error(err);
      triggerToast("Error exporting database backup: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Inspect and parse backup file before restoring
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () => {
      triggerToast("Failed to read the backup file.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text || !text.trim()) {
          triggerToast("The selected backup file is completely empty.");
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }

        let raw: any;
        try {
          raw = JSON.parse(text);
        } catch (jsonErr) {
          triggerToast("Invalid JSON syntax: could not parse file.");
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }

        // Unwrap if nested under payload or data
        const data = raw.payload || raw.data || raw;

        // Extract collections with wide alias compatibility
        let emps: any[] = [];
        let atts: any[] = [];
        let lvs: any[] = [];
        let acrs: any[] = [];
        let pers: any[] = [];
        let pays: any[] = [];
        let advs: any[] = [];
        let debts: any[] = [];
        let nwds: any[] = [];
        let devScheds: any[] = [];
        let devSets: any[] = [];
        let anns: any[] = [];
        let notifs: any[] = [];
        let audits: any[] = [];
        let emails: any[] = [];
        let confSettings: any = null;

        if (Array.isArray(data)) {
          // Flat array of records - inspect first item
          if (data.length > 0) {
            const first = data[0];
            if (first.devotionLeaderName || first.prayerLeaderName) {
              devScheds = data;
            } else if (first.employeeNumber || first.fullName || first.dailyRate) {
              emps = data;
            } else if (first.timeIn || first.hoursWorked || (first.date && first.status)) {
              atts = data;
            } else if (first.amount && (first.installments || first.empId || first.employeeNumber)) {
              advs = data;
            } else if (first.requestId || first.type) {
              lvs = data;
            } else {
              atts = data;
            }
          }
        } else if (typeof data === "object" && data !== null) {
          emps = Array.isArray(data.employees) ? data.employees : (Array.isArray(data.staff) ? data.staff : []);
          atts = Array.isArray(data.attendance) ? data.attendance : (Array.isArray(data.timesheets) ? data.timesheets : []);
          lvs = Array.isArray(data.leave_requests) ? data.leave_requests : (Array.isArray(data.requests) ? data.requests : (Array.isArray(data.leaveRequests) ? data.leaveRequests : []));
          acrs = Array.isArray(data.attendance_copy_requests) ? data.attendance_copy_requests : (Array.isArray(data.copyRequests) ? data.copyRequests : (Array.isArray(data.attendanceCopyRequests) ? data.attendanceCopyRequests : []));
          pers = Array.isArray(data.payroll_periods) ? data.payroll_periods : (Array.isArray(data.periods) ? data.periods : (Array.isArray(data.payrollPeriods) ? data.payrollPeriods : []));
          pays = Array.isArray(data.payroll) ? data.payroll : (Array.isArray(data.payrolls) ? data.payrolls : []);
          advs = Array.isArray(data.cash_advances) ? data.cash_advances : (Array.isArray(data.advances) ? data.advances : (Array.isArray(data.cashAdvances) ? data.cashAdvances : []));
          debts = Array.isArray(data.boss_debts) ? data.boss_debts : (Array.isArray(data.debts) ? data.debts : (Array.isArray(data.bossDebts) ? data.bossDebts : []));
          nwds = Array.isArray(data.no_work_days) ? data.no_work_days : (Array.isArray(data.holidays) ? data.holidays : (Array.isArray(data.nowork_days) ? data.nowork_days : []));
          devScheds = Array.isArray(data.devotion_schedules) ? data.devotion_schedules : (Array.isArray(data.devotions) ? data.devotions : (Array.isArray(data.devotionSchedules) ? data.devotionSchedules : []));
          devSets = Array.isArray(data.devotion_settings) ? data.devotion_settings : (Array.isArray(data.devotionSettings) ? data.devotionSettings : []);
          anns = Array.isArray(data.announcements) ? data.announcements : [];
          notifs = Array.isArray(data.notifications) ? data.notifications : [];
          audits = Array.isArray(data.audit_logs) ? data.audit_logs : [];
          emails = Array.isArray(data.email_logs) ? data.email_logs : [];
          if (data.settings && typeof data.settings === "object") {
            confSettings = data.settings;
          }
        }

        const total = 
          emps.length + 
          atts.length + 
          lvs.length + 
          acrs.length + 
          pers.length + 
          pays.length + 
          advs.length + 
          debts.length + 
          nwds.length +
          devScheds.length +
          devSets.length +
          anns.length +
          notifs.length +
          audits.length +
          emails.length;

        if (total === 0 && !confSettings) {
          triggerToast("No recognizable HR dataset tables found in backup file.");
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }

        setRestoreModal({
          isOpen: true,
          fileName: file.name,
          parsedPayload: {
            employees: emps,
            attendance: atts,
            leave_requests: lvs,
            attendance_copy_requests: acrs,
            payroll_periods: pers,
            payroll: pays,
            cash_advances: advs,
            boss_debts: debts,
            no_work_days: nwds,
            devotion_schedules: devScheds,
            devotion_settings: devSets,
            announcements: anns,
            notifications: notifs,
            audit_logs: audits,
            email_logs: emails,
            settings: confSettings
          },
          restoreMode: "merge",
          totalCount: total
        });
      } catch (err) {
        console.error(err);
        triggerToast("Error processing backup file: " + (err instanceof Error ? err.message : String(err)));
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  // Perform full or merged database restoration
  const handleConfirmRestore = async () => {
    if (!restoreModal.parsedPayload) return;
    const payload = restoreModal.parsedPayload;
    const isClean = restoreModal.restoreMode === "clean";

    setRestoring(true);
    setRestoreProgress({ current: 15, total: 100, message: isClean ? "Purging and replacing records cleanly on server..." : "Merging backup records on server..." });

    try {
      // 1. Call high-speed server restoration endpoint
      await fetch("/api/persistent-store/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collections: {
            employees: payload.employees || [],
            attendance: payload.attendance || [],
            leave_requests: payload.leave_requests || [],
            attendance_copy_requests: payload.attendance_copy_requests || [],
            cash_advances: payload.cash_advances || [],
            boss_debts: payload.boss_debts || [],
            payroll_periods: payload.payroll_periods || [],
            payroll: payload.payroll || [],
            no_work_days: payload.no_work_days || [],
            devotion_schedules: payload.devotion_schedules || [],
            devotion_settings: payload.devotion_settings || [],
            announcements: payload.announcements || [],
            notifications: payload.notifications || [],
            audit_logs: payload.audit_logs || [],
            email_logs: payload.email_logs || []
          },
          settings: payload.settings || null,
          isClean
        })
      });

      setRestoreProgress({ current: 65, total: 100, message: "Updating application cache and local state..." });

      // 2. Clear previous client cache & tombstones if clean overwrite
      if (isClean) {
        clearAllLocalData();
        clearDeletedTombstones();
      }

      // 3. Immediately set in-memory cache for all collections so UI renders instantly
      setLocalData("employees", payload.employees || []);
      setLocalData("attendance", payload.attendance || []);
      setLocalData("leave_requests", payload.leave_requests || []);
      setLocalData("attendance_copy_requests", payload.attendance_copy_requests || []);
      setLocalData("cash_advances", payload.cash_advances || []);
      setLocalData("boss_debts", payload.boss_debts || []);
      setLocalData("payroll_periods", payload.payroll_periods || []);
      setLocalData("payroll", payload.payroll || []);
      setLocalData("no_work_days", payload.no_work_days || []);
      setLocalData("devotion_schedules", payload.devotion_schedules || []);
      setLocalData("devotion_settings", payload.devotion_settings || []);
      setLocalData("announcements", payload.announcements || []);
      setLocalData("notifications", payload.notifications || []);

      if (payload.devotion_schedules && payload.devotion_schedules.length > 0) {
        localStorage.setItem("devotion_initial_seeded_v2", "true");
      }

      // 4. Restore settings if available
      if (payload.settings) {
        try {
          await setDoc(doc(db, "settings", "general"), payload.settings, { merge: true });
          if (payload.settings.companyName) setCompanyName(payload.settings.companyName);
          if (payload.settings.adminEmail) setAdminEmail(payload.settings.adminEmail);
          if (payload.settings.workHourStart) setWorkHourStart(payload.settings.workHourStart);
          if (payload.settings.workHourEnd) setWorkHourEnd(payload.settings.workHourEnd);
          if (payload.settings.breakStart) setBreakStart(payload.settings.breakStart);
          if (payload.settings.breakEnd) setBreakEnd(payload.settings.breakEnd);
          if (payload.settings.currency) setCurrency(payload.settings.currency);
          if (payload.settings.dstOffset !== undefined) setDstOffset(payload.settings.dstOffset);
          if (payload.settings.lateToAbsentCount !== undefined) setLateToAbsentCount(payload.settings.lateToAbsentCount);
          if (payload.settings.brevoApiKey) setBrevoApiKey(payload.settings.brevoApiKey);
          if (payload.settings.emailProvider) setEmailProvider(payload.settings.emailProvider);
          if (payload.settings.smtpHost) setSmtpHost(payload.settings.smtpHost);
          if (payload.settings.smtpPort) setSmtpPort(payload.settings.smtpPort);
          if (payload.settings.smtpUser) setSmtpUser(payload.settings.smtpUser);
          if (payload.settings.smtpPass) setSmtpPass(payload.settings.smtpPass);
          if (payload.settings.smtpSenderName) setSmtpSenderName(payload.settings.smtpSenderName);
        } catch (setErr) {
          console.warn("Settings restore notice:", setErr);
        }
      }

      setRestoreProgress({ current: 100, total: 100, message: "Restoration complete!" });
      triggerToast(`Restoration complete! Successfully restored ${restoreModal.totalCount} records.`);
      setTimeout(() => {
        setRestoreModal(prev => ({ ...prev, isOpen: false }));
        onRefresh();
      }, 500);
    } catch (err) {
      console.error(err);
      triggerToast("Error during restoration: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRestoring(false);
      setRestoreProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Factory System Purge and Reset
  const handleResetApp = () => {
    triggerPromptConfirm(
      "🔥 FACTORY SYSTEM PURGE & SYSTEM RESET",
      "🚨 DANGER WARNING: This will permanently delete ALL data inside your Firebase Firestore database and offline cache, including staff rosters, attendance logs, leaves, payroll history, and notifications! The system will then be instantly re-seeded with standard Oligarch Media configurations and default initial roster.\n\nType RESET SYSTEM to confirm.",
      "RESET SYSTEM",
      async () => {
        setSaving(true);
        triggerToast("Purging database collections and offline cache...");
        try {
          const collectionsToClear = [
            "employees",
            "attendance",
            "leave_requests",
            "attendance_copy_requests",
            "payroll_periods",
            "payroll",
            "cash_advances",
            "boss_debts",
            "no_work_days",
            "notifications",
            "announcements",
            "audit_logs",
            "email_logs"
          ];

          // 1. Wipe collections safely with chunked deletion
          for (const colName of collectionsToClear) {
            try {
              const snap = await getDocs(collection(db, colName));
              if (snap && snap.docs && snap.docs.length > 0) {
                const docIds = snap.docs.map((d: any) => d.id);
                for (let i = 0; i < docIds.length; i += 30) {
                  const chunk = docIds.slice(i, i + 30);
                  await Promise.allSettled(chunk.map((id: string) => deleteDoc(doc(db, colName, id))));
                }
              }
            } catch (err) {
              console.warn(`Purge warning for ${colName}:`, err);
            }
          }

          // 2. Clear all local storage sandbox keys
          clearAllLocalData();

          // 3. Re-seed default Oligarch Media settings
          const defaultSettings = {
            companyName: "Oligarch Media Graphic Design Studio",
            adminEmail: "hr.oligarchmedia@gmail.com",
            workHourStart: "21:00",
            workHourEnd: "06:00",
            breakStart: "02:00",
            breakEnd: "03:00",
            currency: "₱",
            dstOffset: 0,
            lateToAbsentCount: 3,
            gracePeriodMinutes: 0,
            autoRecalculatePayroll: true,
            enableAutoConvertLate: true,
            enableLateDeduction: true,
            resetLateEveryPayrollCutoff: true,
            smtpHost: "smtp.gmail.com",
            smtpPort: "587",
            smtpSenderName: "HR Payroll System"
          };
          try {
            await setDoc(doc(db, "settings", "general"), defaultSettings);
          } catch (err) {
            console.warn("Settings reset warning:", err);
          }

          // 4. Re-seed initial default employees
          try {
            const initialMock = generateMockEmployees();
            for (const emp of initialMock) {
              const { id, ...payload } = emp;
              await setDoc(doc(db, "employees", id || `emp-${Math.random().toString(36).substring(2, 7)}`), payload);
            }
          } catch (err) {
            console.warn("Initial roster seed warning:", err);
          }

          // 5. Update local state variables
          setCompanyName(defaultSettings.companyName);
          setAdminEmail(defaultSettings.adminEmail);
          setWorkHourStart(defaultSettings.workHourStart);
          setWorkHourEnd(defaultSettings.workHourEnd);
          setBreakStart(defaultSettings.breakStart);
          setBreakEnd(defaultSettings.breakEnd);
          setCurrency(defaultSettings.currency);
          setDstOffset(0);
          setLateToAbsentCount(3);
          setGracePeriodMinutes(0);
          setAutoRecalculatePayroll(true);
          setEnableAutoConvertLate(true);
          setEnableLateDeduction(true);
          setResetLateEveryPayrollCutoff(true);

          // 6. Add Audit Log
          try {
            await addDoc(collection(db, "audit_logs"), {
              user: "Admin",
              action: "Factory Reset System",
              details: "The database has been fully pruned and reverted to standard Oligarch Media configurations and default roster.",
              timestamp: new Date().toISOString()
            });
          } catch (err) {
            console.warn("Audit log write warning:", err);
          }

          triggerToast("All data purged successfully! Re-initialized to Oligarch Media defaults.");
          onRefresh();
        } catch (err) {
          console.error("System reset notice:", err);
          triggerToast("Purge completed with minor warnings. UI refreshed.");
          onRefresh();
        } finally {
          setSaving(false);
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold text-zinc-904 dark:text-zinc-50 tracking-tight flex items-center gap-2">
          <Settings className="w-5 h-5 text-blue-500" /> Administrative Configurations
        </h2>
        <p className="text-xs text-zinc-500 mt-1 font-mono">Customize workday boundaries, notifications and run backups</p>
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        
        {/* ROW 1: WORKPLACE DEFAULTS */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-805 rounded-2xl p-5 shadow-xs space-y-4">
          <h3 className="font-bold text-xs uppercase tracking-wider font-mono text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
            <Clock className="w-4 h-4 text-blue-600" /> Shift & Corporate Rules
          </h3>

          {/* Quick DST vs Standard Shift Switcher */}
          <div className="p-4 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-bold font-mono uppercase text-zinc-900 dark:text-zinc-100">
                  Quick Shift Preset (Daylight Saving Time Adjustment)
                </span>
                {workHourStart === "22:00" && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-black bg-amber-500 text-slate-950 uppercase animate-pulse">
                    DST Active (10PM–7AM)
                  </span>
                )}
                {workHourStart === "21:00" && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-black bg-blue-500 text-white uppercase">
                    Standard Active (9PM–6AM)
                  </span>
                )}
              </div>
              <span className="text-[10px] font-mono text-zinc-400">
                Punctuality: 10:00 PM On Time • 10:01 PM Late
              </span>
            </div>

            <p className="text-[11px] text-zinc-600 dark:text-zinc-300">
              Easily toggle between summer Daylight Saving Time (DST) and Standard shift. Selecting a preset updates the corporate rules and synchronizes all staff schedules with 1 click.
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleApplyDstToAllEmployees("22:00", "07:00", "03:00", "04:00")}
                disabled={saving}
                className={`px-3 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer ${
                  workHourStart === "22:00"
                    ? "bg-amber-500 hover:bg-amber-400 text-slate-950 ring-2 ring-amber-400/50"
                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
                }`}
                title="Switch company & all 11 staff to 10:00 PM – 7:00 AM with meal break at 3:00 AM"
              >
                <Sun className="w-3.5 h-3.5 text-amber-950 dark:text-amber-400" />
                <span>☀️ Activate DST (10PM–7AM, Break 3AM)</span>
              </button>

              <button
                type="button"
                onClick={() => handleApplyDstToAllEmployees("21:00", "06:00", "02:00", "03:00")}
                disabled={saving}
                className={`px-3 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer ${
                  workHourStart === "21:00"
                    ? "bg-blue-600 hover:bg-blue-500 text-white ring-2 ring-blue-400/50"
                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
                }`}
                title="Switch company & all 11 staff to 9:00 PM – 6:00 AM with meal break at 2:00 AM"
              >
                <Moon className="w-3.5 h-3.5 text-blue-300" />
                <span>🌙 Standard Shift (9PM–6AM, Break 2AM)</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">Company Title Banner</label>
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50 font-semibold"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">Work Shift Start</label>
              <input
                type="time"
                required
                value={workHourStart}
                onChange={(e) => setWorkHourStart(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">Work Shift End</label>
              <input
                type="time"
                required
                value={workHourEnd}
                onChange={(e) => setWorkHourEnd(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">Break Time Start</label>
              <input
                type="time"
                required
                value={breakStart}
                onChange={(e) => setBreakStart(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">Break Time End</label>
              <input
                type="time"
                required
                value={breakEnd}
                onChange={(e) => setBreakEnd(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">Operational Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none dark:text-zinc-100 font-mono font-bold"
              >
                <option value="₱">PHP (₱)</option>
                <option value="$">USD ($)</option>
                <option value="€">EUR (€)</option>
                <option value="£">GBP (£)</option>
              </select>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">Daylight Saving Shift Preset</label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setWorkHourStart("22:00");
                      setWorkHourEnd("07:00");
                      setBreakStart("03:00");
                      setBreakEnd("04:00");
                      setDstOffset(0);
                    }}
                    className={`text-[9px] px-2 py-0.5 rounded font-mono font-bold transition-all ${
                      workHourStart === "22:00" && workHourEnd === "07:00"
                        ? "bg-emerald-600 text-white"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200"
                    }`}
                  >
                    Nov 1 Winter (10PM–7AM)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWorkHourStart("21:00");
                      setWorkHourEnd("06:00");
                      setBreakStart("02:00");
                      setBreakEnd("03:00");
                      setDstOffset(0);
                    }}
                    className={`text-[9px] px-2 py-0.5 rounded font-mono font-bold transition-all ${
                      workHourStart === "21:00" && workHourEnd === "06:00"
                        ? "bg-emerald-600 text-white"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200"
                    }`}
                  >
                    Summer (9PM–6AM)
                  </button>
                </div>
              </div>
              <select
                value={dstOffset}
                onChange={(e) => setDstOffset(Number(e.target.value))}
                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none dark:text-zinc-100 font-mono font-bold text-amber-600 dark:text-amber-500"
              >
                <option value={0}>Standard Shift Alignment (No Phantom OT)</option>
                <option value={60}>+60 min (DST Manual Offset)</option>
                <option value={-60}>-60 min (DST Manual Offset)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase font-semibold">Admin Verification Email</label>
              <input
                type="email"
                required
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50 font-mono font-bold"
              />
            </div>
          </div>
        </div>

        {/* --- Advanced Payroll Settings Section --- */}
        <div className="bg-white dark:bg-zinc-950 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-805 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/40 text-blue-600 rounded-lg">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 uppercase tracking-tight">Advanced Payroll Rules</h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">Automated calculation logic & attendance conversion policies.</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase font-semibold">Late Threshold Before 1 Absent</label>
              <input
                type="number"
                required
                min="1"
                value={lateToAbsentCount}
                onChange={(e) => setLateToAbsentCount(Number(e.target.value))}
                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50 font-mono font-bold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase font-semibold">Grace Period (Minutes)</label>
              <input
                type="number"
                required
                min="0"
                value={gracePeriodMinutes}
                onChange={(e) => setGracePeriodMinutes(Number(e.target.value))}
                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50 font-mono font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-4">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={enableAutoConvertLate}
                  onChange={(e) => setEnableAutoConvertLate(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:checked:bg-blue-500"
                />
                Enable Auto Convert Late to Absent
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={enableLateDeduction}
                  onChange={(e) => setEnableLateDeduction(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:checked:bg-blue-500"
                />
                Enable Late Deduction (per minute)
              </label>
            </div>
            
            <div className="space-y-4 flex flex-col">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={resetLateEveryPayrollCutoff}
                  onChange={(e) => setResetLateEveryPayrollCutoff(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:checked:bg-blue-500"
                />
                Reset Late Every Payroll Cutoff
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={autoRecalculatePayroll}
                  onChange={(e) => setAutoRecalculatePayroll(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:checked:bg-blue-500"
                />
                Auto-recalculate unreleased payrolls on data change
              </label>
            </div>
          </div>
        </div>

        {/* ROW 2: EMAIL DISPATCH INTEGRATION */}
        {/* ROW 2: BREVO EMAIL DISPATCH ENGINE */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800/80">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-xs uppercase tracking-wider font-mono text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <span>Payslip Email Dispatch Engine (Brevo API)</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                    brevoApiKey 
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" 
                      : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                  }`}>
                    {brevoApiKey ? "● Brevo Active (300 Free Emails/Day)" : "● API Key Needed"}
                  </span>
                </h3>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Delivers official electronic payslips directly to employee Gmail inboxes. Zero Google passwords or verification required.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href="https://app.brevo.com/settings/keys/api"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                <span>Get Free Brevo Key</span>
                <ExternalLink className="w-3 h-3 ml-0.5" />
              </a>
            </div>
          </div>

          {/* Test Result Feedback Banner */}
          {smtpTestResult && (
            <div className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 animate-in fade-in ${
              smtpTestResult.success
                ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
                : "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200"
            }`}>
              {smtpTestResult.success ? (
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed font-sans">{smtpTestResult.message}</span>
            </div>
          )}

          {/* BREVO CONFIGURATION */}
          <div className="space-y-4">
            <div className="bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/50 rounded-2xl p-4 text-xs space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5 text-xs">
                  <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Free Automated Email Delivery (300 Free Emails / Day):</span>
                </h4>
                <span className="text-[10px] font-mono font-bold bg-emerald-200/60 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                  9,000 Free Emails / mo
                </span>
              </div>
              <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed font-sans">
                Sends official payslips directly to employee inboxes with zero Google passwords, zero Google App Passwords, and no Google account verification.
              </p>
              <div className="bg-white/80 dark:bg-zinc-900/80 p-3 rounded-xl border border-emerald-100 dark:border-emerald-900/40 space-y-1.5 text-zinc-700 dark:text-zinc-300">
                <div className="font-bold text-zinc-900 dark:text-zinc-100 text-[11px] mb-1">
                  1-Minute Setup Guide:
                </div>
                <ol className="list-decimal list-inside space-y-1 text-[11px]">
                  <li>Sign up for free at <a href="https://www.brevo.com" target="_blank" rel="noreferrer" className="text-emerald-600 dark:text-emerald-400 underline font-bold">brevo.com</a> (any email, no credit card required).</li>
                  <li>Go to API Keys at <a href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noreferrer" className="text-emerald-600 dark:text-emerald-400 underline font-bold">app.brevo.com/settings/keys/api</a>.</li>
                  <li>Click <strong>"Generate a new API key"</strong>, name it <strong>Oligarch Payroll</strong>, copy the key (starts with <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded font-bold text-emerald-600">xkeysib-...</code>), and paste it below!</li>
                </ol>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase flex items-center gap-1.5">
                    <Key className="w-3 h-3 text-emerald-500" />
                    <span>Brevo API Key (starts with xkeysib-...)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowBrevoKey(!showBrevoKey)}
                    className="text-[10px] font-bold text-zinc-400 hover:text-zinc-600 flex items-center gap-1 cursor-pointer"
                  >
                    {showBrevoKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    <span>{showBrevoKey ? "Hide" : "Reveal"}</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showBrevoKey ? "text" : "password"}
                    placeholder="xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxx"
                    value={brevoApiKey}
                    onChange={(e) => setBrevoApiKey(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500 dark:text-zinc-50 font-mono font-bold"
                  />
                </div>
              </div>

              <div className="space-y-1 sm:col-span-1">
                <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">Sender Email Address</label>
                <input
                  type="email"
                  placeholder="hr.oligarchmedia@gmail.com"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500 dark:text-zinc-50 font-mono font-bold"
                />
                <p className="text-[9px] text-zinc-400">Your registered email address on Brevo.</p>
              </div>

              <div className="space-y-1 sm:col-span-3">
                <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase">Sender Display Name / Company</label>
                <input
                  type="text"
                  placeholder="Oligarch Media Graphic Design Studio"
                  value={smtpSenderName}
                  onChange={(e) => setSmtpSenderName(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500 dark:text-zinc-50 font-sans"
                />
              </div>
            </div>
          </div>

          {/* Test & Diagnostic Actions */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 dark:border-zinc-800/80">
            <p className="text-[11px] text-zinc-400 font-mono">
              Test recipient: <strong className="text-zinc-700 dark:text-zinc-300">{adminEmail || smtpUser || "hr.oligarchmedia@gmail.com"}</strong>
            </p>

            <button
              type="button"
              onClick={handleTestSmtpConnection}
              disabled={smtpTesting || !brevoApiKey.trim()}
              className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-900 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {smtpTesting ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  <span>Verifying & Sending Test Email...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Test Email via Brevo to {adminEmail || smtpUser || "Admin"}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* SAVE GENERAL BUTTONS */}
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            {saving ? "Updating carrier options..." : "Save System Config"}
          </button>
        </div>
      </form>

      {/* ROW 2.5: SECURE PORTAL DUAL-ACCESS LINKS */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-805 rounded-2xl p-5 shadow-xs space-y-4">
        <div>
          <h3 className="font-bold text-xs uppercase tracking-wider font-mono text-zinc-650 dark:text-zinc-400 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-500 animate-pulse" /> Secure Isolated Access Links
          </h3>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-2xl font-sans leading-relaxed">
            To prevent employees from viewing or accessing the administration interface, the system isolates employee and administrator sessions. Distribute the separate links below to keep access securely partitioned.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Employee Link Card */}
          <div className="p-4 bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/60 dark:border-zinc-800/85 rounded-xl flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-blue-500/10 text-blue-400">
                Staff Portal Mode
              </span>
              <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-100">Employee Time Clock URL</h4>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Provide this URL to standard employees. This link automatically boots the app in Portal Mode and completely hides the Admin toggle option.
              </p>
            </div>
            <div className="pt-2 flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={`${window.location.origin}/?view=employee`}
                className="flex-1 text-[10px] font-mono p-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-400 select-all focus:outline-none"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/?view=employee`);
                  triggerToast("Copied Employee Staff Portal link to clipboard!");
                }}
                className="p-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-750 text-zinc-750 dark:text-zinc-300 rounded-lg transition-colors cursor-pointer"
                title="Copy Link"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <a
                href={`${window.location.origin}/?view=employee`}
                target="_blank"
                rel="noreferrer"
                className="p-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-750 text-zinc-750 dark:text-zinc-300 rounded-lg transition-colors flex items-center justify-center"
                title="Open in new tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Admin Link Card */}
          <div className="p-4 bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/60 dark:border-zinc-800/85 rounded-xl flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-amber-500/10 text-amber-500">
                Admin Console Mode
              </span>
              <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-100">Administrator Gateway URL</h4>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Save this secure URL for administrators. This link forces the app to open the Admin Authentication panel and hides the employee workspace until logged in.
              </p>
            </div>
            <div className="pt-2 flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={`${window.location.origin}/?view=admin`}
                className="flex-1 text-[10px] font-mono p-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-400 select-all focus:outline-none"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/?view=admin`);
                  triggerToast("Copied Secure Admin Gateway link to clipboard!");
                }}
                className="p-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-750 text-zinc-750 dark:text-zinc-300 rounded-lg transition-colors cursor-pointer"
                title="Copy Link"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <a
                href={`${window.location.origin}/?view=admin`}
                target="_blank"
                rel="noreferrer"
                className="p-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-750 text-zinc-750 dark:text-zinc-300 rounded-lg transition-colors flex items-center justify-center"
                title="Open in new tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ROW 3: DATABASE BACKUP CLOUD RECOVERY */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-805 rounded-2xl p-5 shadow-xs space-y-4">
        <div>
          <h3 className="font-bold text-xs uppercase tracking-wider font-mono text-zinc-650 dark:text-zinc-400 flex items-center gap-1.5">
            <Database className="w-4 h-4 text-blue-600" /> Database Backup & Restoration Services
          </h3>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-sm font-sans">
            Preserve enterprise compliance logs. Store snapshot formats locally and restore them during disaster recoveries.
          </p>
        </div>

        <div className="flex items-center gap-3.5 flex-wrap">
          {/* Export */}
          <button
            type="button"
            onClick={handleExportBackup}
            className="px-4 py-2 text-xs bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-250 dark:border-zinc-805 text-zinc-700 dark:text-zinc-200 font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export Database JSON
          </button>

          {/* Import file widget */}
          <div className="relative font-bold inline-flex items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              disabled={restoring}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={restoring}
              className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
            >
              {restoring ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Restoring records...
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" /> Restore backup file
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ROW 4: FACTORY RESET SYSTEM PERMANENT ERASE */}
      <div className="bg-red-50/50 dark:bg-red-950/10 border border-red-200 dark:border-red-900/30 rounded-2xl p-5 shadow-xs space-y-4">
        <div>
          <h3 className="font-bold text-xs uppercase tracking-wider font-mono text-red-650 dark:text-red-400 flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-red-500" /> Dangerous System Purge / App Reset
          </h3>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-lg font-sans">
            Clear all active datasets including staff rosters, attendance logs, leaves, payroll history, and notifications from Firestore. Revert settings instantly to default Oligarch Media configurations.
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={handleResetApp}
            disabled={saving || restoring}
            className="px-4 py-2.5 text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm shadow-red-550/10 transition-all"
          >
            <Flame className="w-3.5 h-3.5 animate-pulse" /> Reset Application Database
          </button>
        </div>
      </div>

      {/* Interactive Restore Confirmation & Preview Modal */}
      {restoreModal.isOpen && restoreModal.parsedPayload && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-805 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-200 text-zinc-900 dark:text-white">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-blue-500 uppercase tracking-wider font-mono flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-500" /> Restore Database Backup
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono mt-0.5 truncate max-w-md">
                  File: {restoreModal.fileName}
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold font-mono bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
                {restoreModal.totalCount} Total Records
              </span>
            </div>

            {/* Content summary grid */}
            <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/80 dark:border-zinc-800 rounded-xl p-3.5 space-y-2.5">
              <span className="text-[10px] font-bold font-mono text-zinc-400 uppercase tracking-wider block">
                Detected Datasets in File
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Staff Roster</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-100">{restoreModal.parsedPayload.employees.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Attendance Logs</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{restoreModal.parsedPayload.attendance.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Leave Requests</span>
                  <span className="font-bold text-amber-600 dark:text-amber-400">{restoreModal.parsedPayload.leave_requests.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Cash Advances</span>
                  <span className="font-bold text-cyan-600 dark:text-cyan-400">{restoreModal.parsedPayload.cash_advances.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Boss Debts</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400">{restoreModal.parsedPayload.boss_debts.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Copy Requests</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400">{restoreModal.parsedPayload.attendance_copy_requests.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Payroll Cutoffs</span>
                  <span className="font-bold text-blue-600 dark:text-blue-400">{restoreModal.parsedPayload.payroll_periods.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Payroll History</span>
                  <span className="font-bold text-purple-600 dark:text-purple-400">{restoreModal.parsedPayload.payroll.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Holidays / Days Off</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-100">{restoreModal.parsedPayload.no_work_days.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Announcements</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-100">{restoreModal.parsedPayload.announcements.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Notifications</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-100">{restoreModal.parsedPayload.notifications.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <span className="text-zinc-400 text-[10px] block">Audit Trail</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-100">{restoreModal.parsedPayload.audit_logs.length}</span>
                </div>
                <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 sm:col-span-2">
                  <span className="text-zinc-400 text-[10px] block">Devotion & Prayer Roster (Date-Based)</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400">
                    {restoreModal.parsedPayload.devotion_schedules.length} schedules ({restoreModal.parsedPayload.devotion_settings.length} settings)
                  </span>
                </div>
              </div>
              {restoreModal.parsedPayload.settings && (
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 pt-1 font-mono">
                  <Check className="w-3.5 h-3.5" /> Company workplace configuration included in backup
                </div>
              )}
            </div>

            {/* Restore Strategy Mode */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase block">
                Select Restoration Mode
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setRestoreModal(prev => ({ ...prev, restoreMode: "merge" }))}
                  className={`p-3 text-left rounded-xl border transition-all cursor-pointer ${
                    restoreModal.restoreMode === "merge"
                      ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-blue-500"
                      : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-mono text-blue-600 dark:text-blue-400">Merge & Upsert</span>
                    <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-300">Recommended</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 leading-snug">
                    Preserves existing records. Updates matching records and appends missing ones.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setRestoreModal(prev => ({ ...prev, restoreMode: "clean" }))}
                  className={`p-3 text-left rounded-xl border transition-all cursor-pointer ${
                    restoreModal.restoreMode === "clean"
                      ? "border-red-500 bg-red-50/50 dark:bg-red-950/20 ring-1 ring-red-500"
                      : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-mono text-red-600 dark:text-red-400">Clean Replace</span>
                    <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-300">Purge First</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 leading-snug">
                    Wipes current database first, then restores this backup snapshot cleanly.
                  </p>
                </button>
              </div>
            </div>

            {/* Active restoration progress indicator */}
            {restoreProgress && (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] font-mono text-zinc-500">
                  <span>{restoreProgress.message}</span>
                  <span>{Math.round((restoreProgress.current / (restoreProgress.total || 1)) * 100)}%</span>
                </div>
                <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-blue-600 h-full transition-all duration-200" 
                    style={{ width: `${Math.min(100, Math.round((restoreProgress.current / (restoreProgress.total || 1)) * 100))}%` }}
                  />
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex justify-end gap-2.5 pt-2 font-mono">
              <button
                type="button"
                disabled={restoring}
                onClick={() => {
                  setRestoreModal(prev => ({ ...prev, isOpen: false }));
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={restoring}
                onClick={handleConfirmRestore}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-blue-500/15"
              >
                {restoring ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Restoring...
                  </>
                ) : (
                  <>
                    <Database className="w-3.5 h-3.5" /> Start Restoration ({restoreModal.totalCount} records)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation Dialog for Reset */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-805 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-200 text-zinc-900 dark:text-white">
            <h3 className="text-sm font-extrabold text-amber-500 uppercase tracking-wider font-mono flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-500 animate-pulse" /> {confirmModal.title}
            </h3>
            <p className="text-xs text-zinc-650 dark:text-zinc-350 leading-relaxed font-sans">
              {confirmModal.message}
            </p>
            {confirmModal.requireCode && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-500 font-mono block">CONFIRMATION CODE REQUIRED</label>
                <input
                  type="text"
                  placeholder={confirmModal.requireCode}
                  value={confirmModal.codeValue || ""}
                  onChange={(e) => setConfirmModal(prev => ({ ...prev, codeValue: e.target.value }))}
                  className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none font-mono uppercase tracking-wider text-zinc-900 dark:text-white"
                />
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2 font-mono">
              <button
                type="button"
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-white rounded-lg text-sm font-bold shadow-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmModal.onConfirm(confirmModal.codeValue)}
                className="px-4 py-2 bg-red-650 hover:bg-red-700 text-white text-xs font-black uppercase rounded-xl transition-all cursor-pointer shadow-md shadow-red-500/15"
              >
                Confirm Action
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating System Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-55 max-w-sm bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-950 px-4 py-3.5 rounded-xl shadow-lg border border-zinc-850 dark:border-zinc-200 flex items-center gap-2.5 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold font-mono tracking-tight">{toastMessage}</span>
        </div>
      )}

    </div>
  );
}
