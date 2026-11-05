import React, { useState, useEffect, useRef } from "react";
import { 
  db,
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  doc, 
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  deleteDoc
} from "../firebase";
import { LeaveRequest, RequestType, Employee, Payroll, PayrollPeriod, Attendance, SystemNotification, AttendanceCopyRequest, DevotionSchedule, DevotionSettings } from "../types";
import LateTracker from "./LateTracker";
import { 
  FileText, 
  Search, 
  Calendar, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  ArrowRight,
  ShieldAlert,
  Sparkles,
  Paperclip,
  Check,
  UserCheck,
  Download,
  Megaphone,
  CreditCard,
  Eye,
  Info,
  Coffee,
  LogIn,
  LogOut,
  Lock,
  Bell,
  Smartphone,
  X,
  Trash2,
  BookOpen,
  Repeat,
  UserX,
  Image as ImageIcon,
  Upload,
  Heart,
  LayoutGrid,
  List,
  AlertCircle,
  RefreshCw
} from "lucide-react";
import DevotionFlyerCard from "./DevotionFlyerCard";
import EmployeeSearchInput from "./EmployeeSearchInput";
import { jsPDF } from "jspdf";
import { maintainRollingSchedule } from "../utils/devotionScheduler";
import { calculateAttendanceHours, getLiveTimerSeconds, ensureEmployee002Exists, formatTo12Hour, getBusinessDate, getEmployeeSchedule, getBirthdayWeekInfo, getManilaTimeString, getManilaDateString } from "../utils";

// Real-time calculated working hours timer

const getRunningWorkedTime = (
  attendance: Attendance | null,
  currentTime: Date,
  workHourStartStr: string = "22:00",
  workHourEndStr: string = "07:00",
  dstOffset: number = 0,
  defaultBreakStart: string = "03:00",
  defaultBreakEnd: string = "04:00"
) => {
  if (!attendance || !attendance.timeIn) return "00:00:00";
  
  if (attendance.timeOut) {
     const hw = attendance.hoursWorked || 0;
     const totalSecs = Math.round(hw * 3600);
     return formatSeconds(totalSecs);
  }
  
  const currentTimeStr = currentTime.toTimeString().split(" ")[0];
  const secs = getLiveTimerSeconds(
     currentTimeStr,
     attendance.timeIn,
     attendance.breakStart,
     attendance.breakEnd,
     attendance.shiftStart || workHourStartStr,
     attendance.shiftEnd || workHourEndStr,
     attendance.accumulatedBreakSeconds || 0,
     attendance.currentBreakStart || null,
     attendance.earlyInApproved || false,
     attendance.approvedEarlyTime
  );
  
  if (secs <= 0) {
    return "00:00:00";
  }
  return formatSeconds(secs);
};

const formatSeconds = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

interface PortalProps {
  onLoginStateChange?: (isLoggedIn: boolean) => void;
}

