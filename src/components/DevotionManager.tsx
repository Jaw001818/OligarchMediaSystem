import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  db, 
  collection, 
  onSnapshot, 
  doc, 
  getDoc,
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query 
} from "../firebase";
import { Employee, DevotionSchedule, DevotionSettings, DevotionRotationState } from "../types";
import { 
  Sparkles, 
  Calendar, 
  UserCheck, 
  Upload, 
  Download,
  Image as ImageIcon, 
  Plus, 
  Trash2, 
  Edit3, 
  AlertCircle, 
  Clock, 
  BookOpen, 
  CheckCircle, 
  Check,
  Repeat, 
  Eye, 
  X, 
  Search, 
  UserX, 
  FileImage, 
  RefreshCw, 
  Heart, 
  ChevronRight, 
  ShieldAlert, 
  LayoutGrid, 
  List, 
  Shuffle,
  History,
  AlertTriangle,
  Archive
} from "lucide-react";
import DevotionFlyerCard from "./DevotionFlyerCard";
import EmployeeSearchInput from "./EmployeeSearchInput";
import { 
  OFFICIAL_FLIER_ROSTER, 
  generateFairRoster,
  generateNextFairAssignment,
  maintainRollingSchedule,
  generateNextRotationPair,
  initializeRotationState,
  getNextRotationSuggestion,
  generateLoopedSchedule,
  addDaysToDateStr,
  isWeekendDateStr,
  ensureWeekdayDateStr
} from "../utils/devotionScheduler";

interface DevotionManagerProps {
  employees: Employee[];
  currentUser: any;
}

