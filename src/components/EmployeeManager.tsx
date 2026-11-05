import React, { useState } from "react";
import { db, handleFirestoreError, OperationType, collection, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs, setDoc } from "../firebase";
import { Employee, WeeklySchedule, DaySchedule, DayOfWeek, ScheduleOverride, Attendance, SalaryRateRecord } from "../types";
import { formatTo12Hour, getEmployeeSchedule, getBusinessDate, DAYS_OF_WEEK, createDefaultWeeklySchedule, calculateAttendanceHours, getBirthdayWeekInfo, calculateSalaryIncrease, getEmployeeRateForDate } from "../utils";
import { OFFICIAL_JOEMARIE_PANGAN } from "../data/officialStaffBackup";
import { 
  Plus, 
  Search, 
  Filter, 
  Edit, 
  Archive, 
  Check, 
  UserPlus, 
  Download, 
  X,
  CreditCard,
  Briefcase,
  AlertTriangle,
  UserCheck,
  Trash2,
  Camera,
  Clock,
  Zap,
  Calendar,
  RotateCcw,
  Sparkles,
  Info,
  CheckCircle2,
  Copy,
  TrendingUp,
  History,
  ArrowUpRight
} from "lucide-react";

interface EmployeeManagerProps {
  employees: Employee[];
  onRefresh: () => void;
  isSuperAdmin: boolean;
  settings?: any;
}