export default function Portal({ onLoginStateChange }: PortalProps = {}) {
  const [verifiedEmployee, setVerifiedEmployee] = useState<Employee | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const autoBreakInFlightRef = useRef(false);
  const autoBreakHandledRef = useRef<{ [attId: string]: { started?: boolean; ended?: boolean } }>({});
  const [showBirthdayModal, setShowBirthdayModal] = useState(false);
  const [birthdayInput, setBirthdayInput] = useState("");
  const [isSavingBirthday, setIsSavingBirthday] = useState(false);

  const [activePortalTab, setActivePortalTab] = useState<"login" | "submit" | "track" | "bulletins" | "payslips" | "timetracking" | "notifications" | "devotion">("timetracking");
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loadingBulletins, setLoadingBulletins] = useState(false);
  const [showInstallHelper, setShowInstallHelper] = useState(false);
  const [todayAttendance, setTodayAttendance] = useState<Attendance | null>(null);
  const [fetchingAttendance, setFetchingAttendance] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Devotion & Prayer states
  const [devotionSchedules, setDevotionSchedules] = useState<DevotionSchedule[]>([]);
  const [devotionSettings, setDevotionSettings] = useState<DevotionSettings | null>(null);
  const [showDevotionPopup, setShowDevotionPopup] = useState(false);
  const [assignedDevotionNotice, setAssignedDevotionNotice] = useState<{
    schedule: DevotionSchedule;
    isDevotionLeader: boolean;
    isPrayerLeader: boolean;
    isSubstitute: boolean;
    targetDate: string;
    isTomorrow: boolean;
  } | null>(null);
  const [showPortalSubstituteModal, setShowPortalSubstituteModal] = useState(false);
  const [portalSubstituteTargetRole, setPortalSubstituteTargetRole] = useState<"devotion" | "prayer">("devotion");
  const [portalSubstituteEmployeeId, setPortalSubstituteEmployeeId] = useState("");
  const [portalSubstituteEmployeeName, setPortalSubstituteEmployeeName] = useState("");
  const [portalSubstituteReason, setPortalSubstituteReason] = useState("");
  const [isSubmittingPortalSubstitute, setIsSubmittingPortalSubstitute] = useState(false);
  const [isPortalImageViewerOpen, setIsPortalImageViewerOpen] = useState(false);
  const [portalActiveEmployees, setPortalActiveEmployees] = useState<Employee[]>([]);
  const [portalDevotionView, setPortalDevotionView] = useState<"flyer" | "list">("flyer");

  // Local active date with 12:00 AM midnight roll-over
  const currentLocalDateStr = (() => {
    const y = currentTime.getFullYear();
    const m = String(currentTime.getMonth() + 1).padStart(2, "0");
    const d = String(currentTime.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();

  const nextLocalDateStr = (() => {
    const next = new Date(currentTime);
    next.setDate(next.getDate() + 1);
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
    const y = next.getFullYear();
    const m = String(next.getMonth() + 1).padStart(2, "0");
    const d = String(next.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();

  // Listen to devotion schedules, settings, and active employees
  useEffect(() => {
    const q = query(collection(db, "devotion_schedules"));
    const unsub = onSnapshot(q, (snap) => {
      const rawList: DevotionSchedule[] = [];
      snap.forEach((d) => {
        rawList.push({ ...d.data() as DevotionSchedule, id: d.id });
      });

      // Deduplicate strictly by date
      const dateMap = new Map<string, DevotionSchedule>();
      rawList.forEach((item) => {
        if (!item.date) return;
        if (!dateMap.has(item.date)) {
          dateMap.set(item.date, item);
        } else {
          const existing = dateMap.get(item.date)!;
          if ((item.updatedAt || "") > (existing.updatedAt || "")) {
            dateMap.set(item.date, item);
          }
        }
      });

      const list = Array.from(dateMap.values());
      list.sort((a, b) => a.date.localeCompare(b.date));
      setDevotionSchedules(list);
    }, (err) => console.error("Error listening to devotion schedules:", err));

    const unsubSettings = onSnapshot(doc(db, "devotion_settings", "general"), (snap) => {
      if (snap.exists()) {
        setDevotionSettings(snap.data() as DevotionSettings);
      }
    }, (err) => console.error("Error listening to devotion settings:", err));

    const unsubGenSettings = onSnapshot(doc(db, "settings", "general"), (snap) => {
      if (snap.exists()) {
        setSettings(snap.data());
      }
    }, (err) => console.warn("Error listening to general settings:", err));

    const qEmp = query(collection(db, "employees"), where("status", "==", "Active"));
    const unsubEmp = onSnapshot(qEmp, (snap) => {
      const emps: Employee[] = [];
      snap.forEach((d) => emps.push({ ...d.data() as Employee, id: d.id }));
      setPortalActiveEmployees(emps);
    });

    return () => {
      unsub();
      unsubSettings();
      unsubGenSettings();
      unsubEmp();
    };
  }, []);



  // Check if verified employee is assigned today or tomorrow and trigger auto-popup
  useEffect(() => {
    if (!verifiedEmployee || devotionSchedules.length === 0) return;

    const empId = verifiedEmployee.id || "";
    const empName = verifiedEmployee.fullName.toLowerCase().trim();
    const empNum = verifiedEmployee.employeeNumber.toLowerCase().trim();
    const empEmail = (verifiedEmployee.email || "").toLowerCase().trim();

    const matchesLeader = (id?: string, name?: string) => {
      if (!name && !id) return false;
      if (id && id === empId) return true;
      if (name) {
        const clean = name.toLowerCase().trim();
        if (clean === empName || clean.includes(empName) || empName.includes(clean)) return true;
        if (empNum && (clean === empNum || clean.includes(empNum))) return true;
        // Check if leader name matches first name (e.g., "Daniel", "Roland", "Cedric", "Raicen", "Aaron", "Jericho", "Mark", "Israel", "Rayvel", "Frankie")
        const firstName = empName.split(" ")[0];
        if (firstName && firstName.length >= 2 && (clean === firstName || firstName === clean)) return true;
        // Special mapping for JAO -> Joemarie G. Pangan
        if ((clean === "jao" || clean === "joemarie") && (empName.includes("pangan") || empEmail.includes("jao"))) return true;
        // Check email username prefix
        if (empEmail && (empEmail.startsWith(clean) || clean.startsWith(empEmail.split("@")[0]))) return true;
      }
      return false;
    };

    // 1. Check today's schedule (active starting 12:00 AM)
    const todaySched = devotionSchedules.find((s) => s.date === currentLocalDateStr);
    let matchedAssignment: any = null;

    if (todaySched) {
      const isSubDev = matchesLeader(todaySched.substituteDevotionLeaderId, todaySched.substituteDevotionLeaderName);
      const isOrigDev = !todaySched.isAbsent && matchesLeader(todaySched.devotionLeaderId, todaySched.devotionLeaderName);
      const isSubPray = matchesLeader(todaySched.substitutePrayerLeaderId, todaySched.substitutePrayerLeaderName);
      const isOrigPray = !todaySched.isPrayerAbsent && matchesLeader(todaySched.prayerLeaderId, todaySched.prayerLeaderName);

      if (isSubDev || isOrigDev || isSubPray || isOrigPray) {
        matchedAssignment = {
          schedule: todaySched,
          isDevotionLeader: isSubDev || isOrigDev,
          isPrayerLeader: isSubPray || isOrigPray,
          isSubstitute: isSubDev || isSubPray,
          targetDate: currentLocalDateStr,
          isTomorrow: false
        };
      }
    }

    // 2. If not assigned today, check upcoming shift (tomorrow's schedule) so night shift employees are aware before clocking out
    if (!matchedAssignment) {
      const tomorrowSched = devotionSchedules.find((s) => s.date === nextLocalDateStr);
      if (tomorrowSched) {
        const isSubDev = matchesLeader(tomorrowSched.substituteDevotionLeaderId, tomorrowSched.substituteDevotionLeaderName);
        const isOrigDev = !tomorrowSched.isAbsent && matchesLeader(tomorrowSched.devotionLeaderId, tomorrowSched.devotionLeaderName);
        const isSubPray = matchesLeader(tomorrowSched.substitutePrayerLeaderId, tomorrowSched.substitutePrayerLeaderName);
        const isOrigPray = !tomorrowSched.isPrayerAbsent && matchesLeader(tomorrowSched.prayerLeaderId, tomorrowSched.prayerLeaderName);

        if (isSubDev || isOrigDev || isSubPray || isOrigPray) {
          matchedAssignment = {
            schedule: tomorrowSched,
            isDevotionLeader: isSubDev || isOrigDev,
            isPrayerLeader: isSubPray || isOrigPray,
            isSubstitute: isSubDev || isSubPray,
            targetDate: nextLocalDateStr,
            isTomorrow: true
          };
        }
      }
    }

    if (matchedAssignment) {
      setAssignedDevotionNotice(matchedAssignment);
      const storageKey = `devotion_popup_dismissed_${empId}_${matchedAssignment.targetDate}`;
      const dismissed = sessionStorage.getItem(storageKey);
      if (!dismissed) {
        setShowDevotionPopup(true);
      }
    } else {
      setAssignedDevotionNotice(null);
    }
  }, [verifiedEmployee, devotionSchedules, currentLocalDateStr, nextLocalDateStr]);

  const handlePortalSubmitSubstitute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignedDevotionNotice || !assignedDevotionNotice.schedule.id || !verifiedEmployee) return;
    if (!portalSubstituteEmployeeName.trim()) {
      alert("Please select or enter the substitute leader.");
      return;
    }

    setIsSubmittingPortalSubstitute(true);
    try {
      const schedId = assignedDevotionNotice.schedule.id;
      const updates: any = {
        updatedAt: new Date().toISOString(),
        updatedBy: `${verifiedEmployee.fullName} (Self-Reported Absent)`,
      };

      if (portalSubstituteTargetRole === "devotion") {
        updates.isAbsent = true;
        updates.substituteDevotionLeaderId = portalSubstituteEmployeeId;
        updates.substituteDevotionLeaderName = portalSubstituteEmployeeName.trim();
      } else {
        updates.isPrayerAbsent = true;
        updates.substitutePrayerLeaderId = portalSubstituteEmployeeId;
        updates.substitutePrayerLeaderName = portalSubstituteEmployeeName.trim();
      }

      await updateDoc(doc(db, "devotion_schedules", schedId), updates);

      await addDoc(collection(db, "audit_logs"), {
        user: verifiedEmployee.fullName,
        action: "Employee Swapped Devotion Leader (Absent)",
        details: `${verifiedEmployee.fullName} marked absent for ${portalSubstituteTargetRole.toUpperCase()} on ${assignedDevotionNotice.schedule.date}. Designated substitute: ${portalSubstituteEmployeeName}. Reason: ${portalSubstituteReason || "Not specified"}.`,
        timestamp: new Date().toISOString()
      });

      await addDoc(collection(db, "notifications"), {
        title: "Employee Swapped Devotion Duty",
        message: `${verifiedEmployee.fullName} designated ${portalSubstituteEmployeeName} as substitute for ${portalSubstituteTargetRole === "devotion" ? "Devotion" : "Prayer"} on ${assignedDevotionNotice.schedule.date}. Reason: ${portalSubstituteReason || "Absent"}.`,
        type: "Alert",
        read: false,
        createdAt: new Date().toISOString()
      });

      alert(`Substitute leader assigned successfully! HR and your team will see ${portalSubstituteEmployeeName} on the roster.`);
      setShowPortalSubstituteModal(false);
      setShowDevotionPopup(false);
    } catch (err) {
      console.error("Error submitting substitute:", err);
      alert("Failed to submit substitute. Please try again.");
    } finally {
      setIsSubmittingPortalSubstitute(false);
    }
  };



  // Navigation states





  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    const dismissed = localStorage.getItem('pwa-helper-dismissed') === 'true';
    if (!isStandalone && !dismissed) {
      setShowInstallHelper(true);
    }
  }, []);

  const dismissInstallHelper = () => {
    localStorage.setItem('pwa-helper-dismissed', 'true');
    setShowInstallHelper(false);
  };

  // Time Tracking real-time clock state




  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Safe Auto-Break Engine with strict concurrency locks and dynamic schedule alignment
  useEffect(() => {
    if (!verifiedEmployee || !todayAttendance || !todayAttendance.id || autoBreakInFlightRef.current) return;

    const attId = todayAttendance.id;
    if (!autoBreakHandledRef.current[attId]) {
      autoBreakHandledRef.current[attId] = {};
    }

    // Determine configured break window (defaults dynamically to settings or DST 03:00 - 04:00)
    const breakStartStr = settings?.breakStart || "03:00";
    const breakEndStr = settings?.breakEnd || "04:00";
    const [bStartH, bStartM = 0] = breakStartStr.split(":").map(Number);
    const [bEndH, bEndM = 0] = breakEndStr.split(":").map(Number);

    const currentH = currentTime.getHours();
    const currentM = currentTime.getMinutes();

    // Check if within break window
    const isPastBreakStart = currentH > bStartH || (currentH === bStartH && currentM >= bStartM);
    const isPastBreakEnd = currentH > bEndH || (currentH === bEndH && currentM >= bEndM);

    // Auto-start break when reaching scheduled break start time
    if (
      isPastBreakStart && 
      !isPastBreakEnd && 
      (todayAttendance.status === "Present" || todayAttendance.status === "Late") && 
      !todayAttendance.currentBreakStart &&
      !autoBreakHandledRef.current[attId].started
    ) {
      autoBreakInFlightRef.current = true;
      autoBreakHandledRef.current[attId].started = true;
      const timeStr = `${String(bStartH).padStart(2, "0")}:${String(bStartM).padStart(2, "0")}:00`;
      const docRef = doc(db, "attendance", attId);
      const updateData: any = {
        currentBreakStart: timeStr,
        status: "On Break"
      };
      if (!todayAttendance.breakStart) {
        updateData.breakStart = timeStr;
      }
      updateDoc(docRef, updateData)
        .catch(err => console.warn("Auto break start note:", err))
        .finally(() => {
          autoBreakInFlightRef.current = false;
        });

      addDoc(collection(db, "audit_logs"), {
        user: verifiedEmployee.fullName,
        action: "System Auto Break Start",
        details: `System scheduled break started for ${verifiedEmployee.fullName} at ${timeStr}.`,
        timestamp: new Date().toISOString()
      }).catch(() => {});
      return;
    }

    // Auto-end break when reaching scheduled break end time
    if (
      isPastBreakEnd && 
      currentH < 12 && 
      todayAttendance.status === "On Break" && 
      todayAttendance.currentBreakStart &&
      !autoBreakHandledRef.current[attId].ended
    ) {
      autoBreakInFlightRef.current = true;
      autoBreakHandledRef.current[attId].ended = true;
      const timeStr = `${String(bEndH).padStart(2, "0")}:${String(bEndM).padStart(2, "0")}:00`;
      const docRef = doc(db, "attendance", attId);
      const todayStr = getBusinessDate();

      let diffSecs = 3600;
      try {
        const bStart = new Date(`${todayStr}T${todayAttendance.currentBreakStart}`);
        const bEnd = new Date(`${todayStr}T${timeStr}`);
        if (!isNaN(bStart.getTime()) && !isNaN(bEnd.getTime())) {
          diffSecs = Math.max(0, Math.floor((bEnd.getTime() - bStart.getTime()) / 1000));
        }
      } catch {
        diffSecs = 3600;
      }

      const prevSecs = Number(todayAttendance.accumulatedBreakSeconds) || 0;
      const accumulated = (isNaN(prevSecs) ? 0 : prevSecs) + (isNaN(diffSecs) ? 0 : diffSecs);

      const updateData: any = {
        currentBreakStart: null,
        accumulatedBreakSeconds: accumulated,
        status: todayAttendance.lateMinutes && todayAttendance.lateMinutes > 0 ? "Late" : "Present"
      };
      if (!todayAttendance.breakEnd) {
        updateData.breakEnd = timeStr;
      }

      updateDoc(docRef, updateData)
        .catch(err => console.warn("Auto break end note:", err))
        .finally(() => {
          autoBreakInFlightRef.current = false;
        });

      addDoc(collection(db, "audit_logs"), {
        user: verifiedEmployee.fullName,
        action: "System Auto Break End",
        details: `System scheduled break ended for ${verifiedEmployee.fullName} at ${timeStr}.`,
        timestamp: new Date().toISOString()
      }).catch(() => {});
    }
  }, [currentTime, todayAttendance, verifiedEmployee, settings]);

  const fetchTodayAttendance = async (empId: string) => {
    // Replaced by real-time listener below
  };
  
  useEffect(() => {
    if (!verifiedEmployee || !verifiedEmployee.id) {
      setTodayAttendance(null);
      return;
    }
    
    setFetchingAttendance(true);
    const todayStr = getBusinessDate();
    const q = query(
      collection(db, "attendance"),
      where("employeeId", "==", verifiedEmployee.id),
      where("date", "==", todayStr)
    );
    
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        let found = null;
        snap.forEach((d) => {
          found = { ...d.data(), id: d.id };
        });
        setTodayAttendance(found);
      } else {
        setTodayAttendance(null);
      }
      setFetchingAttendance(false);
    });
    
    return () => unsub();
  }, [verifiedEmployee]);

  // Fetch corporate announcements
  const fetchBulletins = async () => { /* Replaced by listener */ };
  
  useEffect(() => {
    setLoadingBulletins(true);
    const unsub = onSnapshot(collection(db, "announcements"), (snap) => {
      const list = [];
      snap.forEach(d => {
        const data = d.data();
        if (!data.isArchived) {
          list.push({ ...data, id: d.id });
        }
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setAnnouncements(list);
      setLoadingBulletins(false);
    });
    return () => unsub();
  }, []);

  const handleReactToBulletin = async (bulletinId: string, emoji: string) => {
    if (!verifiedEmployee || !verifiedEmployee.id) {
      return;
    }
    try {
      const bulletinRef = doc(db, "announcements", bulletinId);
      const bulletinSnap = await getDoc(bulletinRef);
      if (!bulletinSnap.exists()) return;
      
      const data = bulletinSnap.data();
      const currentReactions = data.reactions || {};
      
      const employeeId = verifiedEmployee.id;
      const employeeName = verifiedEmployee.fullName;
      
      if (currentReactions[employeeId] && currentReactions[employeeId].emoji === emoji) {
        // Toggle off if clicking the same emoji
        delete currentReactions[employeeId];
      } else {
        // Set new or update reaction
        currentReactions[employeeId] = {
          employeeName,
          emoji
        };
      }
      
      await updateDoc(bulletinRef, {
        reactions: currentReactions
      });
      
      await fetchBulletins();
    } catch (err) {
      console.error("Error reacting to announcement:", err);
    }
  };

  useEffect(() => {
    fetchBulletins();
  }, [activePortalTab]);

  // Authentication validation states
  const [employeeNum, setEmployeeNum] = useState("");
  const [portalPin, setPortalPin] = useState("");
  const [showPortalPin, setShowPortalPin] = useState(false);

  const [isChangingPin, setIsChangingPin] = useState(false);
  const [currentPinInput, setCurrentPinInput] = useState("");
  const [newPinInput, setNewPinInput] = useState("");
  const [confirmNewPinInput, setConfirmNewPinInput] = useState("");
  const [pinChangeError, setPinChangeError] = useState("");
  const [pinChangeSuccess, setPinChangeSuccess] = useState("");

  const [isVerifying, setIsVerifying] = useState(false);
  const [authError, setAuthError] = useState("");
  const [existingPaidLeaves, setExistingPaidLeaves] = useState<LeaveRequest[]>([]);

  // Instant Punch Non-Blocking Notification System (replaces all blocking "OK" alerts)
  const [punchToast, setPunchToast] = useState<{
    id: number;
    message: string;
    submessage?: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [isSubmittingPunch, setIsSubmittingPunch] = useState(false);

  const showPunchToast = (message: string, submessage?: string, type: "success" | "error" | "info" = "success") => {
    const id = Date.now();
    setPunchToast({ id, message, submessage, type });
    setTimeout(() => {
      setPunchToast((current) => (current?.id === id ? null : current));
    }, 4500);
  };

  const playPunchChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch {
      // Audio context suppressed
    }
  };

  // Employee notifications state & subscriber
  const [employeeNotifications, setEmployeeNotifications] = useState<SystemNotification[]>([]);
  const [downloadingNotifId, setDownloadingNotifId] = useState<string | null>(null);

  useEffect(() => {
    if (onLoginStateChange) {
      onLoginStateChange(!!verifiedEmployee);
    }
  }, [verifiedEmployee, onLoginStateChange]);

  useEffect(() => {
    if (!verifiedEmployee || !verifiedEmployee.id) {
      setEmployeeNotifications([]);
      return;
    }

    const q = query(
      collection(db, "notifications"),
      where("employeeId", "==", verifiedEmployee.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: SystemNotification[] = [];
      snapshot.forEach((doc) => {
        list.push({ ...doc.data() as SystemNotification, id: doc.id });
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setEmployeeNotifications(list);
    }, (error) => {
      console.error("Error listening to employee notifications:", error);
    });

    return () => unsubscribe();
  }, [verifiedEmployee]);

  // Real-time security guard: automatically disconnect session if employee is deactivated or marked as Resigned
  useEffect(() => {
    if (!verifiedEmployee || !verifiedEmployee.id) return;

    const empRef = doc(db, "employees", verifiedEmployee.id);
    const unsubscribe = onSnapshot(empRef, (snapshot) => {
      if (snapshot.exists()) {
        const currentData = snapshot.data() as Employee;
        const currentStatus = currentData.status || "Active";
        if (currentStatus === "Inactive" || currentStatus === "Resigned" || currentStatus !== "Active") {
          setVerifiedEmployee(null);
          setActivePortalTab("login");
          setAuthError(
            `Access Revoked: Your employee account has been marked as ${currentStatus.toUpperCase()}. You have been automatically logged out.`
          );
        } else {
          // Keep verifiedEmployee state synchronized
          setVerifiedEmployee(prev => prev ? { ...prev, ...currentData } : null);
        }
      } else {
        setVerifiedEmployee(null);
        setActivePortalTab("login");
        setAuthError("Access Revoked: Your employee profile could not be found.");
      }
    }, (error) => {
      console.warn("Real-time employee status watcher error:", error);
    });

    return () => unsubscribe();
  }, [verifiedEmployee?.id]);

  const handleMarkNotificationAsRead = async (notifId: string) => {
    try {
      const docRef = doc(db, "notifications", notifId);
      await updateDoc(docRef, { read: true });
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const handleMarkAllNotificationsAsRead = async () => {
    try {
      const unreadNotifs = employeeNotifications.filter(n => !n.read);
      await Promise.all(
        unreadNotifs.map(n => {
          if (n.id) {
            return updateDoc(doc(db, "notifications", n.id), { read: true });
          }
          return Promise.resolve();
        })
      );
    } catch (err) {
      console.error("Error marking all notifications as read:", err);
    }
  };

  const handleDeleteNotification = async (notifId: string) => {
    try {
      await deleteDoc(doc(db, "notifications", notifId));
    } catch (err) {
      console.error("Error deleting notification:", err);
    }
  };

  // Employee Payroll States
  const [employeePayrolls, setEmployeePayrolls] = useState<Payroll[]>([]);
  const [payrollPeriods, setPayrollPeriods] = useState<PayrollPeriod[]>([]);
  const [loadingPayrolls, setLoadingPayrolls] = useState(false);
  const [selectedPayslipDetails, setSelectedPayslipDetails] = useState<Payroll | null>(null);

  // Admin override early shift start states
  const [showAdminOverrideModal, setShowAdminOverrideModal] = useState(false);
  const [adminOverridePin, setAdminOverridePin] = useState("");
  const [adminOverrideError, setAdminOverrideError] = useState("");
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);

  const handleAdminEarlyInOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!todayAttendance || !todayAttendance.id) return;
    setAdminOverrideError("");
    setIsSubmittingOverride(true);
    try {
      const employeesRef = collection(db, "employees");
      const q = query(employeesRef, where("status", "==", "Active"));
      const snap = await getDocs(q);
      
      let matchedAdmin = false;
      snap.forEach((d) => {
        const emp = d.data() as Employee;
        const matchesAdmin = emp.isAdmin || 
          (emp.position && emp.position.toLowerCase().includes("admin")) || 
          (emp.position && emp.position.toLowerCase().includes("hr manager"));
        
        if (matchesAdmin && emp.pin === adminOverridePin) {
          matchedAdmin = true;
        }
      });

      if (!matchedAdmin) {
        setAdminOverrideError("Invalid Administrator PIN.");
        setIsSubmittingOverride(false);
        return;
      }

      const docRef = doc(db, "attendance", todayAttendance.id);
      await updateDoc(docRef, { earlyInApproved: true });

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin Override",
        action: "Authorized Early-In Shift Start",
        details: `Approved early clock-in timer start for ${todayAttendance.employeeName} on ${todayAttendance.date}.`,
        timestamp: new Date().toISOString()
      });

      showPunchToast("Early-In Authorized!", "The timer will now count from actual time of clock-in.", "success");
      setShowAdminOverrideModal(false);
      setAdminOverridePin("");
      if (verifiedEmployee) {
        await fetchTodayAttendance(verifiedEmployee.id || "");
      }
    } catch (err) {
      console.error(err);
      setAdminOverrideError("An error occurred during verification.");
    } finally {
      setIsSubmittingOverride(false);
    }
  };



  useEffect(() => {
    if (verifiedEmployee && activePortalTab === "timetracking") {
      fetchTodayAttendance(verifiedEmployee.id || "");
    }
  }, [verifiedEmployee, activePortalTab]);

  const currency = settings?.currency || "₱";

  const fetchEmployeePayrolls = async (empId: string, empNumber: string) => { /* Replaced by listener */ };
  
  useEffect(() => {
    if (!verifiedEmployee || !verifiedEmployee.id) {
      setEmployeePayrolls([]);
      setPayrollPeriods([]);
      return;
    }
    
    setLoadingPayrolls(true);
    const qPay = query(collection(db, "payroll"), where("employeeId", "==", verifiedEmployee.id));
    const unsubPay = onSnapshot(qPay, (snap) => {
      const list = [];
      snap.forEach(d => list.push({ ...d.data(), id: d.id }));
      list.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
      setEmployeePayrolls(list);
      setLoadingPayrolls(false);
    });
    
    const unsubPeriods = onSnapshot(collection(db, "payroll_periods"), (snap) => {
      const pList = [];
      snap.forEach(d => pList.push({ ...d.data(), id: d.id }));
      pList.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
      setPayrollPeriods(pList);
    });
    
    return () => { unsubPay(); unsubPeriods(); };
  }, [verifiedEmployee]);

  const downloadPayslipPDF = (pay: Payroll) => {
    const period = payrollPeriods.find(p => p.periodId === pay.cutoffPeriodId);
    const dateRange = period ? `${period.startDate} to ${period.endDate}` : "N/A";
    const releaseDate = period ? period.releaseDate : "N/A";
    
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
    
    doc.setTextColor(248, 250, 252);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text(`PAY PERIOD: ${dateRange}`, 15, 34);
    doc.text(`RELEASE DATE: ${releaseDate}`, 145, 34);

    let yOffset = 52;
    
    // Employee Info Card Box
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
    doc.text(`${pay.fullName || verifiedEmployee?.fullName || "Employee"}`, 20, yOffset + 11);
    doc.text(`${pay.employeeNumber || verifiedEmployee?.employeeNumber || "N/A"}`, 110, yOffset + 11);
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
    const leavesVal = (pay.paidLeavePay || 0) + (pay.birthdayLeavePay || 0);
    const additionalCashVal = pay.additionalCashPay || 0;
    const grossEarnings = baseVal + allowanceVal + otVal + leavesVal + additionalCashVal;
    
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
    if (allowanceVal > 0) printRow("Workspace Allowance / Subsidies", allowanceVal, true);
    if (otVal > 0) printRow("Overtime Shift Premium", otVal, true);
    if (leavesVal > 0) printRow("Paid Leave Credits Redeemed", leavesVal, true);
    if (additionalCashVal > 0) printRow("Boss Repayment / Additional Cash (+)", additionalCashVal, true);
    
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
      doc.text("No deductions logged in this cycle.", 20, yOffset + 5.5);
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
  };

  // 2-Month block leave helpers
  const getTwoMonthBlockLabel = (dateStr: string) => {
    if (!dateStr) return { label: "N/A", index: -1, year: 2026 };
    const d = new Date(dateStr);
    const month = d.getMonth(); // 0-indexed
    const year = d.getFullYear();
    if (month === 0 || month === 1) return { label: "January-February", index: 0, year };
    if (month === 2 || month === 3) return { label: "March-April", index: 1, year };
    if (month === 4 || month === 5) return { label: "May-June", index: 2, year };
    if (month === 6 || month === 7) return { label: "July-August", index: 3, year };
    if (month === 8 || month === 9) return { label: "September-October", index: 4, year };
    return { label: "November-December", index: 5, year };
  };

  const getAccrualMetrics = (dateHiredStr: string, existingLeaves: LeaveRequest[], targetDate: Date = new Date()) => {
    if (!dateHiredStr) return { monthsOfService: 0, accrued: 0, used: 0, balance: 0 };
    const hired = new Date(dateHiredStr);
    const now = new Date();
    
    // Calculate difference in months for overall service
    let months = (now.getFullYear() - hired.getFullYear()) * 12 + (now.getMonth() - hired.getMonth());
    if (now.getDate() < hired.getDate()) {
      months--;
    }
    if (months < 0) months = 0;
    
    // Determine the bimonthly period block of the targetDate
    const targetBlock = getTwoMonthBlockLabel(targetDate.toISOString());
    const targetMonthIndex = targetDate.getMonth();
    const targetYear = targetDate.getFullYear();
    const isSecondMonthOfBlock = targetMonthIndex % 2 === 1;
    
    let accrued = 0;
    const firstMonthOfBlock = isSecondMonthOfBlock ? targetMonthIndex - 1 : targetMonthIndex;
    const firstMonthLimit = new Date(targetYear, firstMonthOfBlock + 1, 0); // End of first month of block
    const secondMonthLimit = new Date(targetYear, targetMonthIndex + 1, 0); // End of current month of block
    
    if (hired <= secondMonthLimit) {
      if (isSecondMonthOfBlock) {
        if (hired <= firstMonthLimit) {
          accrued = 2; // Accrued 1 day for first month + 1 day for second month
        } else {
          accrued = 1; // Hired in the second month of the block, so only 1 day accrued
        }
      } else {
        accrued = 1; // In the first month of the block, so 1 day accrued
      }
    }
    
    // Filter used leaves whose dates fall within the target bimonthly block
    const used = existingLeaves.filter((req) => {
      if (req.type !== "Paid Leave" || req.status === "Rejected") return false;
      const leaveDate = req.startDate;
      if (!leaveDate) return false;
      const leaveBlock = getTwoMonthBlockLabel(leaveDate);
      return leaveBlock.label === targetBlock.label && leaveBlock.year === targetBlock.year;
    }).length;
    
    const balance = accrued - used;
    return {
      monthsOfService: months,
      accrued,
      used,
      balance: Math.max(0, balance)
    };
  };

  const fetchEmployeeLeaves = async (empId: string) => { /* Replaced by listener */ };
  
  useEffect(() => {
    if (!verifiedEmployee || !verifiedEmployee.id) {
      setExistingPaidLeaves([]);
      return;
    }
    const q = query(collection(db, "leave_requests"), where("employeeId", "==", verifiedEmployee.id));
    const unsub = onSnapshot(q, (snap) => {
      const list = [];
      snap.forEach(d => list.push({ ...d.data(), id: d.id }));
      list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      setExistingPaidLeaves(list);
    });
    return () => unsub();
  }, [verifiedEmployee]);

  // Leave Submit Form States
  const [requestType, setRequestType] = useState<RequestType>("Paid Leave");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [singleDate, setSingleDate] = useState("");
  const [reason, setReason] = useState("");
  const [attachment, setAttachment] = useState(""); // URL or textual upload note
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<LeaveRequest | null>(null);

  // Attendance Copy Request States
  const [submitTabType, setSubmitTabType] = useState<"leave" | "attendance_copy">("leave");
  const [attCopyStartDate, setAttCopyStartDate] = useState("");
  const [attCopyEndDate, setAttCopyEndDate] = useState("");
  const [attCopyReason, setAttCopyReason] = useState("");
  const [attCopySuccess, setAttCopySuccess] = useState<AttendanceCopyRequest | null>(null);

  // Status Track Query state
  const [trackNumber, setTrackNumber] = useState("");
  const [trackedRequests, setTrackedRequests] = useState<LeaveRequest[]>([]);
  const [trackedAttRequests, setTrackedAttRequests] = useState<AttendanceCopyRequest[]>([]);
  const [isTracking, setIsTracking] = useState(false);
  const [trackResultMsg, setTrackResultMsg] = useState("");

  // Generate downloadable corporate PDF
  const downloadPDF = (req: LeaveRequest) => {
    const doc = new jsPDF();
    
    // Header Style Banner (Slate 900)
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 42, "F");
    
    // Header Content
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("OLIGARCH MEDIA", 20, 26);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(147, 197, 253); // blue-300
    doc.text("OFFICIAL LEAVE & REQUEST VOUCHER", 125, 26);
    
    // Border surrounding details box
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252); // slate-50
    doc.rect(15, 52, 180, 102, "FD");
    
    // Heading Inside Box
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("REQUEST SPECIFICATIONS & DISPATCH STATUS", 23, 65);
    
    // Specifications
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Reference Number ID:", 25, 78);
    doc.setFont("helvetica", "normal");
    doc.text(`${req.requestId || "N/A"}`, 85, 78);
    
    doc.setFont("helvetica", "bold");
    doc.text("Tracking Code Number:", 25, 86);
    doc.setFont("helvetica", "normal");
    doc.text(`${req.trackingNumber || "N/A"}`, 85, 86);
    
    doc.setFont("helvetica", "bold");
    doc.text("Current Progress Status:", 25, 94);
    if (req.status === "Approved") {
      doc.setTextColor(22, 163, 74); // green-600
      doc.setFont("helvetica", "bold");
      doc.text("APPROVED & REGISTERED", 85, 94);
    } else if (req.status === "Rejected") {
      doc.setTextColor(220, 38, 38); // red-600
      doc.setFont("helvetica", "bold");
      doc.text("DISAPPROVED / REJECTED", 85, 94);
    } else {
      doc.setTextColor(217, 119, 6); // amber-600
      doc.setFont("helvetica", "bold");
      doc.text("PENDING REVIEW (SUBMITTED)", 85, 94);
    }
    
    // Rest of fields
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.text("Employee Name:", 25, 104);
    doc.setFont("helvetica", "normal");
    doc.text(`${req.employeeName}`, 85, 104);
    
    doc.setFont("helvetica", "bold");
    doc.text("Employee Number:", 25, 112);
    doc.setFont("helvetica", "normal");
    doc.text(`${req.employeeNumber}`, 85, 112);
    
    doc.setFont("helvetica", "bold");
    doc.text("Request Type:", 25, 120);
    doc.setFont("helvetica", "normal");
    doc.text(`${req.type}`, 85, 120);
    
    doc.setFont("helvetica", "bold");
    doc.text("Leave Duration Period:", 25, 128);
    doc.setFont("helvetica", "normal");
    const dates = req.type === "Paid Leave" ? `${req.startDate} to ${req.endDate}` : req.startDate;
    doc.text(`${dates}`, 85, 128);
    
    doc.setFont("helvetica", "bold");
    doc.text("Submission Date Log:", 25, 136);
    doc.setFont("helvetica", "normal");
    doc.text(req.submittedAt ? `${new Date(req.submittedAt).toLocaleString()}` : "N/A", 85, 136);
    
    // Message Description Box
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(255, 255, 255);
    doc.rect(15, 164, 180, 52, "FD");
    
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.text("Stated Reason / Support Log:", 23, 174);
    
    doc.setFont("helvetica", "italic");
    doc.setTextColor(71, 85, 105); // slate-600
    const splitReason = doc.splitTextToSize(req.reason || "No detail specified.", 164);
    doc.text(splitReason, 25, 182);

    // If there is Administrator Feedback
    if (req.adminNotes) {
      doc.setFillColor(254, 243, 199); // amber-100
      doc.setDrawColor(251, 191, 36); // amber-400
      doc.rect(15, 224, 180, 24, "FD");
      
      doc.setTextColor(180, 83, 9); // amber-800
      doc.setFont("helvetica", "bold");
      doc.text("HR Administrator Evaluation Notes:", 23, 232);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 53, 4);
      const splitNotes = doc.splitTextToSize(req.adminNotes, 164);
      doc.text(splitNotes, 25, 240);
    }
    
    // Bottom Legal Footer
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // slate-400
    const buildDate = new Date().toLocaleString();
    doc.text(`Voucher document generated on: ${buildDate}`, 20, 276);
    doc.text("Copyright © Oligarch Media. All rights reserved. This voucher is valid and tamper-checked.", 20, 281);
    
    doc.save(`Request_Voucher_${req.trackingNumber || req.requestId}.pdf`);
  };

  const handlePortalTimeIn = async () => {
    if (!verifiedEmployee || isSubmittingPunch) return;
    const empStatus = verifiedEmployee.status || "Active";
    if (empStatus === "Inactive" || empStatus === "Resigned" || empStatus !== "Active") {
      showPunchToast(`Access denied. Employee account is ${empStatus.toUpperCase()}.`, undefined, "error");
      setVerifiedEmployee(null);
      setActivePortalTab("login");
      return;
    }
    if (todayAttendance && todayAttendance.timeIn) {
      showPunchToast("Already Clocked In", `Shift started at ${formatTo12Hour(todayAttendance.timeIn)}`, "info");
      return;
    }

    try {
      setIsSubmittingPunch(true);
      const todayStr = getBusinessDate();
      const timeStr = getManilaTimeString();
      const docId = `${verifiedEmployee.id}_${todayStr}`;

      const empSched = getEmployeeSchedule(verifiedEmployee, settings);
      const workHourStart = empSched.workHourStart;
      const workHourEnd = empSched.workHourEnd;
      const requiredHours = empSched.requiredHours;
      const dstOffset = settings?.dstOffset || 0;

      const math = calculateAttendanceHours(
        timeStr,
        null,
        null,
        null,
        workHourStart,
        workHourEnd,
        dstOffset,
        0, null, false, settings?.gracePeriodMinutes || 0,
        false,
        undefined,
        requiredHours
      );

      const isOnline = navigator.onLine;
      const payload: Omit<Attendance, "id"> = {
        employeeId: verifiedEmployee.id || "",
        employeeNumber: verifiedEmployee.employeeNumber,
        employeeName: verifiedEmployee.fullName,
        date: todayStr,
        timeIn: timeStr,
        deviceRecordedTime: timeStr,
        timezone: "Asia/Manila",
        syncStatus: isOnline ? "SYNCED" : "PENDING_SYNC",
        breakStart: null,
        breakEnd: null,
        timeOut: null,
        hoursWorked: 0,
        lateMinutes: math.lateMinutes,
        otHours: 0,
        status: math.lateMinutes > 0 ? "Late" : "Present",
        shiftStart: workHourStart,
        shiftEnd: workHourEnd,
        requiredHours: requiredHours
      };

      // 1. Instant optimistic local update - UI reflects punch immediately without lag
      const optimisticDoc: Attendance = { id: docId, ...payload };
      setTodayAttendance(optimisticDoc);

      // 2. Immediate audio feedback & sleek non-blocking notification (Zero "OK" buttons!)
      playPunchChime();
      showPunchToast(
        isOnline ? `✓ Clock In Recorded: ${formatTo12Hour(timeStr)}` : `⏱ Clock In (Offline): ${formatTo12Hour(timeStr)}`,
        isOnline 
          ? `Accurately logged in real-time (${payload.status}). Synced with Cloud.`
          : `Saved locally (Pending Sync). Will automatically sync to Cloud when connected.`,
        isOnline ? "success" : "info"
      );

      // 3. Persist to Firestore
      await setDoc(doc(db, "attendance", docId), payload, { merge: true });

      // 4. Fire-and-forget background logging (never blocks attendance)
      addDoc(collection(db, "audit_logs"), {
        user: verifiedEmployee.fullName,
        action: "Employee Clocks In",
        details: `${verifiedEmployee.fullName} (${verifiedEmployee.employeeNumber}) clocked in via Media Hub at ${timeStr}.`,
        timestamp: new Date().toISOString()
      }).catch(err => console.warn("Audit log note:", err));

      addDoc(collection(db, "notifications"), {
        title: "Employee Clock In",
        message: `${verifiedEmployee.fullName} has clocked in at ${timeStr}.`,
        type: "Attendance",
        read: false,
        createdAt: new Date().toISOString()
      }).catch(err => console.warn("Notification note:", err));
    } catch (err) {
      console.error("Error logging Time In:", err);
      showPunchToast("Could not record Clock In", "Please check your network connection and retry.", "error");
    } finally {
      setIsSubmittingPunch(false);
    }
  };

  const handlePortalStartBreak = async () => {
    if (!verifiedEmployee || !todayAttendance || !todayAttendance.id || isSubmittingPunch) return;
    const empStatus = verifiedEmployee.status || "Active";
    if (empStatus === "Inactive" || empStatus === "Resigned" || empStatus !== "Active") {
      showPunchToast(`Access denied. Employee account is ${empStatus.toUpperCase()}.`, undefined, "error");
      setVerifiedEmployee(null);
      setActivePortalTab("login");
      return;
    }
    try {
      setIsSubmittingPunch(true);
      const timeStr = getManilaTimeString();
      const docRef = doc(db, "attendance", todayAttendance.id);
      
      const updateData: any = {
        currentBreakStart: timeStr,
        status: "On Break"
      };
      
      if (!todayAttendance.breakStart) {
        updateData.breakStart = timeStr;
      }
      
      // Optimistic update
      setTodayAttendance(prev => prev ? ({ ...prev, ...updateData }) : null);

      playPunchChime();
      showPunchToast(`☕ Rest Break Started: ${formatTo12Hour(timeStr)}`, "Enjoy your rest break!", "info");

      await updateDoc(docRef, updateData);

      addDoc(collection(db, "audit_logs"), {
        user: verifiedEmployee.fullName,
        action: "Employee Starts Break",
        details: `${verifiedEmployee.fullName} started their rest break at ${timeStr}.`,
        timestamp: new Date().toISOString()
      }).catch(err => console.warn("Audit log note:", err));
    } catch (err) {
      console.error("Error starting break:", err);
      showPunchToast("Failed to start break", "Please try again.", "error");
    } finally {
      setIsSubmittingPunch(false);
    }
  };

  const handlePortalEndBreak = async () => {
    if (!verifiedEmployee || !todayAttendance || !todayAttendance.id || isSubmittingPunch) return;
    const empStatus = verifiedEmployee.status || "Active";
    if (empStatus === "Inactive" || empStatus === "Resigned" || empStatus !== "Active") {
      showPunchToast(`Access denied. Employee account is ${empStatus.toUpperCase()}.`, undefined, "error");
      setVerifiedEmployee(null);
      setActivePortalTab("login");
      return;
    }
    try {
      setIsSubmittingPunch(true);
      const timeStr = getManilaTimeString();
      const docRef = doc(db, "attendance", todayAttendance.id);
      const isLateCheck = todayAttendance.lateMinutes && todayAttendance.lateMinutes > 0;
      
      const updateData: any = {
        currentBreakStart: null,
        status: isLateCheck ? "Late" : "Present"
      };

      if (!todayAttendance.breakEnd) {
        updateData.breakEnd = timeStr;
      }
      
      // Calculate duration of the current break
      const parseTimeToMinutes = (tStr: string) => {
        if (typeof tStr !== 'string') return 0;
        const parts = tStr.split(":").map(Number);
        const h = parts[0] || 0;
        const m = parts[1] || 0;
        const s = parts[2] || 0;
        return h * 60 + m + s / 60;
      };
      const breakStartStr = todayAttendance.currentBreakStart || todayAttendance.breakStart;
      if (breakStartStr) {
        let startMins = parseTimeToMinutes(breakStartStr);
        let endMins = parseTimeToMinutes(timeStr);
        if (endMins < startMins) endMins += 1440; // Next day
        const breakSecs = Math.round((endMins - startMins) * 60);
        updateData.accumulatedBreakSeconds = (todayAttendance.accumulatedBreakSeconds || 0) + breakSecs;
      }

      // Optimistic update
      setTodayAttendance(prev => prev ? ({ ...prev, ...updateData }) : null);

      playPunchChime();
      showPunchToast(`💼 Break Ended: ${formatTo12Hour(timeStr)}`, "Welcome back to your shift!", "success");

      await updateDoc(docRef, updateData);

      addDoc(collection(db, "audit_logs"), {
        user: verifiedEmployee.fullName,
        action: "Employee Ends Break",
        details: `${verifiedEmployee.fullName} ended their rest break at ${timeStr}.`,
        timestamp: new Date().toISOString()
      }).catch(err => console.warn("Audit log note:", err));
    } catch (err) {
      console.error("Error ending break:", err);
      showPunchToast("Failed to end break", "Please try again.", "error");
    } finally {
      setIsSubmittingPunch(false);
    }
  };

  const handlePortalTimeOut = async () => {
    if (!verifiedEmployee || !todayAttendance || !todayAttendance.id || isSubmittingPunch) return;
    const empStatus = verifiedEmployee.status || "Active";
    if (empStatus === "Inactive" || empStatus === "Resigned" || empStatus !== "Active") {
      showPunchToast(`Access denied. Employee account is ${empStatus.toUpperCase()}.`, undefined, "error");
      setVerifiedEmployee(null);
      setActivePortalTab("login");
      return;
    }
    try {
      setIsSubmittingPunch(true);
      const timeOutStr = getManilaTimeString();
      
      const empSched = getEmployeeSchedule(verifiedEmployee, settings);
      const workHourStart = todayAttendance.shiftStart || empSched.workHourStart;
      const workHourEnd = todayAttendance.shiftEnd || empSched.workHourEnd;
      const requiredHours = todayAttendance.requiredHours || empSched.requiredHours;
      const dstOffset = settings?.dstOffset || 0;

      const math = calculateAttendanceHours(
        todayAttendance.timeIn,
        todayAttendance.breakStart || settings?.breakStart || "02:00",
        todayAttendance.breakEnd || settings?.breakEnd || "03:00",
        timeOutStr,
        workHourStart,
        workHourEnd,
        dstOffset,
        todayAttendance.accumulatedBreakSeconds || 0,
        todayAttendance.currentBreakStart || null,
        todayAttendance.earlyInApproved || false,
        settings?.gracePeriodMinutes || 0,
        todayAttendance.isLateExcused || false,
        todayAttendance.approvedEarlyTime,
        requiredHours
      );

      const isOnline = navigator.onLine;
      const updatePayload: Partial<Attendance> = {
        timeOut: timeOutStr,
        hoursWorked: math.hoursWorked,
        otHours: math.otHours,
        status: "Timed Out",
        shiftStart: workHourStart,
        shiftEnd: workHourEnd,
        requiredHours: requiredHours,
        timezone: "Asia/Manila",
        syncStatus: isOnline ? "SYNCED" : "PENDING_SYNC",
        updatedAt: Date.now()
      };

      // 1. Instant optimistic update
      setTodayAttendance(prev => prev ? ({ ...prev, ...updatePayload }) : null);

      // 2. Audio feedback & instant toast (Zero "OK" buttons required)
      playPunchChime();
      showPunchToast(
        isOnline ? `✓ Clock Out Recorded: ${formatTo12Hour(timeOutStr)}` : `⏱ Clock Out (Offline): ${formatTo12Hour(timeOutStr)}`,
        isOnline 
          ? `Shift Completed: ${math.hoursWorked} hrs logged${math.otHours > 0 ? ` (+${math.otHours}h OT)` : ""}. Synced with Cloud.`
          : `Saved locally (Pending Sync). Will automatically sync to Cloud when connected.`,
        isOnline ? "success" : "info"
      );

      // 3. Persist to Firestore
      const docRef = doc(db, "attendance", todayAttendance.id);
      await updateDoc(docRef, updatePayload);

      // 4. Background auxiliary logs
      addDoc(collection(db, "audit_logs"), {
        user: verifiedEmployee.fullName,
        action: "Employee Clocks Out",
        details: `${verifiedEmployee.fullName} clocked out at ${timeOutStr}. Hours worked: ${math.hoursWorked}, Overtime: ${math.otHours}.`,
        timestamp: new Date().toISOString()
      }).catch(err => console.warn("Audit log note:", err));

      addDoc(collection(db, "notifications"), {
        title: "Employee Clock Out",
        message: `${verifiedEmployee.fullName} clocked out at ${timeOutStr}.`,
        type: "Attendance",
        read: false,
        createdAt: new Date().toISOString()
      }).catch(err => console.warn("Notification note:", err));
    } catch (err) {
      console.error("Error logging Time Out:", err);
      showPunchToast("Could not record Clock Out", "Please check your network connection and retry.", "error");
    } finally {
      setIsSubmittingPunch(false);
    }
  };

  // Verification step handler
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setVerifiedEmployee(null);
    setSubmitSuccess(null);
    setIsVerifying(true);

    try {
      let cleanNum = employeeNum.trim().toUpperCase();
      if (cleanNum.startsWith("EMP-")) {
        cleanNum = cleanNum.substring(4);
      }

      const q = query(
        collection(db, "employees"),
        where("employeeNumber", "==", cleanNum)
      );
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setAuthError("No employee profile found with this Employee Number.");
        setIsVerifying(false);
        return;
      }

      let matchedEmp: Employee | null = null;
      snapshot.forEach((d) => {
        const data = d.data() as Employee;
        matchedEmp = { ...data, id: d.id };
      });

      if (!matchedEmp) {
        setAuthError("Verification failed. Profile matching this Employee Number could not be loaded.");
      } else {
        const emp: Employee = matchedEmp;

        // Strict Status Check: Inactive or Resigned employees CANNOT access account
        const status = emp.status || "Active";
        if (status === "Inactive") {
          setAuthError(`Access Denied: Account for ${emp.fullName} is currently marked as INACTIVE. Please contact HR or Management to reactivate your access.`);
          setIsVerifying(false);
          return;
        }

        if (status === "Resigned") {
          setAuthError(`Access Denied: Account for ${emp.fullName} is recorded as RESIGNED. Former employees no longer have access to employee portal accounts.`);
          setIsVerifying(false);
          return;
        }

        if (status !== "Active") {
          setAuthError(`Access Denied: Account for ${emp.fullName} is marked as "${status}". Only Active employees can access the portal.`);
          setIsVerifying(false);
          return;
        }
        
        // Validate 4-digit PIN (default is "1234" if empty or not set)
        const enteredPin = portalPin.trim();
        if (!enteredPin) {
          setAuthError("Please enter your 4-digit PIN.");
          setIsVerifying(false);
          return;
        }
        if (!/^\d{4}$/.test(enteredPin)) {
          setAuthError("PIN must be exactly 4 digits.");
          setIsVerifying(false);
          return;
        }

        const savedPin = emp.pin ? emp.pin.trim() : "1234";
        if (enteredPin !== savedPin) {
          setAuthError("Incorrect PIN. New employees default to 1234.");
          setIsVerifying(false);
          return;
        }

        setVerifiedEmployee(emp);
        if (activePortalTab === "login") {
          setActivePortalTab("timetracking");
        }
        await Promise.all([
          fetchEmployeeLeaves(emp.id || ""),
          fetchEmployeePayrolls(emp.id || "", emp.employeeNumber || ""),
          fetchTodayAttendance(emp.id || "")
        ]);
        
        // Reset PIN field after successful login
        setPortalPin("");
      }
    } catch (err) {
      console.error(err);
      setAuthError("Server verification error. Please retry later.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinChangeError("");
    setPinChangeSuccess("");

    if (!verifiedEmployee || !verifiedEmployee.id) return;
    const empStatus = verifiedEmployee.status || "Active";
    if (empStatus === "Inactive" || empStatus === "Resigned" || empStatus !== "Active") {
      setPinChangeError(`Access denied. Your employee account is marked as ${empStatus.toUpperCase()}.`);
      setVerifiedEmployee(null);
      setActivePortalTab("login");
      return;
    }

    const savedPin = verifiedEmployee.pin ? verifiedEmployee.pin.trim() : "1234";
    if (currentPinInput.trim() !== savedPin) {
      setPinChangeError("The current PIN you entered is incorrect.");
      return;
    }

    const newPinClean = newPinInput.trim();
    if (!/^\d{4}$/.test(newPinClean)) {
      setPinChangeError("New PIN must be exactly 4 digits.");
      return;
    }

    if (newPinClean === "1234") {
      setPinChangeError("Please choose a PIN other than the default '1234' for better security.");
      return;
    }

    if (newPinClean !== confirmNewPinInput.trim()) {
      setPinChangeError("New PIN and confirmation PIN do not match.");
      return;
    }

    try {
      const docRef = doc(db, "employees", verifiedEmployee.id);
      await updateDoc(docRef, { pin: newPinClean });

      // Log in audit log
      await addDoc(collection(db, "audit_logs"), {
        user: verifiedEmployee.fullName,
        action: "Employee Changes PIN",
        details: `${verifiedEmployee.fullName} (${verifiedEmployee.employeeNumber}) changed their Employee Portal 4-digit PIN passcode.`,
        timestamp: new Date().toISOString()
      });

      // Update local state
      setVerifiedEmployee(prev => prev ? { ...prev, pin: newPinClean } : null);
      
      setPinChangeSuccess("Your 4-digit PIN was successfully updated!");
      setCurrentPinInput("");
      setNewPinInput("");
      setConfirmNewPinInput("");
      
      setTimeout(() => {
        setIsChangingPin(false);
        setPinChangeSuccess("");
      }, 3000);
    } catch (err) {
      console.error("Error changing PIN:", err);
      setPinChangeError("Failed to update PIN in database. Please try again.");
    }
  };

  // Submit Leave Request
  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifiedEmployee) return;
    const empStatus = verifiedEmployee.status || "Active";
    if (empStatus === "Inactive" || empStatus === "Resigned" || empStatus !== "Active") {
      alert(`Access denied. Your employee account is marked as ${empStatus.toUpperCase()}.`);
      setVerifiedEmployee(null);
      setActivePortalTab("login");
      return;
    }

    if (!reason.trim()) {
      alert("Please designate a description or reason.");
      return;
    }

    setIsSubmitting(true);
    const orderId = Math.floor(100000 + Math.random() * 900000).toString();
    const empNumSafe = verifiedEmployee.employeeNumber || "0000";
    const trackingNo = `TRK-${empNumSafe.slice(-4)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Paid Leave now uses a single leave date: singleDate
    const finalStart = singleDate;
    const finalEnd = singleDate;

    // 2-Month Accrual Paid Leave validation
    if (requestType === "Paid Leave") {
      if (!singleDate) {
        alert("Please select a date for your Paid Leave.");
        setIsSubmitting(false);
        return;
      }
      const targetDateObj = new Date(singleDate);
      const metrics = getAccrualMetrics(verifiedEmployee.dateHired || "", existingPaidLeaves, targetDateObj);
      if (metrics.balance < 1) {
        alert(`Request Denied: You do not have enough accrued paid leave balance for this period. You have accrued ${metrics.accrued} days of paid leave and used ${metrics.used} days in this 2-month block. Remaining balance: ${metrics.balance} days. Paid leave is accrued at a rate of 1 day per month and resets bimonthly.`);
        setIsSubmitting(false);
        return;
      }
    }

    // Birthday validation
    if (requestType === "Birthday Leave") {
      if (!verifiedEmployee.birthday) {
        alert("Cannot submit Birthday Leave: You do not have a birthday registered in your profile. Please set your birthday first.");
        setBirthdayInput("");
        setShowBirthdayModal(true);
        setIsSubmitting(false);
        return;
      }
      if (!singleDate) {
        alert("Please select a date for your Birthday Leave.");
        setIsSubmitting(false);
        return;
      }
      const bdayInfo = getBirthdayWeekInfo(verifiedEmployee.birthday, singleDate);
      if (!bdayInfo.isValid) {
        alert(bdayInfo.explanation);
        setIsSubmitting(false);
        return;
      }
      if (!bdayInfo.isInBirthdayWeek(singleDate)) {
        alert(`Birthday Leave can only be scheduled and approved during your birthday week (${bdayInfo.weekStartMondayStr} to ${bdayInfo.weekEndFridayStr}). Your birthday is on ${bdayInfo.birthdayFormatted}.`);
        setIsSubmitting(false);
        return;
      }
    }

    const payload: LeaveRequest = {
      requestId: "req-" + orderId,
      employeeId: verifiedEmployee.id || "",
      employeeNumber: verifiedEmployee.employeeNumber,
      employeeName: verifiedEmployee.fullName,
      type: requestType,
      startDate: finalStart,
      endDate: finalEnd,
      reason: reason.trim(),
      attachment: attachment.trim() || "",
      status: "Pending",
      adminNotes: "",
      submittedAt: new Date().toISOString(),
      trackingNumber: trackingNo
    };

    try {
      await addDoc(collection(db, "leave_requests"), payload);
      
      // Auto-publish system notification to Firestore for Admin
      await addDoc(collection(db, "notifications"), {
        title: `New ${requestType} Submitted`,
        message: `${verifiedEmployee.fullName} (${verifiedEmployee.employeeNumber}) submitted a request. Tracking: ${trackingNo}`,
        type: "Request",
        read: false,
        createdAt: new Date().toISOString()
      });

      // Re-fetch employee leaves to update live status/balance indicators
      await fetchEmployeeLeaves(verifiedEmployee.id || "");

      setSubmitSuccess(payload);
      setReason("");
      setAttachment("");
      setStartDate("");
      setEndDate("");
      setSingleDate("");
    } catch (err) {
      console.error(err);
      alert("Error submitting request. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Attendance Report Copy Request
  const handleSubmitAttendanceCopy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifiedEmployee) return;
    const empStatus = verifiedEmployee.status || "Active";
    if (empStatus === "Inactive" || empStatus === "Resigned" || empStatus !== "Active") {
      alert(`Access denied. Your employee account is marked as ${empStatus.toUpperCase()}.`);
      setVerifiedEmployee(null);
      setActivePortalTab("login");
      return;
    }

    if (!attCopyStartDate || !attCopyEndDate) {
      alert("Please select a date range.");
      return;
    }
    if (new Date(attCopyStartDate) > new Date(attCopyEndDate)) {
      alert("Start Date cannot be after End Date.");
      return;
    }
    if (!attCopyReason.trim()) {
      alert("Please provide a reason for requesting attendance copy.");
      return;
    }

    setIsSubmitting(true);
    const orderId = Math.floor(100000 + Math.random() * 900000).toString();
    const empNumSafe = verifiedEmployee.employeeNumber || "0000";
    const trackingNo = `TRK-ATT-${empNumSafe.slice(-4)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const payload: AttendanceCopyRequest = {
      employeeId: verifiedEmployee.id || "",
      employeeNumber: verifiedEmployee.employeeNumber,
      employeeName: verifiedEmployee.fullName,
      startDate: attCopyStartDate,
      endDate: attCopyEndDate,
      reason: attCopyReason.trim(),
      status: "Pending",
      submittedAt: new Date().toISOString(),
      trackingNumber: trackingNo
    };

    try {
      await addDoc(collection(db, "attendance_copy_requests"), payload);
      
      // Auto-publish system notification to Firestore for Admin
      await addDoc(collection(db, "notifications"), {
        title: "New Attendance Copy Request",
        message: `${verifiedEmployee.fullName} requested attendance copy for range ${attCopyStartDate} to ${attCopyEndDate}. Tracking: ${trackingNo}`,
        type: "Request",
        read: false,
        createdAt: new Date().toISOString()
      });

      setAttCopySuccess(payload);
      setAttCopyReason("");
      setAttCopyStartDate("");
      setAttCopyEndDate("");
    } catch (err) {
      console.error("Error submitting attendance copy request:", err);
      alert("Failed to submit request. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const downloadAttendanceCopyPDF = async (req: AttendanceCopyRequest) => {
    try {
      // Fetch attendance documents for this employeeId
      const q = query(
        collection(db, "attendance"),
        where("employeeId", "==", req.employeeId)
      );
      const snap = await getDocs(q);
      const logs: Attendance[] = [];
      snap.forEach(d => {
        const data = d.data() as Attendance;
        if (data.date >= req.startDate && data.date <= req.endDate) {
          logs.push({ ...data, id: d.id });
        }
      });

      // Sort by date ascending
      logs.sort((a, b) => a.date.localeCompare(b.date));

      // Calculate totals
      const totalWorkingDays = logs.length;
      const totalHours = logs.reduce((sum, log) => sum + (log.hoursWorked ?? 0), 0);
      const totalOT = logs.reduce((sum, log) => sum + (log.otHours ?? 0), 0);

      const doc = new jsPDF();
      
      // Header Style Banner (Slate 900)
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 210, 38, "F");
      
      // Header Content left side
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text("OLIGARCH MEDIA", 15, 18);
      
      // Sub-heading below title
      doc.setFontSize(8.5);
      doc.setTextColor(56, 189, 248); // sky-400 / cyan
      doc.text("OFFICIAL PERSONNEL TIMELINE REGISTER", 15, 26);
      
      // Header Content right side
      doc.setTextColor(148, 163, 184); // slate-400
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("SHIFT TIMELINE EXPORT", 195, 20, { align: "right" });

      // Operations Timesheet Review Card Wrapper
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.rect(15, 45, 180, 42, "FD");

      // Title inside card
      doc.setTextColor(30, 41, 59); // slate-800
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("OPERATIONS TIMESHEET REVIEW", 20, 52);

      // Card Content Left Column
      doc.setFontSize(8);
      
      doc.setFont("helvetica", "bold");
      doc.text("Search Terms:", 20, 59);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text("None (All Registers Searched)", 45, 59);

      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "bold");
      doc.text("Status Filter:", 20, 65);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text("All", 45, 65);

      const generatedAtStr = new Date().toLocaleString("en-US", {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true
      });
      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "bold");
      doc.text("Generated On:", 20, 71);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(generatedAtStr, 45, 71);

      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "bold");
      doc.text("Studio Dept:", 20, 77);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(verifiedEmployee?.department || "Oligarch Media (All Personnel)", 45, 77);

      // Card Content Right Column
      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "bold");
      doc.text("Total Shift Records:", 110, 59);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(`${totalWorkingDays} logs`, 150, 59);

      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "bold");
      doc.text("Accumulated Hours:", 110, 65);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(14, 165, 233); // sky-500
      doc.text(`${totalHours.toFixed(2)} hrs`, 150, 65);

      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "bold");
      doc.text("Approved Overtime:", 110, 71);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(22, 163, 74); // green-600
      doc.text(`${totalOT.toFixed(2)} hrs`, 150, 71);

      // Setup list headers
      let y = 96;

      // Draw table headers
      doc.setFillColor(241, 245, 249);
      doc.rect(15, y, 180, 8, "F");
      
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text("DATE", 18, y + 5.5);
      doc.text("DESIGNER", 42, y + 5.5);
      doc.text("IN TIME", 88, y + 5.5);
      doc.text("OUT TIME", 112, y + 5.5);
      doc.text("STATUS STATUS", 138, y + 5.5);
      doc.text("HOURS / OVERTIME", 165, y + 5.5);

      doc.setDrawColor(226, 232, 240);
      doc.line(15, y + 8, 195, y + 8);
      y += 8;

      // Table rows
      doc.setFont("helvetica", "normal");
      doc.setTextColor(15, 23, 42);
      
      const designerStr = `${(req.employeeName || "").toUpperCase()} (${req.employeeNumber || ""})`;

      if (logs.length === 0) {
        doc.setFontSize(8);
        doc.text("No attendance records found for this date range.", 20, y + 8);
      } else {
        doc.setFontSize(7.5);
        logs.forEach((log) => {
          const inStr = log.timeIn ? formatTo12Hour(log.timeIn) : "—";
          const outStr = log.timeOut ? formatTo12Hour(log.timeOut) : "—";
          const hrOtStr = `${(log.hoursWorked ?? 0).toFixed(2)} hrs (+${(log.otHours ?? 0).toFixed(2)} OT)`;
          
          doc.text(log.date, 18, y + 6);
          doc.text(designerStr, 42, y + 6);
          doc.text(inStr, 88, y + 6);
          doc.text(outStr, 112, y + 6);
          doc.text(log.status || "N/A", 138, y + 6);
          doc.text(hrOtStr, 165, y + 6);
          
          doc.line(15, y + 9, 195, y + 9);
          y += 9;
          
          if (y > 260) {
            doc.addPage();
            y = 20;
            doc.setFillColor(15, 23, 42);
            doc.rect(0, 0, 210, 20, "F");
            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("OLIGARCH MEDIA - OFFICIAL PERSONNEL TIMELINE REGISTER", 15, 12);
            doc.setTextColor(148, 163, 184);
            doc.text("SHIFT TIMELINE EXPORT", 195, 12, { align: "right" });

            y += 10;
            doc.setFillColor(241, 245, 249);
            doc.rect(15, y, 180, 8, "F");
            
            doc.setTextColor(100, 116, 139);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(7.5);
            doc.text("DATE", 18, y + 5.5);
            doc.text("DESIGNER", 42, y + 5.5);
            doc.text("IN TIME", 88, y + 5.5);
            doc.text("OUT TIME", 112, y + 5.5);
            doc.text("STATUS STATUS", 138, y + 5.5);
            doc.text("HOURS / OVERTIME", 165, y + 5.5);
            
            doc.setDrawColor(226, 232, 240);
            doc.line(15, y + 8, 195, y + 8);
            y += 8;
            doc.setFont("helvetica", "normal");
            doc.setTextColor(15, 23, 42);
            doc.setFontSize(7.5);
          }
        });
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Report generated on: ${generatedAtStr} | Voucher tracking: ${req.trackingNumber}`, 15, 282);
      doc.text("Copyright © Oligarch Media. All rights reserved. Generated by Employee Portal System.", 15, 287);

      doc.save(`Attendance_Report_${req.startDate}_to_${req.endDate}.pdf`);
    } catch (err) {
      console.error("Error generating attendance copy PDF:", err);
      alert("Error generating PDF copy.");
    }
  };

  const handleDownloadFromNotification = async (notif: SystemNotification) => {
    if (!notif.attendanceCopyRequestId || !notif.id) return;
    setDownloadingNotifId(notif.id);
    try {
      // 1. Fetch the request document from Firestore to get employeeId, startDate, endDate, etc.
      const requestDoc = await getDoc(doc(db, "attendance_copy_requests", notif.attendanceCopyRequestId));
      if (!requestDoc.exists()) {
        alert("This attendance copy request record could not be found.");
        return;
      }
      const reqData = { ...requestDoc.data(), id: requestDoc.id } as AttendanceCopyRequest;
      
      // 2. Download the PDF
      await downloadAttendanceCopyPDF(reqData);

      // 3. Mark the notification as downloaded and read in Firestore so they can't download it again
      await updateDoc(doc(db, "notifications", notif.id), {
        downloaded: true,
        read: true
      });

      alert("Attendance copy PDF downloaded successfully. Note: Each document copy is limited to a single-time secure download.");
    } catch (err) {
      console.error("Error downloading from notification:", err);
      alert("Failed to download PDF. Please try again.");
    } finally {
      setDownloadingNotifId(null);
    }
  };

  // Status Check tracker
  const handleTrackRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrackResultMsg("");
    setTrackedRequests([]);
    setTrackedAttRequests([]);
    setIsTracking(true);

    const searchInput = trackNumber.trim();
    if (!searchInput) {
      setTrackResultMsg("Please provide your Employee Number, Tracking Number, or Reference ID.");
      setIsTracking(false);
      return;
    }

    try {
      // 1. Try tracking code matching
      let qLeave = query(
        collection(db, "leave_requests"),
        where("trackingNumber", "==", searchInput.toUpperCase())
      );
      let snapLeave = await getDocs(qLeave);

      let qAtt = query(
        collection(db, "attendance_copy_requests"),
        where("trackingNumber", "==", searchInput.toUpperCase())
      );
      let snapAtt = await getDocs(qAtt);

      // 2. Try matching by reference code / requestId (exact or prefix req-)
      if (snapLeave.empty && snapAtt.empty) {
        let referenceTerm = searchInput.toLowerCase();
        if (!referenceTerm.startsWith("req-") && /^\d+$/.test(referenceTerm)) {
          referenceTerm = "req-" + referenceTerm;
        }
        qLeave = query(
          collection(db, "leave_requests"),
          where("requestId", "==", referenceTerm)
        );
        snapLeave = await getDocs(qLeave);
      }

      // 3. Fallback to general employee identifier search
      if (snapLeave.empty && snapAtt.empty) {
        qLeave = query(
          collection(db, "leave_requests"),
          where("employeeNumber", "==", searchInput.toUpperCase())
        );
        snapLeave = await getDocs(qLeave);

        qAtt = query(
          collection(db, "attendance_copy_requests"),
          where("employeeNumber", "==", searchInput.toUpperCase())
        );
        snapAtt = await getDocs(qAtt);
      }

      if (snapLeave.empty && snapAtt.empty) {
        setTrackResultMsg("No matching records found. Please check your tracking code or reference number.");
      } else {
        const leaveResults: LeaveRequest[] = [];
        snapLeave.forEach((d) => {
          leaveResults.push({ ...d.data() as LeaveRequest, id: d.id });
        });
        leaveResults.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
        setTrackedRequests(leaveResults);

        const attResults: AttendanceCopyRequest[] = [];
        snapAtt.forEach((d) => {
          attResults.push({ ...d.data() as AttendanceCopyRequest, id: d.id });
        });
        attResults.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
        setTrackedAttRequests(attResults);
      }
    } catch (err) {
      console.error(err);
      setTrackResultMsg("Error fetching matching logs.");
    } finally {
      setIsTracking(false);
    }
  };

  const handlePortalPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !verifiedEmployee?.id) return;
    
    if (file.size > 1.5 * 1024 * 1024) {
      alert("Image is too large. Image file must be under 1.5MB.");
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = async () => {
      if (typeof reader.result === "string") {
        try {
          await updateDoc(doc(db, "employees", verifiedEmployee.id), {
            profilePicture: reader.result
          });
          // Update local state
          const newPic = reader.result;
          setVerifiedEmployee(prev => prev ? { ...prev, profilePicture: newPic } : null);
          alert("Your profile photo has been successfully uploaded and updated!");
        } catch (err) {
          console.error("Error updating profile photo:", err);
          alert("Could not update profile photo.");
        }
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 relative">
      {/* Real-time Non-Blocking Punch Toast (Zero OK button required) */}
      {punchToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] w-[92%] max-w-md animate-in fade-in slide-in-from-top-4 duration-300 pointer-events-auto">
          <div className={`p-4 rounded-2xl shadow-2xl border backdrop-blur-xl flex items-center justify-between gap-3 ${
            punchToast.type === "success"
              ? "bg-emerald-950/95 text-white border-emerald-500/50 shadow-emerald-950/60 ring-1 ring-emerald-500/30"
              : punchToast.type === "error"
              ? "bg-rose-950/95 text-white border-rose-500/50 shadow-rose-950/60 ring-1 ring-rose-500/30"
              : "bg-zinc-900/95 text-white border-zinc-700 shadow-black/70 ring-1 ring-white/10"
          }`}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                punchToast.type === "success" 
                  ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/30" 
                  : punchToast.type === "error"
                  ? "bg-rose-500 text-white shadow-md shadow-rose-500/30"
                  : "bg-blue-500 text-white"
              }`}>
                {punchToast.type === "success" ? (
                  <CheckCircle className="w-5 h-5 stroke-[2.5]" />
                ) : punchToast.type === "error" ? (
                  <AlertCircle className="w-5 h-5 stroke-[2.5]" />
                ) : (
                  <Clock className="w-5 h-5 stroke-[2.5]" />
                )}
              </div>
              <div>
                <p className="text-xs font-black font-sans tracking-wide leading-tight">
                  {punchToast.message}
                </p>
                {punchToast.submessage && (
                  <p className="text-[11px] font-mono text-zinc-300 mt-0.5 opacity-90 leading-snug">
                    {punchToast.submessage}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPunchToast(null)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Portal Hero */}
      <header className="mb-8 text-center">
        <span className="px-3 py-1 bg-blue-50 dark:bg-zinc-800 text-blue-600 dark:text-blue-400 text-xs font-mono font-bold rounded-full uppercase tracking-widest gap-1 inline-flex items-center">
          <Sparkles className="w-3 h-3" /> Public HR Portal
        </span>
        <h1 className="text-3xl font-extrabold text-zinc-905 dark:text-white mt-3 tracking-tight">Oligarch Media Hub</h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-2 max-w-md mx-auto">
          Secure, direct self-service requests for employees. Log birthday plans, emergency leaves, or download tracking vouchers.
        </p>
      </header>

      {/* Tabs */}
      <div className={`grid ${verifiedEmployee ? "grid-cols-2 sm:grid-cols-3 md:flex md:flex-wrap" : "grid-cols-3 md:flex md:flex-wrap"} border border-zinc-200 dark:border-zinc-800/80 mb-8 max-w-2xl mx-auto justify-center bg-zinc-50 dark:bg-zinc-900 p-1.5 rounded-3xl md:rounded-full shadow-inner gap-1.5`}>
        {!verifiedEmployee ? (
          <>
            <button
              onClick={() => {
                setActivePortalTab("timetracking");
              }}
              className={`px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold uppercase tracking-wider transition-all duration-205 flex items-center gap-1.5 justify-center w-full md:w-auto ${
                activePortalTab === "timetracking"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-550 dark:text-zinc-400 hover:text-zinc-900"
              }`}
              id="time_tracking_portal_tab"
            >
              <Clock className="w-3.5 h-3.5 text-blue-500" />
              <span>Time Tracking</span>
            </button>
            <button
              onClick={() => {
                setActivePortalTab("devotion");
              }}
              className={`px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold uppercase tracking-wider transition-all duration-205 flex items-center gap-1.5 justify-center w-full md:w-auto ${
                activePortalTab === "devotion"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-550 dark:text-zinc-400 hover:text-zinc-900"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-500" />
              <span>Devotion & Prayer</span>
            </button>
            <button
              onClick={() => {
                setActivePortalTab("bulletins");
              }}
              className={`px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold uppercase tracking-wider transition-all duration-205 flex items-center gap-1.5 justify-center w-full md:w-auto relative ${
                activePortalTab === "bulletins"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-550 dark:text-zinc-400 hover:text-zinc-900"
              }`}
            >
              <Megaphone className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
              <span>Announcements</span>
              {announcements.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white">
                  {announcements.length}
                </span>
              )}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                setActivePortalTab("timetracking");
              }}
              className={`px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold uppercase tracking-wider transition-all duration-205 flex items-center gap-1.5 justify-center w-full md:w-auto ${
                activePortalTab === "timetracking"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-550 dark:text-zinc-400 hover:text-zinc-900"
              }`}
              id="time_tracking_portal_tab"
            >
              <Clock className="w-3.5 h-3.5 text-blue-500" />
              <span>Time Tracking</span>
            </button>
            <button
              onClick={() => {
                setActivePortalTab("devotion");
              }}
              className={`px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold uppercase tracking-wider transition-all duration-205 flex items-center gap-1.5 justify-center w-full md:w-auto relative ${
                activePortalTab === "devotion"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-550 dark:text-zinc-400 hover:text-zinc-900"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-500" />
              <span>Devotion</span>
              {assignedDevotionNotice && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black text-slate-950 animate-pulse">
                  ★
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setActivePortalTab("submit");
                setSubmitSuccess(null);
              }}
              className={`px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold uppercase tracking-wider transition-all duration-205 flex items-center gap-1.5 justify-center w-full md:w-auto ${
                activePortalTab === "submit"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-550 dark:text-zinc-400 hover:text-zinc-900"
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-blue-500" />
              <span>Request Submission</span>
            </button>
            <button
              onClick={() => {
                setActivePortalTab("payslips");
              }}
              className={`px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold uppercase tracking-wider transition-all duration-205 flex items-center gap-1.5 justify-center w-full md:w-auto relative ${
                activePortalTab === "payslips"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-550 dark:text-zinc-400 hover:text-zinc-900"
              }`}
            >
              <CreditCard className="w-3.5 h-3.5 text-blue-500" />
              <span>My Payslips</span>
            </button>
            <button
              onClick={() => {
                setActivePortalTab("notifications");
              }}
              className={`px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold uppercase tracking-wider transition-all duration-205 flex items-center gap-1.5 justify-center w-full md:w-auto relative ${
                activePortalTab === "notifications"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-550 dark:text-zinc-400 hover:text-zinc-900"
              }`}
            >
              <Bell className="w-3.5 h-3.5 text-indigo-550" />
              <span>My Alerts</span>
              {employeeNotifications.filter(n => !n.read).length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-black text-white animate-bounce">
                  {employeeNotifications.filter(n => !n.read).length}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setActivePortalTab("bulletins");
              }}
              className={`px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold uppercase tracking-wider transition-all duration-205 flex items-center gap-1.5 justify-center w-full md:w-auto relative ${
                activePortalTab === "bulletins"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                  : "text-zinc-550 dark:text-zinc-400 hover:text-zinc-900"
              }`}
            >
              <Megaphone className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
              <span>Announcements</span>
              {announcements.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white">
                  {announcements.length}
                </span>
              )}
            </button>
          </>
        )}
      </div>

      {/* Main Container Card */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 md:p-8 shadow-sm transition-colors duration-200">


        {/* TAB 1: FORM REPORT SUBMISSION */}
        {activePortalTab === "submit" && (
          <div>            {!verifiedEmployee ? (
              /* Phase A: Employee Credentials Verification */
              <form onSubmit={handleVerify} className="max-w-md mx-auto space-y-5 py-6" id="portal_unified_login_form_submit">
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-zinc-900 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3">
                    <UserCheck className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-lg text-zinc-850 dark:text-zinc-200">Employee Portal Login</h3>
                  <p className="text-xs text-zinc-500 mt-1">Please enter your Employee Number and 4-digit PIN passcode.</p>
                </div>

                {authError && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/20 text-red-750 dark:text-red-400 text-xs rounded-xl flex items-center gap-2 border border-red-100 dark:border-red-900/30 font-semibold">
                    <ShieldAlert className="w-4 h-4 shrink-0 text-red-500" />
                    <span>{authError}</span>
                  </div>
                )}
                 <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-650 dark:text-zinc-400 font-mono">EMPLOYEE ID / NUMBER</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 003"
                    value={employeeNum}
                    onChange={(e) => setEmployeeNum(e.target.value)}
                    className="w-full text-sm px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-550 dark:text-zinc-100 uppercase text-center font-bold tracking-wider"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-650 dark:text-zinc-400 font-mono">4-DIGIT PIN PASSCODE</label>
                  <div className="relative">
                    <input
                      type={showPortalPin ? "text" : "password"}
                      required
                      maxLength={4}
                      placeholder="e.g. 1234"
                      value={portalPin}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        setPortalPin(digits);
                      }}
                      className="w-full text-sm px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-550 dark:text-zinc-100 text-center font-bold tracking-widest font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPortalPin(!showPortalPin)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs font-mono font-bold"
                    >
                      {showPortalPin ? "HIDE" : "SHOW"}
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500 font-mono text-center mt-1">Default PIN is 1234. You can change this after logging in.</p>
                </div>

                <button
                  type="submit"
                  disabled={isVerifying}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 px-4 rounded-xl text-sm shadow-sm transition-colors flex items-center justify-center gap-1 cursor-pointer font-sans"
                >
                  {isVerifying ? "Logging in..." : "Login & Continue"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              /* Phase B: Verification Success -> Show request Form */
              <div>
                {/* Employee Welcome banner */}
                <div className="p-5 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 mb-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {/* Avatar with optional upload */}
                      <div className="relative group shrink-0">
                        <img 
                          src={verifiedEmployee.profilePicture || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"} 
                          alt="avatar" 
                          referrerPolicy="no-referrer"
                          className="w-12 h-12 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shadow-sm"
                        />
                        <label className="absolute -bottom-1 -right-1 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-1 cursor-pointer shadow-sm transition-transform hover:scale-105 active:scale-95 leading-none" title="Upload new photo">
                          <span className="text-[8px] font-sans font-bold block px-0.5 uppercase">UP</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={handlePortalPhotoUpload}
                          />
                        </label>
                      </div>
                      <div>
                        <span className="text-xs font-mono font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 px-2 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1">
                          <Check className="w-3 h-3" /> Identity Verified
                        </span>
                        <h3 className="font-bold text-zinc-800 dark:text-zinc-150 text-base mt-1">{verifiedEmployee.fullName}</h3>
                        <p className="text-xs text-zinc-500 font-mono">{verifiedEmployee.position} • {verifiedEmployee.department}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                            🎂 {verifiedEmployee.birthday ? `Birthday: ${getBirthdayWeekInfo(verifiedEmployee.birthday).birthdayFormatted}` : "Birthday: Not Set"}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setBirthdayInput(verifiedEmployee.birthday || "");
                              setShowBirthdayModal(true);
                            }}
                            className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-bold cursor-pointer"
                          >
                            {verifiedEmployee.birthday ? "Edit Birthday" : "+ Set Birthday"}
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-col sm:items-end gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setIsChangingPin(!isChangingPin);
                          setPinChangeError("");
                          setPinChangeSuccess("");
                        }}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1 justify-start sm:justify-end cursor-pointer"
                      >
                        <Lock className="w-3 h-3" />
                        {isChangingPin ? "Cancel Change PIN" : "Change 4-Digit PIN"}
                      </button>
                      <button
                        onClick={() => {
                          setVerifiedEmployee(null);
                          setEmployeeNum("");
                          setActivePortalTab("timetracking");
                        }}
                        className="text-xs font-bold text-red-600 hover:text-red-700 dark:text-red-450 dark:hover:text-red-350 underline text-left cursor-pointer"
                      >
                        Logout
                      </button>
                    </div>
                  </div>

                  {isChangingPin && (
                    <form onSubmit={handleChangePin} className="max-w-md mx-auto p-5 bg-blue-50/40 dark:bg-zinc-900/40 border border-blue-100 dark:border-blue-900/30 rounded-2xl mb-2 space-y-4 animate-fadeIn">
                      <div className="text-center pb-2 border-b border-blue-100/50 dark:border-blue-900/20">
                        <h4 className="text-xs font-bold font-mono text-blue-700 dark:text-blue-400 uppercase tracking-wider">Update Portal 4-Digit PIN</h4>
                        <p className="text-[10px] text-zinc-500 mt-0.5">Protect your account with a personal PIN code.</p>
                      </div>

                      {pinChangeError && (
                        <div className="p-2.5 bg-red-50 dark:bg-red-955/20 text-red-750 dark:text-red-400 text-[11px] rounded-xl border border-red-100 dark:border-red-900/30 font-semibold">
                          {pinChangeError}
                        </div>
                      )}

                      {pinChangeSuccess && (
                        <div className="p-2.5 bg-green-50 dark:bg-green-955/20 text-green-750 dark:text-green-400 text-[11px] rounded-xl border border-green-100 dark:border-green-900/30 font-semibold">
                          {pinChangeSuccess}
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Current PIN</label>
                          <input
                            type="password"
                            required
                            maxLength={4}
                            placeholder="e.g. 1234"
                            value={currentPinInput}
                            onChange={(e) => setCurrentPinInput(e.target.value.replace(/\D/g, ""))}
                            className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-center font-mono font-bold tracking-widest text-zinc-900 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">New 4-Digit PIN</label>
                          <input
                            type="password"
                            required
                            maxLength={4}
                            placeholder="Enter 4 digits"
                            value={newPinInput}
                            onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, ""))}
                            className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-center font-mono font-bold tracking-widest text-zinc-900 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Confirm New PIN</label>
                          <input
                            type="password"
                            required
                            maxLength={4}
                            placeholder="Repeat 4 digits"
                            value={confirmNewPinInput}
                            onChange={(e) => setConfirmNewPinInput(e.target.value.replace(/\D/g, ""))}
                            className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-center font-mono font-bold tracking-widest text-zinc-900 dark:text-white"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded-xl text-xs shadow-sm transition-colors cursor-pointer"
                      >
                        Update 4-Digit PIN
                      </button>
                    </form>
                  )}
                </div>

                {/* Request Type Sub-tabs selector */}
                <div className="flex border-b border-zinc-200 dark:border-zinc-800 mb-6">
                  <button
                    type="button"
                    onClick={() => setSubmitTabType("leave")}
                    className={`flex-1 pb-3 text-sm font-bold text-center border-b-2 transition-all ${
                      submitTabType === "leave"
                        ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                        : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                  >
                    Leave & Notice Vouchers
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmitTabType("attendance_copy")}
                    className={`flex-1 pb-3 text-sm font-bold text-center border-b-2 transition-all ${
                      submitTabType === "attendance_copy"
                        ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                        : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                  >
                    Attendance Report Copy
                  </button>
                </div>

                {submitTabType === "leave" ? (
                  <>
                    {/* Leave reset status box rule */}
                    {(() => {
                      const blockNow = getTwoMonthBlockLabel(new Date().toISOString());
                      const metrics = getAccrualMetrics(verifiedEmployee.dateHired || "", existingPaidLeaves);
                      return (
                        <div className="p-3.5 bg-sky-50/50 dark:bg-sky-950/10 rounded-xl border border-sky-100 dark:border-sky-900/40 text-[11px] font-mono space-y-1 mb-6">
                          <p className="font-bold text-sky-850 dark:text-sky-300 uppercase tracking-wider">Leave Allocation & Accrual Sync</p>
                          <p className="text-zinc-650 dark:text-zinc-400">
                            Hired Date: <span className="font-bold text-zinc-800 dark:text-zinc-200">{verifiedEmployee.dateHired || "N/A"}</span> ({metrics.monthsOfService} mos. of service)
                          </p>
                          <p className="text-zinc-650 dark:text-zinc-400">
                            Current Block: <span className="font-bold text-zinc-800 dark:text-zinc-200">{blockNow.label} {blockNow.year}</span>
                          </p>
                          <p className="text-zinc-650 dark:text-zinc-400">
                            Paid PTO Accrual: <span className="font-bold text-zinc-800 dark:text-zinc-200">1 day per month (restarting every 2 months)</span>
                          </p>
                          <p className="text-zinc-650 dark:text-zinc-400">
                            This Block Accrued: <span className="font-bold text-zinc-800 dark:text-zinc-200">{metrics.accrued} Days</span> | This Block Used: <span className="font-bold text-zinc-800 dark:text-zinc-200">{metrics.used} Days</span>
                          </p>
                          <p className="text-zinc-650 dark:text-zinc-400">
                            Current Period Balance: {metrics.balance > 0 ? (
                              <span className="text-green-600 dark:text-green-400 font-extrabold uppercase bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded leading-none inline-block">{metrics.balance} PTO Available</span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400 font-extrabold uppercase bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded leading-none inline-block">0 PTO Remaining</span>
                            )}
                          </p>
                          <p className="text-[9px] text-zinc-500 font-sans pt-1 leading-normal">
                            All leave credits are accrued at a rate of 1 day per calendar month, resetting completely at the end of every bimonthly period. Unused leave does not carry over.
                          </p>
                        </div>
                      );
                    })()}

                    {/* Successful submission voucher */}
                    {submitSuccess ? (

                  <div className="text-center py-8 space-y-4 max-w-md mx-auto">
                    <div className="w-16 h-16 bg-green-50 dark:bg-green-950/20 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                      <CheckCircle className="w-8 h-8" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-xl font-bold text-zinc-900 dark:text-white">Leave Voucher Logged</h4>
                      <p className="text-xs text-zinc-500">Your leave/notice voucher has been dispatched for Admin approval.</p>
                    </div>

                    <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 font-mono select-all text-left space-y-3">
                      <div>
                        <p className="text-[10px] text-zinc-400 uppercase font-mono">TRACKING NUMBER</p>
                        <p className="text-base font-bold text-blue-600 mt-0.5 select-all">{submitSuccess.trackingNumber}</p>
                      </div>
                      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-2">
                        <p className="text-[10px] text-zinc-400 uppercase font-mono">REFERENCE NUMBER</p>
                        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mt-0.5 select-all">{submitSuccess.requestId}</p>
                      </div>
                      <p className="text-[10px] text-zinc-400 leading-relaxed font-sans border-t border-zinc-100 dark:border-zinc-800 pt-2">
                        Use either the Tracking Number or the Reference ID to check request progress in the tracking hub.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                      <button
                        onClick={() => downloadPDF(submitSuccess)}
                        className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2.5 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-4 h-4" /> Download PDF Voucher
                      </button>
                      <button
                        onClick={() => setSubmitSuccess(null)}
                        className="text-xs font-bold text-zinc-800 hover:text-zinc-950 px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 rounded-xl dark:text-zinc-300 dark:bg-zinc-800 transition-colors cursor-pointer"
                      >
                        Log Another Leave Notice
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Create leave request form */
                  <form onSubmit={handleSubmitRequest} className="space-y-6">
                    {/* Select leave dynamic categories */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { id: "Paid Leave", desc: "Standard Paid Time-Off" },
                        { id: "Birthday Leave", desc: "Annual Birth-Month Paid PTO" },
                        { id: "Absent Notice", desc: "Unscheduled Unpaid Absence" }
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setRequestType(item.id as RequestType)}
                          className={`p-4 rounded-xl border text-left transition-all ${
                            requestType === item.id
                              ? "bg-blue-50/50 border-blue-500 dark:bg-blue-950/20 text-indigo-700 dark:text-blue-300 shadow-xs"
                              : "border-zinc-200 dark:border-zinc-800 dark:text-zinc-300"
                          }`}
                        >
                          <p className="text-sm font-bold">{item.id}</p>
                          <p className="text-xs text-zinc-500 mt-1 leading-normal">{item.desc}</p>
                        </button>
                      ))}
                    </div>

                    {/* Birthday Leave Policy & Helper Banner */}
                    {requestType === "Birthday Leave" && (
                      <div>
                        {verifiedEmployee?.birthday ? (
                          (() => {
                            const bdayInfo = getBirthdayWeekInfo(verifiedEmployee.birthday, singleDate || new Date().toISOString());
                            return (
                              <div className="p-4 rounded-xl bg-pink-50/70 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-800/60 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-pink-700 dark:text-pink-300 font-mono flex items-center gap-1.5">
                                    🎂 BIRTHDAY LEAVE POLICY & SCHEDULE
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBirthdayInput(verifiedEmployee.birthday || "");
                                      setShowBirthdayModal(true);
                                    }}
                                    className="text-[10px] text-pink-600 dark:text-pink-400 hover:underline font-bold font-mono cursor-pointer"
                                  >
                                    Change Birthday
                                  </button>
                                </div>
                                <p className="text-xs text-zinc-700 dark:text-zinc-300">
                                  Registered Birthday: <strong>{bdayInfo.birthdayFormatted}</strong>
                                </p>
                                <p className="text-xs text-zinc-700 dark:text-zinc-300">
                                  Eligible Birthday Week: <strong>Monday, {bdayInfo.weekStartMondayStr} to Friday, {bdayInfo.weekEndFridayStr}</strong>
                                </p>
                                {singleDate && (
                                  <div className={`mt-2 p-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                                    bdayInfo.isInBirthdayWeek(singleDate)
                                      ? "bg-emerald-100/70 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                                      : "bg-red-100/70 text-red-800 dark:bg-red-950/40 dark:text-red-300 border border-red-300 dark:border-red-800"
                                  }`}>
                                    {bdayInfo.isInBirthdayWeek(singleDate) ? (
                                      <span>✓ <strong>Eligible:</strong> {singleDate} falls within your birthday week (Monday – Friday).</span>
                                    ) : (
                                      <span>⚠️ <strong>Outside Birthday Week:</strong> {singleDate} is outside your birthday week ({bdayInfo.weekStartMondayStr} to {bdayInfo.weekEndFridayStr}). Birthday leave can only be approved during your birthday week.</span>
                                    )}
                                  </div>
                                )}
                                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono mt-1">
                                  * Company Rule: Birthday leave will only be approved during your birthday week (e.g. if birthday is Sept 1 Monday, you can use it until Friday).
                                </p>
                              </div>
                            );
                          })()
                        ) : (
                          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 space-y-3">
                            <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-bold text-xs">
                              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                              <span>Birthday Required to Request Birthday Leave</span>
                            </div>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400">
                              Please register your date of birth below so the system can determine your eligible Birthday Week:
                            </p>
                            <div className="flex items-center gap-2">
                              <input
                                type="date"
                                value={birthdayInput}
                                onChange={(e) => setBirthdayInput(e.target.value)}
                                className="text-xs px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none dark:text-white"
                              />
                              <button
                                type="button"
                                disabled={!birthdayInput || isSavingBirthday}
                                onClick={async () => {
                                  if (!verifiedEmployee?.id || !birthdayInput) return;
                                  setIsSavingBirthday(true);
                                  try {
                                    await updateDoc(doc(db, "employees", verifiedEmployee.id), { birthday: birthdayInput });
                                    setVerifiedEmployee(prev => prev ? { ...prev, birthday: birthdayInput } : null);
                                    alert("Birthday successfully saved!");
                                  } catch (err: any) {
                                    alert("Failed to save: " + err.message);
                                  } finally {
                                    setIsSavingBirthday(false);
                                  }
                                }}
                                className="px-3 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-xs cursor-pointer"
                              >
                                {isSavingBirthday ? "Saving..." : "Save Birthday"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Unified single Datepicker layout */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-500 font-mono uppercase">
                        {requestType === "Paid Leave" 
                          ? "LEAVE DATE" 
                          : requestType === "Birthday Leave" 
                            ? "Date of Birthday Celebration" 
                            : "Date of Unscheduled Absence"}
                      </label>
                      <input
                        type="date"
                        required
                        value={singleDate}
                        onChange={(e) => setSingleDate(e.target.value)}
                        className="w-full text-sm px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-550 dark:text-zinc-100"
                      />
                    </div>

                    {/* Leave Description textarea */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-500 font-mono">REASON / BRIEF DESCRIPTION</label>
                      <textarea
                        rows={4}
                        required
                        placeholder="Please type your support justification here..."
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="w-full text-sm px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-550 dark:text-zinc-100"
                      />
                    </div>

                    {/* Optional Attachments upload mock links */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-500 font-mono flex items-center gap-1.5">
                        <Paperclip className="w-3.5 h-3.5" /> ATTACHMENT / URL (OPTIONAL)
                      </label>
                      <input
                        type="text"
                        placeholder="Paste document cloud link or type description e.g. 'Medical Certificate.pdf'"
                        value={attachment}
                        onChange={(e) => setAttachment(e.target.value)}
                        className="w-full text-sm px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-550 dark:text-zinc-100"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-sm shadow-md transition-colors cursor-pointer flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? "Submitting request..." : "Publish Official Request"}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <>
                {/* Attendance Copy Request form flow */}
                {attCopySuccess ? (
                  <div className="text-center py-8 space-y-4 max-w-md mx-auto">
                    <div className="w-16 h-16 bg-blue-50 dark:bg-blue-955/20 text-blue-650 rounded-full flex items-center justify-center mx-auto shadow-inner">
                      <CheckCircle className="w-8 h-8" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-xl font-bold text-zinc-900 dark:text-white">Attendance Copy Requested</h4>
                      <p className="text-xs text-zinc-500">Your attendance copy request has been queued for HR approval.</p>
                    </div>

                    <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 font-mono select-all text-left space-y-3">
                      <div>
                        <p className="text-[10px] text-zinc-400 uppercase font-mono">TRACKING NUMBER</p>
                        <p className="text-base font-bold text-blue-600 mt-0.5 select-all">{attCopySuccess.trackingNumber}</p>
                      </div>
                      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-2">
                        <p className="text-[10px] text-zinc-400 uppercase font-mono">REQUESTED RANGE</p>
                        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mt-0.5 select-all">
                          {attCopySuccess.startDate} to {attCopySuccess.endDate}
                        </p>
                      </div>
                      <p className="text-[10px] text-zinc-400 leading-relaxed font-sans border-t border-zinc-100 dark:border-zinc-800 pt-2">
                        Use this tracking code in the tracking hub to view status. Once Approved, you can download your official PDF copy directly.
                      </p>
                    </div>

                    <button
                      onClick={() => setAttCopySuccess(null)}
                      className="text-xs font-bold text-zinc-800 hover:text-zinc-950 px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 rounded-xl dark:text-zinc-300 dark:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      Submit Another Attendance Copy Request
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmitAttendanceCopy} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-zinc-500 font-mono uppercase">START DATE</label>
                        <input
                          type="date"
                          required
                          value={attCopyStartDate}
                          onChange={(e) => setAttCopyStartDate(e.target.value)}
                          className="w-full text-sm px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-100"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-zinc-500 font-mono uppercase">END DATE</label>
                        <input
                          type="date"
                          required
                          value={attCopyEndDate}
                          onChange={(e) => setAttCopyEndDate(e.target.value)}
                          className="w-full text-sm px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-100"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-500 font-mono uppercase">REASON FOR THE COPY REQUEST</label>
                      <textarea
                        rows={4}
                        required
                        placeholder="State your reason (e.g., 'Visa Application Requirement', 'Personal audit', 'Correction audit' etc.)"
                        value={attCopyReason}
                        onChange={(e) => setAttCopyReason(e.target.value)}
                        className="w-full text-sm px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-100"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? "Submitting Request..." : "Request Authorized Copy"}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
            )}
          </div>
        )}

        {/* TAB 2: VOUCHER TRACKING TAB */}
        {activePortalTab === "track" && (
          <div className="space-y-6">
            <h4 className="text-base font-bold text-zinc-800 dark:text-zinc-200 mb-2">Check leave notice tracker status</h4>

            <form onSubmit={handleTrackRequest} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-semibold text-zinc-500 font-mono">TRACKING NUMBER OR REFERENCE ID</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. TRK-0821-HAKF, req-582914, or EMP-0821"
                  value={trackNumber}
                  onChange={(e) => setTrackNumber(e.target.value)}
                  className="w-full text-sm px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-550 dark:text-zinc-100 uppercase"
                />
              </div>
              <button
                type="submit"
                disabled={isTracking}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold py-2.5 px-4 rounded-xl text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Search className="w-4 h-4" />
                {isTracking ? "Searching..." : "Track Status"}
              </button>
            </form>

            {trackResultMsg && (
              <p className="text-xs text-red-500 font-semibold">{trackResultMsg}</p>
            )}

            {/* List employee leave history tracked */}
            {trackedRequests.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-zinc-100 dark:border-zinc-900">
                {trackedRequests.map((req) => (
                  <div 
                    key={req.id} 
                    className="border border-zinc-200 dark:border-zinc-805 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-50/40 dark:bg-zinc-900/40"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-blue-600 dark:text-blue-400 text-xs font-mono font-bold bg-blue-50 dark:bg-blue-955/20 px-2 py-0.5 rounded-md">
                          {req.trackingNumber}
                        </span>
                        <span className="text-zinc-400">•</span>
                        <span className="text-zinc-650 dark:text-zinc-300 text-xs font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-md">
                          ID: {req.requestId}
                        </span>
                        <span className="text-zinc-400">•</span>
                        <span className="text-xs font-semibold font-mono dark:text-zinc-350">{req.type}</span>
                      </div>
                      <h5 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{req.employeeName}</h5>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Date(s): <span className="font-semibold">{req.type === "Paid Leave" ? `${req.startDate} to ${req.endDate}` : req.startDate}</span>
                      </p>
                      <p className="text-xs text-zinc-650 dark:text-zinc-400 line-clamp-2 italic">"{req.reason}"</p>
                      {req.adminNotes && (
                        <div className="p-2.5 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-850 dark:text-yellow-400 text-xs rounded-lg mt-2 border border-yellow-105 dark:border-yellow-900/30">
                          <strong className="font-semibold">Hr Note:</strong> {req.adminNotes}
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center gap-3">
                      {/* PDF Action download */}
                      <button
                        onClick={() => downloadPDF(req)}
                        title="Download PDF"
                        className="p-2 bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 rounded-xl transition-all shadow-xs flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 text-blue-550" />
                        <span>PDF</span>
                      </button>

                      {req.status === "Pending" && (
                        <span className="px-3 py-1.5 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-600 dark:text-yellow-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> Pending Approval
                        </span>
                      )}
                      {req.status === "Approved" && (
                        <span className="px-3 py-1.5 bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400 text-xs font-bold font-mono rounded-full flex items-center gap-1 border border-green-200 dark:border-green-900/30">
                          <CheckCircle className="w-3.5 h-3.5" /> Approved
                        </span>
                      )}
                      {req.status === "Rejected" && (
                        <span className="px-3 py-1.5 bg-red-50 dark:bg-red-950/20 text-red-650 dark:text-red-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Rejected
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* List employee attendance copy requests tracked */}
            {trackedAttRequests.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-zinc-100 dark:border-zinc-900">
                <h5 className="text-xs font-bold text-zinc-500 font-mono uppercase tracking-wider mb-2">Attendance Copy Requests</h5>
                {trackedAttRequests.map((req) => (
                  <div 
                    key={req.id} 
                    className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-50/40 dark:bg-zinc-900/40"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-blue-600 dark:text-blue-400 text-xs font-mono font-bold bg-blue-50 dark:bg-blue-955/20 px-2 py-0.5 rounded-md">
                          {req.trackingNumber}
                        </span>
                        <span className="text-zinc-400">•</span>
                        <span className="text-xs font-semibold font-mono text-zinc-650 dark:text-zinc-350">Attendance Copy</span>
                      </div>
                      <h5 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{req.employeeName}</h5>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Requested Period: <span className="font-semibold text-blue-600 dark:text-blue-400">{req.startDate} to {req.endDate}</span>
                      </p>
                      <p className="text-xs text-zinc-650 dark:text-zinc-400 line-clamp-2 italic">"{req.reason}"</p>
                      {req.adminNotes && (
                        <div className="p-2.5 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-850 dark:text-yellow-400 text-xs rounded-lg mt-2 border border-yellow-105 dark:border-yellow-900/30">
                          <strong className="font-semibold">Hr Note:</strong> {req.adminNotes}
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center gap-3">
                      {req.status === "Approved" ? (
                        <button
                          onClick={() => downloadAttendanceCopyPDF(req)}
                          className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-sm flex items-center gap-1.5 text-xs font-bold cursor-pointer animate-pulse"
                        >
                          <Download className="w-4 h-4" />
                          <span>Download Report</span>
                        </button>
                      ) : (
                        <button
                          disabled
                          title="Awaiting approval"
                          className="p-2.5 bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 rounded-xl text-xs font-semibold cursor-not-allowed flex items-center gap-1.5"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>PDF Locked</span>
                        </button>
                      )}

                      {req.status === "Pending" && (
                        <span className="px-3 py-1.5 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-600 dark:text-yellow-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> Pending Approval
                        </span>
                      )}
                      {req.status === "Approved" && (
                        <span className="px-3 py-1.5 bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400 text-xs font-bold font-mono rounded-full flex items-center gap-1 border border-green-200 dark:border-green-900/30">
                          <CheckCircle className="w-3.5 h-3.5" /> Approved
                        </span>
                      )}
                      {req.status === "Rejected" && (
                        <span className="px-3 py-1.5 bg-red-50 dark:bg-red-950/20 text-red-650 dark:text-red-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Rejected
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: PRIVATE PAYSLIPS HISTORY VAULT */}
        {activePortalTab === "payslips" && (
          <div>
            {!verifiedEmployee ? (
              /* Phase A: Employee Credentials Verification for Payslips */
              <form onSubmit={handleVerify} className="max-w-md mx-auto space-y-5 py-6" id="portal_unified_login_form_payslips">
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-955/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3">
                    <CreditCard className="w-6 h-6 animate-pulse" />
                  </div>
                  <h3 className="font-bold text-lg text-zinc-850 dark:text-zinc-200">Confidential Payslip Vault</h3>
                  <p className="text-xs text-zinc-500 mt-1 font-sans">Please enter your Employee Number and 4-digit PIN passcode to securely unlock your statement.</p>
                </div>

                {authError && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/20 text-red-750 dark:text-red-400 text-xs rounded-xl flex items-center gap-2 border border-red-100 dark:border-red-900/30 font-semibold">
                    <ShieldAlert className="w-4 h-4 shrink-0 text-red-500" />
                    <span>{authError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-650 dark:text-zinc-400 font-mono">EMPLOYEE ID / NUMBER</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 003"
                    value={employeeNum}
                    onChange={(e) => setEmployeeNum(e.target.value)}
                    className="w-full text-sm px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-550 dark:text-zinc-100 uppercase text-center font-bold tracking-wider"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-650 dark:text-zinc-400 font-mono">4-DIGIT PIN PASSCODE</label>
                  <div className="relative">
                    <input
                      type={showPortalPin ? "text" : "password"}
                      required
                      maxLength={4}
                      placeholder="e.g. 1234"
                      value={portalPin}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        setPortalPin(digits);
                      }}
                      className="w-full text-sm px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-550 dark:text-zinc-100 text-center font-bold tracking-widest font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPortalPin(!showPortalPin)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs font-mono font-bold"
                    >
                      {showPortalPin ? "HIDE" : "SHOW"}
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500 font-mono text-center mt-1">Default PIN is 1234. You can change this after logging in.</p>
                </div>

                <button
                  type="submit"
                  disabled={isVerifying}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 px-4 rounded-xl text-sm shadow-sm transition-colors flex items-center justify-center gap-1 cursor-pointer font-sans"
                >
                  {isVerifying ? "Unlocking Vault..." : "Verify & Unlock Statement"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              /* Phase B: Verification Success -> Show Payslip History & Download */
              <div className="space-y-6">
                {/* Header Welcome banner */}
                <div className="p-5 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <img 
                      src={verifiedEmployee.profilePicture || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"} 
                      alt="avatar" 
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shadow-sm shrink-0"
                    />
                    <div>
                      <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-955/20 px-2 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1">
                        <CreditCard className="w-3 h-3" /> Secure Wallet Mode
                      </span>
                      <h3 className="font-bold text-zinc-800 dark:text-zinc-150 text-base mt-1">{verifiedEmployee.fullName}</h3>
                      <p className="text-xs text-zinc-500 font-mono">{verifiedEmployee.position} • {verifiedEmployee.department}</p>
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:items-end gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setIsChangingPin(!isChangingPin);
                        setPinChangeError("");
                        setPinChangeSuccess("");
                      }}
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1 justify-start sm:justify-end cursor-pointer"
                    >
                      <Lock className="w-3 h-3" />
                      {isChangingPin ? "Cancel Change PIN" : "Change 4-Digit PIN"}
                    </button>
                    <button
                      onClick={() => {
                        setVerifiedEmployee(null);
                        setEmployeeNum("");
                        setEmployeePayrolls([]);
                        setActivePortalTab("timetracking");
                      }}
                      className="text-xs font-semibold text-zinc-650 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 underline text-left cursor-pointer"
                    >
                      Logout Statement View
                    </button>
                  </div>
                </div>

                {isChangingPin && (
                  <form onSubmit={handleChangePin} className="max-w-md mx-auto p-5 bg-blue-50/40 dark:bg-zinc-900/40 border border-blue-100 dark:border-blue-900/30 rounded-2xl mb-2 space-y-4 animate-fadeIn">
                    <div className="text-center pb-2 border-b border-blue-100/50 dark:border-blue-900/20">
                      <h4 className="text-xs font-bold font-mono text-blue-700 dark:text-blue-400 uppercase tracking-wider">Update Portal 4-Digit PIN</h4>
                      <p className="text-[10px] text-zinc-500 mt-0.5">Protect your account with a personal PIN code.</p>
                    </div>

                    {pinChangeError && (
                      <div className="p-2.5 bg-red-50 dark:bg-red-955/20 text-red-750 dark:text-red-400 text-[11px] rounded-xl border border-red-100 dark:border-red-900/30 font-semibold">
                        {pinChangeError}
                      </div>
                    )}

                    {pinChangeSuccess && (
                      <div className="p-2.5 bg-green-50 dark:bg-green-955/20 text-green-750 dark:text-green-400 text-[11px] rounded-xl border border-green-100 dark:border-green-900/30 font-semibold">
                        {pinChangeSuccess}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Current PIN</label>
                        <input
                          type="password"
                          required
                          maxLength={4}
                          placeholder="e.g. 1234"
                          value={currentPinInput}
                          onChange={(e) => setCurrentPinInput(e.target.value.replace(/\D/g, ""))}
                          className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-center font-mono font-bold tracking-widest text-zinc-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">New 4-Digit PIN</label>
                        <input
                          type="password"
                          required
                          maxLength={4}
                          placeholder="Enter 4 digits"
                          value={newPinInput}
                          onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, ""))}
                          className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-center font-mono font-bold tracking-widest text-zinc-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Confirm New PIN</label>
                        <input
                          type="password"
                          required
                          maxLength={4}
                          placeholder="Repeat 4 digits"
                          value={confirmNewPinInput}
                          onChange={(e) => setConfirmNewPinInput(e.target.value.replace(/\D/g, ""))}
                          className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-center font-mono font-bold tracking-widest text-zinc-900 dark:text-white"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded-xl text-xs shadow-sm transition-colors cursor-pointer"
                    >
                      Update 4-Digit PIN
                    </button>
                  </form>
                )}

                {loadingPayrolls ? (
                  <p className="text-xs text-zinc-400 italic text-center py-12 font-mono">Syncing official pay records safely...</p>
                ) : (() => {
                  const releasedPayrolls = employeePayrolls.filter(p => p.status !== "Draft");
                  if (releasedPayrolls.length === 0) {
                    return (
                      <div className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 text-center max-w-md mx-auto">
                        <Info className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
                        <h4 className="text-sm font-bold text-zinc-750 dark:text-zinc-200 uppercase tracking-wider">No pay records compiled</h4>
                        <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                          Your official payroll cycle statements are released after administrative review and validation. Please check back shortly, or reach out to HR.
                        </p>
                      </div>
                    );
                  }

                  const activePayStub = selectedPayslipDetails || releasedPayrolls[0];
                  const periodObj = payrollPeriods.find(p => p.periodId === activePayStub.cutoffPeriodId);
                  const activeRange = periodObj ? `${periodObj.startDate} to ${periodObj.endDate}` : "N/A";
                  const activeReleaseDate = periodObj ? periodObj.releaseDate : "N/A";

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 animate-in fade-in duration-200">
                      {/* Left Side: Ledger History Column */}
                      <div className="md:col-span-5 space-y-3">
                        <h4 className="text-xs font-bold font-mono text-zinc-450 uppercase tracking-wider pl-1">
                          Statement Ledger Cycle ({releasedPayrolls.length})
                        </h4>
                        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                          {releasedPayrolls.map((pay) => {
                            const p = payrollPeriods.find(pd => pd.periodId === pay.cutoffPeriodId);
                            const rangeStr = p ? `${p.startDate} to ${p.endDate}` : "N/A";
                            const isSelected = activePayStub.id === pay.id;

                            return (
                              <div
                                key={pay.id}
                                onClick={() => setSelectedPayslipDetails(pay)}
                                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                                  isSelected
                                    ? "bg-blue-50/75 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/60 shadow-xs"
                                    : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-805 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/10"
                                }`}
                              >
                                <div className="flex justify-between items-start">
                                  <div>
                                    <p className="text-[10px] font-mono font-bold text-zinc-450 uppercase tracking-wider">
                                      Pay cycle range
                                    </p>
                                    <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 mt-0.5">
                                      {rangeStr}
                                    </p>
                                  </div>
                                  <span className={`text-[9px] font-mono font-black uppercase px-2 py-0.5 rounded ${
                                    pay.status === "Paid" 
                                      ? "bg-green-100 dark:bg-green-950/40 text-green-750 dark:text-green-400" 
                                      : "bg-blue-100 dark:bg-blue-950/40 text-blue-750 dark:text-blue-400"
                                  }`}>
                                    {pay.status}
                                  </span>
                                </div>
                                <div className="mt-3 flex justify-between items-end border-t border-dashed border-zinc-200 dark:border-zinc-800 pt-2">
                                  <p className="text-[10px] font-mono text-zinc-400">Net payout</p>
                                  <p className="text-sm font-black font-mono text-blue-600 dark:text-blue-400">
                                    {currency}{(pay.finalSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right Side: Statement Details Breakdown Card */}
                      <div className="md:col-span-7 bg-zinc-50/50 dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 md:p-6 space-y-5">
                        <div className="flex justify-between items-start border-b border-zinc-200 dark:border-zinc-800 pb-3">
                          <div>
                            <h4 className="text-sm font-extrabold text-zinc-900 dark:text-white uppercase tracking-tight">
                              Earnings & Deductions Summary
                            </h4>
                            <p className="text-[10px] font-mono text-zinc-500 mt-0.5 font-semibold">
                              PAYROLL RECONCILIATION FILE
                            </p>
                          </div>
                          <button
                            onClick={() => downloadPayslipPDF(activePayStub)}
                            className="bg-emerald-550 hover:bg-emerald-600 font-bold text-xs text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-xs shrink-0 cursor-pointer transition-colors"
                            title="Download official PDF copy"
                          >
                            <Download className="w-3.5 h-3.5" /> PDF Copy
                          </button>
                        </div>

                        {/* Cutoff Meta details */}
                        <div className="grid grid-cols-2 gap-4 bg-white dark:bg-zinc-950 p-3.5 rounded-xl border border-zinc-200/60 dark:border-zinc-805 font-mono text-[10px] text-zinc-500 shadow-inner">
                          <div>
                            <p className="uppercase font-bold tracking-wider">CUTOFF RANGE:</p>
                            <p className="text-zinc-800 dark:text-zinc-200 mt-0.5 font-black">{activeRange}</p>
                          </div>
                          <div>
                            <p className="uppercase font-bold tracking-wider">OFFICIAL RELEASED:</p>
                            <p className="text-zinc-800 dark:text-zinc-200 mt-0.5 font-black">{activeReleaseDate}</p>
                          </div>
                        </div>

                        {/* Compensation Details Rows */}
                        <div className="space-y-2.5">
                          <p className="text-[10px] font-bold font-mono text-zinc-450 uppercase tracking-wider pl-1">
                            Breakdown calculation
                          </p>
                          <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-150 dark:border-zinc-850 divide-y divide-zinc-100 dark:divide-zinc-850 text-xs text-zinc-800 dark:text-zinc-200 overflow-hidden shadow-xs">
                            <div className="flex justify-between items-center px-4 py-3">
                              <span className="text-zinc-500">Regular Base Salary Package</span>
                              <span className="font-mono font-bold">
                                {currency}{(activePayStub.basicSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                            
                            {(activePayStub.allowance || 0) > 0 && (
                              <div className="flex justify-between items-center px-4 py-3">
                                <span className="text-zinc-500">Standard Allowance Components</span>
                                <span className="font-mono text-green-600 font-bold">
                                  +{currency}{(activePayStub.allowance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                            )}

                            {(activePayStub.otPay || 0) > 0 && (
                              <div className="flex justify-between items-center px-4 py-3">
                                <span className="text-zinc-500">Calculated Overtime Premium</span>
                                <span className="font-mono text-green-600 font-bold">
                                  +{currency}{(activePayStub.otPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                            )}

                            {((activePayStub.paidLeavePay || 0) + (activePayStub.birthdayLeavePay || 0)) > 0 && (
                              <div className="flex justify-between items-center px-4 py-3">
                                <span className="text-zinc-500 font-medium">Leaves Compensation & Benefits</span>
                                <span className="font-mono text-blue-500 font-bold">
                                  +{currency}{((activePayStub.paidLeavePay || 0) + (activePayStub.birthdayLeavePay || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                            )}

                            {(activePayStub.additionalCashPay || 0) > 0 && (
                              <div className="flex justify-between items-center px-4 py-3 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300">
                                <div>
                                  <span className="font-bold block">Boss Debt / Additional Cash Payout (+)</span>
                                  {activePayStub.additionalCashNotes && (
                                    <span className="text-[10px] text-zinc-500 font-normal block">{activePayStub.additionalCashNotes}</span>
                                  )}
                                </div>
                                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-black">
                                  +{currency}{(activePayStub.additionalCashPay || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                            )}

                            {(activePayStub.deductions || 0) > 0 && (
                              <div className="flex justify-between items-center px-4 py-3">
                                <span className="text-zinc-550">Penalties & Deductions (Absences, Lateness, Advances)</span>
                                <span className="font-mono text-red-600 font-bold">
                                  -{currency}{(activePayStub.deductions || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Gross and Net values summary */}
                        <div className="pt-4 border-t border-dashed border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                          <div>
                            <p className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest leading-none">
                              Total Net Earning
                            </p>
                            <p className="text-[9px] text-zinc-400 mt-1 font-sans">
                              Confidential Statement • System Verified
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-lg font-black font-mono text-blue-600 dark:text-blue-400 block tracking-tight leading-none">
                              {currency}{(activePayStub.finalSalary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                            <span className={`text-[9px] font-mono uppercase bg-zinc-100 dark:bg-zinc-850 text-zinc-500 font-black px-2 py-0.5 rounded mt-2 inline-block leading-none`}>
                              VOUCHER {activePayStub.status}
                            </span>
                          </div>
                        </div>

                        {/* Major download CTA button */}
                        <button
                          onClick={() => downloadPayslipPDF(activePayStub)}
                          className="w-full mt-2 bg-zinc-900 hover:bg-black dark:bg-zinc-800 dark:hover:bg-zinc-750 text-white font-bold py-3.5 px-4 rounded-xl text-xs uppercase tracking-wider shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer border border-zinc-800 dark:border-zinc-700"
                        >
                          <Download className="w-4 h-4 text-emerald-400 animate-bounce" />
                          Download Official PDF Payslip reference
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PUBLIC BULLETINS BROADCASTS */}
        {activePortalTab === "bulletins" && (
          <div className="space-y-6">
            <div className="text-center py-4 border-b border-zinc-150 dark:border-zinc-850 pb-5 animate-in fade-in duration-200">
              <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-zinc-900 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3">
                <Megaphone className="w-6 h-6 text-blue-550 animate-pulse" />
              </div>
              <h3 className="text-xl font-bold text-zinc-904 dark:text-zinc-50 tracking-tight">Oligarch Media Bulletin Board</h3>
              <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto font-sans leading-relaxed">Official corporate announcements, operation directives, and scheduling updates from the Admin staff.</p>
            </div>

            {loadingBulletins ? (
              <p className="text-xs text-zinc-400 italic text-center py-12 font-mono">Syncing official announcement files...</p>
            ) : announcements.length === 0 ? (
              <div className="text-center py-12 text-zinc-400 uppercase font-mono tracking-wider text-xs">
                📢 Zero active bulletins posted at this time.
              </div>
            ) : (
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                {announcements.map((bulletin) => {
                  const isYouTagged = verifiedEmployee && bulletin.mentionedEmployeeIds?.includes(verifiedEmployee.id || "");
                  return (
                    <div 
                      key={bulletin.id}
                      className={`p-5 border rounded-2xl space-y-3 shadow-xs transition-colors ${
                        isYouTagged
                          ? "bg-blue-500/5 dark:bg-blue-500/2 border-blue-500/30 hover:border-blue-500/40"
                          : "bg-zinc-50/50 dark:bg-zinc-900/20 border-zinc-150 dark:border-zinc-805 hover:border-blue-500/10"
                      }`}
                    >
                      {isYouTagged && (
                        <div className="flex items-center gap-1.5 text-[11px] text-blue-600 dark:text-blue-400 font-extrabold bg-blue-550/10 px-3 py-1.5 rounded-xl border border-blue-500/20 font-mono tracking-tight uppercase">
                          <span className="animate-bounce">🔔</span>
                          <span>You are tagged in this official bulletin!</span>
                        </div>
                      )}

                      <div className="flex justify-between items-start gap-4">
                        <h4 className="font-extrabold text-base text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                          <Megaphone className="w-4.5 h-4.5 text-blue-500 shrink-0" />
                          {bulletin.title}
                        </h4>
                        <span className="text-[10px] font-mono text-zinc-450 dark:text-zinc-500 shrink-0 font-bold bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 rounded-full uppercase leading-none">
                          BULLETIN
                        </span>
                      </div>

                      <p className="text-sm text-zinc-700 dark:text-zinc-300 font-sans leading-relaxed whitespace-pre-wrap">{bulletin.message}</p>

                      {bulletin.mentionedEmployeeNames && bulletin.mentionedEmployeeNames.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2.5">
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono self-center mr-1">TAGGED:</span>
                          {bulletin.mentionedEmployeeNames.map((name, i) => {
                            const isSelf = verifiedEmployee && name === verifiedEmployee.fullName;
                            return (
                              <span 
                                key={i} 
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md font-mono ${
                                  isSelf 
                                    ? "bg-blue-600 text-white shadow-xs" 
                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                                }`}
                              >
                                @{name}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Interactive Reactions */}
                      <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Active emoji reaction pills */}
                          {(() => {
                            const rx = bulletin.reactions || {};
                            const rxKeys = Object.keys(rx);
                            const grouped: Record<string, { id: string; name: string }[]> = {};
                            rxKeys.forEach(empId => {
                              const item = rx[empId];
                              if (!grouped[item.emoji]) {
                                grouped[item.emoji] = [];
                              }
                              grouped[item.emoji].push({ id: empId, name: item.employeeName });
                            });

                            return ["👍", "❤️", "🎉", "😮", "📌"].map(emoji => {
                              const people = grouped[emoji] || [];
                              const hasReacted = verifiedEmployee && rx[verifiedEmployee.id || ""]?.emoji === emoji;
                              if (people.length === 0) return null;
                              
                              const hoverText = people.map(p => p.name).join(", ");
                              return (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => handleReactToBulletin(bulletin.id, emoji)}
                                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-all cursor-pointer font-sans select-none border group relative ${
                                    hasReacted
                                      ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-300 font-bold"
                                      : "bg-zinc-100/50 hover:bg-zinc-150 border-zinc-200 text-zinc-600 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/70 dark:border-zinc-800 dark:text-zinc-300"
                                  }`}
                                  title={`Reacted by: ${hoverText}`}
                                >
                                  <span>{emoji}</span>
                                  <span className="font-mono text-[11px] font-bold">{people.length}</span>
                                  
                                  {/* Mini hover tooltip listing names */}
                                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block z-20 bg-zinc-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap shadow-md pointer-events-none">
                                    {hoverText}
                                  </div>
                                </button>
                              );
                            });
                          })()}

                          {/* Quick Add reaction buttons list */}
                          {verifiedEmployee && (
                            <div className="flex items-center gap-1 bg-zinc-100/50 dark:bg-zinc-900/30 px-2 py-1 rounded-full border border-zinc-200 dark:border-zinc-800">
                              <span className="text-[10.5px] font-semibold text-zinc-400 mr-1.5 font-sans">React:</span>
                              {["👍", "❤️", "🎉", "😮", "📌"].map(emoji => {
                                const rx = bulletin.reactions || {};
                                const hasReacted = verifiedEmployee && rx[verifiedEmployee.id || ""]?.emoji === emoji;
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => handleReactToBulletin(bulletin.id, emoji)}
                                    className={`w-5.5 h-5.5 rounded-full flex items-center justify-center text-xs hover:scale-120 transition-transform cursor-pointer hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 ${
                                      hasReacted ? "bg-blue-100/60 dark:bg-blue-955/40 scale-110" : ""
                                    }`}
                                    title={`React with ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Reaction summary count info to know who read */}
                        {(() => {
                          const rx = bulletin.reactions || {};
                          const totalReacts = Object.keys(rx).length;
                          if (totalReacts === 0) return null;
                          return (
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono italic">
                              {totalReacts} {totalReacts === 1 ? "employee has" : "employees have"} read & acknowledged
                            </span>
                          );
                        })()}
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-dashed border-zinc-155 dark:border-zinc-800 text-[10px] text-zinc-400 font-mono">
                        <span className="font-bold text-blue-600 dark:text-blue-400 uppercase bg-blue-50 dark:bg-blue-955/20 px-1.5 py-0.5 rounded">
                          Published by {bulletin.sender || "Operations Admin"}
                        </span>
                        <span>•</span>
                        <span>Posted: {new Date(bulletin.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB: EMPLOYEE NOTIFICATIONS FEED */}
        {activePortalTab === "notifications" && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-5 border-b border-zinc-150 dark:border-zinc-850">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Bell className="w-6 h-6 text-indigo-550" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-zinc-904 dark:text-zinc-50 tracking-tight">My Alerts & Status Updates</h3>
                  <p className="text-xs text-zinc-500 mt-0.5 font-sans leading-relaxed">
                    Personalized status notifications about your leave requests, attendance logs, and pay approvals.
                  </p>
                </div>
              </div>

              {employeeNotifications.some(n => !n.read) && (
                <button
                  onClick={handleMarkAllNotificationsAsRead}
                  className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-indigo-600 dark:text-zinc-300 text-xs font-bold rounded-xl border border-indigo-100 dark:border-zinc-800 transition-colors cursor-pointer shrink-0 self-start md:self-auto"
                >
                  Mark all as read
                </button>
              )}
            </div>

            {employeeNotifications.length === 0 ? (
              <div className="text-center py-16 text-zinc-400 dark:text-zinc-550 uppercase font-mono tracking-wider text-xs">
                🔔 Zero active alerts found for your account.
              </div>
            ) : (
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                {employeeNotifications.map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => {
                      if (!notif.read && notif.id) {
                        handleMarkNotificationAsRead(notif.id);
                      }
                    }}
                    className={`p-5 rounded-2xl border transition-all relative ${
                      notif.read
                        ? "bg-zinc-50/30 dark:bg-zinc-900/10 border-zinc-150 dark:border-zinc-805 opacity-75"
                        : "bg-indigo-50/10 dark:bg-indigo-950/5 border-indigo-200 dark:border-indigo-900/30 shadow-xs"
                    }`}
                  >
                    {!notif.read && (
                      <span className="absolute top-5 right-5 h-2.5 w-2.5 rounded-full bg-indigo-600 animate-pulse" />
                    )}

                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] font-mono shrink-0 font-extrabold px-2.5 py-1 rounded-full uppercase leading-none ${
                            notif.type === "Success"
                              ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400"
                              : notif.type === "Alert"
                              ? "bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400"
                              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-650 dark:text-zinc-400"
                          }`}>
                            {notif.title}
                          </span>
                          <span className="text-zinc-300 dark:text-zinc-700 font-mono text-[10px]">•</span>
                          <span className="text-[10px] font-mono text-zinc-405 dark:text-zinc-500 font-bold">
                            {new Date(notif.createdAt).toLocaleString()}
                          </span>
                        </div>

                        <p className="text-sm font-sans font-medium text-zinc-800 dark:text-zinc-200 leading-relaxed">
                          {notif.message}
                        </p>

                        {notif.attendanceCopyRequestId && (
                          <div className="mt-3 flex items-center gap-2">
                            {notif.downloaded ? (
                              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-xs font-semibold rounded-xl border border-zinc-200 dark:border-zinc-800 font-mono">
                                <Lock className="w-3.5 h-3.5 text-zinc-400" />
                                <span>Already Downloaded (One-Time Access Expired)</span>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={downloadingNotifId === notif.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownloadFromNotification(notif);
                                }}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {downloadingNotifId === notif.id ? (
                                  <>
                                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    <span>Downloading Report...</span>
                                  </>
                                ) : (
                                  <>
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Download Attendance Copy (Once)</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-start">
                        {notif.id && !notif.read && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (notif.id) handleMarkNotificationAsRead(notif.id);
                            }}
                            className="text-[10px] font-mono font-extrabold text-indigo-600 dark:text-indigo-400 uppercase bg-indigo-50 dark:bg-indigo-955/20 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer font-bold"
                          >
                            Dismiss
                          </button>
                        )}
                        {notif.id && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (notif.id) handleDeleteNotification(notif.id);
                            }}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-955/20 transition-colors cursor-pointer"
                            title="Delete notification"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: TIME TRACKING / CLOCK IN/OUT */}
        {activePortalTab === "timetracking" && (
          <div className="space-y-6">
            {!verifiedEmployee ? (
              /* Phase A: Employee Credentials Verification for Time Tracking */
              <>
              <form onSubmit={handleVerify} className="max-w-md mx-auto space-y-5 py-6" id="portal_time_tracking_verify_form">
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-zinc-900 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3">
                    <Clock className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-lg text-zinc-850 dark:text-zinc-200">Employee Portal Login</h3>
                  <p className="text-xs text-zinc-500 mt-1 font-sans">Please enter your Employee Number and 4-digit PIN passcode to access the clocking system.</p>
                </div>

                {authError && (
                  <div className="p-3 bg-red-50 dark:bg-red-955/20 text-red-750 dark:text-red-400 text-xs rounded-xl flex items-center gap-2 border border-red-100 dark:border-red-900/30 font-semibold">
                    <ShieldAlert className="w-4 h-4 shrink-0 text-red-500" />
                    <span>{authError}</span>
                  </div>
                )}
                
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-650 dark:text-zinc-400 font-mono">EMPLOYEE ID / NUMBER</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 003"
                    value={employeeNum}
                    onChange={(e) => setEmployeeNum(e.target.value)}
                    className="w-full text-sm px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-550 dark:text-zinc-100 uppercase text-center font-bold tracking-wider"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-650 dark:text-zinc-400 font-mono">4-DIGIT PIN PASSCODE</label>
                  <div className="relative">
                    <input
                      type={showPortalPin ? "text" : "password"}
                      required
                      maxLength={4}
                      placeholder="e.g. 1234"
                      value={portalPin}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        setPortalPin(digits);
                      }}
                      className="w-full text-sm px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-550 dark:text-zinc-100 text-center font-bold tracking-widest font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPortalPin(!showPortalPin)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs font-mono font-bold"
                    >
                      {showPortalPin ? "HIDE" : "SHOW"}
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500 font-mono text-center mt-1">Default PIN is 1234. You can change this after logging in.</p>
                </div>

                <button
                  type="submit"
                  disabled={isVerifying}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 px-4 rounded-xl text-sm shadow-sm transition-colors flex items-center justify-center gap-1 cursor-pointer font-sans"
                >
                  {isVerifying ? "Logging in..." : "Login & Continue"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              {/* CP Mobile App Installation Helper */}
              {showInstallHelper && (
                <div className="max-w-md mx-auto mt-6 p-5 rounded-2xl bg-zinc-50/60 dark:bg-zinc-900/60 border border-zinc-200/50 dark:border-zinc-800/80 text-center space-y-3 shadow-xs relative">
                  <button
                    onClick={dismissInstallHelper}
                    className="absolute top-3.5 right-3.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-1 rounded-full hover:bg-zinc-150 dark:hover:bg-zinc-800 cursor-pointer"
                    title="Don't show this again"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex items-center justify-center gap-2 text-blue-600 dark:text-blue-400">
                    <Smartphone className="w-4 h-4 animate-bounce" />
                    <h4 className="font-bold text-xs uppercase tracking-wider font-mono">Install on Cellphone (CP)</h4>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-sans leading-relaxed">
                    Download and add this portal directly to your phone's home screen for easy daily access and offline clock-in/out support!
                  </p>
                  <div className="grid grid-cols-2 gap-3 pt-1 text-left">
                    <div className="p-3 rounded-xl bg-white dark:bg-zinc-950/40 border border-zinc-200/60 dark:border-zinc-800/50">
                      <p className="text-[10px] font-bold text-zinc-700 dark:text-zinc-300 font-mono flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Android (Chrome)
                      </p>
                      <ol className="text-[9px] text-zinc-500 dark:text-zinc-400 mt-1.5 list-decimal pl-3.5 space-y-1">
                        <li>Tap the <strong>three dots</strong> on top right.</li>
                        <li>Select <strong>"Add to Home Screen"</strong> or <strong>"Install App"</strong>.</li>
                      </ol>
                    </div>
                    <div className="p-3 rounded-xl bg-white dark:bg-zinc-950/40 border border-zinc-200/60 dark:border-zinc-800/50">
                      <p className="text-[10px] font-bold text-zinc-700 dark:text-zinc-300 font-mono flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> iPhone (Safari)
                      </p>
                      <ol className="text-[9px] text-zinc-500 dark:text-zinc-400 mt-1.5 list-decimal pl-3.5 space-y-1">
                        <li>Tap the <strong>Share</strong> button at the bottom.</li>
                        <li>Scroll and choose <strong>"Add to Home Screen"</strong>.</li>
                      </ol>
                    </div>
                  </div>
                  <div className="pt-1 text-center">
                    <button
                      onClick={dismissInstallHelper}
                      className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-mono font-bold"
                    >
                      Hide & Don't Show Again
                    </button>
                  </div>
                </div>
              )}
              </>
            ) : (
              /* Phase B: Verified Employee Time Tracker Interface */
              <div className="max-w-xl mx-auto space-y-6" id="portal_time_tracking_verified_panel">
                {/* Employee Welcome Banner */}
                <div className="p-5 bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <img 
                      src={verifiedEmployee.profilePicture || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"} 
                      alt="avatar" 
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shadow-sm shrink-0"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-zinc-800 dark:text-zinc-150 text-base">{verifiedEmployee.fullName}</h3>
                        {fetchingAttendance ? (
                          <span className="text-[10px] text-zinc-400 font-mono font-bold animate-pulse uppercase">Syncing...</span>
                        ) : !todayAttendance ? (
                          <span className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase rounded bg-red-50 text-red-650 dark:bg-red-955/20 dark:text-red-400 border border-red-100 dark:border-red-900/25">
                            Off Duty
                          </span>
                        ) : todayAttendance.status === "Birthday Leave" ? (
                          <span className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase rounded bg-pink-50 text-pink-600 dark:bg-pink-955/20 dark:text-pink-400 border border-pink-200 dark:border-pink-800/40">
                            🎂 Birthday Leave (Approved)
                          </span>
                        ) : todayAttendance.status === "Paid Leave" || todayAttendance.status?.toLowerCase().includes("leave") ? (
                          <span className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase rounded bg-purple-50 text-purple-600 dark:bg-purple-955/20 dark:text-purple-400 border border-purple-200 dark:border-purple-800/40">
                            Approved Leave ({todayAttendance.status})
                          </span>
                        ) : todayAttendance.status === "Late" && !todayAttendance.isLateExcused ? (
                          <span className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase rounded bg-rose-50 text-rose-650 dark:bg-rose-955/20 dark:text-rose-400 border border-rose-100 dark:border-rose-900/25 animate-pulse">
                            On Duty (Late)
                          </span>
                        ) : todayAttendance.status === "Present" || (todayAttendance.status === "Late" && todayAttendance.isLateExcused) ? (
                          <span className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase rounded bg-emerald-50 text-emerald-650 dark:bg-emerald-955/20 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/25">
                            On Duty
                          </span>
                        ) : todayAttendance.status === "On Break" ? (
                          <span className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase rounded bg-amber-50 text-amber-650 dark:bg-amber-955/20 dark:text-amber-400 border border-amber-100 dark:border-amber-900/25 animate-pulse">
                            On Break
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase rounded bg-zinc-100 text-zinc-650 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                            Shift Done
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 font-mono uppercase tracking-wider">{verifiedEmployee.position} • {verifiedEmployee.department}</p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:items-end gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setIsChangingPin(!isChangingPin);
                        setPinChangeError("");
                        setPinChangeSuccess("");
                      }}
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1 justify-start sm:justify-end cursor-pointer"
                    >
                      <Lock className="w-3 h-3" />
                      {isChangingPin ? "Cancel Change PIN" : "Change 4-Digit PIN"}
                    </button>
                    <button
                      onClick={() => {
                        setVerifiedEmployee(null);
                        setEmployeeNum("");
                        setActivePortalTab("timetracking");
                      }}
                      className="text-xs font-bold text-red-600 hover:text-red-700 dark:text-red-455 dark:hover:text-red-350 underline text-left cursor-pointer"
                    >
                      Logout
                    </button>
                  </div>
                </div>

                {isChangingPin && (
                  <form onSubmit={handleChangePin} className="max-w-md mx-auto p-5 bg-blue-50/40 dark:bg-zinc-900/40 border border-blue-100 dark:border-blue-900/30 rounded-2xl mb-2 space-y-4 animate-fadeIn">
                    <div className="text-center pb-2 border-b border-blue-100/50 dark:border-blue-900/20">
                      <h4 className="text-xs font-bold font-mono text-blue-700 dark:text-blue-400 uppercase tracking-wider">Update Portal 4-Digit PIN</h4>
                      <p className="text-[10px] text-zinc-500 mt-0.5">Protect your account with a personal PIN code.</p>
                    </div>

                    {pinChangeError && (
                      <div className="p-2.5 bg-red-50 dark:bg-red-955/20 text-red-750 dark:text-red-400 text-[11px] rounded-xl border border-red-100 dark:border-red-900/30 font-semibold">
                        {pinChangeError}
                      </div>
                    )}

                    {pinChangeSuccess && (
                      <div className="p-2.5 bg-green-50 dark:bg-green-955/20 text-green-750 dark:text-green-400 text-[11px] rounded-xl border border-green-100 dark:border-green-900/30 font-semibold">
                        {pinChangeSuccess}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Current PIN</label>
                        <input
                          type="password"
                          required
                          maxLength={4}
                          placeholder="e.g. 1234"
                          value={currentPinInput}
                          onChange={(e) => setCurrentPinInput(e.target.value.replace(/\D/g, ""))}
                          className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-center font-mono font-bold tracking-widest text-zinc-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">New 4-Digit PIN</label>
                        <input
                          type="password"
                          required
                          maxLength={4}
                          placeholder="Enter 4 digits"
                          value={newPinInput}
                          onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, ""))}
                          className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-center font-mono font-bold tracking-widest text-zinc-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Confirm New PIN</label>
                        <input
                          type="password"
                          required
                          maxLength={4}
                          placeholder="Repeat 4 digits"
                          value={confirmNewPinInput}
                          onChange={(e) => setConfirmNewPinInput(e.target.value.replace(/\D/g, ""))}
                          className="w-full text-xs px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-center font-mono font-bold tracking-widest text-zinc-900 dark:text-white"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded-xl text-xs shadow-sm transition-colors cursor-pointer"
                    >
                      Update 4-Digit PIN
                    </button>
                  </form>
                )}

                {/* DEVOTION & PRAYER ROSTER WIDGET (12:00 AM ACTIVE) */}
                {(() => {
                  const todaySched = devotionSchedules.find((s) => s.date === currentLocalDateStr);
                  const isAssigned = !!assignedDevotionNotice;

                  if (isAssigned && assignedDevotionNotice) {
                    return (
                      <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-indigo-500/10 to-amber-500/15 border-2 border-amber-500/40 shadow-lg relative overflow-hidden animate-in fade-in duration-300">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-mono text-[10px] font-black uppercase tracking-wider flex items-center gap-1 animate-pulse">
                                <Sparkles className="w-3 h-3" /> ASSIGNED TODAY (12:00 AM)
                              </span>
                              <span className="text-xs font-mono text-zinc-400">
                                {assignedDevotionNotice.isTomorrow ? "Upcoming Tomorrow" : "Today's Shift"}
                              </span>
                            </div>
                            <h4 className="text-sm font-extrabold text-zinc-900 dark:text-white flex items-center gap-2">
                              <span>You are assigned:</span>
                              <span className="text-amber-500 font-black">
                                {assignedDevotionNotice.isDevotionLeader && assignedDevotionNotice.isPrayerLeader 
                                  ? "Devotion & Opening Prayer Leader" 
                                  : assignedDevotionNotice.isDevotionLeader 
                                  ? "Devotion Leader" 
                                  : "Opening Prayer Leader"}
                              </span>
                            </h4>
                            <p className="text-xs text-zinc-600 dark:text-zinc-300 font-mono">
                              {assignedDevotionNotice.isDevotionLeader 
                                ? `Partner (Opening Prayer Leader): ${assignedDevotionNotice.schedule.prayerLeaderName || "Team"}`
                                : `Partner (Devotion Leader): ${assignedDevotionNotice.schedule.devotionLeaderName || "Team"}`}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                            <button
                              type="button"
                              onClick={() => setShowDevotionPopup(true)}
                              className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-mono font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer"
                            >
                              <BookOpen className="w-3.5 h-3.5" />
                              <span>View Notice</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPortalSubstituteTargetRole(assignedDevotionNotice.isDevotionLeader ? "devotion" : "prayer");
                                setShowPortalSubstituteModal(true);
                              }}
                              className="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-500 text-xs font-mono font-bold transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <UserX className="w-3.5 h-3.5" />
                              <span>Absent? Swap</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (todaySched) {
                    const devLeader = todaySched.isAbsent && todaySched.substituteDevotionLeaderName 
                      ? `${todaySched.substituteDevotionLeaderName} (Sub)` 
                      : todaySched.devotionLeaderName;
                    const prayLeader = todaySched.isPrayerAbsent && todaySched.substitutePrayerLeaderName 
                      ? `${todaySched.substitutePrayerLeaderName} (Sub)` 
                      : todaySched.prayerLeaderName;

                    return (
                      <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                            <BookOpen className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase font-bold text-zinc-400">
                              <span>Today's Devotion Roster</span>
                              <span className="text-zinc-600">•</span>
                              <span className="text-emerald-500">12:00 AM Active</span>
                            </div>
                            <p className="font-bold text-zinc-800 dark:text-zinc-200 mt-0.5">
                              Devotion: <span className="text-indigo-400">{devLeader}</span> • Prayer: <span className="text-sky-400">{prayLeader}</span>
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActivePortalTab("devotion")}
                          className="px-3 py-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-mono text-xs font-bold transition-all self-start sm:self-auto cursor-pointer"
                        >
                          View Roster & Flyer
                        </button>
                      </div>
                    );
                  }

                  return null;
                })()}

                  {/* Minimalist Clock Card with quiet confidence */}
                  <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-150 dark:border-zinc-800/80 rounded-2xl p-8 text-center space-y-4 shadow-sm relative overflow-hidden">
                    {/* Decorative neon accent if running */}
                    {todayAttendance && (
                      <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-emerald-500 via-blue-500 to-indigo-500" />
                    )}
                    
                    {(() => {
                      const activeShift = verifiedEmployee ? getEmployeeSchedule(verifiedEmployee, settings) : {
                        workHourStart: settings?.workHourStart || "21:00",
                        workHourEnd: settings?.workHourEnd || "06:00",
                        requiredHours: 8,
                        label: `${formatTo12Hour(settings?.workHourStart || "21:00")} – ${formatTo12Hour(settings?.workHourEnd || "06:00")}`,
                        isCustom: false,
                        notes: "Standard",
                        isOverride: false,
                        isRestDay: false,
                        source: "default" as const,
                        dayOfWeek: "monday" as const
                      };
                      // If an override is active, it takes immediate precedence over previously saved shiftStart
                      const activeShiftStart = activeShift.isOverride ? activeShift.workHourStart : (todayAttendance?.shiftStart || activeShift.workHourStart);
                      const activeShiftEnd = activeShift.isOverride ? activeShift.workHourEnd : (todayAttendance?.shiftEnd || activeShift.workHourEnd);

                      return (
                        <div className="space-y-1">
                          <p className="text-[11px] font-mono font-bold text-blue-600 dark:text-blue-400 tracking-widest uppercase flex items-center justify-center gap-1.5">
                            {todayAttendance ? (
                              <>
                                <span>ACTIVE SHIFT WORKING TIMER</span>
                                {activeShift.isOverride && (
                                  <span className="text-[9px] font-sans font-extrabold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 uppercase tracking-wider">
                                    Override Active
                                  </span>
                                )}
                              </>
                            ) : (
                              "Media Hub Time Server (Local)"
                            )}
                          </p>
                          
                          <div className="text-4xl sm:text-5xl font-black font-mono tracking-wider text-zinc-900 dark:text-white drop-shadow-sm">
                            {todayAttendance ? (
                              getRunningWorkedTime(todayAttendance, currentTime, activeShiftStart, activeShiftEnd, settings?.dstOffset || 0)
                            ) : (
                              currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                            )}
                          </div>
                          
                          <p className="text-xs font-semibold text-zinc-450 dark:text-zinc-400 uppercase tracking-widest pt-1 font-mono">
                            {todayAttendance ? (
                              <>
                                Shift In: {todayAttendance.timeIn ? formatTo12Hour(todayAttendance.timeIn) : "—"}
                                {todayAttendance.earlyInApproved && (
                                  <span className="ml-2 inline-block text-[9px] font-sans font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 uppercase tracking-wider">
                                    Early-In Approved
                                  </span>
                                )}
                              </>
                            ) : (
                              currentTime.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                            )}
                          </p>

                          {/* Notice if early clock-in but not approved yet */}
                          {todayAttendance && todayAttendance.timeIn && !todayAttendance.earlyInApproved && (() => {
                            const parseToSecs = (tStr: string) => {
                              if (typeof tStr !== 'string') return 0;
                              const [h, m] = tStr.split(":").map(Number);
                              return h * 3600 + m * 60;
                            };
                            const inSecs = parseToSecs(todayAttendance.timeIn);
                            const schedSecs = parseToSecs(activeShiftStart);
                            
                            let isEarly = inSecs < schedSecs;
                            if (inSecs < schedSecs - 6 * 3600) {
                              isEarly = false;
                            }
                            
                            if (isEarly) {
                              return (
                                <div className="pt-3.5 space-y-2 border-t border-dashed border-zinc-200 dark:border-zinc-800 mt-3.5 max-w-sm mx-auto">
                                  <p className="text-[10px] font-sans text-amber-600 dark:text-amber-400 leading-normal flex items-center justify-center gap-1.5 font-bold">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                    Timer starts at shift start ({formatTo12Hour(activeShiftStart)}) unless authorized by Admin.
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAdminOverrideError("");
                                      setAdminOverridePin("");
                                      setShowAdminOverrideModal(true);
                                    }}
                                    className="px-3.5 py-1.5 text-[10px] font-mono font-bold uppercase rounded-lg border border-blue-500/20 bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 transition-all cursor-pointer inline-flex items-center gap-1 shrink-0"
                                  >
                                    <Lock className="w-3 h-3" /> Admin Early-In Override
                                  </button>
                                </div>
                              );
                            }
                            return null;
                          })()}

                          {/* Notice if late checked-in */}
                          {todayAttendance && todayAttendance.lateMinutes > 0 && !todayAttendance.isLateExcused && todayAttendance.status !== "Paid Leave" && todayAttendance.status !== "Birthday Leave" && !todayAttendance.status?.toLowerCase().includes("leave") && (
                            <div className="pt-3.5 border-t border-dashed border-zinc-200 dark:border-zinc-800 mt-3.5 max-w-sm mx-auto">
                              <p className="text-[11px] font-sans text-rose-600 dark:text-rose-400 leading-normal flex items-center justify-center gap-1.5 font-extrabold animate-pulse">
                                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
                                Late Tardy Notice: You logged in {todayAttendance.lateMinutes} minutes late for your scheduled {formatTo12Hour(activeShiftStart)} shift.
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                {/* Live Real-Time Punch Control Center */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1 text-[11px] font-mono">
                    <span className="flex items-center gap-1.5 font-bold text-zinc-400">
                      <span className={`w-2 h-2 rounded-full ${todayAttendance ? (todayAttendance.status === "Timed Out" ? "bg-blue-400" : "bg-emerald-400 animate-ping") : "bg-zinc-500"}`} />
                      {todayAttendance ? (todayAttendance.status === "Timed Out" ? "Shift Concluded" : "Shift In Progress (Live Sync)") : "Terminal Ready • One-Tap Punch"}
                    </span>
                    <span className="text-zinc-500 text-[10px]">
                      Instant Cloud Logging (No OK prompt)
                    </span>
                  </div>

                  {/* Action Buttons Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* BUTTON 1: TIME IN */}
                    <button
                      type="button"
                      onClick={handlePortalTimeIn}
                      disabled={!!todayAttendance || isSubmittingPunch}
                      className={`relative p-5 rounded-2xl font-black font-sans text-xs uppercase tracking-wider transition-all duration-200 flex flex-col items-center justify-center gap-2 border shadow-lg ${
                        !todayAttendance
                          ? "bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white border-emerald-400/40 shadow-emerald-950/50 hover:scale-[1.02] active:scale-[0.98] cursor-pointer ring-1 ring-emerald-400/30"
                          : "bg-zinc-900/60 text-zinc-400 border-zinc-800/80 opacity-70 cursor-not-allowed"
                      }`}
                    >
                      {isSubmittingPunch && !todayAttendance ? (
                        <>
                          <RefreshCw className="w-6 h-6 animate-spin text-emerald-300" />
                          <span className="font-mono text-[11px]">Recording Punch...</span>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <LogIn className="w-5 h-5 text-emerald-300" />
                            <span className="text-sm font-black">
                              {todayAttendance?.status === "Birthday Leave"
                                ? "🎂 Birthday Leave (8h Paid)"
                                : todayAttendance?.status === "Paid Leave" || todayAttendance?.status?.toLowerCase().includes("leave")
                                  ? `🌴 ${todayAttendance.status} (8h Paid)`
                                  : "Time In"}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono font-normal opacity-80 normal-case tracking-normal">
                            {!todayAttendance ? "Tap to record shift start accurately" : `Logged: ${todayAttendance.timeIn ? formatTo12Hour(todayAttendance.timeIn) : "Active"}`}
                          </span>
                        </>
                      )}
                    </button>

                    {/* BUTTON 2: TIME OUT */}
                    <button
                      type="button"
                      onClick={handlePortalTimeOut}
                      disabled={!todayAttendance || todayAttendance.status === "Timed Out" || todayAttendance.status === "On Break" || isSubmittingPunch}
                      className={`relative p-5 rounded-2xl font-black font-sans text-xs uppercase tracking-wider transition-all duration-200 flex flex-col items-center justify-center gap-2 border shadow-lg ${
                        todayAttendance && todayAttendance.status !== "Timed Out" && todayAttendance.status !== "On Break"
                          ? "bg-gradient-to-r from-rose-600 via-rose-500 to-red-600 hover:from-rose-500 hover:to-red-500 text-white border-rose-400/40 shadow-rose-950/50 hover:scale-[1.02] active:scale-[0.98] cursor-pointer ring-1 ring-rose-400/30"
                          : "bg-zinc-900/60 text-zinc-500 border-zinc-800/80 opacity-60 cursor-not-allowed"
                      }`}
                    >
                      {isSubmittingPunch && todayAttendance && todayAttendance.status !== "Timed Out" ? (
                        <>
                          <RefreshCw className="w-6 h-6 animate-spin text-rose-300" />
                          <span className="font-mono text-[11px]">Recording Punch...</span>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <LogOut className="w-5 h-5 text-rose-300" />
                            <span className="text-sm font-black">Time Out</span>
                          </div>
                          <span className="text-[10px] font-mono font-normal opacity-80 normal-case tracking-normal">
                            {todayAttendance && todayAttendance.status !== "Timed Out"
                              ? "Tap to record shift end accurately"
                              : todayAttendance?.status === "Timed Out"
                              ? `Logged: ${todayAttendance.timeOut ? formatTo12Hour(todayAttendance.timeOut) : "Completed"}`
                              : "Requires active Clock-In"}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Attendance Summary and Logs */}
                {todayAttendance && (
                  <div className="p-5 border border-zinc-200 dark:border-zinc-800/85 bg-zinc-50/50 dark:bg-zinc-900/20 rounded-2xl space-y-4">
                    <h4 className="text-xs font-bold font-mono text-zinc-450 dark:text-zinc-400 uppercase tracking-widest border-b border-zinc-200 dark:border-zinc-800 pb-2">
                      Today's Log Timeline
                    </h4>
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div className="p-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-150 dark:border-zinc-800">
                        <p className="text-[9px] font-mono text-zinc-400 uppercase">Clock In</p>
                        <p className="text-sm font-bold font-mono text-zinc-850 dark:text-zinc-200 mt-1">
                          {(() => {
                            if (!todayAttendance.timeIn) return "--:--:--";
                            if (todayAttendance.earlyInApproved) return todayAttendance.timeIn;
                            const parseToSecs = (t) => {
                              const [h, m, s = 0] = String(t).split(":").map(Number);
                              return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
                            };
                            const tSecs = parseToSecs(todayAttendance.timeIn);
                            const empSched = verifiedEmployee ? getEmployeeSchedule(verifiedEmployee, settings) : null;
                            let sStr = todayAttendance.shiftStart || empSched?.workHourStart || settings?.workHourStart || "21:00";
                            if (sStr.split(":").length === 2) sStr += ":00";
                            const sSecs = parseToSecs(sStr);
                            if (tSecs < sSecs && (sSecs - tSecs) < 12 * 3600) {
                              return sStr;
                            }
                            return todayAttendance.timeIn;
                          })()}
                        </p>
                      </div>
                      <div className="p-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-150 dark:border-zinc-800">
                        <p className="text-[9px] font-mono text-zinc-400 uppercase">Clock Out</p>
                        <p className="text-sm font-bold font-mono text-zinc-850 dark:text-zinc-200 mt-1">
                          {todayAttendance.timeOut || "--:--:--"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                
                <LateTracker 
                  employeePayrolls={employeePayrolls} 
                  payrollPeriods={payrollPeriods} 
                  settings={settings}
                  verifiedEmployee={verifiedEmployee}
                />

                {/* shift hours message */}
                <div className="text-center">
                  <span className="text-[10px] font-mono text-zinc-450 dark:text-zinc-500 uppercase tracking-widest inline-flex items-center gap-1.5 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800">
                    <Lock className="w-3.5 h-3.5 text-blue-500" />
                    {(() => {
                      const empSched = verifiedEmployee ? getEmployeeSchedule(verifiedEmployee, settings) : null;
                      if (empSched) {
                        return (
                          <span>
                            Authorized HR Terminal • Your Shift: <strong>{empSched.isRestDay ? "Rest Day / Off" : empSched.label}</strong> ({empSched.requiredHours}h{empSched.isOverride ? " • Real-Time Override Active" : empSched.source === "weekly" ? ` • ${(empSched.dayOfWeek || "").toUpperCase()}` : empSched.isCustom ? " • Custom Shift" : ""})
                          </span>
                        );
                      }
                      return (
                        <span>
                          Authorized HR Terminal • Company Shift: {formatTo12Hour(settings?.workHourStart || "21:00")} to {formatTo12Hour(settings?.workHourEnd || "06:00")}
                        </span>
                      );
                    })()}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 7: DEVOTION & PRAYER ROSTER & SCHEDULE FLYER */}
        {activePortalTab === "devotion" && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Header */}
            <div className="text-center py-4 border-b border-zinc-150 dark:border-zinc-850 pb-5">
              <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-3">
                <BookOpen className="w-6 h-6 animate-pulse" />
              </div>
              <div className="flex items-center justify-center gap-2">
                <h3 className="font-bold text-lg text-zinc-850 dark:text-zinc-200">Daily Devotion & Prayer Ministry</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  12:00 AM Active
                </span>
              </div>
              <p className="text-xs text-zinc-500 mt-1 max-w-lg mx-auto font-sans">
                Official schedule for scripture devotions and opening prayers. Schedules roll over every midnight (12:00 AM) so team members on the night shift are aware before clocking out.
              </p>
            </div>

            {/* Today's Spotlight Box */}
            {(() => {
              const todaySched = devotionSchedules.find((s) => s.date === currentLocalDateStr);
              const tomorrowSched = devotionSchedules.find((s) => s.date === nextLocalDateStr);

              return (
                <div className="space-y-6">
                  {/* Today's Assignment Card */}
                  <div className="p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 via-zinc-900 to-indigo-950/30 border border-amber-500/30 shadow-lg space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                        <div>
                          <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider block">
                            TODAY'S DEVOTION DUTY • {currentLocalDateStr}
                          </span>
                          <h4 className="text-base font-black text-white">
                            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                          </h4>
                        </div>
                      </div>

                      {devotionSettings?.scheduleImageUrl && (
                        <button
                          type="button"
                          onClick={() => setIsPortalImageViewerOpen(true)}
                          className="px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-300 text-xs font-mono font-bold flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Official Flyer</span>
                        </button>
                      )}
                    </div>

                    {todaySched ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* Devotion Leader */}
                          <div className={`p-4 rounded-xl border ${
                            todaySched.isAbsent ? "bg-rose-950/20 border-rose-500/30" : "bg-zinc-900/80 border-zinc-800"
                          }`}>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-[10px] font-mono uppercase font-bold text-indigo-400">
                                📖 DEVOTION LEADER
                              </span>
                              {todaySched.isAbsent && (
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-bold uppercase">
                                  Absent (Substituted)
                                </span>
                              )}
                            </div>
                            {todaySched.isAbsent && todaySched.substituteDevotionLeaderName ? (
                              <div>
                                <div className="text-xs text-rose-300 line-through">
                                  Original: {todaySched.devotionLeaderName}
                                </div>
                                <div className="text-base font-black text-amber-400 mt-1 flex items-center gap-1.5">
                                  <Repeat className="w-4 h-4 text-amber-400" />
                                  <span>{todaySched.substituteDevotionLeaderName} (Substitute)</span>
                                </div>
                              </div>
                            ) : (
                              <div className="text-base font-black text-white">
                                {todaySched.devotionLeaderName}
                              </div>
                            )}
                            <p className="text-[11px] text-zinc-400 mt-1">Leads reflection & scripture reading</p>
                          </div>

                          {/* Prayer Leader */}
                          <div className={`p-4 rounded-xl border ${
                            todaySched.isPrayerAbsent ? "bg-rose-950/20 border-rose-500/30" : "bg-zinc-900/80 border-zinc-800"
                          }`}>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-[10px] font-mono uppercase font-bold text-sky-400">
                                🙏 PRAYER LEADER
                              </span>
                              {todaySched.isPrayerAbsent && (
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-bold uppercase">
                                  Absent (Substituted)
                                </span>
                              )}
                            </div>
                            {todaySched.isPrayerAbsent && todaySched.substitutePrayerLeaderName ? (
                              <div>
                                <div className="text-xs text-rose-300 line-through">
                                  Original: {todaySched.prayerLeaderName}
                                </div>
                                <div className="text-base font-black text-amber-400 mt-1 flex items-center gap-1.5">
                                  <Repeat className="w-4 h-4 text-amber-400" />
                                  <span>{todaySched.substitutePrayerLeaderName} (Substitute)</span>
                                </div>
                              </div>
                            ) : (
                              <div className="text-base font-black text-white">
                                {todaySched.prayerLeaderName}
                              </div>
                            )}
                            <p className="text-[11px] text-zinc-400 mt-1">Leads opening prayer & petitions</p>
                          </div>
                        </div>

                        {/* If verified employee is assigned, give quick swap button */}
                        {verifiedEmployee && (
                          (todaySched.devotionLeaderId === verifiedEmployee.id || todaySched.devotionLeaderName.toLowerCase().includes(verifiedEmployee.fullName.toLowerCase()) ||
                           todaySched.prayerLeaderId === verifiedEmployee.id || todaySched.prayerLeaderName.toLowerCase().includes(verifiedEmployee.fullName.toLowerCase())) && (
                            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                              <div className="text-xs text-amber-300">
                                <strong>You are assigned for today!</strong> If you are absent or cannot lead, you can designate a substitute right here.
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setPortalSubstituteTargetRole(
                                    todaySched.devotionLeaderId === verifiedEmployee.id || todaySched.devotionLeaderName.toLowerCase().includes(verifiedEmployee.fullName.toLowerCase())
                                      ? "devotion"
                                      : "prayer"
                                  );
                                  setShowPortalSubstituteModal(true);
                                }}
                                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-mono text-xs font-bold transition-all shadow-xs shrink-0 cursor-pointer"
                              >
                                I Am Absent? Assign Substitute
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 text-center text-xs text-zinc-400">
                        No schedule logged for today yet. HR or Management can add assignments in the Admin Console.
                      </div>
                    )}
                  </div>

                  {/* Upcoming / Tomorrow's Next Shift Preview */}
                  {tomorrowSched && (
                    <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-sky-400 font-bold flex items-center gap-1.5">
                          <Clock className="w-3 h-3" /> NEXT SHIFT PREVIEW ({tomorrowSched.date})
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500">
                          Awareness before clocking out
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/60">
                          <span className="text-[10px] text-zinc-400 font-mono block">Devotion Leader:</span>
                          <span className="font-bold text-white text-sm">
                            {tomorrowSched.isAbsent && tomorrowSched.substituteDevotionLeaderName
                              ? `${tomorrowSched.substituteDevotionLeaderName} (Sub)`
                              : tomorrowSched.devotionLeaderName}
                          </span>
                        </div>
                        <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/60">
                          <span className="text-[10px] text-zinc-400 font-mono block">Prayer Leader:</span>
                          <span className="font-bold text-white text-sm">
                            {tomorrowSched.isPrayerAbsent && tomorrowSched.substitutePrayerLeaderName
                              ? `${tomorrowSched.substitutePrayerLeaderName} (Sub)`
                              : tomorrowSched.prayerLeaderName}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Master Roster List with Flyer / List View Switcher */}
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                      <h4 className="font-bold text-xs font-mono uppercase tracking-wider text-zinc-400">
                        Official Devotion & Prayer Schedule (Next 10 Upcoming Shifts)
                      </h4>

                      <div className="flex items-center p-1 bg-zinc-900 border border-zinc-800 rounded-xl self-start sm:self-auto">
                        <button
                          type="button"
                          onClick={() => setPortalDevotionView("flyer")}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                            portalDevotionView === "flyer"
                              ? "bg-indigo-600 text-white shadow-xs"
                              : "text-zinc-400 hover:text-white"
                          }`}
                        >
                          <LayoutGrid className="w-3.5 h-3.5" />
                          <span>Flyer View</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPortalDevotionView("list")}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                            portalDevotionView === "list"
                              ? "bg-indigo-600 text-white shadow-xs"
                              : "text-zinc-400 hover:text-white"
                          }`}
                        >
                          <List className="w-3.5 h-3.5" />
                          <span>Calendar List</span>
                        </button>
                      </div>
                    </div>

                    {/* View 1: Flyer Poster Card (Strictly 10 Upcoming Rows for Employees) */}
                    {portalDevotionView === "flyer" && (
                      <DevotionFlyerCard
                        schedules={devotionSchedules}
                        todayStr={currentLocalDateStr}
                        isAdmin={false}
                        currentUserId={verifiedEmployee?.id}
                        currentUserName={verifiedEmployee?.fullName}
                        onOpenSubstituteModal={
                          verifiedEmployee
                            ? (sched, role) => {
                                setPortalSubstituteTargetRole(role);
                                setShowPortalSubstituteModal(true);
                              }
                            : undefined
                        }
                      />
                    )}

                    {/* View 2: Calendar List (Strictly 10 Upcoming Rows for Employees) */}
                    {portalDevotionView === "list" && (
                      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                        {devotionSchedules.filter(s => s.date >= currentLocalDateStr && s.status !== "completed").slice(0, 10).length === 0 ? (
                          <p className="text-xs text-zinc-500 font-mono text-center py-4">No upcoming schedules found.</p>
                        ) : (
                          devotionSchedules
                            .filter(s => s.date >= currentLocalDateStr && s.status !== "completed")
                            .slice(0, 10)
                            .map((s, idx) => {
                            const isToday = s.date === currentLocalDateStr;
                            const devL = s.isAbsent && s.substituteDevotionLeaderName ? `${s.substituteDevotionLeaderName} (Sub)` : s.devotionLeaderName;
                            const prayL = s.isPrayerAbsent && s.substitutePrayerLeaderName ? `${s.substitutePrayerLeaderName} (Sub)` : s.prayerLeaderName;

                            return (
                              <div 
                                key={s.id || s.date}
                                className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-all text-xs ${
                                  isToday 
                                    ? "bg-amber-500/10 border-amber-500/30 text-white" 
                                    : "bg-zinc-900/50 border-zinc-800/80 text-zinc-300"
                                }`}
                              >
                                <div className="flex items-center gap-2.5 font-mono">
                                  {isToday && <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />}
                                  <span className={`font-bold ${isToday ? "text-amber-400" : "text-zinc-200"}`}>{s.date}</span>
                                  <span className="text-[10px] text-zinc-500">
                                    ({new Date(s.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })})
                                  </span>
                                </div>

                                <div className="flex flex-wrap items-center gap-4 text-[11px]">
                                  <div>
                                    <span className="text-zinc-500 font-mono">Devotion: </span>
                                    <strong className="text-indigo-300">{devL}</strong>
                                  </div>
                                  <div>
                                    <span className="text-zinc-500 font-mono">Prayer: </span>
                                    <strong className="text-sky-300">{prayL}</strong>
                                  </div>
                                </div>

                                <div>
                                  {isToday ? (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300">
                                      Active Today
                                    </span>
                                  ) : s.date < currentLocalDateStr ? (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono text-zinc-500 bg-zinc-800">
                                      Done
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono text-sky-400 bg-sky-950/40">
                                      Upcoming
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* AUTO POPUP NOTIFICATION MODAL (TRIGGERS WHEN ASSIGNED EMPLOYEE LOGS IN) */}
      {showDevotionPopup && assignedDevotionNotice && verifiedEmployee && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border-2 border-amber-500/50 rounded-2xl w-full max-w-lg p-6 sm:p-8 shadow-2xl relative space-y-5 animate-in zoom-in-95 duration-200">
            {/* Close button */}
            <button
              type="button"
              onClick={() => {
                const empId = verifiedEmployee.id || "";
                sessionStorage.setItem(`devotion_popup_dismissed_${empId}_${assignedDevotionNotice.targetDate}`, "true");
                setShowDevotionPopup(false);
              }}
              className="absolute top-4 right-4 p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header with Icon and Badge */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                <BookOpen className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black uppercase tracking-wider bg-amber-500 text-slate-950">
                  {assignedDevotionNotice.isTomorrow ? "UPCOMING SHIFT NOTICE" : "TODAY'S 12:00 AM ACTIVE ROSTER"}
                </span>
                <h3 className="text-lg font-black text-white mt-1">
                  🙏 Devotion & Prayer Assignment Notice
                </h3>
              </div>
            </div>

            {/* Personal Callout */}
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs leading-relaxed space-y-1">
              <p className="text-sm font-bold text-white">
                Hello, {verifiedEmployee.fullName}!
              </p>
              <p>
                You are assigned as the <strong>{assignedDevotionNotice.isDevotionLeader && assignedDevotionNotice.isPrayerLeader ? "Devotion & Prayer Leader" : assignedDevotionNotice.isDevotionLeader ? "Devotion Leader" : "Opening Prayer Leader"}</strong> {assignedDevotionNotice.isTomorrow ? "for the upcoming shift tomorrow" : "for today's shift (effective 12:00 AM)"}.
              </p>
            </div>

            {/* Assignment Details */}
            <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs space-y-3 font-mono">
              <div className="flex justify-between items-center border-b border-zinc-800/80 pb-2">
                <span className="text-zinc-400 uppercase font-semibold">ASSIGNED DATE:</span>
                <span className="font-bold text-white text-sm bg-zinc-800 px-2.5 py-0.5 rounded-lg border border-zinc-700">
                  {assignedDevotionNotice.targetDate}
                </span>
              </div>

              <div className="flex justify-between items-center border-b border-zinc-800/80 pb-2">
                <span className="text-zinc-400 uppercase font-semibold">YOUR ASSIGNED ROLE:</span>
                <span className={`px-2.5 py-1 rounded-lg font-black text-xs uppercase flex items-center gap-1.5 shadow-sm ${
                  assignedDevotionNotice.isPrayerLeader 
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                    : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                }`}>
                  {assignedDevotionNotice.isDevotionLeader && assignedDevotionNotice.isPrayerLeader 
                    ? "📖 Devotion & 🙏 Opening Prayer Leader"
                    : assignedDevotionNotice.isDevotionLeader 
                    ? "📖 Devotion Leader" 
                    : "🙏 Opening Prayer Leader"}
                </span>
              </div>

              {/* Both Leaders Display - Clear & Highly Legible */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {/* Devotion Leader Card */}
                <div className={`p-3 rounded-xl border ${
                  assignedDevotionNotice.isDevotionLeader 
                    ? "bg-indigo-950/40 border-indigo-500/50 shadow-inner" 
                    : "bg-zinc-950/60 border-zinc-800/80"
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-zinc-400 font-bold uppercase">📖 DEVOTION LEADER</span>
                    {assignedDevotionNotice.isDevotionLeader && (
                      <span className="text-[9px] font-black bg-indigo-500 text-white px-1.5 py-0.2 rounded font-sans">
                        YOU
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-black text-white truncate">
                    {assignedDevotionNotice.schedule.devotionLeaderName}
                  </div>
                </div>

                {/* Opening Prayer Leader Card */}
                <div className={`p-3 rounded-xl border ${
                  assignedDevotionNotice.isPrayerLeader 
                    ? "bg-amber-950/40 border-amber-500/50 shadow-inner" 
                    : "bg-zinc-950/60 border-zinc-800/80"
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-zinc-400 font-bold uppercase">🙏 OPENING PRAYER LEADER</span>
                    {assignedDevotionNotice.isPrayerLeader && (
                      <span className="text-[9px] font-black bg-amber-500 text-slate-950 px-1.5 py-0.2 rounded font-sans">
                        YOU
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-black text-white truncate">
                    {assignedDevotionNotice.schedule.prayerLeaderName}
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  const empId = verifiedEmployee.id || "";
                  sessionStorage.setItem(`devotion_popup_dismissed_${empId}_${assignedDevotionNotice.targetDate}`, "true");
                  setShowDevotionPopup(false);
                }}
                className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-mono text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle className="w-4 h-4" />
                <span>✓ I Acknowledge & Will Lead</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPortalSubstituteTargetRole(assignedDevotionNotice.isDevotionLeader ? "devotion" : "prayer");
                    setShowPortalSubstituteModal(true);
                  }}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <UserX className="w-3.5 h-3.5" />
                  <span>I Am Absent? Assign Substitute</span>
                </button>

                {devotionSettings?.scheduleImageUrl && (
                  <button
                    type="button"
                    onClick={() => setIsPortalImageViewerOpen(true)}
                    className="py-2.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-indigo-300 border border-zinc-800 font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View Flyer</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PORTAL SUBSTITUTE / REASSIGNMENT MODAL (IF EMPLOYEE IS ABSENT) */}
      {showPortalSubstituteModal && assignedDevotionNotice && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-rose-500/40 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4 animate-in fade-in duration-200">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-rose-400">
                <UserX className="w-5 h-5" />
                <h3 className="text-base font-black text-white">
                  Absent? Reassign Devotion Leader
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPortalSubstituteModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              If you are absent, on leave, or cannot lead today's devotion, select a colleague from the team to substitute for you.
            </p>

            <form onSubmit={handlePortalSubmitSubstitute} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-mono font-bold text-zinc-400 uppercase">Role To Swap</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPortalSubstituteTargetRole("devotion")}
                    className={`py-2 px-3 rounded-xl text-xs font-mono font-bold border transition-all ${
                      portalSubstituteTargetRole === "devotion"
                        ? "bg-indigo-600 text-white border-indigo-500"
                        : "bg-zinc-900 text-zinc-400 border-zinc-800"
                    }`}
                  >
                    Devotion Leader
                  </button>
                  <button
                    type="button"
                    onClick={() => setPortalSubstituteTargetRole("prayer")}
                    className={`py-2 px-3 rounded-xl text-xs font-mono font-bold border transition-all ${
                      portalSubstituteTargetRole === "prayer"
                        ? "bg-indigo-600 text-white border-indigo-500"
                        : "bg-zinc-900 text-zinc-400 border-zinc-800"
                    }`}
                  >
                    Prayer Leader
                  </button>
                </div>
              </div>

              <EmployeeSearchInput
                label="Choose Substitute Colleague"
                valueName={portalSubstituteEmployeeName}
                valueId={portalSubstituteEmployeeId}
                employees={portalActiveEmployees.filter((x) => x.id !== verifiedEmployee?.id)}
                required
                placeholder="Search team by name or ID (e.g. 003, Cedric)..."
                onChange={({ id, name }) => {
                  setPortalSubstituteEmployeeId(id);
                  setPortalSubstituteEmployeeName(name);
                }}
              />

              <div className="space-y-1">
                <label className="text-xs font-mono font-bold text-zinc-400 uppercase">Reason (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. On Sick Leave / Swapped Shifts"
                  value={portalSubstituteReason}
                  onChange={(e) => setPortalSubstituteReason(e.target.value)}
                  className="w-full text-xs px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowPortalSubstituteModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPortalSubstitute}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-mono font-bold cursor-pointer shadow-md"
                >
                  {isSubmittingPortalSubstitute ? "Submitting..." : "Confirm & Reassign Leader"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PORTAL FLYER IMAGE VIEWER */}
      {isPortalImageViewerOpen && devotionSettings?.scheduleImageUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-4xl w-full max-h-[90vh] flex flex-col items-center justify-center relative">
            <button
              type="button"
              onClick={() => setIsPortalImageViewerOpen(false)}
              className="absolute -top-12 right-0 p-2 text-zinc-400 hover:text-white rounded-full bg-zinc-900 border border-zinc-800 cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="overflow-auto max-h-[85vh] rounded-2xl border border-zinc-800 shadow-2xl">
              <img
                src={devotionSettings.scheduleImageUrl}
                alt="Devotion Flyer Graphic"
                className="max-w-full h-auto object-contain rounded-2xl"
              />
            </div>
            <div className="mt-3 text-center text-xs font-mono text-zinc-400">
              {devotionSettings.scheduleImageTitle || "Official Devotion Schedule Flyer"}
            </div>
          </div>
        </div>
      )}
      
      {showAdminOverrideModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-blue-500" />
              <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-zinc-900 dark:text-white">Admin Early-In Override</h3>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Please enter an Administrator's 4-digit security PIN to authorize an early shift start timer for <strong>{todayAttendance?.employeeName}</strong>.
            </p>
            {adminOverrideError && (
              <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-red-500 text-xs font-semibold animate-shake">
                {adminOverrideError}
              </div>
            )}
            <form onSubmit={handleAdminEarlyInOverride} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold font-mono text-zinc-500 uppercase tracking-wider">ADMINISTRATOR PIN</label>
                <input
                  type="password"
                  maxLength={4}
                  required
                  placeholder="••••"
                  value={adminOverridePin}
                  onChange={(e) => setAdminOverridePin(e.target.value.replace(/\D/g, ""))}
                  className="w-full text-center tracking-widest text-lg font-mono px-3.5 py-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 rounded-xl focus:outline-none focus:border-blue-500 text-zinc-900 dark:text-white"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAdminOverrideModal(false);
                    setAdminOverridePin("");
                    setAdminOverrideError("");
                  }}
                  className="px-4 py-2 text-xs font-mono font-bold uppercase text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingOverride || adminOverridePin.length < 4}
                  className="px-5 py-2 text-xs font-mono font-bold uppercase rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-800 disabled:opacity-50 text-white transition-all shadow-md shadow-blue-500/10 cursor-pointer"
                >
                  {isSubmittingOverride ? "Verifying..." : "Authorize"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Employee Portal: Birthday Registration & Edit Modal */}
      {showBirthdayModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-150 dark:border-zinc-800 pb-3">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                🎂 Update Employee Birthday
              </h3>
              <button
                type="button"
                onClick={() => setShowBirthdayModal(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Set your date of birth to calculate your eligible <strong>Birthday Leave Week</strong>. Birthday leave is approved only during the Monday–Friday week of your birthday.
            </p>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold font-mono text-zinc-500 uppercase tracking-wider">
                DATE OF BIRTH (YYYY-MM-DD)
              </label>
              <input
                type="date"
                required
                value={birthdayInput}
                onChange={(e) => setBirthdayInput(e.target.value)}
                className="w-full text-sm px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-900 dark:text-white"
              />
            </div>
            {birthdayInput && (() => {
              const info = getBirthdayWeekInfo(birthdayInput);
              return info.isValid ? (
                <div className="p-3 rounded-xl bg-pink-50 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-800/60 text-[11px] text-pink-700 dark:text-pink-300 space-y-1 font-mono">
                  <p><strong>Registered Birthday:</strong> {info.birthdayFormatted}</p>
                  <p><strong>Eligible Birthday Week:</strong> Monday, {info.weekStartMondayStr} – Friday, {info.weekEndFridayStr}</p>
                </div>
              ) : null;
            })()}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBirthdayModal(false)}
                className="px-4 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!birthdayInput || isSavingBirthday}
                onClick={async () => {
                  if (!verifiedEmployee?.id || !birthdayInput) return;
                  setIsSavingBirthday(true);
                  try {
                    await updateDoc(doc(db, "employees", verifiedEmployee.id), { birthday: birthdayInput });
                    setVerifiedEmployee(prev => prev ? { ...prev, birthday: birthdayInput } : null);
                    setShowBirthdayModal(false);
                    alert("Birthday successfully updated!");
                  } catch (err: any) {
                    alert("Failed to save birthday: " + err.message);
                  } finally {
                    setIsSavingBirthday(false);
                  }
                }}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white shadow-md cursor-pointer"
              >
                {isSavingBirthday ? "Saving..." : "Save Birthday"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