export default function DevotionManager({ employees, currentUser }: DevotionManagerProps) {
  const [schedules, setSchedules] = useState<DevotionSchedule[]>([]);
  const [devotionSettings, setDevotionSettings] = useState<DevotionSchedule | any>(null);
  const [loading, setLoading] = useState(true);

  // Form states
  const [isAddingModalOpen, setIsAddingModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<DevotionSchedule | null>(null);
  const [formDate, setFormDate] = useState(ensureWeekdayDateStr(new Date().toISOString().split("T")[0]));
  const [formDevotionLeaderId, setFormDevotionLeaderId] = useState("");
  const [formDevotionLeaderName, setFormDevotionLeaderName] = useState("");
  const [formPrayerLeaderId, setFormPrayerLeaderId] = useState("");
  const [formPrayerLeaderName, setFormPrayerLeaderName] = useState("");
  const [formClosingPrayerLeaderName, setFormClosingPrayerLeaderName] = useState("");
  const [formTopic, setFormTopic] = useState("");
  const [formScripture, setFormScripture] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  // Substitute modal
  const [isSubstituteModalOpen, setIsSubstituteModalOpen] = useState(false);
  const [substituteTargetSchedule, setSubstituteTargetSchedule] = useState<DevotionSchedule | null>(null);
  const [substituteRole, setSubstituteRole] = useState<"devotion" | "prayer">("devotion");
  const [substituteEmployeeId, setSubstituteEmployeeId] = useState("");
  const [substituteEmployeeName, setSubstituteEmployeeName] = useState("");
  const [substituteReason, setSubstituteReason] = useState("");
  const [substituteSaving, setSubstituteSaving] = useState(false);

  // Rolling Queue state
  const [isRollingQueue, setIsRollingQueue] = useState(false);

  // View mode switcher: "flyer" (interactive replica 15 rows), "table" (master spreadsheet 15 rows), "history" (completed archive)
  const [viewMode, setViewMode] = useState<"flyer" | "table" | "history">("flyer");
  const [rotationState, setRotationState] = useState<DevotionRotationState | null>(null);

  // Fair Cycle Auto-generate states
  const [isAutoGenerateModalOpen, setIsAutoGenerateModalOpen] = useState(false);
  const [autoGenStartDate, setAutoGenStartDate] = useState("2026-11-06");
  const [autoGenDaysCount, setAutoGenDaysCount] = useState(5); // Default to 5 business days
  const [autoGenExcludeWeekends, setAutoGenExcludeWeekends] = useState(true); // Strictly Mon-Fri
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [rosterSource, setRosterSource] = useState<"official" | "employees" | "custom">("official");
  const [customRosterInput, setCustomRosterInput] = useState<string>(OFFICIAL_FLIER_ROSTER.join(", "));
  const [fairPreview, setFairPreview] = useState<any[]>([]);

  // Loop Devotions Forward Modal States
  const [isLoopModalOpen, setIsLoopModalOpen] = useState(false);
  const [loopStartDate, setLoopStartDate] = useState("");
  const [loopDaysCount, setLoopDaysCount] = useState<number>(10);
  const [loopBasePattern, setLoopBasePattern] = useState<{ devotion: string; prayer: string }[]>([]);
  const [loopPreview, setLoopPreview] = useState<
    { date: string; devotion: string; prayer: string; loopIndex: number; patternIndex: number }[]
  >([]);
  const [isPublishingLoop, setIsPublishingLoop] = useState(false);

  // Clear All Devotions Confirmation Modal States
  const [isClearAllModalOpen, setIsClearAllModalOpen] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const hasCleanedLegacyRef = useRef(false);
  const hasSeededSettingsRef = useRef(false);

  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  };

  // Filter & Search
  const [searchTerm, setSearchTerm] = useState("");

  // Real-time clock for 12:00 AM awareness
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Today's date in local YYYY-MM-DD
  const todayStr = (() => {
    const year = currentTime.getFullYear();
    const month = String(currentTime.getMonth() + 1).padStart(2, "0");
    const day = String(currentTime.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  })();

  // Listen to devotion schedules
  useEffect(() => {
    const q = query(collection(db, "devotion_schedules"));
    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        const rawList: DevotionSchedule[] = [];
        snapshot.forEach((docSnap) => {
          rawList.push({ ...(docSnap.data() as DevotionSchedule), id: docSnap.id });
        });

        // Deduplicate strictly by date in memory: ensure each date only has 1 record
        const dateMap = new Map<string, DevotionSchedule>();
        const duplicateIdsToDelete: string[] = [];

        rawList.forEach((item) => {
          if (!item || !item.date) return;
          if (!dateMap.has(item.date)) {
            dateMap.set(item.date, item);
          } else {
            const existing = dateMap.get(item.date)!;
            if ((item.updatedAt || "") > (existing.updatedAt || "")) {
              if (existing.id && existing.id !== item.date) duplicateIdsToDelete.push(existing.id);
              dateMap.set(item.date, item);
            } else {
              if (item.id && item.id !== item.date) duplicateIdsToDelete.push(item.id);
            }
          }
        });

        let list = Array.from(dateMap.values());
        list.sort((a, b) => a.date.localeCompare(b.date));

        setSchedules(list);
        setLoading(false);

        // Perform one-time legacy duplicate cleanup at most once per mount
        if (!hasCleanedLegacyRef.current && rawList.length > 0) {
          hasCleanedLegacyRef.current = true;
          duplicateIdsToDelete.forEach((dupId) => {
            deleteDoc(doc(db, "devotion_schedules", dupId)).catch(() => {});
          });
        }
      },
      (err) => {
        console.error("Error fetching devotion schedules:", err);
        setLoading(false);
      }
    );

    // Listen to devotion settings (schedule image, global notices)
    const unsubSettings = onSnapshot(
      doc(db, "devotion_settings", "general"),
      async (docSnap) => {
        if (docSnap.exists()) {
          setDevotionSettings(docSnap.data() as DevotionSettings);
        } else if (!hasSeededSettingsRef.current) {
          hasSeededSettingsRef.current = true;
          const defaultSettings = {
            scheduleImageUrl: "/assets/aistudio/DEVOTION__1__22cb325c.jpg",
            scheduleImageTitle: "Oligarch Media Devotion - Official Team Schedule",
            uploadedAt: new Date().toISOString(),
            uploadedBy: "Management"
          };
          setDevotionSettings(defaultSettings as DevotionSettings);
          await setDoc(doc(db, "devotion_settings", "general"), defaultSettings).catch(() => {});
        }
      },
      (err) => {
        console.error("Error fetching devotion settings:", err);
      }
    );

    // Listen to devotion rotation state
    const unsubRotation = onSnapshot(
      doc(db, "devotion_settings", "rotation_state"),
      (snap) => {
        if (snap.exists()) {
          setRotationState(snap.data() as DevotionRotationState);
        }
      },
      (err) => console.error("Error fetching rotation state:", err)
    );

    return () => {
      unsub();
      unsubSettings();
      unsubRotation();
    };
  }, []);

  // Active employees list
  const activeEmployees = employees.filter((e) => (e.status || "Active") === "Active");

  // Today's schedule
  const todaySchedule = schedules.find((s) => s.date === todayStr && s.status !== "completed");

  // Upcoming schedules: strictly from today onwards, status !== "completed", sorted asc
  const upcomingSchedules = useMemo(() => {
    return schedules
      .filter((s) => s.date >= todayStr && s.status !== "completed")
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [schedules, todayStr]);

  // Completed history schedules: past dates or status === "completed", sorted desc
  const historySchedules = useMemo(() => {
    return schedules
      .filter((s) => (s.date < todayStr || s.status === "completed"))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [schedules, todayStr]);

  // Handle Leader Dropdown Change
  const handleDevotionLeaderSelect = (empId: string) => {
    setFormDevotionLeaderId(empId);
    const emp = employees.find((e) => e.id === empId);
    if (emp) {
      setFormDevotionLeaderName(emp.fullName);
    }
  };

  const handlePrayerLeaderSelect = (empId: string) => {
    setFormPrayerLeaderId(empId);
    const emp = employees.find((e) => e.id === empId);
    if (emp) {
      setFormPrayerLeaderName(emp.fullName);
    }
  };

  // Open Add/Edit Modal
  const openAddModal = (existing?: DevotionSchedule) => {
    if (existing) {
      setEditingSchedule(existing);
      setFormDate(existing.date);
      setFormDevotionLeaderId(existing.devotionLeaderId || "");
      setFormDevotionLeaderName(existing.devotionLeaderName || "");
      setFormPrayerLeaderId(existing.prayerLeaderId || "");
      setFormPrayerLeaderName(existing.prayerLeaderName || "");
      setFormClosingPrayerLeaderName(existing.closingPrayerLeaderName || "");
      setFormTopic(existing.topic || "");
      setFormScripture(existing.scripture || "");
      setFormNotes(existing.notes || "");
    } else {
      const suggestion = getNextRotationSuggestion(activeEmployees, schedules);
      setEditingSchedule(null);
      setFormDate(suggestion.nextDate);
      setFormDevotionLeaderId(suggestion.devotionId);
      setFormDevotionLeaderName(suggestion.devotionName);
      setFormPrayerLeaderId(suggestion.prayerId);
      setFormPrayerLeaderName(suggestion.prayerName);
      setFormClosingPrayerLeaderName("");
      setFormTopic("Daily Devotion & Shift Alignment");
      setFormScripture("Philippians 4:6-7");
      setFormNotes("Fair Cycle Continuous Rotation");
    }
    setIsAddingModalOpen(true);
  };

  // Save Schedule Entry (Strictly Date-Based Keying: docId === YYYY-MM-DD)
  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDate || !formDevotionLeaderName.trim() || !formPrayerLeaderName.trim()) {
      showToast("Please specify the Date, Devotion Leader, and Prayer Leader.", "error");
      return;
    }

    if (isWeekendDateStr(formDate)) {
      showToast("Saturday and Sunday are rest days with no work/devotions. Please choose Monday through Friday.", "error");
      return;
    }

    setFormSaving(true);
    try {
      const existingForTargetDate = schedules.find((s) => s.date === formDate);
      const scheduleData: Partial<DevotionSchedule> = {
        id: formDate,
        date: formDate,
        devotionLeaderId: formDevotionLeaderId || "",
        devotionLeaderName: formDevotionLeaderName.trim(),
        prayerLeaderId: formPrayerLeaderId || "",
        prayerLeaderName: formPrayerLeaderName.trim(),
        closingPrayerLeaderName: formClosingPrayerLeaderName.trim() || "",
        topic: formTopic.trim() || existingForTargetDate?.topic || editingSchedule?.topic || "Daily Devotion & Shift Alignment",
        scripture: formScripture.trim() || existingForTargetDate?.scripture || editingSchedule?.scripture || "Philippians 4:6-7",
        notes: formNotes.trim() || existingForTargetDate?.notes || editingSchedule?.notes || "",
        imageUrl: devotionSettings?.scheduleImageUrl || "/assets/aistudio/image_17b76ed3.png",
        status: formDate < todayStr ? "completed" : "upcoming",
        isAbsent: editingSchedule ? (editingSchedule.isAbsent ?? false) : (existingForTargetDate?.isAbsent ?? false),
        isPrayerAbsent: editingSchedule ? (editingSchedule.isPrayerAbsent ?? false) : (existingForTargetDate?.isPrayerAbsent ?? false),
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || "Admin",
      };

      // If editing an existing schedule and its date was changed or it had a legacy non-date ID, remove the old document
      if (editingSchedule) {
        if (editingSchedule.id && editingSchedule.id !== formDate) {
          await deleteDoc(doc(db, "devotion_schedules", editingSchedule.id)).catch(() => {});
        }
        if (editingSchedule.date && editingSchedule.date !== formDate) {
          await deleteDoc(doc(db, "devotion_schedules", editingSchedule.date)).catch(() => {});
        }
      }

      // Also clean up any legacy random-ID document that shared formDate
      if (existingForTargetDate && existingForTargetDate.id && existingForTargetDate.id !== formDate) {
        await deleteDoc(doc(db, "devotion_schedules", existingForTargetDate.id)).catch(() => {});
      }

      // Save deterministically under the date key (YYYY-MM-DD)
      await setDoc(doc(db, "devotion_schedules", formDate), scheduleData, { merge: true });
      localStorage.setItem("devotion_initial_seeded_v2", "true");

      // Add audit log
      await addDoc(collection(db, "audit_logs"), {
        user: currentUser?.email || "Admin",
        action: editingSchedule ? "Updated Devotion Schedule" : "Added Devotion Schedule",
        details: `Devotion schedule saved for date ${formDate}: Devotion by ${formDevotionLeaderName.trim()}, Prayer by ${formPrayerLeaderName.trim()}.`,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      showToast(`Devotion & Prayer schedule for ${formDate} saved permanently!`, "success");
      setIsAddingModalOpen(false);
    } catch (err) {
      console.error("Error saving devotion schedule:", err);
      showToast("Failed to save schedule. Please try again.", "error");
    } finally {
      setFormSaving(false);
    }
  };

  // Delete Schedule Entry
  const handleDeleteSchedule = async (id: string, date: string) => {
    try {
      await deleteDoc(doc(db, "devotion_schedules", id));
      await addDoc(collection(db, "audit_logs"), {
        user: currentUser?.email || "Admin",
        action: "Deleted Devotion Schedule",
        details: `Deleted devotion schedule for date ${date}.`,
        timestamp: new Date().toISOString()
      }).catch(() => {});
      showToast(`Deleted devotion schedule for ${date}.`, "info");
    } catch (err) {
      console.error("Error deleting schedule:", err);
      showToast("Failed to delete schedule.", "error");
    }
  };

  // Open Substitute Modal
  const openSubstituteModal = (schedule: DevotionSchedule, role: "devotion" | "prayer") => {
    setSubstituteTargetSchedule(schedule);
    setSubstituteRole(role);
    setSubstituteEmployeeId("");
    setSubstituteEmployeeName("");
    setSubstituteReason("");
    setIsSubstituteModalOpen(true);
  };

  // Save Substitute / Reassign Absent Leader
  const handleSaveSubstitute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!substituteTargetSchedule || !substituteTargetSchedule.id) return;
    if (!substituteEmployeeName.trim()) {
      showToast("Please select or enter the substitute leader.", "error");
      return;
    }

    setSubstituteSaving(true);
    try {
      const docRef = doc(db, "devotion_schedules", substituteTargetSchedule.id);
      const updates: any = {
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || "Admin",
      };

      if (substituteRole === "devotion") {
        updates.isAbsent = true;
        updates.substituteDevotionLeaderId = substituteEmployeeId;
        updates.substituteDevotionLeaderName = substituteEmployeeName.trim();
      } else {
        updates.isPrayerAbsent = true;
        updates.substitutePrayerLeaderId = substituteEmployeeId;
        updates.substitutePrayerLeaderName = substituteEmployeeName.trim();
      }

      await updateDoc(docRef, updates);

      // Audit log & System Notification
      const originalLeader = substituteRole === "devotion" 
        ? substituteTargetSchedule.devotionLeaderName 
        : substituteTargetSchedule.prayerLeaderName;

      await addDoc(collection(db, "audit_logs"), {
        user: currentUser?.email || "Admin",
        action: "Devotion Substitute Assigned",
        details: `${originalLeader} was marked absent for ${substituteRole.toUpperCase()} on ${substituteTargetSchedule.date}. Substituted by ${substituteEmployeeName}. Reason: ${substituteReason || "Unspecified"}.`,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      await addDoc(collection(db, "notifications"), {
        title: "Devotion Leader Swapped / Substituted",
        message: `${substituteEmployeeName} has been assigned as substitute ${substituteRole === "devotion" ? "Devotion Leader" : "Prayer Leader"} for ${substituteTargetSchedule.date} (Originally ${originalLeader}).`,
        type: "Alert",
        read: false,
        createdAt: new Date().toISOString()
      }).catch(() => {});

      setIsSubstituteModalOpen(false);
      showToast(`Substitute assigned for ${substituteTargetSchedule.date}!`, "success");
    } catch (err) {
      console.error("Error setting substitute:", err);
      showToast("Failed to assign substitute.", "error");
    } finally {
      setSubstituteSaving(false);
    }
  };

  // Reset / Clear Substitute (Restore original leader)
  const handleRestoreOriginalLeader = async (schedule: DevotionSchedule, role: "devotion" | "prayer") => {
    if (!schedule.id) return;

    try {
      const docRef = doc(db, "devotion_schedules", schedule.id);
      const updates: any = {
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || "Admin",
      };

      if (role === "devotion") {
        updates.isAbsent = false;
        updates.substituteDevotionLeaderId = "";
        updates.substituteDevotionLeaderName = "";
      } else {
        updates.isPrayerAbsent = false;
        updates.substitutePrayerLeaderId = "";
        updates.substitutePrayerLeaderName = "";
      }

      await updateDoc(docRef, updates);
      showToast(`Restored original ${role} leader.`, "info");
    } catch (err) {
      console.error("Error restoring original leader:", err);
      showToast("Failed to restore original leader.", "error");
    }
  };

  // Automatic Daily Rolling Queue & Schedule Maintenance:
  // Maintains 15 upcoming schedule rows in DB (10 visible to employees, 15 to admins).
  // Archives past schedules (date < todayStr) to "completed", NEVER deletes from database!
  useEffect(() => {
    if (loading || schedules.length === 0) return;
    maintainRollingSchedule(db, todayStr, employees, schedules, 15).catch((err) => {
      console.warn("Devotion auto-maintain note:", err);
    });
  }, [schedules.length, todayStr, employees.length, loading]);

  // Manual Advance 1 Day: Archives today's top schedule to History (DO NOT DELETE)
  // and appends exactly 1 new fair cycle assignment at the bottom to maintain 15 upcoming rows.
  const handleRollDailyQueue = async () => {
    if (activeEmployees.length < 2) {
      showToast("Cannot advance queue: at least 2 active employees are required.", "error");
      return;
    }

    if (upcomingSchedules.length === 0) {
      showToast("No upcoming schedules found to advance. Please add or loop devotion entries first.", "info");
      return;
    }

    setIsRollingQueue(true);
    try {
      // 1. Mark top upcoming schedule completed (ARCHIVED IN HISTORY - NEVER DELETED)
      const topSchedule = upcomingSchedules[0];
      if (topSchedule && topSchedule.id) {
        await updateDoc(doc(db, "devotion_schedules", topSchedule.id), {
          status: "completed",
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser?.email || "Admin (Queue Advanced)"
        });
      }

      // 2. Load or initialize rotation state
      const stateDocRef = doc(db, "devotion_settings", "rotation_state");
      let rotState: DevotionRotationState;
      const stateSnap = await getDoc(stateDocRef);
      if (stateSnap.exists()) {
        rotState = initializeRotationState(
          activeEmployees.map(e => e.fullName.trim()),
          stateSnap.data() as DevotionRotationState
        );
      } else {
        rotState = initializeRotationState(activeEmployees.map(e => e.fullName.trim()));
      }

      // 3. Calculate next weekday date at bottom (strictly skipping Saturday & Sunday)
      const remainingUpcoming = upcomingSchedules.slice(1);
      const lastDateStr = remainingUpcoming.length > 0 
        ? remainingUpcoming[remainingUpcoming.length - 1].date 
        : topSchedule.date;
      const nextDateStr = addDaysToDateStr(lastDateStr, 1, true);

      const lastDev = remainingUpcoming.length > 0 
        ? remainingUpcoming[remainingUpcoming.length - 1].devotionLeaderName 
        : topSchedule.devotionLeaderName;
      const lastPray = remainingUpcoming.length > 0 
        ? remainingUpcoming[remainingUpcoming.length - 1].prayerLeaderName 
        : topSchedule.prayerLeaderName;

      // 4. Generate next fair rotation pair (respecting separate cycles & cohort locking)
      const nextPair = generateNextRotationPair(activeEmployees, rotState, lastDev, lastPray);
      rotState = nextPair.updatedState;

      const matchedDev = activeEmployees.find(e => e.fullName.toLowerCase() === nextPair.devotion.toLowerCase());
      const matchedPray = activeEmployees.find(e => e.fullName.toLowerCase() === nextPair.prayer.toLowerCase());

      const newEntry: Partial<DevotionSchedule> = {
        id: nextDateStr,
        date: nextDateStr,
        devotionLeaderId: matchedDev?.id || "",
        devotionLeaderName: nextPair.devotion,
        prayerLeaderId: matchedPray?.id || "",
        prayerLeaderName: nextPair.prayer,
        closingPrayerLeaderName: "",
        topic: "Daily Devotion & Shift Alignment",
        scripture: "Philippians 4:6-7",
        notes: `Rolling Queue Advance (Dev Cycle #${nextPair.devCycleNumber}, Prayer Cycle #${nextPair.prayCycleNumber})`,
        imageUrl: "/assets/aistudio/image_17b76ed3.png",
        status: "upcoming",
        cycleDevotionNumber: nextPair.devCycleNumber,
        cyclePrayerNumber: nextPair.prayCycleNumber,
        cycleDevotionCohort: [...rotState.devotionCohort],
        cyclePrayerCohort: [...rotState.prayerCohort],
        isAbsent: false,
        isPrayerAbsent: false,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || "Admin (Manual Roll)"
      };

      await setDoc(doc(db, "devotion_schedules", nextDateStr), newEntry, { merge: true });
      await setDoc(stateDocRef, { ...rotState, lastMaintainedAt: new Date().toISOString() });
      localStorage.setItem("devotion_initial_seeded_v2", "true");

      showToast(
        `Advanced 1 Day: Archived ${topSchedule.date} (${topSchedule.devotionLeaderName}) to History, appended ${nextDateStr} (${nextPair.devotion} & ${nextPair.prayer}) at bottom!`,
        "success"
      );
    } catch (err) {
      console.error("Error advancing queue:", err);
      showToast("Failed to advance rolling queue.", "error");
    } finally {
      setIsRollingQueue(false);
    }
  };

  // Resolve selected roster pool of team members
  const getSelectedRosterPool = (): string[] => {
    if (rosterSource === "official") {
      return OFFICIAL_FLIER_ROSTER;
    }
    if (rosterSource === "employees") {
      const names = activeEmployees.map((e) => e.fullName.trim()).filter(Boolean);
      return names.length > 0 ? names : OFFICIAL_FLIER_ROSTER;
    }
    // Custom comma-separated input
    const parsed = customRosterInput
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return parsed.length >= 2 ? parsed : OFFICIAL_FLIER_ROSTER;
  };

  // Generate Fair Randomizer Preview
  const handleGenerateFairPreview = (targetStartDate?: string, targetDays?: number, targetExcludeWeekends?: boolean) => {
    const pool = getSelectedRosterPool();
    if (pool.length < 2) {
      showToast("Need at least 2 team members in the roster pool.", "error");
      return;
    }
    const startDate = targetStartDate || autoGenStartDate;
    const days = targetDays || autoGenDaysCount;
    const excludeWk = targetExcludeWeekends !== undefined ? targetExcludeWeekends : autoGenExcludeWeekends;
    const previewList = generateFairRoster(
      pool,
      startDate,
      days,
      excludeWk,
      schedules,
      activeEmployees
    );
    setFairPreview(previewList);
  };

  // Commit Fair Randomizer Schedule to Firestore
  const handleCommitFairRoster = async () => {
    if (fairPreview.length === 0) {
      handleGenerateFairPreview();
      return;
    }

    setAutoGenerating(true);
    try {
      const activeFlyerImage = "/assets/aistudio/image_17b76ed3.png";

      for (const item of fairPreview) {
        // Try to match employee ID from directory if available
        const matchedDevEmp = employees.find(
          (e) => e.fullName.toLowerCase() === item.devotion.toLowerCase() ||
                 (e.fullName.toLowerCase().includes(item.devotion.toLowerCase()) && item.devotion.length >= 3)
        );
        const matchedPrayEmp = employees.find(
          (e) => e.fullName.toLowerCase() === item.prayer.toLowerCase() ||
                 (e.fullName.toLowerCase().includes(item.prayer.toLowerCase()) && item.prayer.length >= 3)
        );

        const data: Partial<DevotionSchedule> = {
          id: item.date,
          date: item.date,
          devotionLeaderId: matchedDevEmp?.id || "",
          devotionLeaderName: item.devotion,
          prayerLeaderId: matchedPrayEmp?.id || "",
          prayerLeaderName: item.prayer,
          closingPrayerLeaderName: "",
          topic: "Daily Devotion & Shift Alignment",
          scripture: "Philippians 4:6-7",
          notes: `Fair Exhaustion Cycle ${item.cycleNumber} (Day ${item.dayInCycle} of ${item.cycleTotal})`,
          imageUrl: activeFlyerImage,
          status: item.date < todayStr ? "completed" : "upcoming",
          isAbsent: false,
          isPrayerAbsent: false,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser?.email || "Admin",
        };

        const existing = schedules.find((s) => s.date === item.date);
        if (existing && existing.id && existing.id !== item.date) {
          await deleteDoc(doc(db, "devotion_schedules", existing.id)).catch(() => {});
        }
        await setDoc(doc(db, "devotion_schedules", item.date), data, { merge: true });
      }

      // Update rotation_state in Firestore so future single adds and rolling maintenance stay in sync
      const stateDocRef = doc(db, "devotion_settings", "rotation_state");
      const assignedDevs = fairPreview.map(p => p.devotion);
      const assignedPrays = fairPreview.map(p => p.prayer);
      await setDoc(stateDocRef, {
        devotionAssigned: assignedDevs,
        prayerAssigned: assignedPrays,
        lastMaintainedAt: new Date().toISOString()
      }, { merge: true }).catch(() => {});

      localStorage.setItem("devotion_initial_seeded_v2", "true");

      await addDoc(collection(db, "audit_logs"), {
        user: currentUser?.email || "Admin",
        action: "Fair Cycle Devotion Generated",
        details: `Generated ${fairPreview.length} devotion days using Fair Cycle Exhaustion Randomizer starting from ${autoGenStartDate}.`,
        timestamp: new Date().toISOString()
      });

      showToast(`Successfully generated and published ${fairPreview.length} days of fair cycle devotion!`, "success");
      setIsAutoGenerateModalOpen(false);
      setFairPreview([]);
    } catch (err) {
      console.error("Error committing fair schedule:", err);
      showToast("Failed to commit schedule. Please try again.", "error");
    } finally {
      setAutoGenerating(false);
    }
  };

  // -------------------------------------------------------------
  // LOOP DEVOTIONS FORWARD (Strictly Monday–Friday; Weekends Skipped)
  // -------------------------------------------------------------
  const openLoopModal = () => {
    // 1. Extract existing schedules sorted by date
    const sorted = [...schedules]
      .filter((s) => Boolean(s.date) && Boolean(s.devotionLeaderName) && Boolean(s.prayerLeaderName))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Deduce initial base pattern: either current schedules' pairs or fallback to active employees
    let base: { devotion: string; prayer: string }[] = [];
    if (sorted.length > 0) {
      base = sorted.map((s) => ({
        devotion: s.devotionLeaderName,
        prayer: s.prayerLeaderName,
      }));
    } else if (activeEmployees.length >= 2) {
      const emps = activeEmployees.map((e) => e.fullName.trim());
      for (let i = 0; i < Math.min(5, emps.length); i++) {
        base.push({
          devotion: emps[i],
          prayer: emps[(i + 1) % emps.length],
        });
      }
    }

    setLoopBasePattern(base);

    // Default start date: next weekday after the last scheduled date (or today if none)
    const nextStart = sorted.length > 0
      ? addDaysToDateStr(sorted[sorted.length - 1].date, 1, true)
      : ensureWeekdayDateStr(todayStr);

    setLoopStartDate(nextStart);
    setLoopDaysCount(10);

    // Generate initial preview
    if (base.length > 0) {
      const prev = generateLoopedSchedule(base, nextStart, 10);
      setLoopPreview(prev);
    } else {
      setLoopPreview([]);
    }

    setIsLoopModalOpen(true);
  };

  const handleUpdateLoopPreview = (
    pattern: { devotion: string; prayer: string }[],
    startDate: string,
    days: number
  ) => {
    if (!pattern || pattern.length === 0 || !startDate || days <= 0) {
      setLoopPreview([]);
      return;
    }
    const cleanStartDate = ensureWeekdayDateStr(startDate);
    const prev = generateLoopedSchedule(pattern, cleanStartDate, days);
    setLoopPreview(prev);
  };

  const handlePublishLoop = async () => {
    if (loopPreview.length === 0) {
      showToast("No loop preview generated. Please configure your base devotion entries.", "error");
      return;
    }

    setIsPublishingLoop(true);
    try {
      const activeFlyerImage = devotionSettings?.scheduleImageUrl || "/assets/aistudio/image_17b76ed3.png";

      const promises = loopPreview.map(async (item) => {
        const matchedDev = employees.find(
          (e) => e.fullName.toLowerCase() === item.devotion.toLowerCase()
        );
        const matchedPray = employees.find(
          (e) => e.fullName.toLowerCase() === item.prayer.toLowerCase()
        );

        const data: Partial<DevotionSchedule> = {
          id: item.date,
          date: item.date,
          devotionLeaderId: matchedDev?.id || "",
          devotionLeaderName: item.devotion,
          prayerLeaderId: matchedPray?.id || "",
          prayerLeaderName: item.prayer,
          closingPrayerLeaderName: "",
          topic: "Daily Devotion & Shift Alignment",
          scripture: "Philippians 4:6-7",
          notes: `Loop Cycle ${item.loopIndex} (Pattern Day ${item.patternIndex} of ${loopBasePattern.length})`,
          imageUrl: activeFlyerImage,
          status: item.date < todayStr ? "completed" : "upcoming",
          isAbsent: false,
          isPrayerAbsent: false,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser?.email || "Admin (Loop Generator)",
        };

        return setDoc(doc(db, "devotion_schedules", item.date), data, { merge: true });
      });

      await Promise.all(promises);

      await addDoc(collection(db, "audit_logs"), {
        user: currentUser?.email || "Admin",
        action: "Published Devotion Loop",
        details: `Published ${loopPreview.length} business days of devotion schedules (Mon–Fri only) starting from ${loopStartDate}.`,
        timestamp: new Date().toISOString(),
      }).catch(() => {});

      showToast(`Successfully published ${loopPreview.length} days of devotion loop (Monday–Friday only)!`, "success");
      setIsLoopModalOpen(false);
      setLoopPreview([]);
    } catch (err) {
      console.error("Error publishing devotion loop:", err);
      showToast("Failed to publish devotion loop. Please try again.", "error");
    } finally {
      setIsPublishingLoop(false);
    }
  };

  // -------------------------------------------------------------
  // CLEAR / DELETE ALL DEVOTION SCHEDULES
  // -------------------------------------------------------------
  const handleClearAllDevotions = async () => {
    setClearingAll(true);
    try {
      for (const s of schedules) {
        if (s.id) {
          await deleteDoc(doc(db, "devotion_schedules", s.id)).catch(() => {});
        }
        if (s.date && s.date !== s.id) {
          await deleteDoc(doc(db, "devotion_schedules", s.date)).catch(() => {});
        }
      }

      await setDoc(doc(db, "devotion_settings", "rotation_state"), {
        devotionCycleNumber: 1,
        devotionCohort: [],
        devotionAssigned: [],
        prayerCycleNumber: 1,
        prayerCohort: [],
        prayerAssigned: [],
        queuedNewEmployees: [],
        lastMaintainedAt: new Date().toISOString(),
      }).catch(() => {});

      setSchedules([]);
      setIsClearAllModalOpen(false);
      showToast("All devotion schedules have been cleared! You can now input your new devotions.", "success");
    } catch (err) {
      console.error("Error clearing schedules:", err);
      showToast("Failed to clear schedules. Please try again.", "error");
    } finally {
      setClearingAll(false);
    }
  };

  // Filter schedules according to view mode & search:
  // - flyer / table: Strictly the next 15 upcoming schedule rows for admin planning
  // - history: Completed / archived historical schedules
  const filteredSchedules = useMemo(() => {
    let sourceList: DevotionSchedule[];
    if (viewMode === "history") {
      sourceList = historySchedules;
    } else {
      sourceList = upcomingSchedules.slice(0, 15);
    }

    if (!searchTerm) return sourceList;
    const term = searchTerm.toLowerCase();
    return sourceList.filter((s) =>
      s.date.includes(term) ||
      s.devotionLeaderName.toLowerCase().includes(term) ||
      s.prayerLeaderName.toLowerCase().includes(term) ||
      (s.substituteDevotionLeaderName && s.substituteDevotionLeaderName.toLowerCase().includes(term)) ||
      (s.substitutePrayerLeaderName && s.substitutePrayerLeaderName.toLowerCase().includes(term)) ||
      (s.topic && s.topic.toLowerCase().includes(term)) ||
      (s.scripture && s.scripture.toLowerCase().includes(term))
    );
  }, [viewMode, upcomingSchedules, historySchedules, searchTerm]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Banner / Headline */}
      <div className="bg-gradient-to-r from-zinc-900 via-indigo-950 to-zinc-900 border border-indigo-500/20 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        
        <div className="relative z-10 flex flex-col gap-5">
          <div className="space-y-2.5 w-full">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-[11px] sm:text-xs font-mono font-bold tracking-wider uppercase inline-flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Spiritual Ministry & Fellowship</span>
              </span>
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-400 text-[11px] sm:text-xs font-mono font-bold tracking-wider uppercase inline-flex items-center gap-1.5 animate-pulse">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Mon–Fri 12:00 AM Shift (Sat–Sun Rest Day)</span>
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Devotion & Prayer Ministry Hub
            </h2>
            <p className="text-xs sm:text-sm text-zinc-300 max-w-3xl leading-relaxed">
              Official Monday–Friday schedule for daily opening prayer and devotions (Saturday & Sunday are Rest Days).
              All schedule dates and leader assignments are saved permanently by date.
            </p>
          </div>

          {/* Action buttons toolbar */}
          <div className="w-full pt-4 border-t border-indigo-500/20 flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => openLoopModal()}
              className="px-3.5 py-2.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm flex-1 sm:flex-none"
              title="Loop your current entered devotions forward across upcoming Monday–Friday business days (skipping Sat & Sun)"
            >
              <Repeat className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>Loop Devotions Forward</span>
            </button>

            <button
              onClick={handleRollDailyQueue}
              disabled={isRollingQueue}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-200 text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm flex-1 sm:flex-none"
              title="Manually advance 1 day: Removes top row and adds newly generated fair random pair to the bottom"
            >
              {isRollingQueue ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-400 shrink-0" />
                  <span>Rolling Queue...</span>
                </>
              ) : (
                <>
                  <Shuffle className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Advance 1 Day (Roll Queue)</span>
                </>
              )}
            </button>

            <button
              onClick={() => {
                const nextDate = schedules.length > 0
                  ? addDaysToDateStr(schedules.reduce((max, s) => s.date > max ? s.date : max, schedules[0].date), 1, true)
                  : ensureWeekdayDateStr(todayStr);
                setAutoGenStartDate(nextDate);
                setAutoGenDaysCount(5);
                setAutoGenExcludeWeekends(true);
                handleGenerateFairPreview(nextDate, 5, true);
                setIsAutoGenerateModalOpen(true);
              }}
              className="px-3.5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-200 text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm flex-1 sm:flex-none"
            >
              <Shuffle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Fair Cycle Settings</span>
            </button>

            <button
              onClick={() => setIsClearAllModalOpen(true)}
              className="px-3.5 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm flex-1 sm:flex-none"
              title="Delete all current devotion schedules to start fresh"
            >
              <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
              <span>Clear All Schedules</span>
            </button>

            <button
              onClick={() => openAddModal()}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md flex-1 sm:flex-none sm:ml-auto"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Add Schedule Entry</span>
            </button>
          </div>
        </div>
      </div>

      {/* INSUFFICIENT ELIGIBLE STAFF WARNING BANNER */}
      {activeEmployees.length < 2 && (
        <div className="bg-amber-950/40 border border-amber-500/50 rounded-2xl p-4 flex items-start gap-3 shadow-lg">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <h4 className="font-bold text-amber-300 uppercase tracking-wide">
              Insufficient Eligible Staff for Auto-Scheduling
            </h4>
            <p className="text-zinc-300 leading-relaxed font-sans">
              At least 2 active employees are required to generate fair Devotion & Prayer rotation schedules without mutual exclusion conflicts. Please ensure at least 2 staff members have "Active" status in Employee Directory.
            </p>
          </div>
        </div>
      )}

      {/* TODAY'S DEVOTION SPOTLIGHT CARD */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-zinc-950 border border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-black text-white tracking-tight">Today's Devotion Assignment</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Active Shift (12:00 AM)
                  </span>
                </div>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">
                  {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>

            {todaySchedule && (
              <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                <button
                  onClick={() => openAddModal(todaySchedule)}
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-mono font-semibold flex items-center gap-1.5 border border-zinc-800 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              </div>
            )}
          </div>

          {todaySchedule ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Devotion Leader Box */}
                <div className={`p-4 rounded-xl border relative transition-all ${
                  todaySchedule.isAbsent 
                    ? "bg-rose-950/20 border-rose-500/30" 
                    : "bg-indigo-950/20 border-indigo-500/30"
                }`}>
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-indigo-300">
                      📖 DEVOTION LEADER
                    </span>
                    {todaySchedule.isAbsent ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1 shrink-0">
                        <UserX className="w-3 h-3" /> Absent
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 shrink-0">
                        <CheckCircle className="w-3 h-3" /> Scheduled
                      </span>
                    )}
                  </div>

                  {todaySchedule.isAbsent && todaySchedule.substituteDevotionLeaderName ? (
                    <div>
                      <div className="text-xs text-rose-300/80 line-through">
                        Original: {todaySchedule.devotionLeaderName}
                      </div>
                      <div className="text-lg font-black text-amber-400 mt-1 flex items-center gap-2">
                        <Repeat className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>Substitute: {todaySchedule.substituteDevotionLeaderName}</span>
                      </div>
                      <button
                        onClick={() => handleRestoreOriginalLeader(todaySchedule, "devotion")}
                        className="mt-2 text-[10px] font-mono text-zinc-400 hover:text-white underline cursor-pointer"
                      >
                        Restore original leader
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="text-lg font-black text-white">
                        {todaySchedule.devotionLeaderName}
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">Leads Scripture & Spiritual Reflection</p>
                      
                      {!todaySchedule.isAbsent && (
                        <button
                          onClick={() => openSubstituteModal(todaySchedule, "devotion")}
                          className="mt-3 px-2.5 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <UserX className="w-3 h-3 shrink-0" />
                          <span>Absent? Swap / Assign Substitute</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Prayer Leader Box */}
                <div className={`p-4 rounded-xl border relative transition-all ${
                  todaySchedule.isPrayerAbsent 
                    ? "bg-rose-950/20 border-rose-500/30" 
                    : "bg-sky-950/20 border-sky-500/30"
                }`}>
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-sky-300">
                      🙏 PRAYER LEADER
                    </span>
                    {todaySchedule.isPrayerAbsent ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1 shrink-0">
                        <UserX className="w-3 h-3" /> Absent
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 shrink-0">
                        <CheckCircle className="w-3 h-3" /> Scheduled
                      </span>
                    )}
                  </div>

                  {todaySchedule.isPrayerAbsent && todaySchedule.substitutePrayerLeaderName ? (
                    <div>
                      <div className="text-xs text-rose-300/80 line-through">
                        Original: {todaySchedule.prayerLeaderName}
                      </div>
                      <div className="text-lg font-black text-amber-400 mt-1 flex items-center gap-2">
                        <Repeat className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>Substitute: {todaySchedule.substitutePrayerLeaderName}</span>
                      </div>
                      <button
                        onClick={() => handleRestoreOriginalLeader(todaySchedule, "prayer")}
                        className="mt-2 text-[10px] font-mono text-zinc-400 hover:text-white underline cursor-pointer"
                      >
                        Restore original leader
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="text-lg font-black text-white">
                        {todaySchedule.prayerLeaderName}
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">Leads Opening & Intercessory Prayer</p>
                      
                      {!todaySchedule.isPrayerAbsent && (
                        <button
                          onClick={() => openSubstituteModal(todaySchedule, "prayer")}
                          className="mt-3 px-2.5 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <UserX className="w-3 h-3 shrink-0" />
                          <span>Absent? Swap / Assign Substitute</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-xl bg-zinc-900/40 border border-zinc-800/60 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
              <h4 className="text-sm font-bold text-white">No Devotion Schedule Logged for Today ({todayStr})</h4>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Click below to add today's leaders or use the Auto-Fill Cycle to populate the weekly roster.
              </p>
              <button
                onClick={() => openAddModal()}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold font-mono inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Assign Leaders for Today</span>
              </button>
            </div>
          )}
        </div>

        {/* Schedule Flyer / Graphic Widget */}
        {/* Daily Rolling Queue & Fair Cycle Engine Status Widget */}
        <div className="lg:col-span-4 bg-zinc-950 border border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400 shrink-0" />
                <h4 className="text-sm font-bold text-white">Daily Rolling Queue</h4>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                12:00 AM Active
              </span>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between items-center gap-2 p-2 rounded-xl bg-zinc-900 border border-zinc-850">
                <span className="text-zinc-400 text-[11px] shrink-0">UPCOMING QUEUE:</span>
                <span className="font-bold text-white text-right">15 Days (10 for Employees)</span>
              </div>

              <div className="flex justify-between items-center gap-2 p-2 rounded-xl bg-zinc-900 border border-zinc-850">
                <span className="text-zinc-400 text-[11px] shrink-0">TODAY (TOP ROW):</span>
                <span className="font-bold text-amber-400 truncate max-w-[160px] text-right">
                  {todaySchedule ? `${todaySchedule.devotionLeaderName} & ${todaySchedule.prayerLeaderName}` : "Not Assigned"}
                </span>
              </div>

              <div className="flex justify-between items-center gap-2 p-2 rounded-xl bg-zinc-900 border border-zinc-850">
                <span className="text-zinc-400 text-[11px] shrink-0">SCHEDULE HISTORY:</span>
                <span className="font-bold text-emerald-400 text-right">{historySchedules.length} Archived Past Shifts</span>
              </div>

              <div className="flex justify-between items-center gap-2 p-2 rounded-xl bg-zinc-900 border border-zinc-850">
                <span className="text-zinc-400 text-[11px] shrink-0">DEVOTION CYCLE:</span>
                <span className="font-bold text-indigo-400 text-right">
                  Cycle #{rotationState?.devotionCycleNumber || 1} ({rotationState?.devotionAssigned?.length || 0}/{rotationState?.devotionCohort?.length || getSelectedRosterPool().length} Served)
                </span>
              </div>

              <div className="flex justify-between items-center gap-2 p-2 rounded-xl bg-zinc-900 border border-zinc-850">
                <span className="text-zinc-400 text-[11px] shrink-0">PRAYER CYCLE:</span>
                <span className="font-bold text-sky-400 text-right">
                  Cycle #{rotationState?.prayerCycleNumber || 1} ({rotationState?.prayerAssigned?.length || 0}/{rotationState?.prayerCohort?.length || getSelectedRosterPool().length} Served)
                </span>
              </div>

              {rotationState?.queuedNewEmployees && rotationState.queuedNewEmployees.length > 0 && (
                <div className="p-2 rounded-xl bg-indigo-950/40 border border-indigo-800/40 text-[10px]">
                  <span className="text-indigo-300 font-bold block mb-0.5">NEXT CYCLE QUEUE:</span>
                  <span className="text-zinc-300">{rotationState.queuedNewEmployees.join(", ")} (Joins Next Cycle)</span>
                </div>
              )}
            </div>

            <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-1 text-[11px]">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold font-mono">
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Fair Exhaustion Guarantee</span>
              </div>
              <p className="text-zinc-400 leading-relaxed font-sans text-xs">
                Each employee serves once per role cycle before anyone is chosen again. Newly added staff join the next cycle only. Devotion and prayer on the same day are strictly mutually exclusive.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-800/80 space-y-2">
            <button
              type="button"
              onClick={handleRollDailyQueue}
              disabled={isRollingQueue}
              className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-mono text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              {isRollingQueue ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Rolling Queue...</span>
                </>
              ) : (
                <>
                  <Shuffle className="w-3.5 h-3.5" />
                  <span>Advance 1 Day (Test Roll Now)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => openLoopModal()}
              className="w-full py-2 px-3 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 font-mono text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Repeat className="w-3.5 h-3.5 text-indigo-400" />
              <span>Loop Current Devotions Forward</span>
            </button>
          </div>
        </div>
      </div>

      {/* ROSTER SECTION WITH VIEW MODE TABS */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div className="space-y-0.5">
            <h3 className="text-base font-black text-white tracking-tight flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>
                {viewMode === "history"
                  ? `Schedule History (${filteredSchedules.length} Archived Completed Records)`
                  : `15-Day Upcoming Planning Roster (${filteredSchedules.length} Shifts Ahead)`}
              </span>
            </h3>
            <p className="text-xs text-zinc-400 font-mono">
              {viewMode === "history"
                ? "Full historical archive of completed past devotion leaders, prayer assignments, and substitute logs."
                : "Admin Planning View: Next 15 upcoming shifts (first 10 are visible to staff on Employee Portal)."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto">
            {/* 3 View Tabs: Flyer Layout, Table View, Schedule History */}
            <div className="flex flex-wrap items-center p-1 bg-zinc-900 border border-zinc-800 rounded-xl gap-1">
              <button
                type="button"
                onClick={() => setViewMode("flyer")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  viewMode === "flyer"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                <span>Flyer Layout</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  viewMode === "table"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <List className="w-3.5 h-3.5 shrink-0" />
                <span>Table View</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode("history")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  viewMode === "history"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <History className="w-3.5 h-3.5 shrink-0" />
                <span>Schedule History</span>
                {historySchedules.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-zinc-800 text-zinc-200">
                    {historySchedules.length}
                  </span>
                )}
              </button>
            </div>

            <div className="relative flex-1 sm:flex-none min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search date or leader..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-3.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full sm:w-56"
              />
            </div>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* View 1: Flyer Poster Layout */}
        {viewMode === "flyer" && (
          <DevotionFlyerCard
            schedules={filteredSchedules}
            todayStr={todayStr}
            onOpenSubstituteModal={openSubstituteModal}
            onEditSchedule={openAddModal}
            onDeleteSchedule={handleDeleteSchedule}
            onOpenLoopModal={openLoopModal}
            onRollDailyQueue={handleRollDailyQueue}
            isRolling={isRollingQueue}
            isAdmin={true}
            currentUserId={currentUser?.uid}
            currentUserName={currentUser?.displayName || currentUser?.email}
          />
        )}

        {/* View 2: Full Spreadsheet Table */}
        {viewMode === "table" && (
          <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-800 font-mono text-[10px] text-zinc-400 uppercase tracking-wider bg-zinc-900/50">
                <th className="py-3 px-3">Date</th>
                <th className="py-3 px-3">Devotion Leader</th>
                <th className="py-3 px-3">Prayer Leader</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-sans">
              {filteredSchedules.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500 font-mono">
                    No devotion schedules found. Click "Add Schedule Entry" or "Auto-Fill Cycle" to begin.
                  </td>
                </tr>
              ) : (
                filteredSchedules.map((item) => {
                  const isToday = item.date === todayStr;
                  const itemDateObj = new Date(item.date + "T00:00:00");
                  const dayName = itemDateObj.toLocaleDateString(undefined, { weekday: "short" });

                  return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-zinc-900/40 transition-colors ${
                        isToday ? "bg-indigo-950/20 font-medium" : ""
                      }`}
                    >
                      {/* Date */}
                      <td className="py-3.5 px-3 whitespace-nowrap font-mono">
                        <div className="flex items-center gap-2">
                          {isToday && (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                          )}
                          <span className={`font-bold ${isToday ? "text-amber-400" : "text-zinc-200"}`}>
                            {item.date}
                          </span>
                          <span className="text-[10px] text-zinc-500 uppercase">
                            ({dayName})
                          </span>
                        </div>
                      </td>

                      {/* Devotion Leader */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {item.isAbsent && item.substituteDevotionLeaderName ? (
                          <div>
                            <div className="text-[10px] text-rose-400 line-through">
                              {item.devotionLeaderName} (Absent)
                            </div>
                            <div className="font-bold text-amber-400 flex items-center gap-1 mt-0.5">
                              <Repeat className="w-3 h-3 text-amber-400" />
                              <span>{item.substituteDevotionLeaderName}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="font-bold text-zinc-200">
                            {item.devotionLeaderName}
                          </div>
                        )}
                      </td>

                      {/* Prayer Leader */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {item.isPrayerAbsent && item.substitutePrayerLeaderName ? (
                          <div>
                            <div className="text-[10px] text-rose-400 line-through">
                              {item.prayerLeaderName} (Absent)
                            </div>
                            <div className="font-bold text-amber-400 flex items-center gap-1 mt-0.5">
                              <Repeat className="w-3 h-3 text-amber-400" />
                              <span>{item.substitutePrayerLeaderName}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="font-bold text-zinc-200">
                            {item.prayerLeaderName}
                          </div>
                        )}
                      </td>


                      {/* Status */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {item.isAbsent || item.isPrayerAbsent ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Substituted
                          </span>
                        ) : isToday ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            Active Today
                          </span>
                        ) : item.date < todayStr ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono text-zinc-500 bg-zinc-800">
                            Completed
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono text-sky-400 bg-sky-950/40 border border-sky-800/40">
                            Upcoming
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Swap / Substitute button */}
                          <button
                            onClick={() => openSubstituteModal(item, "devotion")}
                            title="Substitute if absent"
                            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-rose-400 border border-zinc-800 cursor-pointer"
                          >
                            <UserX className="w-3.5 h-3.5" />
                          </button>

                          {/* Edit button */}
                          <button
                            onClick={() => openAddModal(item)}
                            title="Edit details"
                            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete button */}
                          {item.id && (
                            <button
                              onClick={() => handleDeleteSchedule(item.id!, item.date)}
                              title="Delete schedule"
                              className="p-1.5 rounded-lg bg-zinc-900 hover:bg-rose-950/40 text-zinc-500 hover:text-rose-400 border border-zinc-800 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        )}

        {/* View 3: Schedule History */}
        {viewMode === "history" && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-indigo-950/20 border border-indigo-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-indigo-300">
                <History className="w-4 h-4 shrink-0" />
                <span className="font-mono">
                  Preserved Schedule History: Past completed assignments are archived here and never deleted.
                </span>
              </div>
              <span className="text-[11px] font-mono text-zinc-400">
                Total Archived: <strong>{historySchedules.length}</strong>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 font-mono text-[10px] text-zinc-400 uppercase tracking-wider bg-zinc-900/50">
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Devotion Leader</th>
                    <th className="py-3 px-3">Prayer Leader</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-sans">
                  {filteredSchedules.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-zinc-500 font-mono">
                        No completed history records found yet. Schedules automatically archive here when completed.
                      </td>
                    </tr>
                  ) : (
                    filteredSchedules.map((item) => {
                      const itemDateObj = new Date(item.date + "T00:00:00");
                      const dayName = itemDateObj.toLocaleDateString(undefined, { weekday: "short" });

                      return (
                        <tr key={item.id || item.date} className="hover:bg-zinc-900/40 transition-colors">
                          <td className="py-3.5 px-3 whitespace-nowrap font-mono">
                            <span className="font-bold text-zinc-300">{item.date}</span>
                            <span className="text-[10px] text-zinc-500 ml-1.5 font-normal">({dayName})</span>
                          </td>
                          <td className="py-3.5 px-3">
                            <span className="font-bold text-indigo-300">{item.devotionLeaderName}</span>
                            {item.isAbsent && item.substituteDevotionLeaderName && (
                              <span className="block text-[10px] text-amber-400 font-mono">
                                Sub: {item.substituteDevotionLeaderName}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3">
                            <span className="font-bold text-sky-300">{item.prayerLeaderName}</span>
                            {item.isPrayerAbsent && item.substitutePrayerLeaderName && (
                              <span className="block text-[10px] text-amber-400 font-mono">
                                Sub: {item.substitutePrayerLeaderName}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 inline-flex items-center gap-1">
                              <CheckCircle className="w-2.5 h-2.5" />
                              Completed History
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-right whitespace-nowrap">
                            <button
                              onClick={() => openAddModal(item)}
                              title="View / Edit details"
                              className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: ADD / EDIT SCHEDULE ENTRY */}
      {isAddingModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative space-y-4 animate-in fade-in duration-200">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-black text-white">
                  {editingSchedule ? "Edit Devotion Schedule" : "Add Devotion Schedule"}
                </h3>
              </div>
              <button
                onClick={() => setIsAddingModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSchedule} className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono font-bold text-zinc-400 uppercase">Schedule Date</label>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    Mon–Fri Workdays Only
                  </span>
                </div>
                <input
                  type="date"
                  required
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full text-xs font-mono px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                {formDate && isWeekendDateStr(formDate) && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-[11px] text-amber-300 font-mono">
                    <span>⚠️ Saturday & Sunday are Rest Days (no work/devotion).</span>
                    <button
                      type="button"
                      onClick={() => setFormDate(ensureWeekdayDateStr(formDate))}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 font-bold underline cursor-pointer"
                    >
                      Shift to Monday
                    </button>
                  </div>
                )}
              </div>

              {/* Devotion Leader Search Bar */}
              <EmployeeSearchInput
                label="Devotion Leader"
                valueName={formDevotionLeaderName}
                valueId={formDevotionLeaderId}
                employees={activeEmployees}
                required
                placeholder="Search by employee name or ID (e.g. Cedric, 003)..."
                onChange={({ id, name }) => {
                  setFormDevotionLeaderId(id);
                  setFormDevotionLeaderName(name);
                }}
              />

              {/* Opening Prayer Leader Search Bar */}
              <EmployeeSearchInput
                label="Opening Prayer Leader"
                valueName={formPrayerLeaderName}
                valueId={formPrayerLeaderId}
                employees={activeEmployees}
                required
                placeholder="Search by employee name or ID (e.g. Rayvel, 004)..."
                onChange={({ id, name }) => {
                  setFormPrayerLeaderId(id);
                  setFormPrayerLeaderName(name);
                }}
              />

              {/* Closing Prayer Leader (Optional) */}
              <div className="space-y-1">
                <label className="text-xs font-mono font-bold text-zinc-400 uppercase">Closing Prayer Leader (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Christian or leave blank"
                  value={formClosingPrayerLeaderName}
                  onChange={(e) => setFormClosingPrayerLeaderName(e.target.value)}
                  className="w-full text-xs px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none"
                />
              </div>


              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddingModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-bold"
                >
                  {formSaving ? "Saving..." : editingSchedule ? "Update Schedule" : "Create Schedule Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: SUBSTITUTE / SWAP LEADER (IF ABSENT) */}
      {isSubstituteModalOpen && substituteTargetSchedule && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-rose-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4 animate-in fade-in duration-200">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-rose-400">
                <UserX className="w-5 h-5" />
                <h3 className="text-base font-black text-white">
                  Assign Substitute Leader (Employee Absent)
                </h3>
              </div>
              <button
                onClick={() => setIsSubstituteModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-rose-950/20 border border-rose-500/30 rounded-xl text-xs text-rose-300 space-y-1">
              <p>
                <strong>Date:</strong> {substituteTargetSchedule.date}
              </p>
              <p>
                <strong>Original Leader:</strong>{" "}
                {substituteRole === "devotion" 
                  ? substituteTargetSchedule.devotionLeaderName 
                  : substituteTargetSchedule.prayerLeaderName}
              </p>
            </div>

            <form onSubmit={handleSaveSubstitute} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-mono font-bold text-zinc-400 uppercase">Role Being Substituted</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSubstituteRole("devotion")}
                    className={`py-2 px-3 rounded-xl text-xs font-mono font-bold border transition-all ${
                      substituteRole === "devotion"
                        ? "bg-indigo-600 text-white border-indigo-500"
                        : "bg-zinc-900 text-zinc-400 border-zinc-800"
                    }`}
                  >
                    Devotion Leader
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubstituteRole("prayer")}
                    className={`py-2 px-3 rounded-xl text-xs font-mono font-bold border transition-all ${
                      substituteRole === "prayer"
                        ? "bg-indigo-600 text-white border-indigo-500"
                        : "bg-zinc-900 text-zinc-400 border-zinc-800"
                    }`}
                  >
                    Prayer Leader
                  </button>
                </div>
              </div>

              {/* Substitute Employee Search Bar */}
              <EmployeeSearchInput
                label="Substitute Employee"
                valueName={substituteEmployeeName}
                valueId={substituteEmployeeId}
                employees={activeEmployees}
                required
                placeholder="Search directory by name or ID (e.g. 003, Cedric)..."
                onChange={({ id, name }) => {
                  setSubstituteEmployeeId(id);
                  setSubstituteEmployeeName(name);
                }}
              />

              <div className="space-y-1">
                <label className="text-xs font-mono font-bold text-zinc-400 uppercase">Reason / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Employee on Sick Leave / Emergency Swap"
                  value={substituteReason}
                  onChange={(e) => setSubstituteReason(e.target.value)}
                  className="w-full text-xs px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsSubstituteModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={substituteSaving}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-mono font-bold shadow-md"
                >
                  {substituteSaving ? "Updating..." : "Confirm & Save Substitute"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* MODAL 5: AI FAIR CYCLE EXHAUSTION RANDOMIZER */}
      {isAutoGenerateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-emerald-500/30 rounded-2xl w-full max-w-xl p-6 shadow-2xl relative space-y-4 animate-in fade-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <Shuffle className="w-5 h-5" />
                <h3 className="text-base font-black text-white">
                  AI Fair Cycle Exhaustion Randomizer
                </h3>
              </div>
              <button
                onClick={() => {
                  setIsAutoGenerateModalOpen(false);
                  setFairPreview([]);
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Rules banner */}
              <div className="p-3.5 bg-emerald-950/20 border border-emerald-500/30 rounded-xl space-y-2">
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold font-mono text-[11px] uppercase">
                  <CheckCircle className="w-4 h-4" />
                  <span>Mathematical Fairness & Exhaustion Guarantee</span>
                </div>
                <ul className="text-zinc-300 text-[11px] space-y-1 list-disc pl-4 leading-relaxed">
                  <li>
                    <strong>No Same-Day Clashes:</strong> If someone is the Devotion Leader on a date, they are guaranteed <em>never</em> to be the Prayer Leader on that same date.
                  </li>
                  <li>
                    <strong>Full Exhaustion Cycle:</strong> All members in the roster pool must be selected once before <em>any</em> person's name can repeat in a new cycle.
                  </li>
                  <li>
                    <strong>Boundary Smoothing:</strong> Prevents consecutive repeats between the last day of cycle 1 and the first day of cycle 2.
                  </li>
                </ul>
              </div>

              {/* Roster Pool Selector */}
              <div className="space-y-2">
                <label className="text-xs font-mono font-bold text-zinc-400 uppercase">
                  1. Select Team Roster Pool
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRosterSource("official");
                      setFairPreview([]);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      rosterSource === "official"
                        ? "bg-indigo-600/20 border-indigo-500 text-white font-bold"
                        : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <div className="font-mono text-xs">Official Flyer Team</div>
                    <div className="text-[10px] text-zinc-400 font-normal mt-0.5">
                      10 staff names matching physical layout
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRosterSource("employees");
                      setFairPreview([]);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      rosterSource === "employees"
                        ? "bg-indigo-600/20 border-indigo-500 text-white font-bold"
                        : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <div className="font-mono text-xs">Directory Staff</div>
                    <div className="text-[10px] text-zinc-400 font-normal mt-0.5">
                      {activeEmployees.length} active registered accounts
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRosterSource("custom");
                      setFairPreview([]);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      rosterSource === "custom"
                        ? "bg-indigo-600/20 border-indigo-500 text-white font-bold"
                        : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <div className="font-mono text-xs">Custom Names</div>
                    <div className="text-[10px] text-zinc-400 font-normal mt-0.5">
                      Type custom list of names
                    </div>
                  </button>
                </div>

                {rosterSource === "custom" && (
                  <div className="pt-1">
                    <input
                      type="text"
                      value={customRosterInput}
                      onChange={(e) => {
                        setCustomRosterInput(e.target.value);
                        setFairPreview([]);
                      }}
                      placeholder="e.g. FRANKIE, RAYVEL, CEDRIC, ROLAND, ISRAEL, JR, AARON, JERICHO, MARK, JAO"
                      className="w-full text-xs font-mono px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none"
                    />
                    <span className="text-[10px] text-zinc-500 font-mono mt-1 block">
                      Separate names with commas. Need at least 2 names.
                    </span>
                  </div>
                )}

                {/* Show pool chip badges */}
                <div className="p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase block mb-1.5 font-bold">
                    Active Roster Pool ({getSelectedRosterPool().length} Members):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {getSelectedRosterPool().map((name, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-200 text-[10px] font-mono font-bold"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Start Date & Days Count */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-mono font-bold text-zinc-400 uppercase">
                    2. Starting Date
                  </label>
                  <input
                    type="date"
                    value={autoGenStartDate}
                    onChange={(e) => {
                      setAutoGenStartDate(e.target.value);
                      setFairPreview([]);
                    }}
                    className="w-full text-xs font-mono px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-mono font-bold text-zinc-400 uppercase">
                    3. Duration to Schedule
                  </label>
                  <select
                    value={autoGenDaysCount}
                    onChange={(e) => {
                      setAutoGenDaysCount(Number(e.target.value));
                      setFairPreview([]);
                    }}
                    className="w-full text-xs font-mono px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none"
                  >
                    <option value={5}>5 Days (1 Week / 5 Business Shifts)</option>
                    <option value={10}>10 Days (2 Weeks / 10 Business Shifts)</option>
                    <option value={15}>15 Days (3 Weeks / Admin Horizon)</option>
                    <option value={20}>20 Days (4 Weeks / 1 Month Horizon)</option>
                    <option value={30}>30 Days (6 Weeks / Extended Horizon)</option>
                  </select>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs text-emerald-300 font-mono font-bold">
                  Mon–Fri Workdays Only (Saturday & Sunday Rest Days Skipped)
                </span>
              </div>

              {/* Preview trigger button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => handleGenerateFairPreview()}
                  className="w-full py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-emerald-400 border border-emerald-500/30 text-xs font-mono font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Shuffle className="w-4 h-4" />
                  <span>
                    {fairPreview.length > 0 ? "Re-Shuffle New Fair Permutation" : "Generate Fair Randomization Preview"}
                  </span>
                </button>
              </div>

              {/* Live Preview of Fair Cycles */}
              {fairPreview.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-emerald-400 font-bold uppercase flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Generated Fair Permutation Preview ({fairPreview.length} Days)
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      Cycle Size: {getSelectedRosterPool().length} Members
                    </span>
                  </div>

                  <div className="max-h-56 overflow-y-auto space-y-1 pr-1 border border-zinc-800 rounded-xl p-2 bg-zinc-900/50 font-mono text-[11px]">
                    {fairPreview.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg bg-zinc-950/80 border border-zinc-850"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-500 text-[10px]">#{idx + 1}</span>
                          <span className="text-zinc-200 font-bold">{item.date}</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300">
                            Cycle {item.cycleNumber} ({item.dayInCycle}/{item.cycleTotal})
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span>
                            <strong className="text-indigo-400">DEV:</strong> {item.devotion}
                          </span>
                          <span>
                            <strong className="text-sky-400">PRAY:</strong> {item.prayer}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Commit buttons */}
              <div className="pt-3 flex justify-between items-center border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsAutoGenerateModalOpen(false);
                    setFairPreview([]);
                  }}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-semibold cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={autoGenerating}
                  onClick={handleCommitFairRoster}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold flex items-center gap-2 cursor-pointer shadow-md"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {autoGenerating 
                      ? "Publishing Schedule..." 
                      : fairPreview.length > 0 
                        ? `Publish ${fairPreview.length} Days to Calendar` 
                        : "Generate & Publish Schedule"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: CREATE NEW DEVOTION LOOP (MONDAY–FRIDAY ONLY) */}
      {isLoopModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative space-y-5 animate-in fade-in duration-200">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Repeat className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Create New Devotion Loop</h3>
                  <p className="text-[11px] font-mono text-zinc-400">
                    Loop custom devotion entries forward • Strictly Monday–Friday (Sat & Sun Skipped)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsLoopModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Info Banner */}
              <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-start gap-2.5 text-xs text-zinc-300">
                <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed font-sans">
                  This tool takes your ordered sequence of devotion & prayer leader pairs and repeats it seamlessly into future business days. 
                  <strong className="text-emerald-400 block font-mono text-[11px] mt-1">
                    ✓ Saturday and Sunday Rest Days are strictly skipped. Devotions are only scheduled Monday through Friday.
                  </strong>
                </div>
              </div>

              {/* Step 1: Base Pattern (Pairs to loop) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wide flex items-center gap-2">
                    <span>1. Base Devotion Sequence ({loopBasePattern.length} Days in Loop)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const newPattern = [...loopBasePattern, { devotion: "", prayer: "" }];
                      setLoopBasePattern(newPattern);
                      handleUpdateLoopPreview(newPattern, loopStartDate, loopDaysCount);
                    }}
                    className="text-[11px] font-mono font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Pair</span>
                  </button>
                </div>

                {loopBasePattern.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-zinc-800 text-center space-y-2">
                    <p className="text-xs text-zinc-400 font-mono">
                      No base pattern detected. Click below to add pairs or load active team members.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const emps = activeEmployees.map((e) => e.fullName.trim());
                        const base: { devotion: string; prayer: string }[] = [];
                        for (let i = 0; i < Math.min(5, emps.length); i++) {
                          base.push({
                            devotion: emps[i],
                            prayer: emps[(i + 1) % emps.length],
                          });
                        }
                        setLoopBasePattern(base);
                        handleUpdateLoopPreview(base, loopStartDate, loopDaysCount);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 text-xs font-mono font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Load Active Staff Pairs</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {loopBasePattern.map((pair, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 p-2 rounded-xl bg-zinc-900/80 border border-zinc-800 text-xs font-mono"
                      >
                        <span className="w-6 text-zinc-500 font-bold text-center">#{idx + 1}</span>
                        <div className="flex-1 flex items-center gap-1.5">
                          <span className="text-[10px] text-indigo-400 font-bold shrink-0">DEV:</span>
                          <input
                            type="text"
                            value={pair.devotion}
                            onChange={(e) => {
                              const updated = [...loopBasePattern];
                              updated[idx] = { ...updated[idx], devotion: e.target.value };
                              setLoopBasePattern(updated);
                              handleUpdateLoopPreview(updated, loopStartDate, loopDaysCount);
                            }}
                            placeholder="Devotion Leader"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-white text-xs focus:outline-none"
                          />
                        </div>
                        <div className="flex-1 flex items-center gap-1.5">
                          <span className="text-[10px] text-sky-400 font-bold shrink-0">PRAY:</span>
                          <input
                            type="text"
                            value={pair.prayer}
                            onChange={(e) => {
                              const updated = [...loopBasePattern];
                              updated[idx] = { ...updated[idx], prayer: e.target.value };
                              setLoopBasePattern(updated);
                              handleUpdateLoopPreview(updated, loopStartDate, loopDaysCount);
                            }}
                            placeholder="Prayer Leader"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-white text-xs focus:outline-none"
                          />
                        </div>
                        {loopBasePattern.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = loopBasePattern.filter((_, i) => i !== idx);
                              setLoopBasePattern(updated);
                              handleUpdateLoopPreview(updated, loopStartDate, loopDaysCount);
                            }}
                            className="p-1 rounded text-zinc-500 hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Step 2: Start Date & Duration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-800">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-mono font-bold text-zinc-400 uppercase">
                      2. Start Loop On (Mon–Fri)
                    </label>
                  </div>
                  <input
                    type="date"
                    value={loopStartDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLoopStartDate(val);
                      handleUpdateLoopPreview(loopBasePattern, val, loopDaysCount);
                    }}
                    className="w-full text-xs font-mono px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none"
                  />
                  {loopStartDate && isWeekendDateStr(loopStartDate) && (
                    <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-[10px] text-amber-300 font-mono">
                      <span>Rest Day selected.</span>
                      <button
                        type="button"
                        onClick={() => {
                          const weekday = ensureWeekdayDateStr(loopStartDate);
                          setLoopStartDate(weekday);
                          handleUpdateLoopPreview(loopBasePattern, weekday, loopDaysCount);
                        }}
                        className="font-bold underline cursor-pointer"
                      >
                        Shift to Monday
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-mono font-bold text-zinc-400 uppercase">
                    3. Duration to Project
                  </label>
                  <select
                    value={loopDaysCount}
                    onChange={(e) => {
                      const cnt = Number(e.target.value);
                      setLoopDaysCount(cnt);
                      handleUpdateLoopPreview(loopBasePattern, loopStartDate, cnt);
                    }}
                    className="w-full text-xs font-mono px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none"
                  >
                    <option value={5}>5 Business Days (1 Work Week)</option>
                    <option value={10}>10 Business Days (2 Work Weeks)</option>
                    <option value={15}>15 Business Days (3 Work Weeks)</option>
                    <option value={20}>20 Business Days (4 Work Weeks)</option>
                    <option value={25}>25 Business Days (5 Work Weeks)</option>
                    <option value={30}>30 Business Days (6 Work Weeks)</option>
                  </select>
                </div>
              </div>

              {/* Step 3: Live Preview Table */}
              {loopPreview.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-emerald-400 font-bold uppercase flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Looped Schedule Preview ({loopPreview.length} Weekday Shifts)
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      All Dates Guaranteed Monday–Friday
                    </span>
                  </div>

                  <div className="max-h-52 overflow-y-auto space-y-1 pr-1 border border-zinc-800 rounded-xl p-2 bg-zinc-900/50 font-mono text-[11px]">
                    {loopPreview.map((item, idx) => {
                      const [y, m, d] = item.date.split("-").map(Number);
                      const dayName = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded-lg bg-zinc-950/80 border border-zinc-850"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-500 text-[10px]">#{idx + 1}</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300">
                              {dayName}
                            </span>
                            <span className="text-zinc-200 font-bold">{item.date}</span>
                            <span className="text-[9px] text-zinc-500">
                              (Loop #{item.loopIndex})
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span>
                              <strong className="text-indigo-400">DEV:</strong> {item.devotion}
                            </span>
                            <span>
                              <strong className="text-sky-400">PRAY:</strong> {item.prayer}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Commit buttons */}
              <div className="pt-3 flex justify-between items-center border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsLoopModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-semibold cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={isPublishingLoop || loopPreview.length === 0}
                  onClick={handlePublishLoop}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-mono font-bold flex items-center gap-2 cursor-pointer shadow-md"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {isPublishingLoop ? "Publishing Loop..." : `Publish ${loopPreview.length} Looped Days (Mon–Fri)`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: CONFIRM CLEAR ALL DEVOTIONS */}
      {isClearAllModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-rose-500/40 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-white">Clear All Devotion Schedules?</h3>
                <p className="text-xs text-zinc-400 font-mono">Permanent Action</p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed font-sans">
              Are you sure you want to delete all current devotion schedules?
              This will wipe existing schedule rows so you can enter your new devotions from scratch. 
              The schedule will remain empty until you add your entries or loop them.
            </p>

            <div className="pt-2 flex justify-end gap-2.5 border-t border-zinc-800">
              <button
                type="button"
                disabled={clearingAll}
                onClick={() => setIsClearAllModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={clearingAll}
                onClick={handleClearAllDevotions}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-mono font-bold flex items-center gap-2 cursor-pointer shadow-md"
              >
                {clearingAll ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Clearing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Yes, Clear All Schedules</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border text-xs font-mono font-bold animate-in fade-in slide-in-from-bottom-3 duration-200 ${
          toastMessage.type === "success"
            ? "bg-emerald-950/95 border-emerald-500/50 text-emerald-200"
            : toastMessage.type === "error"
            ? "bg-rose-950/95 border-rose-500/50 text-rose-200"
            : "bg-indigo-950/95 border-indigo-500/50 text-indigo-200"
        }`}>
          {toastMessage.type === "success" && <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toastMessage.type === "error" && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
          {toastMessage.type === "info" && <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />}
          <span>{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