export default function EmployeeManager({ employees, onRefresh, isSuperAdmin, settings }: EmployeeManagerProps) {
  // Lists queries filters
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");

  // Add/Edit modal dialog states
  const [isOpen, setIsOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);

  // Form Fields
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("Graphic Design");
  const [position, setPosition] = useState("Graphic Designer");
  const [employmentType, setEmploymentType] = useState<"Full-time" | "Part-time" | "Contract" | "Intern">("Full-time");
  const [dateHired, setDateHired] = useState("");
  const [birthday, setBirthday] = useState("");
  const [quickBdayEmp, setQuickBdayEmp] = useState<Employee | null>(null);
  const [quickBdayVal, setQuickBdayVal] = useState("");
  const [isSavingQuickBday, setIsSavingQuickBday] = useState(false);
  const [salary, setSalary] = useState(0);
  const [allowance, setAllowance] = useState(0);
  const [otRate, setOtRate] = useState(0);
  const [profilePicture, setProfilePicture] = useState("");
  const [status, setStatus] = useState<"Active" | "Inactive" | "Resigned">("Active");
  const [isAdmin, setIsAdmin] = useState(false);
  const [pin, setPin] = useState("");

  // Salary rate history & designated cutoff transitions
  const [salaryHistory, setSalaryHistory] = useState<SalaryRateRecord[]>([]);
  const [showAddRateForm, setShowAddRateForm] = useState(false);
  const [newRateSalary, setNewRateSalary] = useState(0);
  const [newRateAllowance, setNewRateAllowance] = useState(0);
  const [newRateEffectiveDate, setNewRateEffectiveDate] = useState(() => getBusinessDate());
  const [newRateCutoffName, setNewRateCutoffName] = useState("");
  const [newRateReason, setNewRateReason] = useState("Designated Cutoff Salary Adjustment");

  // Individual Work Schedule states
  const [scheduleType, setScheduleType] = useState<"default" | "custom" | "weekly">("weekly");
  const [workHourStart, setWorkHourStart] = useState("21:00");
  const [workHourEnd, setWorkHourEnd] = useState("06:00");
  const [requiredHours, setRequiredHours] = useState(8);
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule>(createDefaultWeeklySchedule());

  // Real-Time Shift Override Modal states
  const [shiftChangeModalEmployee, setShiftChangeModalEmployee] = useState<Employee | null>(null);
  const [overrideDate, setOverrideDate] = useState(getBusinessDate());
  const [overrideStart, setOverrideStart] = useState("21:00");
  const [overrideEnd, setOverrideEnd] = useState("06:00");
  const [overrideBreakDuration, setOverrideBreakDuration] = useState(60);
  const [overrideRequiredHours, setOverrideRequiredHours] = useState(8);
  const [overrideIsRestDay, setOverrideIsRestDay] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [savingOverride, setSavingOverride] = useState(false);

  const [saving, setSaving] = useState(false);

  // Custom iframe-safe confirmation/alert/prompt modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    requireCode?: string;
    codeValue?: string;
    placeholder?: string;
    onConfirm: (codeVal?: string) => void | Promise<void>;
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

  const triggerPromptConfirm = (title: string, message: string, requireCode: string, onConfirm: () => void | Promise<void>) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      requireCode,
      codeValue: "",
      onConfirm: async (val) => {
        if (val?.trim() === requireCode) {
          await onConfirm();
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        } else {
          triggerToast("Incorrect confirmation code. State purge aborted.");
        }
      },
    });
  };

  // Auto calculated Daily Rate helper (Monthly salary / 20 assuming standard working days)
  const calculatedDailyRate = salary > 0 ? parseFloat((salary / 20).toFixed(2)) : 0;

  const handleAddSalaryTransition = (isOldYear2025 = false) => {
    const targetDate = isOldYear2025 ? "2025-01-01" : newRateEffectiveDate;
    const targetSalary = isOldYear2025 ? (newRateSalary || 18000) : newRateSalary;
    if (!targetDate) {
      triggerToast("Please enter an effective date for this salary rate.");
      return;
    }
    if (!targetSalary || targetSalary <= 0) {
      triggerToast("Please enter a valid salary amount.");
      return;
    }

    const calculatedDaily = parseFloat((targetSalary / 20).toFixed(2));
    const calculatedOt = parseFloat(((targetSalary / 20) / 8).toFixed(2));

    const previousRates = salaryHistory.filter(r => r.effectiveDate < targetDate);
    const prev = previousRates.length > 0 ? previousRates[previousRates.length - 1].salary : salary;
    
    const { increaseAmount, increasePercentage } = calculateSalaryIncrease(targetSalary, prev);

    const newRecord: SalaryRateRecord = {
      id: `rate-${Date.now()}`,
      effectiveDate: targetDate,
      effectiveCutoffPeriodId: newRateCutoffName.trim() || undefined,
      salary: targetSalary,
      dailyRate: calculatedDaily,
      allowance: newRateAllowance !== undefined && newRateAllowance > 0 ? newRateAllowance : allowance,
      otRate: calculatedOt,
      previousSalary: prev,
      increaseAmount,
      increasePercentage,
      reason: isOldYear2025 
        ? (newRateReason.trim() || "2025 Baseline Rate (For 2025 13th Month)")
        : (newRateReason.trim() || "Designated Cutoff Rate Transition"),
      createdAt: new Date().toISOString()
    };

    const updatedHistory = [...salaryHistory.filter(r => r.effectiveDate !== targetDate), newRecord].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    setSalaryHistory(updatedHistory);

    const todayStr = getBusinessDate();
    if (targetDate <= todayStr && !isOldYear2025) {
      setSalary(targetSalary);
      if (newRateAllowance > 0) setAllowance(newRateAllowance);
      setOtRate(calculatedOt);
    }

    setShowAddRateForm(false);
    triggerToast(isOldYear2025 
      ? "2025 Old Salary recorded! 2025 13th month will calculate using this rate." 
      : `Salary transition recorded (+₱${(increaseAmount || 0).toLocaleString()} / +${increasePercentage || 0}%)! Save employee profile to persist.`
    );
  };

  const handleRemoveSalaryRecord = (recordId?: string) => {
    setSalaryHistory(prev => prev.filter(r => r.id !== recordId));
    triggerToast("Salary rate record removed from draft.");
  };

  const getNextEmployeeNumber = () => {
    let seq = 3; // start from 3 (003) as requested
    while (true) {
      const formattedNum = String(seq).padStart(3, '0');
      const exists = employees.some(
        (emp) => emp?.employeeNumber && String(emp.employeeNumber).trim().toUpperCase() === formattedNum
      );
      if (!exists) {
        return formattedNum;
      }
      seq++;
    }
  };

  const openAddModal = () => {
    setEditEmployee(null);
    setEmployeeNumber(getNextEmployeeNumber());
    setLastName("");
    setFirstName("");
    setMiddleName("");
    setFullName("");
    setEmail("");
    setPhone("");
    setDepartment("Graphic Design");
    setPosition("Graphic Designer");
    setEmploymentType("Full-time");
    setDateHired(new Date().toISOString().split("T")[0]);
    setBirthday("1995-01-01");
    setSalary(18000);
    setAllowance(1500);
    setOtRate(112.5);
    setProfilePicture("");
    setStatus("Active");
    setIsAdmin(false);
    setPin("1234");
    setScheduleType("weekly");
    setWeeklySchedule(createDefaultWeeklySchedule(settings?.workHourStart || "21:00", settings?.workHourEnd || "06:00", 8, 60));
    setWorkHourStart(settings?.workHourStart || "21:00");
    setWorkHourEnd(settings?.workHourEnd || "06:00");
    setRequiredHours(8);
    setScheduleNotes("");
    setSalaryHistory([]);
    setShowAddRateForm(false);
    setNewRateSalary(18000);
    setNewRateAllowance(1500);
    setNewRateEffectiveDate(getBusinessDate());
    setNewRateCutoffName("");
    setNewRateReason("Designated Cutoff Salary Adjustment");
    setIsOpen(true);
  };

  // Quick Add Historical / Name-Only Profile State
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickSalary, setQuickSalary] = useState("15000");
  const [quickYear, setQuickYear] = useState("2025");
  const [quickStatus, setQuickStatus] = useState<"Resigned" | "Active">("Resigned");
  const [isSubmittingQuick, setIsSubmittingQuick] = useState(false);

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickName.trim()) return;

    setIsSubmittingQuick(true);
    try {
      const yr = parseInt(quickYear, 10) || 2025;
      const salaryNum = parseFloat(quickSalary) || 15000;
      const dailyRate = Math.round((salaryNum / 26) * 100) / 100;
      const otRate = Math.round(((dailyRate / 8) * 1.25) * 100) / 100;
      const randSuffix = Math.floor(100 + Math.random() * 900);
      const generatedEmpNumber = `OM-${yr}-${randSuffix}`;

      await addDoc(collection(db, "employees"), {
        fullName: quickName.trim(),
        employeeNumber: generatedEmpNumber,
        email: `${quickName.toLowerCase().replace(/[^a-z0-9]/g, "")}@oligarchmedia.internal`,
        phone: "09000000000",
        department: "Graphic Design",
        position: quickStatus === "Resigned" ? `Former Artist (Historical ${yr})` : "Graphic Designer",
        birthday: "2000-01-01",
        salary: salaryNum,
        dailyRate,
        allowance: 0,
        otRate,
        status: quickStatus, // "Resigned" hides them from daily punch cards!
        profilePicture: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120",
        employmentType: "Full-time",
        dateHired: `${yr}-01-01`,
        salaryHistory: [
          {
            id: `rate-${yr}-base`,
            effectiveFrom: `${yr}-01-01`,
            monthlySalary: salaryNum,
            dailyRate,
            hourlyRate: Math.round((dailyRate / 8) * 100) / 100,
            note: `${yr} Base Historical Salary for 13th Month Pay`
          }
        ]
      });

      setQuickName("");
      setIsQuickAddOpen(false);
      onRefresh();
    } catch (err) {
      console.error("Error creating quick profile:", err);
    } finally {
      setIsSubmittingQuick(false);
    }
  };

  const openEditModal = (emp: any) => {
    setEditEmployee(emp);
    setEmployeeNumber(emp.employeeNumber);
    
    // Parse name structured details
    if (emp.lastName && emp.firstName) {
      setLastName(emp.lastName);
      setFirstName(emp.firstName);
      setMiddleName(emp.middleName || "");
    } else {
      const commaIndex = emp.fullName.indexOf(",");
      if (commaIndex > -1) {
        const last = emp.fullName.substring(0, commaIndex).trim();
        const rest = emp.fullName.substring(commaIndex + 1).trim();
        const parts = rest.split(/\s+/);
        const first = parts[0] || "";
        const middle = parts.slice(1).join(" ") || "";
        setLastName(last);
        setFirstName(first);
        setMiddleName(middle);
      } else {
        const parts = emp.fullName.trim().split(/\s+/);
        if (parts.length >= 3) {
          setLastName(parts[parts.length - 1]);
          setFirstName(parts[0]);
          setMiddleName(parts.slice(1, parts.length - 1).join(" "));
        } else if (parts.length === 2) {
          setLastName(parts[1]);
          setFirstName(parts[0]);
          setMiddleName("");
        } else {
          setLastName(emp.fullName);
          setFirstName("");
          setMiddleName("");
        }
      }
    }

    setFullName(emp.fullName);
    setEmail(emp.email);
    setPhone(emp.phone);
    setDepartment(emp.department || "Graphic Design");
    setPosition(emp.position || "Graphic Designer");
    setEmploymentType(emp.employmentType);
    setDateHired(emp.dateHired);
    setBirthday(emp.birthday);
    setSalary(emp.salary);
    setAllowance(emp.allowance);
    setOtRate(emp.otRate);
    setProfilePicture(emp.profilePicture || "");
    setStatus(emp.status);
    setIsAdmin(emp.isAdmin || false);
    setPin(emp.pin || "1234");
    setSalaryHistory(emp.salaryHistory ? [...emp.salaryHistory] : []);
    setShowAddRateForm(false);
    setNewRateSalary(emp.salary || 0);
    setNewRateAllowance(emp.allowance || 0);
    setNewRateEffectiveDate(getBusinessDate());
    setNewRateCutoffName("");
    setNewRateReason("Designated Cutoff Salary Adjustment");

    // Initialize individual work schedule
    const hasWeekly = !!emp.weeklySchedule && Object.keys(emp.weeklySchedule).length > 0;
    const isCustom = emp.scheduleType === "custom" || (!!emp.workHourStart && !!emp.workHourEnd && (emp.workHourStart !== (settings?.workHourStart || "21:00") || emp.workHourEnd !== (settings?.workHourEnd || "06:00")));
    
    if (hasWeekly) {
      setScheduleType("weekly");
      setWeeklySchedule({
        ...createDefaultWeeklySchedule(emp.workHourStart || settings?.workHourStart || "21:00", emp.workHourEnd || settings?.workHourEnd || "06:00", emp.requiredHours || 8),
        ...emp.weeklySchedule
      });
    } else if (isCustom) {
      setScheduleType("custom");
      setWeeklySchedule(createDefaultWeeklySchedule(emp.workHourStart || "21:00", emp.workHourEnd || "06:00", emp.requiredHours || 8));
    } else {
      setScheduleType(emp.scheduleType || "weekly");
      setWeeklySchedule(createDefaultWeeklySchedule(settings?.workHourStart || "21:00", settings?.workHourEnd || "06:00", 8));
    }

    setWorkHourStart(emp.workHourStart || settings?.workHourStart || "21:00");
    setWorkHourEnd(emp.workHourEnd || settings?.workHourEnd || "06:00");
    setRequiredHours(emp.requiredHours || 8);
    setScheduleNotes(emp.scheduleNotes || "");

    setIsOpen(true);
  };

  const openShiftChangeModal = (emp: Employee) => {
    setShiftChangeModalEmployee(emp);
    const todayDate = getBusinessDate();
    setOverrideDate(todayDate);
    const currentSched = getEmployeeSchedule(emp, settings, todayDate);
    setOverrideStart(currentSched.workHourStart);
    setOverrideEnd(currentSched.workHourEnd);
    setOverrideBreakDuration(currentSched.breakDurationMinutes || 60);
    setOverrideRequiredHours(currentSched.requiredHours || 8);
    setOverrideIsRestDay(currentSched.isRestDay || false);
    setOverrideReason(emp.scheduleOverride?.date === todayDate ? (emp.scheduleOverride.reason || emp.scheduleOverride.notes || "") : "");
  };

  const handleOverrideDateChange = (newDate: string) => {
    setOverrideDate(newDate);
    if (shiftChangeModalEmployee) {
      const currentSched = getEmployeeSchedule(shiftChangeModalEmployee, settings, newDate);
      setOverrideStart(currentSched.workHourStart);
      setOverrideEnd(currentSched.workHourEnd);
      setOverrideBreakDuration(currentSched.breakDurationMinutes || 60);
      setOverrideRequiredHours(currentSched.requiredHours || 8);
      setOverrideIsRestDay(currentSched.isRestDay || false);
      setOverrideReason(shiftChangeModalEmployee.scheduleOverride?.date === newDate ? (shiftChangeModalEmployee.scheduleOverride.reason || shiftChangeModalEmployee.scheduleOverride.notes || "") : "");
    }
  };

  const applyPresetToWeekly = (type: "example" | "standardNight" | "dstNight" | "standardDay" | "copyMonday") => {
    if (type === "example") {
      setWeeklySchedule({
        monday: { day: "monday", workHourStart: "23:00", workHourEnd: "08:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Night Shift (11PM–8AM)" },
        tuesday: { day: "tuesday", workHourStart: "23:00", workHourEnd: "08:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Night Shift (11PM–8AM)" },
        wednesday: { day: "wednesday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Night Shift (9PM–6AM)" },
        thursday: { day: "thursday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Night Shift (9PM–6AM)" },
        friday: { day: "friday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Night Shift (9PM–6AM)" },
        saturday: { day: "saturday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Night Shift (9PM–6AM)" },
        sunday: { day: "sunday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: true, notes: "Rest Day" },
      });
      triggerToast("Applied Example Schedule: Mon-Tue 11PM–8AM, Wed-Sat 9PM–6AM, Sun Off");
    } else if (type === "dstNight") {
      setWeeklySchedule({
        monday: { day: "monday", workHourStart: "22:00", workHourEnd: "07:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "DST Shift (10PM–7AM, Break 3AM)" },
        tuesday: { day: "tuesday", workHourStart: "22:00", workHourEnd: "07:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "DST Shift (10PM–7AM, Break 3AM)" },
        wednesday: { day: "wednesday", workHourStart: "22:00", workHourEnd: "07:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "DST Shift (10PM–7AM, Break 3AM)" },
        thursday: { day: "thursday", workHourStart: "22:00", workHourEnd: "07:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "DST Shift (10PM–7AM, Break 3AM)" },
        friday: { day: "friday", workHourStart: "22:00", workHourEnd: "07:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "DST Shift (10PM–7AM, Break 3AM)" },
        saturday: { day: "saturday", workHourStart: "22:00", workHourEnd: "07:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "DST Shift (10PM–7AM, Break 3AM)" },
        sunday: { day: "sunday", workHourStart: "22:00", workHourEnd: "07:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: true, notes: "Rest Day" },
      });
      setWorkHourStart("22:00");
      setWorkHourEnd("07:00");
      triggerToast("Applied DST Shift: Mon-Sat 10PM–7AM (Break 3AM), Sun Off");
    } else if (type === "standardNight") {
      setWeeklySchedule({
        monday: { day: "monday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Regular Night Shift" },
        tuesday: { day: "tuesday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Regular Night Shift" },
        wednesday: { day: "wednesday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Regular Night Shift" },
        thursday: { day: "thursday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Regular Night Shift" },
        friday: { day: "friday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Regular Night Shift" },
        saturday: { day: "saturday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Regular Night Shift" },
        sunday: { day: "sunday", workHourStart: "21:00", workHourEnd: "06:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: true, notes: "Rest Day" },
      });
      setWorkHourStart("21:00");
      setWorkHourEnd("06:00");
      triggerToast("Applied Standard Night Shift: Mon-Sat 9PM–6AM, Sun Off");
    } else if (type === "standardDay") {
      setWeeklySchedule({
        monday: { day: "monday", workHourStart: "08:00", workHourEnd: "17:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Day Shift" },
        tuesday: { day: "tuesday", workHourStart: "08:00", workHourEnd: "17:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Day Shift" },
        wednesday: { day: "wednesday", workHourStart: "08:00", workHourEnd: "17:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Day Shift" },
        thursday: { day: "thursday", workHourStart: "08:00", workHourEnd: "17:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Day Shift" },
        friday: { day: "friday", workHourStart: "08:00", workHourEnd: "17:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: false, notes: "Day Shift" },
        saturday: { day: "saturday", workHourStart: "08:00", workHourEnd: "17:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: true, notes: "Rest Day" },
        sunday: { day: "sunday", workHourStart: "08:00", workHourEnd: "17:00", breakDurationMinutes: 60, requiredHours: 8, isRestDay: true, notes: "Rest Day" },
      });
      triggerToast("Applied Standard Day Shift: Mon-Fri 8AM–5PM, Sat-Sun Off");
    } else if (type === "copyMonday") {
      const mon = weeklySchedule.monday;
      setWeeklySchedule(prev => ({
        ...prev,
        tuesday: { ...prev.tuesday, workHourStart: mon.workHourStart, workHourEnd: mon.workHourEnd, breakDurationMinutes: mon.breakDurationMinutes, requiredHours: mon.requiredHours, isRestDay: mon.isRestDay, notes: mon.notes },
        wednesday: { ...prev.wednesday, workHourStart: mon.workHourStart, workHourEnd: mon.workHourEnd, breakDurationMinutes: mon.breakDurationMinutes, requiredHours: mon.requiredHours, isRestDay: mon.isRestDay, notes: mon.notes },
        thursday: { ...prev.thursday, workHourStart: mon.workHourStart, workHourEnd: mon.workHourEnd, breakDurationMinutes: mon.breakDurationMinutes, requiredHours: mon.requiredHours, isRestDay: mon.isRestDay, notes: mon.notes },
        friday: { ...prev.friday, workHourStart: mon.workHourStart, workHourEnd: mon.workHourEnd, breakDurationMinutes: mon.breakDurationMinutes, requiredHours: mon.requiredHours, isRestDay: mon.isRestDay, notes: mon.notes },
        saturday: { ...prev.saturday, workHourStart: mon.workHourStart, workHourEnd: mon.workHourEnd, breakDurationMinutes: mon.breakDurationMinutes, requiredHours: mon.requiredHours, isRestDay: mon.isRestDay, notes: mon.notes },
      }));
      triggerToast("Copied Monday schedule to Tuesday through Saturday!");
    }
  };

  const updateDaySchedule = (day: DayOfWeek, field: keyof DaySchedule, value: any) => {
    setWeeklySchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value
      }
    }));
  };

  const handleApplyShiftOverride = async () => {
    if (!shiftChangeModalEmployee || !shiftChangeModalEmployee.id) return;
    setSavingOverride(true);
    try {
      const emp = shiftChangeModalEmployee;
      const targetDate = overrideDate || getBusinessDate();
      const overrideData: ScheduleOverride = {
        date: targetDate,
        workHourStart: overrideStart,
        workHourEnd: overrideEnd,
        breakDurationMinutes: overrideBreakDuration || 60,
        requiredHours: overrideRequiredHours || 8,
        isRestDay: overrideIsRestDay,
        reason: overrideReason.trim(),
        notes: overrideReason.trim() || `Shift Override: ${formatTo12Hour(overrideStart)} – ${formatTo12Hour(overrideEnd)}`,
        updatedAt: Date.now(),
        updatedBy: "Admin"
      };

      // 1. Update employee doc in Firestore
      const empDocRef = doc(db, "employees", emp.id);
      await updateDoc(empDocRef, {
        scheduleOverride: overrideData
      });

      // 2. Real-time update live attendance if record exists for this date
      try {
        const attendanceRef = collection(db, "attendance");
        const q = query(
          attendanceRef,
          where("date", "==", targetDate)
        );
        const snap = await getDocs(q);
        for (const docSnap of snap.docs) {
          const att = docSnap.data() as Attendance;
          if (
            att.employeeId === emp.id ||
            att.employeeNumber === emp.employeeNumber
          ) {
            // NEVER destroy original punch timeIn / timeOut!
            const dstOffset = settings?.dstOffset || 0;
            const gracePeriod = settings?.gracePeriodMinutes || 0;
            
            let math = { hoursWorked: att.hoursWorked || 0, lateMinutes: att.lateMinutes || 0, otHours: att.otHours || 0 };
            if (att.timeIn) {
              math = calculateAttendanceHours(
                att.timeIn,
                att.breakStart,
                att.breakEnd,
                att.timeOut,
                overrideStart,
                overrideEnd,
                dstOffset,
                att.accumulatedBreakSeconds || 0,
                att.currentBreakStart || null,
                att.earlyInApproved || false,
                gracePeriod,
                att.isLateExcused || false,
                att.approvedEarlyTime,
                overrideRequiredHours
              );
            }

            const updates: any = {
              shiftStart: overrideStart,
              shiftEnd: overrideEnd,
              requiredHours: overrideRequiredHours,
              lateMinutes: math.lateMinutes,
              hoursWorked: math.hoursWorked,
              otHours: math.otHours,
            };
            if (att.status === "Late" || att.status === "Present") {
              updates.status = math.lateMinutes > 0 ? "Late" : "Present";
            }

            await updateDoc(doc(db, "attendance", docSnap.id), updates);
          }
        }
      } catch (attErr) {
        console.error("Error updating live attendance record on override:", attErr);
      }

      // 3. Add audit log
      try {
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Applied Real-Time Shift Override",
          details: `Changed shift for ${emp.fullName} on ${targetDate} to ${overrideIsRestDay ? "Rest Day" : `${formatTo12Hour(overrideStart)} – ${formatTo12Hour(overrideEnd)}`}. Reason: ${overrideReason || "N/A"}`,
          timestamp: new Date().toISOString()
        });
      } catch (logErr) {
        console.warn("Audit log notice:", logErr);
      }

      triggerToast(`Real-time shift change applied for ${emp.fullName}!`);
      setShiftChangeModalEmployee(null);
      onRefresh();
    } catch (err) {
      console.error("Error saving shift override:", err);
      triggerToast("Failed to apply shift override.");
    } finally {
      setSavingOverride(false);
    }
  };

  const handleClearShiftOverride = async () => {
    if (!shiftChangeModalEmployee || !shiftChangeModalEmployee.id) return;
    setSavingOverride(true);
    try {
      const emp = shiftChangeModalEmployee;
      const targetDate = overrideDate || getBusinessDate();

      // 1. Remove scheduleOverride from employee doc
      const empDocRef = doc(db, "employees", emp.id);
      await updateDoc(empDocRef, {
        scheduleOverride: null
      });

      // 2. Recompute today's attendance record using normal weekly schedule
      try {
        const normalSched = getEmployeeSchedule(
          { ...emp, scheduleOverride: null },
          settings,
          targetDate
        );
        const attendanceRef = collection(db, "attendance");
        const q = query(
          attendanceRef,
          where("date", "==", targetDate)
        );
        const snap = await getDocs(q);
        for (const docSnap of snap.docs) {
          const att = docSnap.data() as Attendance;
          if (
            att.employeeId === emp.id ||
            att.employeeNumber === emp.employeeNumber
          ) {
            const dstOffset = settings?.dstOffset || 0;
            const gracePeriod = settings?.gracePeriodMinutes || 0;

            let math = { hoursWorked: att.hoursWorked || 0, lateMinutes: att.lateMinutes || 0, otHours: att.otHours || 0 };
            if (att.timeIn) {
              math = calculateAttendanceHours(
                att.timeIn,
                att.breakStart,
                att.breakEnd,
                att.timeOut,
                normalSched.workHourStart,
                normalSched.workHourEnd,
                dstOffset,
                att.accumulatedBreakSeconds || 0,
                att.currentBreakStart || null,
                att.earlyInApproved || false,
                gracePeriod,
                att.isLateExcused || false,
                att.approvedEarlyTime,
                normalSched.requiredHours
              );
            }

            const updates: any = {
              shiftStart: normalSched.workHourStart,
              shiftEnd: normalSched.workHourEnd,
              requiredHours: normalSched.requiredHours,
              lateMinutes: math.lateMinutes,
              hoursWorked: math.hoursWorked,
              otHours: math.otHours,
            };
            if (att.status === "Late" || att.status === "Present") {
              updates.status = math.lateMinutes > 0 ? "Late" : "Present";
            }
            await updateDoc(doc(db, "attendance", docSnap.id), updates);
          }
        }
      } catch (attErr) {
        console.error("Error recomputing normal attendance after clearing override:", attErr);
      }

      // 3. Audit log
      try {
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Reverted Shift Override",
          details: `Reverted shift for ${emp.fullName} on ${targetDate} to normal schedule.`,
          timestamp: new Date().toISOString()
        });
      } catch (logErr) {
        console.warn("Audit log notice:", logErr);
      }

      triggerToast(`Shift override cleared. Normal weekly schedule restored for ${emp.fullName}.`);
      setShiftChangeModalEmployee(null);
      onRefresh();
    } catch (err) {
      console.error("Error clearing shift override:", err);
      triggerToast("Failed to clear shift override.");
    } finally {
      setSavingOverride(false);
    }
  };

  const compressAndResizeImage = (
    base64Str: string,
    maxWidth = 180,
    maxHeight = 180,
    quality = 0.75
  ): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const resultBase64 = canvas.toDataURL("image/jpeg", quality);
          resolve(resultBase64);
        } else {
          resolve(base64Str);
        }
      };
      img.onerror = () => {
        resolve(base64Str);
      };
    });
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        triggerToast("Image file is too large. Image must be under 10MB.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        if (typeof reader.result === "string") {
          try {
            const compressed = await compressAndResizeImage(reader.result, 180, 180, 0.75);
            setProfilePicture(compressed);
            triggerToast("Employee photo loaded and compressed successfully!");
          } catch (err) {
            console.error("Compression failed, using fallback raw image:", err);
            setProfilePicture(reader.result);
            triggerToast("Employee photo loaded successfully!");
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDirectPhotoUpload = async (empId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      triggerToast("Image file is too large. Image must be under 10MB.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      if (typeof reader.result === "string") {
        try {
          const compressed = await compressAndResizeImage(reader.result, 180, 180, 0.75);
          await updateDoc(doc(db, "employees", empId), {
            profilePicture: compressed
          });
          onRefresh();
          triggerToast("Employee profile picture updated and compressed successfully!");
        } catch (err) {
          console.error("Error updating profile photo:", err);
          triggerToast("Could not update profile photo.");
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmpNum = employeeNumber.trim().toUpperCase();
    if (!trimmedEmpNum) {
      triggerToast("Employee number is required.");
      return;
    }
    if (!lastName.trim() || !firstName.trim()) {
       triggerToast("Last Name and First Name are required.");
       return;
    }

    const finalFullName = `${lastName.trim()}, ${firstName.trim()}${middleName.trim() ? " " + middleName.trim() : ""}`;
    const defaultPosition = "Graphic Designer";
    const defaultDepartment = "Graphic Design";

    // Check for employeeNumber uniqueness (excluding the current editing employee)
    const duplicate = employees.find(
      (emp) =>
        emp?.employeeNumber &&
        String(emp.employeeNumber).toUpperCase() === trimmedEmpNum &&
        emp.id !== editEmployee?.id
    );
    if (duplicate) {
      triggerToast(`Employee number "${trimmedEmpNum}" is already assigned to ${duplicate.fullName}.`);
      return;
    }

    const trimmedPin = pin.trim();
    if (trimmedPin && !/^\d{4}$/.test(trimmedPin)) {
      triggerToast("Employee Portal PIN must be exactly 4 digits.");
      return;
    }

    setSaving(true);
    const payload: any = {
      employeeNumber: trimmedEmpNum,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      middleName: middleName.trim(),
      fullName: finalFullName,
      email: email.trim(),
      phone: phone.trim(),
      department: defaultDepartment,
      position: defaultPosition,
      employmentType,
      dateHired,
      birthday,
      salary: parseFloat(salary.toString()) || 0,
      dailyRate: calculatedDailyRate,
      allowance: parseFloat(allowance.toString()) || 0,
      otRate: parseFloat(otRate.toString()) || 0,
      salaryHistory: salaryHistory || [],
      profilePicture: (profilePicture || "").trim() || `https://ui-avatars.com/api/?name=${encodeURIComponent(finalFullName)}&background=3B82F6&color=fff`,
      status,
      isAdmin: isSuperAdmin ? isAdmin : (editEmployee?.isAdmin || false),
      pin: isSuperAdmin ? (trimmedPin || "1234") : (editEmployee?.pin || "1234"),
      // Individual Work Schedule
      scheduleType,
      weeklySchedule: scheduleType === "weekly" ? weeklySchedule : (editEmployee?.weeklySchedule || weeklySchedule),
      workHourStart: scheduleType === "weekly" ? (weeklySchedule.monday?.workHourStart || "21:00") : (scheduleType === "custom" ? (workHourStart || "21:00") : (settings?.workHourStart || "21:00")),
      workHourEnd: scheduleType === "weekly" ? (weeklySchedule.monday?.workHourEnd || "06:00") : (scheduleType === "custom" ? (workHourEnd || "06:00") : (settings?.workHourEnd || "06:00")),
      requiredHours: scheduleType === "weekly" ? (weeklySchedule.monday?.requiredHours || 8) : (parseFloat(requiredHours.toString()) || 8),
      scheduleNotes: scheduleType === "weekly" ? "Weekly Work Schedule" : (scheduleType === "custom" ? scheduleNotes.trim() : ""),
      updatedAt: Date.now()
    };

    try {
      if (editEmployee?.id) {
        // Update
        const docRef = doc(db, "employees", editEmployee.id);
        await updateDoc(docRef, payload);

        // Update references cascade if the employeeNumber was changed
        if (editEmployee.employeeNumber && String(editEmployee.employeeNumber).trim().toUpperCase() !== trimmedEmpNum) {
          // Update attendance logs
          try {
            const attendanceRef = collection(db, "attendance");
            const qAttend = query(attendanceRef, where("employeeId", "==", editEmployee.id));
            const attendSnap = await getDocs(qAttend);
            for (const docSnap of attendSnap.docs) {
              await updateDoc(doc(db, "attendance", docSnap.id), {
                employeeNumber: trimmedEmpNum
              });
            }
          } catch (err) {
            console.error("Failed to update cascade attendance numbers:", err);
          }

          // Update leave requests
          try {
            const requestsRef = collection(db, "leave_requests");
            const qReq = query(requestsRef, where("employeeId", "==", editEmployee.id));
            const reqSnap = await getDocs(qReq);
            for (const docSnap of reqSnap.docs) {
              await updateDoc(doc(db, "leave_requests", docSnap.id), {
                employeeNumber: trimmedEmpNum
              });
            }
          } catch (err) {
            console.error("Failed to update cascade leave request numbers:", err);
          }

          // Update payrolls
          try {
            const payrollRef = collection(db, "payroll");
            const qPay = query(payrollRef, where("employeeId", "==", editEmployee.id));
            const paySnap = await getDocs(qPay);
            for (const docSnap of paySnap.docs) {
              await updateDoc(doc(db, "payroll", docSnap.id), {
                employeeNumber: trimmedEmpNum
              });
            }
          } catch (err) {
            console.error("Failed to update cascade payroll numbers:", err);
          }
        }
      } else {
        // Create
        await addDoc(collection(db, "employees"), payload);
      }
      setIsOpen(false);
      onRefresh();
      triggerToast(editEmployee?.id ? "Employee updated successfully!" : "Employee registered successfully!");
    } catch (err) {
      console.error(err);
      triggerToast("Error saving employee.");
    } finally {
      setSaving(false);
    }
  };

  // Permanent Deletion handlers
  const handleDeleteEmployee = async (emp: Employee) => {
    if (!emp.id) return;
    triggerConfirm(
      "Confirm Employee Deletion",
      `Are you sure you want to permanently delete employee "${emp.fullName}"? This will remove their profile record from the system completely.`,
      async () => {
        try {
          await deleteDoc(doc(db, "employees", emp.id));
          triggerToast(`Employee "${emp.fullName}" deleted successfully.`);
          onRefresh();
        } catch (err) {
          console.error(err);
          handleFirestoreError(err, OperationType.DELETE, `employees/${emp.id}`);
        }
      }
    );
  };

  const handlePurgeAllEmployees = async () => {
    if (employees.length === 0) {
      triggerToast("No active employee profiles found to delete.");
      return;
    }

    triggerPromptConfirm(
      "🚨 COMPLETE SYSTEM ROSTER PURGE",
      "You are initiating a complete system purge of ALL employee profiles! This action is non-reversible and will permanently erase all employee records from the database. Type DELETE ALL to confirm.",
      "DELETE ALL",
      async () => {
        try {
          setSaving(true);
          for (const emp of employees) {
            if (emp.id) {
              try {
                await deleteDoc(doc(db, "employees", emp.id));
              } catch (err) {
                handleFirestoreError(err, OperationType.DELETE, `employees/${emp.id}`);
              }
            }
          }
          triggerToast("Success! All employee records have been permanently deleted.");
          onRefresh();
        } catch (err) {
          console.error(err);
          triggerToast("Failed to complete full directory purge.");
        } finally {
          setSaving(false);
        }
      }
    );
  };

  // Archive Quick toggle Status
  const toggleArchiveStatus = async (emp: Employee) => {
    if (!emp.id) return;
    const nextStatus = emp.status === "Active" ? "Inactive" : "Active";
    if (!confirm(`Are you sure you want to set status of ${emp.fullName} to [${nextStatus}]?`)) return;

    try {
      const docRef = doc(db, "employees", emp.id);
      await updateDoc(docRef, { status: nextStatus });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  // Check if Joemarie Pangan (#002) is present in directory
  const isJoemarieMissing = !employees.some(
    (e) => e.id === "Y5fCWLfZk5lfg2Ocp1f9" || e.employeeNumber === "002"
  );

  const handleRestoreJoemarie = async () => {
    try {
      setSaving(true);
      await setDoc(doc(db, "employees", "Y5fCWLfZk5lfg2Ocp1f9"), {
        ...OFFICIAL_JOEMARIE_PANGAN,
        updatedAt: Date.now()
      }, { merge: true });
      triggerToast("PANGAN, JOEMARIE G (#002) restored successfully with full history!");
      onRefresh();
    } catch (err) {
      console.error(err);
      triggerToast("Failed to restore Joemarie Pangan.");
    } finally {
      setSaving(false);
    }
  };

  // Filter staff criteria
  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch = 
      (emp.fullName || "").toLowerCase().includes(search.toLowerCase()) ||
      (emp.employeeNumber || "").toLowerCase().includes(search.toLowerCase()) ||
      (emp.position || "").toLowerCase().includes(search.toLowerCase());
    
    const matchesDept = filterDept === "All" || emp.department === filterDept;
    const matchesStatus = filterStatus === "All" || emp.status === filterStatus;

    return matchesSearch && matchesDept && matchesStatus;
  });

  const uniqueDepts = Array.from(new Set(employees.map(e => e.department)));

  return (
    <div className="space-y-6 w-full min-w-0">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">Staff Listing Directory</h2>
          <p className="text-xs text-zinc-500 mt-1 font-mono">Total tracked: {filteredEmployees.length} profiles matched</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {isJoemarieMissing && (
            <button
              type="button"
              onClick={handleRestoreJoemarie}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-3.5 rounded-xl text-xs transition-all shadow-sm flex items-center gap-1.5 cursor-pointer animate-pulse"
              title="Restore PANGAN, JOEMARIE G (#002) original profile and reconnect to historical logs"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Restore PANGAN, JOEMARIE G (#002)
            </button>
          )}
          {employees.length > 0 && (
            <button
              onClick={handlePurgeAllEmployees}
              className="border border-red-200 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-950/20 text-red-650 dark:text-red-400 font-bold py-2.5 px-4 rounded-xl text-xs transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
              title="Delete All Employees"
            >
              <Trash2 className="w-3.5 h-3.5" /> Purge Directory
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsQuickAddOpen(true)}
            className="bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 font-bold py-2.5 px-3.5 rounded-xl text-xs transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
            title="Quickly add 2025 former employees by name only for attendance & 13th month tracking"
          >
            <UserPlus className="w-3.5 h-3.5" /> Quick Add (Name Only / 2025 Staff)
          </button>
          <button
            onClick={openAddModal}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-xl text-sm transition-all shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Add Employee Profile
          </button>
        </div>
      </div>

      {/* Filter and Search Action Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-3.5" />
          <input
            type="text"
            placeholder="Search name, position, or number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-9 pr-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-100"
          />
        </div>

        <div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full text-xs px-3 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none dark:text-zinc-100"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active Only</option>
            <option value="Inactive">Inactive Only</option>
            <option value="Resigned">Resigned Only</option>
          </select>
        </div>
      </div>

      {/* Main Employee Table */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto w-full">
          {filteredEmployees.length === 0 ? (
            <div className="p-12 text-center text-zinc-400">
              <AlertTriangle className="w-12 h-12 mx-auto mb-2 text-zinc-300" />
              <p className="text-sm font-semibold">No employee profiles matched filters.</p>
              <p className="text-xs mt-1">Clear searches or add fresh profiles to seed listing.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-150 dark:border-zinc-800 text-[10px] tracking-wider uppercase font-mono font-bold text-zinc-600 dark:text-zinc-400">
                  <th className="py-3 px-4">EMPLOYEE</th>
                  <th className="py-3 px-4">EMPLOYMENT TYPE</th>
                  <th className="py-3 px-4 text-center">WORK SCHEDULE</th>
                  <th className="py-3 px-4 text-right">MONTHLY SALARY</th>
                  <th className="py-3 px-4 text-center">STATUS</th>
                  <th className="py-3 px-4 text-center">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80 text-xs">
                {filteredEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-zinc-50/55 dark:hover:bg-zinc-900/30 transition-colors">
                    {/* Employee Profile columns */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="relative group/avatar w-10 h-10 shrink-0 rounded-full overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900">
                          <img 
                            src={emp.profilePicture || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"} 
                            className="w-full h-full object-cover transition-transform duration-350 group-hover/avatar:scale-105"
                            alt="avatar" 
                            referrerPolicy="no-referrer"
                          />
                          {/* Direct profile photo instant edit overlay */}
                          <label className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-200 cursor-pointer" title="Update Profile Picture">
                            <Camera className="w-4.5 h-4.5 text-white/90 hover:scale-110 active:scale-95 transition-transform" />
                            <input 
                              type="file" 
                              accept="image/*" 
                              className="hidden" 
                              onChange={(e) => handleDirectPhotoUpload(emp.id, e)}
                            />
                          </label>
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-bold text-zinc-850 dark:text-zinc-50">{emp.fullName}</p>
                            {emp.isAdmin && (
                              <span className="px-1.5 py-0.2 bg-sky-100 dark:bg-sky-950/80 text-[9px] font-extrabold text-sky-700 dark:text-sky-400 rounded-md tracking-wider uppercase font-mono border border-sky-200/50 dark:border-sky-900/60 shrink-0">
                                ADMIN
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-zinc-400 font-mono mt-0.5">{emp.employeeNumber} • {emp.email}</p>
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {emp.birthday ? (
                              <span className="text-[10px] font-mono font-medium text-pink-600 dark:text-pink-400 bg-pink-50 dark:bg-pink-950/20 px-2 py-0.5 rounded border border-pink-200/50 dark:border-pink-800/40 flex items-center gap-1">
                                🎂 {getBirthdayWeekInfo(emp.birthday).birthdayFormatted}
                              </span>
                            ) : (
                              <span className="text-[9px] font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 px-2 py-0.5 rounded border border-amber-200/60 dark:border-amber-800/50 flex items-center gap-1">
                                ⚠️ No Birthday Set
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setQuickBdayEmp(emp);
                                setQuickBdayVal(emp.birthday || "");
                              }}
                              className="text-[9px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                            >
                              {emp.birthday ? "Edit Birthday" : "+ Set Birthday"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono">
                      <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-[10px] font-bold text-zinc-750 dark:text-zinc-300">
                        {emp.employmentType}
                      </span>
                    </td>

                    {/* Assigned Work Schedule */}
                    <td className="py-3.5 px-4 font-mono text-center">
                      {(() => {
                        const sched = getEmployeeSchedule(emp, settings);
                        return (
                          <div className="inline-flex flex-col items-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 ${
                              sched.isOverride
                                ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800"
                                : sched.isRestDay
                                ? "bg-zinc-100 dark:bg-zinc-850 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"
                                : sched.source === "weekly"
                                ? "bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800"
                                : sched.isCustom
                                ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700"
                            }`}>
                              {sched.isOverride ? <Zap className="w-2.5 h-2.5 text-amber-500 fill-amber-500 shrink-0" /> : <Clock className="w-2.5 h-2.5 shrink-0" />}
                              {sched.isRestDay ? "Rest Day" : sched.label}
                            </span>
                            <span className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                              {sched.isOverride ? (
                                <strong className="text-amber-600 dark:text-amber-400 font-semibold">Today's Override • {sched.requiredHours}h</strong>
                              ) : sched.source === "weekly" ? (
                                <span>{(sched.dayOfWeek || "").slice(0,3).toUpperCase()} • {sched.requiredHours}h • {sched.notes}</span>
                              ) : (
                                <span>{sched.requiredHours}h • {sched.notes}</span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => openShiftChangeModal(emp)}
                              className="mt-1 text-[9px] font-sans font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                              title="Change Today's Shift"
                            >
                              <Zap className="w-2.5 h-2.5" /> Shift Change
                            </button>
                          </div>
                        );
                      })()}
                    </td>

                    {/* Basic rate */}
                    <td className="py-3.5 px-4 font-mono text-right font-bold text-zinc-800 dark:text-zinc-200">
                      <div>₱{(emp.salary ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      <span className="block text-[10px] font-normal text-zinc-450 dark:text-zinc-500 font-mono">₱{emp.dailyRate || 0}/day</span>
                      {emp.salaryHistory && emp.salaryHistory.length > 0 && (
                        <div className="mt-1 flex items-center justify-end gap-1">
                          <span 
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/40"
                            title={`Has ${emp.salaryHistory.length} designated salary transition records`}
                          >
                            <TrendingUp className="w-2.5 h-2.5" />
                            {emp.salaryHistory.length} rate tier{emp.salaryHistory.length > 1 ? "s" : ""}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Status badges */}
                    <td className="py-3.5 px-4 text-center">
                      <span className={`px-2 py-0.5 text-[9px] font-bold font-mono tracking-wider rounded-full uppercase ${
                        emp.status === "Active"
                          ? "bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400"
                          : emp.status === "Inactive"
                          ? "bg-yellow-50 dark:bg-yellow-950/20 text-yellow-600 dark:text-yellow-400"
                          : "bg-red-50 dark:bg-red-950/20 text-red-650 dark:text-red-400"
                      }`}>
                        {emp.status}
                      </span>
                    </td>

                    {/* Action buttons list */}
                    <td className="py-3.5 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openShiftChangeModal(emp)}
                          className="p-1 px-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20 border border-amber-300 dark:border-amber-800/40 rounded-lg transition-colors cursor-pointer"
                          title="Real-Time Shift Change / Override Today"
                        >
                          <Zap className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                        </button>
                        <button
                          onClick={() => openEditModal(emp)}
                          className="p-1 px-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-450 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-200 dark:border-zinc-800 cursor-pointer"
                          title="Edit Profile & Schedule"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggleArchiveStatus(emp)}
                          className={`p-1 px-1.5 rounded-lg border transition-colors cursor-pointer ${
                            emp.status === "Active"
                              ? "text-yellow-600 border-yellow-250 hover:bg-yellow-50 dark:border-yellow-900/30"
                              : "text-green-600 border-green-250 hover:bg-green-50 dark:border-green-900/30"
                          }`}
                          title={emp.status === "Active" ? "Set Inactive" : "Set Active"}
                        >
                          {emp.status === "Active" ? <Archive className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => handleDeleteEmployee(emp)}
                          className="p-1 px-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 border border-red-250 dark:border-red-900/30 rounded-lg transition-colors cursor-pointer"
                          title="Delete Employee Permanently"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ADD / EDIT MODAL DRAWER */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 overflow-y-auto flex justify-center p-4 z-55 backdrop-blur-xs transition-colors">
          <div className="my-auto bg-white dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-150 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-zinc-850 dark:text-zinc-50 uppercase tracking-wide">
                  {editEmployee ? `Modify profile: ${editEmployee.fullName}` : "Add New Employee"}
                </h3>
                <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">Fill out core coordinates below</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Employee ID */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">EMPLOYEE NUMBER / ID CODE</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 003"
                    value={employeeNumber}
                    onChange={(e) => setEmployeeNumber(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50 font-mono font-semibold"
                  />
                </div>

                {/* Last Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">LAST NAME</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Vance"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50 font-semibold"
                  />
                </div>

                {/* First Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">FIRST NAME</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Eleanor"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50 font-semibold"
                  />
                </div>

                {/* Middle Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">MIDDLE NAME (OPTIONAL)</label>
                  <input
                    type="text"
                    placeholder="e.g. Hope"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50 font-semibold"
                  />
                </div>

                {/* Email Address */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">EMAIL ADDRESS</label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. eleanor@nova.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50 font-mono"
                  />
                </div>

                {/* Mobile number */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider font-medium">MOBILE NUMBER</label>
                  <input
                    type="text"
                    placeholder="+63 917 555 1234"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">EMPLOYMENT TYPE</label>
                  <select
                    value={employmentType}
                    onChange={(e) => setEmploymentType(e.target.value as any)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none dark:text-zinc-100 font-mono"
                  >
                    <option value="Full-time">Full-time</option>
                    <option value="Part-time">Part-time</option>
                    <option value="Contract">Contract</option>
                    <option value="Intern">Intern</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">DATE HIRED</label>
                  <input
                    type="date"
                    required
                    value={dateHired}
                    onChange={(e) => setDateHired(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider flex items-center justify-between">
                    <span>DATE OF BIRTH / BIRTHDAY</span>
                    <span className="text-pink-600 dark:text-pink-400 font-semibold normal-case">🎂 Required for Birthday Week Leave</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={birthday}
                    onChange={(e) => setBirthday(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50"
                  />
                  {birthday && (() => {
                    const bInfo = getBirthdayWeekInfo(birthday);
                    return bInfo.isValid ? (
                      <p className="text-[10px] text-pink-600 dark:text-pink-400 font-mono">
                        🎂 Birthday Week: Monday {bInfo.weekStartMondayStr} to Friday {bInfo.weekEndFridayStr}
                      </p>
                    ) : null;
                  })()}
                </div>

                <div className="space-y-1 font-medium">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">STATUS</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg outline-none dark:text-zinc-100 font-semibold"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Resigned">Resigned</option>
                  </select>
                  <p className="text-[10px] font-mono leading-tight mt-1 text-zinc-500 dark:text-zinc-400">
                    {status === "Active" && "✓ Active: Employee has full portal, clocking, and account access."}
                    {status === "Inactive" && "🔒 Inactive: Account access locked. Employee cannot log in or clock in."}
                    {status === "Resigned" && "🚫 Resigned: Account permanently revoked and hidden from daily punch cards."}
                  </p>
                </div>
              </div>

              {/* Financial inputs section */}
              <div className="bg-zinc-50 dark:bg-zinc-900/40 p-4 rounded-xl border border-zinc-150 dark:border-zinc-900 space-y-4">
                <h4 className="text-[11px] font-bold text-zinc-650 dark:text-zinc-400 font-mono flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5 text-blue-500" /> COMPENSATION SCALA & RATES
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">MONTHLY SALARY Basic (₱)</label>
                    <input
                      type="number"
                      required
                      value={salary}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setSalary(val);
                        // Standard billing: (Monthly basic salary / 20 days / 8 hours) to ensure extreme precision
                        const autoOt = parseFloat(((val / 20) / 8).toFixed(2));
                        setOtRate(autoOt);
                      }}
                      className="w-full text-xs px-3 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none font-semibold dark:text-zinc-100 font-mono text-right"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">ALLOWANCE PAY (₱)</label>
                    <input
                      type="number"
                      value={allowance}
                      onChange={(e) => setAllowance(parseFloat(e.target.value) || 0)}
                      className="w-full text-xs px-3 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none font-semibold dark:text-zinc-100 font-mono text-right"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">Hourly OT rate (₱)</label>
                    <input
                      type="number"
                      value={otRate}
                      onChange={(e) => setOtRate(parseFloat(e.target.value) || 0)}
                      className="w-full text-xs px-3 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none font-semibold dark:text-zinc-100 font-mono text-right"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-zinc-200/50 dark:border-zinc-800">
                  <span className="text-zinc-500 font-mono font-medium">Calculated Daily Rate:</span>
                  <span className="font-bold text-blue-600 font-mono text-xs">₱{(calculatedDailyRate || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>

                {/* Designated Cutoff Salary Transitions & Rate History */}
                <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 font-mono">
                          DESIGNATED CUTOFF SALARY TRANSITIONS & RATE HISTORY
                        </span>
                        {salaryHistory.length > 0 && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 rounded font-mono font-bold">
                            {salaryHistory.length} Record{salaryHistory.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-0.5 font-sans">
                        Schedule new salary increases starting from a designated cutoff or date. Prior cutoffs and historical months will NOT be changed.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          setNewRateSalary(18000);
                          setNewRateAllowance(allowance);
                          setNewRateEffectiveDate("2025-01-01");
                          setNewRateCutoffName("2025-ANNUAL-BASELINE");
                          setNewRateReason("2025 Baseline Rate (For 2025 13th Month)");
                          setShowAddRateForm(true);
                        }}
                        className="px-2.5 py-1 text-[11px] bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-bold border border-amber-200 dark:border-amber-800 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                        title="Add old 2025 salary record so 2025 13th month calculates with accurate past rate"
                      >
                        <History className="w-3.5 h-3.5" />
                        <span>+ Set 2025 Old Salary</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setNewRateSalary(salary);
                          setNewRateAllowance(allowance);
                          setNewRateEffectiveDate(getBusinessDate());
                          setNewRateCutoffName("");
                          setNewRateReason("Designated Cutoff Salary Adjustment");
                          setShowAddRateForm(!showAddRateForm);
                        }}
                        className="px-2.5 py-1 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{showAddRateForm ? "Close Form" : "New Rate Transition"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Add Rate Transition Sub-form */}
                  {showAddRateForm && (
                    <div className="p-3.5 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 rounded-xl space-y-3 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-900 dark:text-emerald-300 font-mono flex items-center gap-1.5">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          Record Designated Cutoff Salary Rate Change
                        </span>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          Past cutoffs will remain protected
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                            NEW BASIC SALARY (₱)
                          </label>
                          <input
                            type="number"
                            value={newRateSalary}
                            onChange={(e) => setNewRateSalary(parseFloat(e.target.value) || 0)}
                            className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono font-bold text-right"
                            placeholder="e.g. 22000"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                            EFFECTIVE DATE (YYYY-MM-DD)
                          </label>
                          <input
                            type="date"
                            value={newRateEffectiveDate}
                            onChange={(e) => setNewRateEffectiveDate(e.target.value)}
                            className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono font-bold"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                            DESIGNATED CUTOFF / REF
                          </label>
                          <input
                            type="text"
                            value={newRateCutoffName}
                            onChange={(e) => setNewRateCutoffName(e.target.value)}
                            className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono"
                            placeholder="e.g. 2026-04-1ST-CUTOFF"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                            REASON / PURPOSE
                          </label>
                          <input
                            type="text"
                            value={newRateReason}
                            onChange={(e) => setNewRateReason(e.target.value)}
                            className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono"
                            placeholder="e.g. Annual Merit Increase, Promotion, 2025 Baseline"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                            MONTHLY ALLOWANCE (₱)
                          </label>
                          <input
                            type="number"
                            value={newRateAllowance}
                            onChange={(e) => setNewRateAllowance(parseFloat(e.target.value) || 0)}
                            className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono text-right"
                          />
                        </div>
                      </div>

                      {/* Live Calculation preview */}
                      {(() => {
                        const previousRates = salaryHistory.filter(r => r.effectiveDate < newRateEffectiveDate);
                        const prev = previousRates.length > 0 ? previousRates[previousRates.length - 1].salary : salary;
                        const { increaseAmount, increasePercentage } = calculateSalaryIncrease(newRateSalary, prev);
                        const newDaily = parseFloat((newRateSalary / 20).toFixed(2));
                        return (
                          <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-white dark:bg-zinc-900 rounded-lg border border-emerald-100 dark:border-emerald-900/40 text-[11px] font-mono">
                            <div className="flex items-center gap-3">
                              <span>Daily: <strong className="text-zinc-800 dark:text-zinc-200">₱{(newDaily || 0).toLocaleString()}</strong></span>
                              <span>Baseline: <span className="text-zinc-500">₱{(prev || 0).toLocaleString()}</span></span>
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                Increase: +₱{(increaseAmount || 0).toLocaleString()} (+{increasePercentage || 0}%)
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                handleAddSalaryTransition(newRateEffectiveDate === "2025-01-01" && newRateReason.includes("2025"));
                              }}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-md shadow-xs cursor-pointer flex items-center gap-1 text-xs"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Apply Rate Transition
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Salary History Table / Ledger */}
                  {salaryHistory.length === 0 ? (
                    <div className="p-3 bg-zinc-100/70 dark:bg-zinc-900/60 rounded-xl text-center border border-dashed border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500 font-mono">
                      No designated transition records yet. Current baseline ₱{(salary || 0).toLocaleString()} is active for all dates.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 font-mono text-[10px] uppercase">
                          <tr>
                            <th className="px-3 py-2">Effective Date / Cutoff</th>
                            <th className="px-3 py-2 text-right">Monthly Basic</th>
                            <th className="px-3 py-2 text-right">Daily Rate</th>
                            <th className="px-3 py-2">Salary Increase</th>
                            <th className="px-3 py-2">Reason / Details</th>
                            <th className="px-2 py-2 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-mono text-[11px]">
                          {salaryHistory.map((rec) => (
                            <tr key={rec.id || rec.effectiveDate} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                              <td className="px-3 py-2 font-bold text-zinc-900 dark:text-zinc-100">
                                <div>{rec.effectiveDate}</div>
                                {rec.effectiveCutoffPeriodId && (
                                  <div className="text-[9px] text-zinc-500 uppercase">{rec.effectiveCutoffPeriodId}</div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-blue-600 dark:text-blue-400">
                                ₱{(rec.salary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-300">
                                ₱{(rec.dailyRate || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-3 py-2">
                                {(rec.increaseAmount || 0) > 0 ? (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold font-mono text-[10px]">
                                    +₱{(rec.increaseAmount || 0).toLocaleString()} (+{rec.increasePercentage || 0}%)
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-zinc-400">Baseline Rate</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300 font-sans text-xs">
                                {rec.reason || "Scheduled Rate Transition"}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSalaryRecord(rec.id)}
                                  className="p-1 hover:bg-red-50 dark:hover:bg-red-950/40 text-zinc-400 hover:text-red-500 rounded transition-colors cursor-pointer"
                                  title="Remove rate record"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Regular Work Schedule & Shift Timing Panel */}
              <div className="bg-purple-50/50 dark:bg-purple-950/15 p-4 rounded-xl border border-purple-200/70 dark:border-purple-900/40 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-purple-900 dark:text-purple-300 tracking-wide font-mono flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                      WORK SCHEDULE (PER-DAY & SHIFTS)
                    </span>
                    <span className="text-[10px] text-zinc-500 font-sans mt-0.5">
                      Configure custom work hours for each day of the week (Monday to Sunday)
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-1 bg-white dark:bg-zinc-950 p-1 rounded-lg border border-purple-200 dark:border-purple-900/50 shrink-0 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setScheduleType("weekly")}
                      className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded cursor-pointer transition-all ${
                        scheduleType === "weekly"
                          ? "bg-purple-600 text-white shadow-xs"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                      }`}
                    >
                      Weekly (Mon–Sun)
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleType("custom")}
                      className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded cursor-pointer transition-all ${
                        scheduleType === "custom"
                          ? "bg-purple-600 text-white shadow-xs"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                      }`}
                    >
                      Fixed Shift
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setScheduleType("default");
                        setWorkHourStart(settings?.workHourStart || "21:00");
                        setWorkHourEnd(settings?.workHourEnd || "06:00");
                        setRequiredHours(8);
                      }}
                      className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded cursor-pointer transition-all ${
                        scheduleType === "default"
                          ? "bg-purple-600 text-white shadow-xs"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                      }`}
                    >
                      Default
                    </button>
                  </div>
                </div>

                {scheduleType === "weekly" ? (
                  <div className="space-y-3 pt-2 border-t border-dashed border-purple-200 dark:border-purple-900/40">
                    {/* Presets Toolbar */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[10px] font-bold text-purple-900 dark:text-purple-300 font-mono tracking-wider flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-purple-500" />
                          QUICK SCHEDULE TEMPLATES
                        </label>
                        <button
                          type="button"
                          onClick={() => applyPresetToWeekly("copyMonday")}
                          className="text-[9px] font-mono text-purple-700 dark:text-purple-300 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Copy className="w-2.5 h-2.5" /> Copy Mon to Tue–Sat
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
                        <button
                          type="button"
                          onClick={() => applyPresetToWeekly("dstNight")}
                          className="px-2.5 py-2 text-[10px] font-mono rounded-lg border text-left transition-all cursor-pointer bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200"
                        >
                          <div className="font-bold flex items-center gap-1">☀️ DST Shift (10PM–7AM)</div>
                          <div className="text-[9px] text-zinc-500 dark:text-zinc-400">Mon–Sat 10PM–7AM • Break 3AM</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => applyPresetToWeekly("standardNight")}
                          className="px-2.5 py-2 text-[10px] font-mono rounded-lg border text-left transition-all cursor-pointer bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:border-purple-300 text-zinc-700 dark:text-zinc-300"
                        >
                          <div className="font-bold">Standard Night (9PM–6AM)</div>
                          <div className="text-[9px] text-zinc-500 dark:text-zinc-400">Mon–Sat 9PM–6AM • Break 2AM</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => applyPresetToWeekly("standardDay")}
                          className="px-2.5 py-2 text-[10px] font-mono rounded-lg border text-left transition-all cursor-pointer bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:border-purple-300 text-zinc-700 dark:text-zinc-300"
                        >
                          <div className="font-bold">Standard Day (8AM–5PM)</div>
                          <div className="text-[9px] text-zinc-500 dark:text-zinc-400">Mon–Fri 8AM–5PM • Sat-Sun Off</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => applyPresetToWeekly("example")}
                          className="px-2.5 py-2 text-[10px] font-mono rounded-lg border text-left transition-all cursor-pointer bg-white dark:bg-zinc-950 border-purple-250 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/30 text-purple-900 dark:text-purple-200"
                        >
                          <div className="font-bold">Example Mixed Shifts</div>
                          <div className="text-[9px] text-zinc-500 dark:text-zinc-400 truncate">Mon-Tue 11PM • Wed-Sat 9PM</div>
                        </button>
                      </div>
                    </div>

                    {/* 7-Day Table Matrix */}
                    <div className="border border-purple-200 dark:border-purple-900/60 rounded-xl overflow-hidden bg-white dark:bg-zinc-950">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-purple-100/50 dark:bg-purple-950/40 text-[10px] font-mono uppercase text-purple-900 dark:text-purple-300 border-b border-purple-200 dark:border-purple-900/50">
                              <th className="py-2 px-3 font-bold">Day of Week</th>
                              <th className="py-2 px-3 font-bold text-center">Status</th>
                              <th className="py-2 px-3 font-bold">Time In</th>
                              <th className="py-2 px-3 font-bold">Time Out</th>
                              <th className="py-2 px-3 font-bold text-center">Break</th>
                              <th className="py-2 px-3 font-bold text-center">Req Hrs</th>
                              <th className="py-2 px-3 font-bold">Shift Label</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-150 dark:divide-zinc-900">
                            {DAYS_OF_WEEK.map(({ key: dayKey, label: dayLabel }) => {
                              const daySched = weeklySchedule[dayKey] || {
                                day: dayKey,
                                workHourStart: "21:00",
                                workHourEnd: "06:00",
                                breakDurationMinutes: 60,
                                requiredHours: 8,
                                isRestDay: dayKey === "sunday",
                                notes: ""
                              };
                              const isOvernight = (daySched.workHourStart || "21:00") > (daySched.workHourEnd || "06:00");

                              return (
                                <tr key={dayKey} className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors ${daySched.isRestDay ? "bg-zinc-50/60 dark:bg-zinc-900/20" : ""}`}>
                                  <td className="py-2.5 px-3 font-mono font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                                    <div className="flex items-center gap-1.5">
                                      <span>{dayLabel}</span>
                                      {isOvernight && !daySched.isRestDay && (
                                        <span className="text-[8px] bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-1 py-0.2 rounded font-sans uppercase font-bold" title="Crosses Midnight">
                                          Overnight
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => updateDaySchedule(dayKey, "isRestDay", !daySched.isRestDay)}
                                      className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase transition-all cursor-pointer border ${
                                        daySched.isRestDay
                                          ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700"
                                          : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-250 dark:border-emerald-800"
                                      }`}
                                    >
                                      {daySched.isRestDay ? "Rest Day" : "Working"}
                                    </button>
                                  </td>
                                  <td className="py-2 px-3 whitespace-nowrap">
                                    <input
                                      type="time"
                                      disabled={daySched.isRestDay}
                                      value={daySched.workHourStart || "21:00"}
                                      onChange={(e) => updateDaySchedule(dayKey, "workHourStart", e.target.value)}
                                      className="text-xs px-2 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded font-mono font-bold disabled:opacity-30 disabled:bg-transparent"
                                    />
                                    <span className="block text-[9px] font-mono text-purple-600 dark:text-purple-400">
                                      {daySched.isRestDay ? "—" : formatTo12Hour(daySched.workHourStart || "21:00")}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 whitespace-nowrap">
                                    <input
                                      type="time"
                                      disabled={daySched.isRestDay}
                                      value={daySched.workHourEnd || "06:00"}
                                      onChange={(e) => updateDaySchedule(dayKey, "workHourEnd", e.target.value)}
                                      className="text-xs px-2 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded font-mono font-bold disabled:opacity-30 disabled:bg-transparent"
                                    />
                                    <span className="block text-[9px] font-mono text-purple-600 dark:text-purple-400">
                                      {daySched.isRestDay ? "—" : formatTo12Hour(daySched.workHourEnd || "06:00")}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-center whitespace-nowrap">
                                    <input
                                      type="number"
                                      min="0"
                                      max="180"
                                      step="15"
                                      disabled={daySched.isRestDay}
                                      value={daySched.breakDurationMinutes ?? 60}
                                      onChange={(e) => updateDaySchedule(dayKey, "breakDurationMinutes", parseInt(e.target.value) || 0)}
                                      className="w-14 text-xs px-1.5 py-1 text-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded font-mono font-bold disabled:opacity-30"
                                    />
                                    <span className="block text-[8px] text-zinc-400 font-mono">mins</span>
                                  </td>
                                  <td className="py-2 px-3 text-center whitespace-nowrap">
                                    <input
                                      type="number"
                                      min="1"
                                      max="24"
                                      step="0.5"
                                      disabled={daySched.isRestDay}
                                      value={daySched.requiredHours ?? 8}
                                      onChange={(e) => updateDaySchedule(dayKey, "requiredHours", parseFloat(e.target.value) || 8)}
                                      className="w-14 text-xs px-1.5 py-1 text-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded font-mono font-bold disabled:opacity-30"
                                    />
                                    <span className="block text-[8px] text-zinc-400 font-mono">hrs</span>
                                  </td>
                                  <td className="py-2 px-3">
                                    <input
                                      type="text"
                                      disabled={daySched.isRestDay}
                                      placeholder="e.g. Night Shift B"
                                      value={daySched.notes || ""}
                                      onChange={(e) => updateDaySchedule(dayKey, "notes", e.target.value)}
                                      className="w-full min-w-[120px] text-xs px-2 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded text-zinc-800 dark:text-zinc-200 disabled:opacity-30 placeholder:text-zinc-400"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="p-2.5 bg-purple-100/60 dark:bg-purple-950/40 rounded-lg border border-purple-200/70 dark:border-purple-900/50 text-[10px] text-purple-900 dark:text-purple-200 leading-relaxed font-sans">
                      <p className="font-semibold">
                        ✓ Midnight Crossings & Day Isolation: Each day evaluates its own schedule independently. Overtime and lateness will dynamically track the assigned shift for each specific calendar day without spilling into adjacent days.
                      </p>
                    </div>
                  </div>
                ) : scheduleType === "custom" ? (
                  <div className="space-y-3 pt-2 border-t border-dashed border-purple-200 dark:border-purple-900/40">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                          SCHEDULED TIME IN (START)
                        </label>
                        <input
                          type="time"
                          required
                          value={workHourStart}
                          onChange={(e) => setWorkHourStart(e.target.value)}
                          className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-purple-200 dark:border-purple-900 rounded-lg focus:outline-none font-mono font-bold text-zinc-900 dark:text-white"
                        />
                        <span className="text-[9px] font-mono text-purple-600 dark:text-purple-400 block font-semibold">
                          Shift In: {formatTo12Hour(workHourStart)}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                          SCHEDULED TIME OUT (END)
                        </label>
                        <input
                          type="time"
                          required
                          value={workHourEnd}
                          onChange={(e) => setWorkHourEnd(e.target.value)}
                          className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-purple-200 dark:border-purple-900 rounded-lg focus:outline-none font-mono font-bold text-zinc-900 dark:text-white"
                        />
                        <span className="text-[9px] font-mono text-purple-600 dark:text-purple-400 block font-semibold">
                          Shift Out: {formatTo12Hour(workHourEnd)}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                          REQUIRED REGULAR HOURS
                        </label>
                        <input
                          type="number"
                          required
                          step="0.5"
                          min="1"
                          max="24"
                          value={requiredHours}
                          onChange={(e) => setRequiredHours(parseFloat(e.target.value) || 8)}
                          className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-purple-200 dark:border-purple-900 rounded-lg focus:outline-none font-mono font-bold text-zinc-900 dark:text-white"
                        />
                        <span className="text-[9px] font-mono text-zinc-500 block font-semibold">
                          Standard: 8 hours
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                        SHIFT LABEL / REMARKS (OPTIONAL)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Fixed Night Shift"
                        value={scheduleNotes}
                        onChange={(e) => setScheduleNotes(e.target.value)}
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 bg-zinc-100/70 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-600 dark:text-zinc-400 font-sans flex items-center justify-between">
                    <span>Using default company schedule: <strong>{formatTo12Hour(settings?.workHourStart || "21:00")} – {formatTo12Hour(settings?.workHourEnd || "06:00")} (8 hrs)</strong></span>
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-semibold">Default Shift</span>
                  </div>
                )}
              </div>

              {/* Administrative Access Panel */}
              <div className="bg-sky-50/50 dark:bg-sky-950/10 p-4 rounded-xl border border-sky-100 dark:border-sky-900/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-sky-800 dark:text-sky-400 tracking-wide font-mono flex items-center gap-1.5">
                      ADMINISTRATOR POWER GRANT
                      {!isSuperAdmin && (
                        <span className="px-1 text-[8px] tracking-normal font-mono font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 rounded border border-amber-200 dark:border-amber-900">
                          SUPER ADMIN ONLY
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-sans mt-0.5">Toggle to allow this employee to log into the Admin Console</span>
                  </div>
                  <label className={`relative inline-flex items-center select-none ${isSuperAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={isAdmin}
                      onChange={(e) => {
                        if (isSuperAdmin) {
                          setIsAdmin(e.target.checked);
                        }
                      }}
                      disabled={!isSuperAdmin}
                    />
                    <div className="relative w-9 h-5 bg-zinc-300 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500"></div>
                  </label>
                </div>

                <div className="space-y-1.5 animate-fadeIn pt-1 border-t border-dashed border-sky-100 dark:border-sky-900/30">
                  <label className="text-[10px] font-bold text-sky-850 dark:text-sky-400 font-mono tracking-wider">EMPLOYEE PORTAL & ADMIN LOGIN PIN</label>
                  <input
                    type={isSuperAdmin ? "text" : "password"}
                    required
                    maxLength={4}
                    disabled={!isSuperAdmin}
                    placeholder={isSuperAdmin ? "Enter 4-digit PIN (default 1234)" : "••••"}
                    value={isSuperAdmin ? pin : (pin ? "••••" : "")}
                    onChange={(e) => {
                      if (isSuperAdmin) {
                        const digits = e.target.value.replace(/\D/g, "");
                        setPin(digits);
                      }
                    }}
                    className={`w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-sky-200 dark:border-sky-900 rounded-lg focus:outline-none font-mono text-center tracking-widest font-bold text-zinc-900 dark:text-white ${!isSuperAdmin ? 'opacity-70 bg-zinc-50 dark:bg-zinc-900 animate-pulse' : ''}`}
                  />
                  <p className="text-[9px] text-zinc-500 mt-1 font-mono">
                    {isSuperAdmin 
                      ? "Set exactly a 4-digit numeric PIN. New employees default to 1234." 
                      : "Only the Super Admin is authorized to edit or view PIN codes."}
                  </p>
                </div>
              </div>

              {/* Profile Photo upload and URL selection */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">EMPLOYEE PROFILE PHOTO</label>
                <div className="flex items-center gap-4 p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-xl shadow-xs">
                  {profilePicture ? (
                    <div className="relative shrink-0">
                      <img 
                        src={profilePicture} 
                        alt="Employee Photo Preview" 
                        referrerPolicy="no-referrer"
                        className="w-14 h-14 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shadow-sm"
                      />
                      <button 
                        type="button" 
                        onClick={() => setProfilePicture("")}
                        className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-650 text-white rounded-full p-1 leading-none text-[8px] cursor-pointer shadow-sm transition-transform hover:scale-105"
                        title="Remove photo"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-zinc-100 dark:bg-zinc-950 shrink-0 flex items-center justify-center border border-dashed border-zinc-300 dark:border-zinc-800 text-zinc-400 font-bold text-[10px] font-mono">
                      initials
                    </div>
                  )}
                  <div className="flex-1">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-90 w-auto text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-bold cursor-pointer border border-zinc-200 dark:border-zinc-800 shadow-3xs transition-colors">
                      <span className="shrink-0 font-sans">Upload File</span>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handlePhotoUpload}
                      />
                    </label>
                    <p className="text-[9px] text-zinc-500 font-sans mt-1 leading-normal">
                      Click to upload a direct PNG/JPG photo file or paste image URL below. Max size 1.5MB.
                    </p>
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="Or paste direct image URL (e.g. https://images.unsplash.com/...)"
                  value={(profilePicture || "").startsWith("data:image/") ? "" : (profilePicture || "")}
                  onChange={(e) => setProfilePicture(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-50"
                />
              </div>

              {/* Save actions */}
              <div className="pt-4 flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-zinc-900">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 border border-zinc-250 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
                >
                  Discard Changes
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-650 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {saving ? "Saving Record..." : "Confirm Save Information"}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* Real-Time Shift Override Modal */}
      {shiftChangeModalEmployee && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-200 text-zinc-900 dark:text-white">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-zinc-100 dark:border-zinc-900">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
                  <Zap className="w-5 h-5 fill-amber-500" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold uppercase font-mono tracking-wider flex items-center gap-2">
                    Real-Time Shift Change / Override
                  </h3>
                  <p className="text-xs text-zinc-500 font-sans mt-0.5">
                    For <span className="font-bold text-zinc-900 dark:text-zinc-100">{shiftChangeModalEmployee.fullName}</span> ({shiftChangeModalEmployee.employeeNumber})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShiftChangeModalEmployee(null)}
                className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Date Selector & Status */}
            <div className="bg-zinc-50 dark:bg-zinc-900/60 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-zinc-500 font-mono flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> TARGET DATE FOR OVERRIDE
                  </label>
                  <input
                    type="date"
                    value={overrideDate}
                    onChange={(e) => handleOverrideDateChange(e.target.value)}
                    className="text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono font-bold text-zinc-900 dark:text-white"
                  />
                </div>

                <div className="text-right">
                  <span className="text-[9px] font-mono text-zinc-400 uppercase block">Active Rule For This Date</span>
                  {shiftChangeModalEmployee.scheduleOverride?.date === overrideDate ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-800">
                      <Zap className="w-2.5 h-2.5 fill-amber-500" /> Active Override ({shiftChangeModalEmployee.scheduleOverride.workHourStart} – {shiftChangeModalEmployee.scheduleOverride.workHourEnd})
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 rounded border border-purple-200 dark:border-purple-800">
                      <Clock className="w-2.5 h-2.5" /> Normal Weekly Shift
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Shift Form Fields */}
            <div className="space-y-3">
              {/* Working or Rest Day */}
              <div className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-900/40 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div>
                  <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block font-mono">
                    Shift Mode
                  </span>
                  <span className="text-[10px] text-zinc-500 font-sans">
                    {overrideIsRestDay ? "Employee is assigned as OFF / Rest Day for this date" : "Employee has active work shift"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setOverrideIsRestDay(!overrideIsRestDay)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase transition-all border cursor-pointer ${
                    overrideIsRestDay
                      ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700"
                      : "bg-emerald-600 text-white border-emerald-600"
                  }`}
                >
                  {overrideIsRestDay ? "Rest Day" : "Working Day"}
                </button>
              </div>

              {!overrideIsRestDay && (
                <>
                  {/* Quick Shift Presets */}
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider block mb-1">
                      QUICK SHIFT PRESETS
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setOverrideStart("23:00");
                          setOverrideEnd("08:00");
                          setOverrideRequiredHours(8);
                          setOverrideBreakDuration(60);
                          setOverrideReason("11:00 PM – 8:00 AM Shift");
                        }}
                        className={`px-2 py-1.5 text-[10px] font-mono rounded-lg border text-center transition-all cursor-pointer ${
                          overrideStart === "23:00" && overrideEnd === "08:00"
                            ? "bg-amber-100 dark:bg-amber-950/50 border-amber-400 text-amber-900 dark:text-amber-200 font-bold"
                            : "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-amber-300"
                        }`}
                      >
                        11:00 PM – 8:00 AM
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOverrideStart("21:00");
                          setOverrideEnd("06:00");
                          setOverrideRequiredHours(8);
                          setOverrideBreakDuration(60);
                          setOverrideReason("9:00 PM – 6:00 AM Shift");
                        }}
                        className={`px-2 py-1.5 text-[10px] font-mono rounded-lg border text-center transition-all cursor-pointer ${
                          overrideStart === "21:00" && overrideEnd === "06:00"
                            ? "bg-amber-100 dark:bg-amber-950/50 border-amber-400 text-amber-900 dark:text-amber-200 font-bold"
                            : "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-amber-300"
                        }`}
                      >
                        9:00 PM – 6:00 AM
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOverrideStart("08:00");
                          setOverrideEnd("17:00");
                          setOverrideRequiredHours(8);
                          setOverrideBreakDuration(60);
                          setOverrideReason("8:00 AM – 5:00 PM Shift");
                        }}
                        className={`px-2 py-1.5 text-[10px] font-mono rounded-lg border text-center transition-all cursor-pointer ${
                          overrideStart === "08:00" && overrideEnd === "17:00"
                            ? "bg-amber-100 dark:bg-amber-950/50 border-amber-400 text-amber-900 dark:text-amber-200 font-bold"
                            : "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-amber-300"
                        }`}
                      >
                        8:00 AM – 5:00 PM
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOverrideStart("09:00");
                          setOverrideEnd("18:00");
                          setOverrideRequiredHours(8);
                          setOverrideBreakDuration(60);
                          setOverrideReason("9:00 AM – 6:00 PM Shift");
                        }}
                        className={`px-2 py-1.5 text-[10px] font-mono rounded-lg border text-center transition-all cursor-pointer ${
                          overrideStart === "09:00" && overrideEnd === "18:00"
                            ? "bg-amber-100 dark:bg-amber-950/50 border-amber-400 text-amber-900 dark:text-amber-200 font-bold"
                            : "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-amber-300"
                        }`}
                      >
                        9:00 AM – 6:00 PM
                      </button>
                    </div>
                  </div>

                  {/* Shift Timing Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                        TIME IN (START)
                      </label>
                      <input
                        type="time"
                        required
                        value={overrideStart}
                        onChange={(e) => setOverrideStart(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono font-bold text-zinc-900 dark:text-white"
                      />
                      <span className="text-[9px] font-mono text-amber-600 dark:text-amber-400 block font-semibold">
                        {formatTo12Hour(overrideStart)}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                        TIME OUT (END)
                      </label>
                      <input
                        type="time"
                        required
                        value={overrideEnd}
                        onChange={(e) => setOverrideEnd(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono font-bold text-zinc-900 dark:text-white"
                      />
                      <span className="text-[9px] font-mono text-amber-600 dark:text-amber-400 block font-semibold">
                        {formatTo12Hour(overrideEnd)}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                        BREAK DURATION
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max="180"
                          step="15"
                          value={overrideBreakDuration}
                          onChange={(e) => setOverrideBreakDuration(parseInt(e.target.value) || 0)}
                          className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono font-bold text-zinc-900 dark:text-white"
                        />
                        <span className="text-[10px] text-zinc-400 font-mono">min</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                        REQ HOURS
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="1"
                          max="24"
                          step="0.5"
                          value={overrideRequiredHours}
                          onChange={(e) => setOverrideRequiredHours(parseFloat(e.target.value) || 8)}
                          className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono font-bold text-zinc-900 dark:text-white"
                        />
                        <span className="text-[10px] text-zinc-400 font-mono">hrs</span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Override Note/Reason */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 font-mono">
                  REASON / REMARKS FOR SHIFT CHANGE
                </label>
                <input
                  type="text"
                  placeholder="e.g. Client requested 11 PM start, emergency coverage, swap shift"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none text-zinc-900 dark:text-white placeholder:text-zinc-400"
                />
              </div>

              {/* Informative banner */}
              <div className="p-3 bg-amber-50/70 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-900/40 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed font-sans space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                  <Zap className="w-3.5 h-3.5 fill-amber-500 text-amber-500 shrink-0" />
                  Real-Time Application Guarantee
                </div>
                <p>
                  Applying this change immediately recomputes attendance, live portal displays, late penalties, regular hours, and overtime for this day. <strong>The weekly work schedule remains untouched</strong>, and original punch logs are preserved.
                </p>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="pt-3 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-900">
              {shiftChangeModalEmployee.scheduleOverride?.date === overrideDate ? (
                <button
                  type="button"
                  onClick={handleClearShiftOverride}
                  disabled={savingOverride}
                  className="px-3 py-2 border border-red-250 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 text-xs font-mono font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Revert to Weekly Schedule
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShiftChangeModalEmployee(null)}
                  className="px-4 py-2 border border-zinc-250 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 font-semibold rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyShiftOverride}
                  disabled={savingOverride}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5 fill-white" />
                  {savingOverride ? "Applying Shift..." : "Apply Shift Change"}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Custom Confirmation Dialog */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-200 text-zinc-900 dark:text-white">
            <h3 className="text-sm font-extrabold text-amber-500 uppercase tracking-wider font-mono flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 animate-pulse" /> {confirmModal.title}
            </h3>
            <p className="text-xs text-zinc-650 dark:text-zinc-350 leading-relaxed font-sans">
              {confirmModal.message}
            </p>
            {confirmModal.requireCode && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-500 font-mono block">CONFIRMATION CODE REQUIRED</label>
                <input
                  type="text"
                  placeholder={confirmModal.placeholder}
                  value={confirmModal.codeValue || ""}
                  onChange={(e) => setConfirmModal(prev => ({ ...prev, codeValue: e.target.value }))}
                  className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none font-mono uppercase tracking-wider text-zinc-900 dark:text-white"
                />
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2 font-mono">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-white rounded-lg text-sm font-bold shadow-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmModal.onConfirm(confirmModal.codeValue)}
                className="px-4 py-2 bg-red-650 hover:bg-red-700 text-white text-xs font-black uppercase rounded-xl transition-all cursor-pointer shadow-md shadow-red-500/15"
              >
                Confirm
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

      {/* Quick Birthday Modal for Employee Manager */}
      {quickBdayEmp && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-55">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              🎂 Set Birthday: {quickBdayEmp.fullName}
            </h3>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Enter employee's date of birth. This will determine their official <strong>Birthday Week (Monday–Friday)</strong> for Birthday Leave approval.
            </p>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold font-mono text-zinc-500 uppercase">DATE OF BIRTH (YYYY-MM-DD)</label>
              <input
                type="date"
                required
                value={quickBdayVal}
                onChange={(e) => setQuickBdayVal(e.target.value)}
                className="w-full text-sm px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-900 dark:text-white"
              />
            </div>
            {quickBdayVal && (() => {
              const bInfo = getBirthdayWeekInfo(quickBdayVal);
              return bInfo.isValid ? (
                <div className="p-3 rounded-xl bg-pink-50 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-800/60 text-[11px] text-pink-700 dark:text-pink-300 font-mono space-y-0.5">
                  <p><strong>Birthday:</strong> {bInfo.birthdayFormatted}</p>
                  <p><strong>Birthday Week:</strong> Monday {bInfo.weekStartMondayStr} to Friday {bInfo.weekEndFridayStr}</p>
                </div>
              ) : null;
            })()}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setQuickBdayEmp(null);
                  setQuickBdayVal("");
                }}
                className="px-4 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!quickBdayVal || isSavingQuickBday}
                onClick={async () => {
                  if (!quickBdayEmp?.id || !quickBdayVal) return;
                  setIsSavingQuickBday(true);
                  try {
                    await updateDoc(doc(db, "employees", quickBdayEmp.id), { birthday: quickBdayVal });
                    await addDoc(collection(db, "audit_logs"), {
                      user: "Admin",
                      action: "Updated Employee Birthday",
                      details: `Updated birthday for ${quickBdayEmp.fullName} (${quickBdayEmp.employeeNumber}) to ${quickBdayVal}.`,
                      timestamp: new Date().toISOString()
                    });
                    setQuickBdayEmp(null);
                    setQuickBdayVal("");
                    triggerToast(`Birthday saved for ${quickBdayEmp.fullName}`);
                    onRefresh();
                  } catch (err: any) {
                    alert("Failed to save birthday: " + err.message);
                  } finally {
                    setIsSavingQuickBday(false);
                  }
                }}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white shadow-md cursor-pointer"
              >
                {isSavingQuickBday ? "Saving..." : "Save Birthday"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK ADD NAME-ONLY / FORMER STAFF MODAL */}
      {isQuickAddOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-zinc-900 dark:text-zinc-50">
                    Quick Add Staff (Name Only)
                  </h3>
                  <p className="text-[11px] text-zinc-500">
                    Fast profile creation for 2025 historical attendance tracking
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsQuickAddOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleQuickAddSubmit} className="p-6 space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-500 font-mono block mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  placeholder="e.g. Osborn B. Llanes"
                  className="w-full text-xs font-bold px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-zinc-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-zinc-500 font-mono block mb-1">
                    Historical Year
                  </label>
                  <select
                    value={quickYear}
                    onChange={(e) => setQuickYear(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none dark:text-zinc-100 font-mono"
                  >
                    <option value="2024">2024</option>
                    <option value="2025">2025</option>
                    <option value="2026">2026</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-zinc-500 font-mono block mb-1">
                    Monthly Salary (₱)
                  </label>
                  <input
                    type="number"
                    value={quickSalary}
                    onChange={(e) => setQuickSalary(e.target.value)}
                    className="w-full text-xs font-bold px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none dark:text-zinc-100 font-mono text-emerald-600"
                    placeholder="15000"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-500 font-mono block mb-1">
                  Employment Status
                </label>
                <select
                  value={quickStatus}
                  onChange={(e) => setQuickStatus(e.target.value as any)}
                  className="w-full text-xs font-bold px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none dark:text-zinc-100"
                >
                  <option value="Resigned">Former Employee (Resigned) - Hides from daily punch cards</option>
                  <option value="Active">Active Employee - Appears on daily punch cards</option>
                </select>
                <p className="text-[10px] text-zinc-400 mt-1">
                  {quickStatus === "Resigned" 
                    ? "✓ Won't appear on current 2026 daily check-in cards, but 2025 attendance & 13th month calculations work 100%."
                    : "• Will appear on active employee boards."}
                </p>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-zinc-100 dark:border-zinc-850">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingQuick || !quickName.trim()}
                  className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl shadow-md cursor-pointer transition-all"
                >
                  {isSubmittingQuick ? "Creating..." : "Create Profile Instantly"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
