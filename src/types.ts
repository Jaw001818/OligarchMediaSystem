export interface Employee {
  id?: string;
  employeeNumber: string;
  fullName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email: string;
  phone: string;
  department: string;
  position: string;
  birthday: string;
  salary: number;
  dailyRate: number;
  allowance: number;
  otRate: number;
  status: "Active" | "Inactive" | "Resigned";
  profilePicture: string;
  employmentType: "Full-time" | "Part-time" | "Contract" | "Intern";
  dateHired: string;
  isAdmin?: boolean;
  pin?: string;
  updatedAt?: string | number;
  // Individual Work Schedule fields
  scheduleType?: "default" | "custom" | "weekly";
  workHourStart?: string; // e.g. "21:00", "23:00", "08:00"
  workHourEnd?: string;   // e.g. "06:00", "08:00", "17:00"
  requiredHours?: number; // default 8
  scheduleNotes?: string; // e.g. "Night Shift B"
  // Per-Day Weekly Schedule & Real-time Override
  weeklySchedule?: Partial<Record<DayOfWeek, DaySchedule>>;
  scheduleOverride?: ScheduleOverride | null;
  // Salary rate history & designated cutoff transitions
  salaryHistory?: SalaryRateRecord[];
}

export type DayOfWeek = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export interface DaySchedule {
  day: DayOfWeek;
  workHourStart: string; // e.g. "21:00"
  workHourEnd: string;   // e.g. "06:00"
  breakDurationMinutes: number; // default 60
  requiredHours: number; // default 8
  isRestDay: boolean;    // true if rest/off day
  notes?: string;        // optional label or notes
}

export type WeeklySchedule = Record<DayOfWeek, DaySchedule>;

export interface ScheduleOverride {
  date: string; // YYYY-MM-DD
  workHourStart: string;
  workHourEnd: string;
  breakDurationMinutes?: number;
  requiredHours: number;
  isRestDay?: boolean;
  notes?: string;
  reason?: string;
  updatedAt?: string | number;
  updatedBy?: string;
}

export interface EffectiveSchedule {
  workHourStart: string;
  workHourEnd: string;
  requiredHours: number;
  breakDurationMinutes: number;
  isRestDay: boolean;
  isCustom: boolean;
  isOverride: boolean;
  source: "override" | "weekly" | "custom" | "default";
  label: string;
  notes: string;
  date: string;
  dayOfWeek: DayOfWeek;
}

export interface Attendance {
  id?: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  timeIn: string | null; // ISO string or format e.g. "09:04:12"
  breakStart: string | null;
  breakEnd: string | null;
  currentBreakStart?: string | null;
  accumulatedBreakSeconds?: number;
  timeOut: string | null;
  hoursWorked: number;
  lateMinutes: number;
  otHours: number;
  status: "Present" | "Late" | "Absent" | "On Break" | "Timed Out" | "Paid Leave" | "Birthday Leave" | "Absent Notice";
  earlyInApproved?: boolean;
  shiftStart?: string;
  shiftEnd?: string;
  requiredHours?: number;
  companyNightShiftHours?: number; // Company Night-Shift Credit (up to 8h for full night shift, proportional for incomplete)
  statutoryNightDiffHours?: number; // Statutory Art. 86 hours (strictly 10 PM - 6 AM)
  effectiveWorkStart?: string;
  approvedEarlyTime?: string;
  earlyApprovedBy?: string;
  isLateExcused?: boolean;
  lateExcusedBy?: string;
  lateExcuseReason?: string;
  lateExcuseNotes?: string;
  deviceRecordedTime?: string;
  timezone?: string;
  syncStatus?: "SYNCED" | "PENDING_SYNC";
  updatedAt?: number | string;
}

export type RequestType = "Paid Leave" | "Birthday Leave" | "Absent Notice";

export interface LeaveRequest {
  id?: string;
  requestId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  type: RequestType;
  startDate: string;
  endDate: string;
  reason: string;
  attachment?: string;
  status: "Pending" | "Approved" | "Rejected";
  adminNotes: string;
  submittedAt: string;
  trackingNumber: string;
}

export type PayrollStatus = "Draft" | "Released" | "Paid";

