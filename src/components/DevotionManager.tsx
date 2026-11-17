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
import { Employee, DevotionSchedule, DevotionSettings } from "../types";
import { 
  Sparkles, 
  Calendar, 
  CalendarDays,
  ArrowLeftRight,
  Download,
  Plus, 
  Trash2, 
  Edit3, 
  AlertCircle, 
  Clock, 
  BookOpen, 
  CheckCircle, 
  Check,
  Repeat, 
  X, 
  Search, 
  UserX, 
  RefreshCw, 
  LayoutGrid, 
  List, 
  History
} from "lucide-react";
import DevotionFlyerCard from "./DevotionFlyerCard";
import DevotionLineupExportModal from "./DevotionLineupExportModal";
import EmployeeSearchInput from "./EmployeeSearchInput";
import { 
  maintainRollingSchedule,
  getNextManualScheduleDate,
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

  // View mode switcher: "flyer" (interactive replica 15 rows), "table" (master spreadsheet 15 rows), "history" (completed archive)
  const [viewMode, setViewMode] = useState<"flyer" | "table" | "history">("flyer");

  // Manual Multi-Day Planner modal states
  const [isBatchManualModalOpen, setIsBatchManualModalOpen] = useState(false);
  const [batchStartDate, setBatchStartDate] = useState("");
  const [batchDaysCount, setBatchDaysCount] = useState(5);
  const [batchRows, setBatchRows] = useState<
    { date: string; devotionId: string; devotionName: string; prayerId: string; prayerName: string }[]
  >([]);
  const [batchSaving, setBatchSaving] = useState(false);

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

  // Lineup Image Export Modal State (Admin Only)
  const [isLineupExportModalOpen, setIsLineupExportModalOpen] = useState(false);

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

    return () => {
      unsub();
      unsubSettings();
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

  // Open Add/Edit Modal (Strict Manual Admin Assignment — no random auto-selection)
  const openAddModal = (existing?: DevotionSchedule, presetDate?: string) => {
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
      const targetDate = presetDate ? ensureWeekdayDateStr(presetDate) : getNextManualScheduleDate(schedules, todayStr);
      const existingOnTarget = schedules.find((s) => s.date === targetDate);
      setEditingSchedule(existingOnTarget || null);
      setFormDate(targetDate);
      setFormDevotionLeaderId(existingOnTarget?.devotionLeaderId || "");
      setFormDevotionLeaderName(existingOnTarget?.devotionLeaderName || "");
      setFormPrayerLeaderId(existingOnTarget?.prayerLeaderId || "");
      setFormPrayerLeaderName(existingOnTarget?.prayerLeaderName || "");
      setFormClosingPrayerLeaderName(existingOnTarget?.closingPrayerLeaderName || "");
      setFormTopic(existingOnTarget?.topic || "Daily Devotion & Shift Alignment");
      setFormScripture(existingOnTarget?.scripture || "Philippians 4:6-7");
      setFormNotes(existingOnTarget?.notes || "Admin Manual Assignment");
    }
    setIsAddingModalOpen(true);
  };

  // Swap Devotion and Prayer leaders in Single Entry Modal
  const handleSwapFormLeaders = () => {
    const prevDevId = formDevotionLeaderId;
    const prevDevName = formDevotionLeaderName;
    setFormDevotionLeaderId(formPrayerLeaderId);
    setFormDevotionLeaderName(formPrayerLeaderName);
    setFormPrayerLeaderId(prevDevId);
    setFormPrayerLeaderName(prevDevName);
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

  // Archive expired past schedules automatically (no random schedule generation)
  useEffect(() => {
    if (loading || schedules.length === 0) return;
    maintainRollingSchedule(db, todayStr, employees, schedules, 15).catch((err) => {
      console.warn("Devotion archive maintenance note:", err);
    });
  }, [schedules.length, todayStr, employees.length, loading]);

  // -------------------------------------------------------------
  // PLAN MULTIPLE DAYS MANUALLY (Mon–Fri, Admin Explicitly Picks Each Day)
  // -------------------------------------------------------------
  const buildBatchManualRows = (startDateStr: string, daysCount: number) => {
    const cleanStart = ensureWeekdayDateStr(startDateStr || getNextManualScheduleDate(schedules, todayStr));
    const rows: { date: string; devotionId: string; devotionName: string; prayerId: string; prayerName: string }[] = [];
    let cursor = cleanStart;
    for (let i = 0; i < daysCount; i++) {
      const existing = schedules.find((s) => s.date === cursor);
      rows.push({
        date: cursor,
        devotionId: existing?.devotionLeaderId || "",
        devotionName: existing?.devotionLeaderName || "",
        prayerId: existing?.prayerLeaderId || "",
        prayerName: existing?.prayerLeaderName || ""
      });
      cursor = addDaysToDateStr(cursor, 1, true);
    }
    return rows;
  };

  const openBatchManualModal = () => {
    const nextStart = getNextManualScheduleDate(schedules, todayStr);
    setBatchStartDate(nextStart);
    setBatchDaysCount(5);
    setBatchRows(buildBatchManualRows(nextStart, 5));
    setIsBatchManualModalOpen(true);
  };

  const handleBatchLeaderChange = (rowIdx: number, role: "devotion" | "prayer", empId: string) => {
    const emp = activeEmployees.find((e) => e.id === empId);
    setBatchRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIdx) return r;
        if (role === "devotion") {
          return { ...r, devotionId: emp?.id || "", devotionName: emp?.fullName || "" };
        }
        return { ...r, prayerId: emp?.id || "", prayerName: emp?.fullName || "" };
      })
    );
  };

  const handleSwapBatchRow = (rowIdx: number) => {
    setBatchRows((prev) =>
      prev.map((r, i) =>
        i === rowIdx
          ? {
              ...r,
              devotionId: r.prayerId,
              devotionName: r.prayerName,
              prayerId: r.devotionId,
              prayerName: r.devotionName
            }
          : r
      )
    );
  };

  const handleSaveBatchManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const readyRows = batchRows.filter((r) => r.devotionName.trim() && r.prayerName.trim());
    if (readyRows.length === 0) {
      showToast("Select at least one day with both Devotion and Prayer leaders.", "error");
      return;
    }

    setBatchSaving(true);
    try {
      const activeFlyerImage = devotionSettings?.scheduleImageUrl || "/assets/aistudio/image_17b76ed3.png";
      await Promise.all(
        readyRows.map(async (item) => {
          const existing = schedules.find((s) => s.date === item.date);
          if (existing && existing.id && existing.id !== item.date) {
            await deleteDoc(doc(db, "devotion_schedules", existing.id)).catch(() => {});
          }
          const payload: Partial<DevotionSchedule> = {
            id: item.date,
            date: item.date,
            devotionLeaderId: item.devotionId,
            devotionLeaderName: item.devotionName.trim(),
            prayerLeaderId: item.prayerId,
            prayerLeaderName: item.prayerName.trim(),
            closingPrayerLeaderName: existing?.closingPrayerLeaderName || "",
            topic: existing?.topic || "Daily Devotion & Shift Alignment",
            scripture: existing?.scripture || "Philippians 4:6-7",
            notes: "Admin Manual Multi-Day Schedule",
            imageUrl: activeFlyerImage,
            status: item.date < todayStr ? "completed" : "upcoming",
            isAbsent: existing?.isAbsent ?? false,
            isPrayerAbsent: existing?.isPrayerAbsent ?? false,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser?.email || "Admin"
          };
          return setDoc(doc(db, "devotion_schedules", item.date), payload, { merge: true });
        })
      );

      await addDoc(collection(db, "audit_logs"), {
        user: currentUser?.email || "Admin",
        action: "Manual Multi-Day Devotion Planned",
        details: `Admin manually assigned ${readyRows.length} devotion shift(s) starting from ${readyRows[0].date}.`,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      showToast(`Saved ${readyRows.length} manually assigned devotion shift(s)!`, "success");
      setIsBatchManualModalOpen(false);
    } catch (err) {
      console.error("Error saving batch manual devotions:", err);
      showToast("Failed to save manual schedule batch. Please try again.", "error");
    } finally {
      setBatchSaving(false);
    }
  };

  // -------------------------------------------------------------
  // REPEAT MANUAL PATTERN FORWARD (Strictly Monday–Friday; Admin Defines Every Pair)
  // -------------------------------------------------------------
  const openLoopModal = () => {
    const sorted = [...schedules]
      .filter((s) => Boolean(s.date) && Boolean(s.devotionLeaderName) && Boolean(s.prayerLeaderName))
      .sort((a, b) => a.date.localeCompare(b.date));

    const base: { devotion: string; prayer: string }[] =
      sorted.length > 0
        ? sorted.map((s) => ({
            devotion: s.devotionLeaderName,
            prayer: s.prayerLeaderName,
          }))
        : [{ devotion: "", prayer: "" }];

    setLoopBasePattern(base);

    const nextStart = sorted.length > 0
      ? addDaysToDateStr(sorted[sorted.length - 1].date, 1, true)
      : ensureWeekdayDateStr(todayStr);

    setLoopStartDate(nextStart);
    setLoopDaysCount(10);

    if (sorted.length > 0) {
      setLoopPreview(generateLoopedSchedule(base, nextStart, 10));
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

          {/* Action buttons toolbar (100% Admin Manual Control) */}
          <div className="w-full pt-4 border-t border-indigo-500/20 flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => openAddModal()}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md flex-1 sm:flex-none"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Assign / Add Day</span>
            </button>

            <button
              onClick={openBatchManualModal}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-200 text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm flex-1 sm:flex-none"
              title="Manually pick Devotion & Prayer leaders across multiple upcoming weekdays at once"
            >
              <CalendarDays className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Plan Multiple Days</span>
            </button>

            <button
              onClick={() => openLoopModal()}
              className="px-3.5 py-2.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm flex-1 sm:flex-none"
              title="Repeat your manually set leader sequence across upcoming Monday–Friday shifts"
            >
              <Repeat className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>Repeat Manual Pattern</span>
            </button>

            <button
              onClick={() => setIsLineupExportModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-black font-mono transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-amber-500/20 flex-1 sm:flex-none ring-2 ring-amber-400/40"
              title="Download advance devotion line up image to send to employees (Admin Only)"
            >
              <Download className="w-4 h-4 text-slate-950 shrink-0" />
              <span>Download Lineup Image</span>
              <span className="px-1.5 py-0.5 rounded-md bg-black/20 text-[9px] uppercase tracking-wider font-extrabold">PNG</span>
            </button>

            <button
              onClick={() => setIsClearAllModalOpen(true)}
              className="px-3.5 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold font-mono transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm flex-1 sm:flex-none sm:ml-auto"
              title="Delete all current devotion schedules to start fresh"
            >
              <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
              <span>Clear All</span>
            </button>
          </div>
        </div>
      </div>

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
                  className="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 text-xs font-mono font-bold flex items-center gap-1.5 border border-indigo-500/30 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Change Leaders</span>
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
                      DEVOTION LEADER
                    </span>
                    {todaySchedule.isAbsent ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1 shrink-0">
                        <UserX className="w-3 h-3" /> Absent
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 shrink-0">
                        <CheckCircle className="w-3 h-3" /> Assigned
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
                        <span>Sub: {todaySchedule.substituteDevotionLeaderName}</span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => openSubstituteModal(todaySchedule, "devotion")}
                          className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[10px] font-mono font-bold cursor-pointer"
                        >
                          Change Sub
                        </button>
                        <button
                          onClick={() => handleRestoreOriginalLeader(todaySchedule, "devotion")}
                          className="text-[10px] font-mono text-zinc-400 hover:text-white underline cursor-pointer"
                        >
                          Restore original
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-lg font-black text-white">
                        {todaySchedule.devotionLeaderName}
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">Leads Scripture & Spiritual Reflection</p>
                      
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => openSubstituteModal(todaySchedule, "devotion")}
                          className="px-2.5 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <UserX className="w-3 h-3 shrink-0" />
                          <span>Absent? Assign Sub</span>
                        </button>
                      </div>
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
                      PRAYER LEADER
                    </span>
                    {todaySchedule.isPrayerAbsent ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1 shrink-0">
                        <UserX className="w-3 h-3" /> Absent
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 shrink-0">
                        <CheckCircle className="w-3 h-3" /> Assigned
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
                        <span>Sub: {todaySchedule.substitutePrayerLeaderName}</span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => openSubstituteModal(todaySchedule, "prayer")}
                          className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[10px] font-mono font-bold cursor-pointer"
                        >
                          Change Sub
                        </button>
                        <button
                          onClick={() => handleRestoreOriginalLeader(todaySchedule, "prayer")}
                          className="text-[10px] font-mono text-zinc-400 hover:text-white underline cursor-pointer"
                        >
                          Restore original
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-lg font-black text-white">
                        {todaySchedule.prayerLeaderName}
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">Leads Opening & Intercessory Prayer</p>
                      
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => openSubstituteModal(todaySchedule, "prayer")}
                          className="px-2.5 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <UserX className="w-3 h-3 shrink-0" />
                          <span>Absent? Assign Sub</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-xl bg-zinc-900/40 border border-zinc-800/60 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
              <h4 className="text-sm font-bold text-white">No Devotion Leaders Assigned for Today ({todayStr})</h4>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Click below to pick today's Devotion and Prayer leaders manually, or use Plan Multiple Days to fill the week.
              </p>
              <button
                onClick={() => openAddModal(undefined, ensureWeekdayDateStr(todayStr))}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold font-mono inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Assign Today's Leaders</span>
              </button>
            </div>
          )}
        </div>

        {/* Manual Roster Controls & Summary Widget */}
        <div className="lg:col-span-4 bg-zinc-950 border border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2 text-indigo-400">
                <CalendarDays className="w-4 h-4 text-indigo-400 shrink-0" />
                <h4 className="text-sm font-bold text-white">Manual Assignment Controls</h4>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
                Admin Controlled
              </span>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between items-center gap-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-850">
                <span className="text-zinc-400 text-[11px] shrink-0">TODAY'S DUTY:</span>
                <span className="font-bold text-amber-400 truncate max-w-[175px] text-right">
                  {todaySchedule
                    ? `${todaySchedule.isAbsent && todaySchedule.substituteDevotionLeaderName ? todaySchedule.substituteDevotionLeaderName : todaySchedule.devotionLeaderName} & ${todaySchedule.isPrayerAbsent && todaySchedule.substitutePrayerLeaderName ? todaySchedule.substitutePrayerLeaderName : todaySchedule.prayerLeaderName}`
                    : "Not Assigned Yet"}
                </span>
              </div>

              <div className="flex justify-between items-center gap-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-850">
                <span className="text-zinc-400 text-[11px] shrink-0">UPCOMING SCHEDULED:</span>
                <span className="font-bold text-white text-right">{upcomingSchedules.length} Mon–Fri Shifts</span>
              </div>

              <div className="flex justify-between items-center gap-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-850">
                <span className="text-zinc-400 text-[11px] shrink-0">ARCHIVED HISTORY:</span>
                <span className="font-bold text-emerald-400 text-right">{historySchedules.length} Past Shifts</span>
              </div>

              <div className="flex justify-between items-center gap-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-850">
                <span className="text-zinc-400 text-[11px] shrink-0">ACTIVE TEAM POOL:</span>
                <span className="font-bold text-sky-400 text-right">{activeEmployees.length} Active Staff</span>
              </div>
            </div>

            <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-1 text-[11px]">
              <div className="flex items-center gap-1.5 text-indigo-300 font-bold font-mono">
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Explicit Admin Control</span>
              </div>
              <p className="text-zinc-400 leading-relaxed font-sans text-xs">
                Leaders are never picked randomly. Assign anyone per date, adjust plans anytime, or set a quick substitute whenever someone is absent.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-800/80 space-y-2 mt-4">
            <button
              type="button"
              onClick={() =>
                todaySchedule
                  ? openAddModal(todaySchedule)
                  : openAddModal(undefined, ensureWeekdayDateStr(todayStr))
              }
              className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{todaySchedule ? "Adjust Today's Leaders" : "Assign Today's Leaders"}</span>
            </button>

            <button
              type="button"
              onClick={openBatchManualModal}
              className="w-full py-2 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-mono text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <CalendarDays className="w-3.5 h-3.5 text-emerald-400" />
              <span>Plan Multiple Days Manually</span>
            </button>

            <button
              type="button"
              onClick={() => openLoopModal()}
              className="w-full py-2 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Repeat className="w-3.5 h-3.5 text-indigo-400" />
              <span>Repeat Manual Pattern</span>
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
            onOpenExportModal={() => setIsLineupExportModalOpen(true)}
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
                          <button
                            onClick={() => openSubstituteModal(item, "devotion")}
                            title="Mark absent & assign substitute"
                            className="px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 cursor-pointer text-[11px] font-mono font-bold inline-flex items-center gap-1"
                          >
                            <UserX className="w-3 h-3" />
                            <span>Sub</span>
                          </button>

                          <button
                            onClick={() => openAddModal(item)}
                            title="Change Devotion / Prayer leaders"
                            className="px-2 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 cursor-pointer text-[11px] font-mono font-bold inline-flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3 text-indigo-400" />
                            <span>Change</span>
                          </button>

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
                placeholder="Search or pick Devotion Leader..."
                onChange={({ id, name }) => {
                  setFormDevotionLeaderId(id);
                  setFormDevotionLeaderName(name);
                }}
              />

              {/* Swap Devotion & Prayer Leaders Button */}
              <div className="flex justify-end -my-1">
                <button
                  type="button"
                  onClick={handleSwapFormLeaders}
                  className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-mono font-bold text-indigo-300 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  <span>Swap Devotion ↔ Prayer</span>
                </button>
              </div>

              {/* Opening Prayer Leader Search Bar */}
              <EmployeeSearchInput
                label="Opening Prayer Leader"
                valueName={formPrayerLeaderName}
                valueId={formPrayerLeaderId}
                employees={activeEmployees}
                required
                placeholder="Search or pick Prayer Leader..."
                onChange={({ id, name }) => {
                  setFormPrayerLeaderId(id);
                  setFormPrayerLeaderName(name);
                }}
              />

              {formDevotionLeaderName.trim() &&
                formPrayerLeaderName.trim() &&
                formDevotionLeaderName.trim().toLowerCase() === formPrayerLeaderName.trim().toLowerCase() && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300 font-mono">
                    Note: The same person is currently selected for both Devotion and Prayer on this date.
                  </div>
                )}

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

              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800">
                {editingSchedule ? (
                  <button
                    type="button"
                    onClick={() => {
                      const target = editingSchedule;
                      setIsAddingModalOpen(false);
                      openSubstituteModal(target, "devotion");
                    }}
                    className="px-3 py-2 rounded-xl bg-rose-950/50 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 text-xs font-mono font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <UserX className="w-3.5 h-3.5" />
                    <span>Mark Absent & Assign Sub</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsAddingModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSaving}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-bold cursor-pointer"
                  >
                    {formSaving ? "Saving..." : editingSchedule ? "Save Changes" : "Save Assignment"}
                  </button>
                </div>
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



      {/* MODAL 5: ADMIN MANUAL MULTI-DAY PLANNER */}
      {isBatchManualModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-emerald-500/30 rounded-2xl w-full max-w-3xl p-6 shadow-2xl relative space-y-4 animate-in fade-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <CalendarDays className="w-5 h-5" />
                <div>
                  <h3 className="text-base font-black text-white">
                    Plan Multiple Days Manually
                  </h3>
                  <p className="text-[11px] font-mono text-zinc-400">
                    Pick exact Devotion & Prayer leaders per weekday (Mon–Fri only). Existing entries load automatically for easy updates.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBatchManualModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBatchManual} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-mono font-bold text-zinc-400 uppercase">
                    Starting Date (Mon–Fri)
                  </label>
                  <input
                    type="date"
                    value={batchStartDate}
                    onChange={(e) => {
                      const nextDate = ensureWeekdayDateStr(e.target.value);
                      setBatchStartDate(nextDate);
                      setBatchRows(buildBatchManualRows(nextDate, batchDaysCount));
                    }}
                    className="w-full text-xs font-mono px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-mono font-bold text-zinc-400 uppercase">
                    Number of Workdays
                  </label>
                  <select
                    value={batchDaysCount}
                    onChange={(e) => {
                      const count = Number(e.target.value);
                      setBatchDaysCount(count);
                      setBatchRows(buildBatchManualRows(batchStartDate, count));
                    }}
                    className="w-full text-xs font-mono px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none"
                  >
                    <option value={5}>5 Workdays (1 Week)</option>
                    <option value={10}>10 Workdays (2 Weeks)</option>
                    <option value={15}>15 Workdays (3 Weeks)</option>
                    <option value={20}>20 Workdays (4 Weeks)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
                {batchRows.map((row, idx) => {
                  const [y, m, d] = row.date.split("-").map(Number);
                  const dayLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" });
                  const samePerson =
                    row.devotionName.trim() &&
                    row.prayerName.trim() &&
                    row.devotionName.trim().toLowerCase() === row.prayerName.trim().toLowerCase();

                  return (
                    <div
                      key={row.date}
                      className={`p-3 rounded-xl border grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center ${
                        samePerson
                          ? "bg-amber-950/20 border-amber-500/40"
                          : "bg-zinc-900/70 border-zinc-800"
                      }`}
                    >
                      <div className="md:col-span-3 flex items-center gap-2 font-mono">
                        <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold uppercase">
                          {dayLabel}
                        </span>
                        <span className="font-bold text-white">{row.date}</span>
                      </div>

                      <div className="md:col-span-4">
                        <label className="text-[9px] font-mono text-indigo-400 uppercase block mb-0.5 font-bold">
                          Devotion Leader
                        </label>
                        <select
                          value={row.devotionId || (row.devotionName ? `__custom__${row.devotionName}` : "")}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val.startsWith("__custom__")) return;
                            handleBatchLeaderChange(idx, "devotion", val);
                          }}
                          className="w-full px-2.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="">-- Select Devotion Leader --</option>
                          {row.devotionName && !row.devotionId && (
                            <option value={`__custom__${row.devotionName}`}>{row.devotionName}</option>
                          )}
                          {activeEmployees.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              #{emp.employeeNumber} · {emp.fullName}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="md:col-span-1 flex justify-center md:pt-4">
                        <button
                          type="button"
                          onClick={() => handleSwapBatchRow(idx)}
                          title="Swap Devotion & Prayer on this day"
                          className="p-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-indigo-300 cursor-pointer"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="md:col-span-4">
                        <label className="text-[9px] font-mono text-sky-400 uppercase block mb-0.5 font-bold">
                          Prayer Leader
                        </label>
                        <select
                          value={row.prayerId || (row.prayerName ? `__custom__${row.prayerName}` : "")}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val.startsWith("__custom__")) return;
                            handleBatchLeaderChange(idx, "prayer", val);
                          }}
                          className="w-full px-2.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                        >
                          <option value="">-- Select Prayer Leader --</option>
                          {row.prayerName && !row.prayerId && (
                            <option value={`__custom__${row.prayerName}`}>{row.prayerName}</option>
                          )}
                          {activeEmployees.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              #{emp.employeeNumber} · {emp.fullName}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 flex justify-between items-center border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsBatchManualModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={batchSaving}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-mono font-bold flex items-center gap-2 cursor-pointer shadow-md"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {batchSaving
                      ? "Saving..."
                      : `Save ${batchRows.filter((r) => r.devotionName && r.prayerName).length} Assigned Days`}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: REPEAT MANUAL DEVOTION PATTERN (MONDAY–FRIDAY ONLY) */}
      {isLoopModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative space-y-5 animate-in fade-in duration-200">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Repeat className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Repeat Manual Devotion Pattern</h3>
                  <p className="text-[11px] font-mono text-zinc-400">
                    Repeat your exact manual leader sequence forward • Monday–Friday only
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
                  Define your ordered devotion & prayer leader pairs below, and repeat that exact sequence forward across upcoming weekdays (no randomization).
                  <strong className="text-emerald-400 block font-mono text-[11px] mt-1">
                    Saturday and Sunday Rest Days are strictly skipped.
                  </strong>
                </div>
              </div>

              {/* Step 1: Base Pattern (Pairs to loop) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wide flex items-center gap-2">
                    <span>1. Base Manual Pairs ({loopBasePattern.length} Days in Sequence)</span>
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
                      Add a pair above to define your manual repeating sequence.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {loopBasePattern.map((pair, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded-xl bg-zinc-900/80 border border-zinc-800 text-xs font-mono"
                      >
                        <span className="w-6 text-zinc-500 font-bold text-center">#{idx + 1}</span>
                        <div className="flex-1 flex items-center gap-1.5">
                          <span className="text-[10px] text-indigo-400 font-bold shrink-0">DEV:</span>
                          <select
                            value={pair.devotion}
                            onChange={(e) => {
                              const updated = [...loopBasePattern];
                              updated[idx] = { ...updated[idx], devotion: e.target.value };
                              setLoopBasePattern(updated);
                              handleUpdateLoopPreview(updated, loopStartDate, loopDaysCount);
                            }}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-white text-xs focus:outline-none"
                          >
                            <option value="">-- Select Devotion --</option>
                            {pair.devotion &&
                              !activeEmployees.some((e) => e.fullName === pair.devotion) && (
                                <option value={pair.devotion}>{pair.devotion}</option>
                              )}
                            {activeEmployees.map((emp) => (
                              <option key={emp.id} value={emp.fullName}>
                                {emp.fullName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1 flex items-center gap-1.5">
                          <span className="text-[10px] text-sky-400 font-bold shrink-0">PRAY:</span>
                          <select
                            value={pair.prayer}
                            onChange={(e) => {
                              const updated = [...loopBasePattern];
                              updated[idx] = { ...updated[idx], prayer: e.target.value };
                              setLoopBasePattern(updated);
                              handleUpdateLoopPreview(updated, loopStartDate, loopDaysCount);
                            }}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-white text-xs focus:outline-none"
                          >
                            <option value="">-- Select Prayer --</option>
                            {pair.prayer &&
                              !activeEmployees.some((e) => e.fullName === pair.prayer) && (
                                <option value={pair.prayer}>{pair.prayer}</option>
                              )}
                            {activeEmployees.map((emp) => (
                              <option key={emp.id} value={emp.fullName}>
                                {emp.fullName}
                              </option>
                            ))}
                          </select>
                        </div>
                        {loopBasePattern.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = loopBasePattern.filter((_, i) => i !== idx);
                              setLoopBasePattern(updated);
                              handleUpdateLoopPreview(updated, loopStartDate, loopDaysCount);
                            }}
                            className="p-1 rounded text-zinc-500 hover:text-rose-400 cursor-pointer self-end sm:self-center"
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

      {/* Advance Devotion Lineup Image Export Modal (Admin Only) */}
      <DevotionLineupExportModal
        isOpen={isLineupExportModalOpen}
        onClose={() => setIsLineupExportModalOpen(false)}
        schedules={schedules}
        employees={employees}
        todayStr={todayStr}
        isAdmin={true}
        onScheduleUpdated={() => {
          showToast("Advance schedules generated and refreshed!", "success");
        }}
      />

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