export interface Payroll {
  id?: string;
  payrollId: string;
  employeeId: string;
  employeeNumber: string;
  fullName: string;
  department?: string;
  cutoffPeriodId: string;
  basicSalary: number;
  dailyRate: number;
  allowance: number;
  otPay: number;
  nightDiffHours?: number; // Active night diff hours (company credit or statutory based on policy)
  nightDiffPay?: number; // Night diff compensation
  companyNightShiftHours?: number; // Company Night-Shift Policy credit hours (up to 8h)
  companyNightShiftPay?: number; // Company Night-Shift Policy pay
  statutoryNightDiffHours?: number; // Statutory Art. 86 hours (10 PM - 6 AM)
  statutoryNightDiffPay?: number; // Statutory Art. 86 premium pay
  extraDaysPay?: number;
  paidLeavePay: number;
  birthdayLeavePay: number;
  deductions: number;
  absentDeduction: number;
  lateDeduction: number;
  cashAdvanceDeduction: number;
  convertedAbsentDeduction: number;
  convertedAbsences: number;
  remainingLates: number;
  lateCount?: number;
  presentDays?: number;
  actualAbsences?: number;
  workedHours?: number;
  otHours?: number;
  breakHours?: number;
  additionalCashPay?: number; // Boss Debt / Additional Cash addition (+)
  additionalCashNotes?: string;
  allowanceDailyDeduction?: number;
  allowanceAdjustmentMethod?: "Full" | "Removed";
  thirteenthMonthPay?: number;
  finalSalary: number;
  status: PayrollStatus;
  generatedAt: string;
}

export type CashAdvanceStatus = "Pending" | "Active" | "Fully Paid" | "Cancelled";
export type DeductionMethod = "Full" | "Split" | "Manual";

export interface CashAdvance {
  id?: string;
  referenceId: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  remainingBalance: number;
  dateGranted: string;
  status: CashAdvanceStatus;
  deductionMethod: DeductionMethod;
  splitCount?: number | null;
  deductedInPeriodId?: string;
  notes: string;
  history: {
    date: string;
    amount: number;
    periodId: string;
  }[];
  isDeferred?: boolean;
  deferReason?: string;
}

export type BossDebtStatus = "Pending" | "Active" | "Fully Paid" | "Cancelled";
export type BossDebtPayoutMethod = "Full" | "Split" | "Manual";

export interface BossDebt {
  id?: string;
  referenceId: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  remainingBalance: number;
  dateGranted: string;
  status: BossDebtStatus;
  payoutMethod: BossDebtPayoutMethod;
  splitCount?: number | null;
  paidInPeriodId?: string;
  notes: string;
  history: {
    date: string;
    amount: number;
    periodId: string;
    note?: string;
  }[];
  isDeferred?: boolean;
  deferReason?: string;
}

export interface PayrollPeriod {
  id?: string;
  periodId: string;
  name: string;
  startDate: string;
  endDate: string;
  releaseDate: string;
  status: "Open" | "Processing" | "Completed";
  enableNightDiff?: boolean; // Philippine Night Differential / Company Night-Shift Policy
  enableOT125?: boolean; // Philippine 125% Overtime Rate (1.25x hourly rate)
  nightShiftPolicy?: "company_full_shift" | "statutory_only"; // default "company_full_shift" (up to 8h credit for qualifying night shifts)
  nightDiffRate?: number; // default 0.10 (10%)
  otRateMultiplier?: number; // default 1.25 (125%)
}

export interface SystemNotification {
  id?: string;
  title: string;
  message: string;
  type: "Request" | "Attendance" | "System" | "Success" | "Alert";
  read: boolean;
  createdAt: string;
  employeeId?: string;
  leaveRequestId?: string;
  attendanceCopyRequestId?: string;
  downloaded?: boolean;
}

export interface AppSettings {
  companyName: string;
  adminEmail: string;
  workHourStart: string; // e.g. "09:00"
  workHourEnd: string; // e.g. "18:00"
  breakStart?: string; // e.g. "02:00"
  breakEnd?: string; // e.g. "03:00"
  currency: string; // e.g. "$" or "₱"
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpSenderName?: string;
  dstOffset?: number; // e.g. 0, 60 (Spring forward), -60 (Fall back)
  lateToAbsentCount?: number;
  gracePeriodMinutes?: number;
  autoRecalculatePayroll?: boolean;
  enableAutoConvertLate?: boolean;
  enableLateDeduction?: boolean;
  resetLateEveryPayrollCutoff?: boolean;
  defaultAllowancePolicy?: "Full" | "Removed";
  emailProvider?: "brevo" | "smtp" | "google_oauth" | "resend";
  brevoApiKey?: string;
  resendApiKey?: string;
}

export interface AuditLog {
  id?: string;
  user: string;
  action: string;
  details: string;
  timestamp: string;
}

export interface Announcement {
  id?: string;
  title: string;
  message: string;
  createdAt: string;
  sender: string;
  publicationDate?: string;
  mentionedEmployeeIds?: string[];
  mentionedEmployeeNames?: string[];
  isArchived?: boolean;
  reactions?: Record<string, { employeeName: string; emoji: string }>;
}

export interface AttendanceCopyRequest {
  id?: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  reason: string;
  purpose?: string;
  status: "Pending" | "Approved" | "Rejected";
  adminNotes?: string;
  submittedAt: string;
  approvedAt?: string;
  trackingNumber: string;
}

export interface NoWorkDay {
  id?: string;
  date: string; // YYYY-MM-DD
  label: string; // e.g. "Typhoon Suspension", "Office Power Interruption", "Company Non-Working Day"
  notes?: string;
  createdAt?: string;
  createdBy?: string;
}

export interface SalaryRateRecord {
  id?: string;
  effectiveDate: string; // YYYY-MM-DD or cutoff start date
  effectiveCutoffPeriodId?: string; // Optional cutoff ID reference
  salary: number; // Monthly basic salary (₱)
  dailyRate: number; // Daily rate (₱)
  allowance: number; // Monthly allowance (₱)
  otRate: number; // Hourly overtime rate (₱)
  previousSalary?: number; // Pre-increase salary (₱)
  increaseAmount?: number; // salary - previousSalary (₱)
  increasePercentage?: number; // % increase
  reason?: string; // e.g. "2026 Merit Increase", "2025 Baseline Rate", "Promotion"
  notes?: string;
  createdAt?: string;
  createdBy?: string;
}
export interface DevotionSchedule {
  id?: string;
  date: string; // YYYY-MM-DD
  devotionLeaderId?: string;
  devotionLeaderName: string;
  prayerLeaderId?: string;
  prayerLeaderName: string;
  closingPrayerLeaderId?: string;
  closingPrayerLeaderName?: string;
  topic?: string;
  scripture?: string;
  notes?: string;
  imageUrl?: string; // Optional uploaded graphic / schedule flyer
  isAbsent?: boolean; // If main devotion leader is absent
  isPrayerAbsent?: boolean; // If prayer leader is absent
  substituteDevotionLeaderId?: string;
  substituteDevotionLeaderName?: string;
  substitutePrayerLeaderId?: string;
  substitutePrayerLeaderName?: string;
  acknowledgedBy?: string[]; // IDs of employees who acknowledged notification
  status?: "upcoming" | "completed" | "archived";
  cycleDevotionNumber?: number;
  cyclePrayerNumber?: number;
  cycleDevotionCohort?: string[];
  cyclePrayerCohort?: string[];
  completedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface DevotionRotationState {
  id?: string;
  devotionCycleNumber: number;
  devotionCohort: string[];      // Employee names locked into current devotion cycle
  devotionAssigned: string[];    // Employee names who served in this devotion cycle
  prayerCycleNumber: number;
  prayerCohort: string[];        // Employee names locked into current prayer cycle
  prayerAssigned: string[];      // Employee names who served in this prayer cycle
  queuedNewEmployees?: string[]; // Newly added employees awaiting next cycle
  lastMaintainedAt?: string;
  updatedAt?: string;
}

export interface DevotionSettings {
  id?: string;
  scheduleImageUrl?: string;
  scheduleImageTitle?: string;
  uploadedAt?: string;
  uploadedBy?: string;
  meetingTime?: string;
  notes?: string;
}

export interface DeletedRecord {
  id: string;
  originalCollection: string;
  originalId: string;
  title: string;
  subtitle?: string;
  data: any;
  deletedAt: string;
  deletedBy?: string;
}
