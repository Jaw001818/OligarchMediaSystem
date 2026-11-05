/**
 * Devotion & Prayer Scheduler Engine for Oligarch Media
 * 
 * Complies strictly with all rotation and rolling rules:
 * 1. Employee View: Shows strictly the next 10 upcoming schedule rows.
 * 2. Admin View: Shows the next 15 upcoming schedule rows for planning.
 * 3. Preserve History: Completed schedules (past dates) are archived to "completed", NEVER deleted.
 * 4. Separate Fair Rotation Cycles: Independent cycles for Devotion and Prayer.
 * 5. Cohort Locking: Newly added employees join only the NEXT rotation cycle.
 *    The current cycle finishes with employees eligible when the cycle started.
 * 6. Mutual Exclusion: Devotion Leader !== Prayer Leader on the same date.
 * 7. Automatic Schedule Maintenance: Rolling queue maintains 15 upcoming days in the database
 *    (10 visible to employees, 15 to admins). A Firestore mutex lock prevents duplicate generation.
 */

import { DevotionSchedule, DevotionRotationState, Employee } from "../types";
import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  getDocs, 
  query, 
  where 
} from "../firebase";
import type { Firestore } from "firebase/firestore";

export interface FlyerRow {
  devotion: string;
  prayer: string;
}

// 10 core team members featured in the official Oligarch Media Devotion flyer (image 3)
export const OFFICIAL_FLIER_ROSTER: string[] = [
  "FRANKIE",
  "RAYVEL",
  "CEDRIC",
  "ROLAND",
  "ISRAEL",
  "JR",
  "AARON",
  "JERICHO",
  "MARK",
  "JAO"
];

// The exact 13 rows transcribed from the official schedule (/public/assets/aistudio/image_17b76ed3.png)
export const OFFICIAL_FLIER_ROWS: FlyerRow[] = [
  { devotion: "FRANKIE", prayer: "JAO" },       // Row 1
  { devotion: "RAYVEL", prayer: "JERICHO" },   // Row 2
  { devotion: "CEDRIC", prayer: "RAYVEL" },    // Row 3
  { devotion: "ROLAND", prayer: "MARK" },      // Row 4
  { devotion: "ISRAEL", prayer: "CEDRIC" },    // Row 5
  { devotion: "JR", prayer: "FRANKIE" },       // Row 6
  { devotion: "FRANKIE", prayer: "JR" },       // Row 7
  { devotion: "AARON", prayer: "RAYVEL" },     // Row 8
  { devotion: "RAYVEL", prayer: "JAO" },       // Row 9
  { devotion: "JERICHO", prayer: "AARON" },    // Row 10
  { devotion: "MARK", prayer: "JERICHO" },     // Row 11
  { devotion: "JAO", prayer: "MARK" },         // Row 12
  { devotion: "CEDRIC", prayer: "ISRAEL" }     // Row 13
];

/**
 * Fisher-Yates array shuffle helper
 */
export function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Checks if a YYYY-MM-DD date string falls on Saturday (6) or Sunday (0) — Rest Days
 */
export function isWeekendDateStr(dateStr: string): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayOfWeek = new Date(y, m - 1, d).getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * If dateStr falls on Saturday or Sunday, advances it to the next Monday (YYYY-MM-DD)
 */
export function ensureWeekdayDateStr(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const now = new Date();
    const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return fallback !== dateStr ? ensureWeekdayDateStr(fallback) : dateStr;
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  if (isNaN(dateObj.getTime())) return dateStr;
  let guard = 0;
  while ((dateObj.getDay() === 0 || dateObj.getDay() === 6) && guard < 10) {
    dateObj.setDate(dateObj.getDate() + 1);
    guard++;
  }
  const nextY = dateObj.getFullYear();
  const nextM = String(dateObj.getMonth() + 1).padStart(2, "0");
  const nextD = String(dateObj.getDate()).padStart(2, "0");
  return `${nextY}-${nextM}-${nextD}`;
}

/**
 * Calculates next weekday date string in YYYY-MM-DD, skipping Saturday and Sunday (Rest Days) by default.
 */
export function addDaysToDateStr(dateStr: string, days: number = 1, skipWeekends: boolean = true): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return ensureWeekdayDateStr("");
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  if (isNaN(dateObj.getTime())) return ensureWeekdayDateStr("");

  if (!skipWeekends) {
    dateObj.setDate(dateObj.getDate() + days);
  } else if (days === 0) {
    let guard = 0;
    while ((dateObj.getDay() === 0 || dateObj.getDay() === 6) && guard < 10) {
      dateObj.setDate(dateObj.getDate() + 1);
      guard++;
    }
  } else if (days > 0) {
    let remaining = Math.min(days, 365);
    let guard = 0;
    while (remaining > 0 && guard < 600) {
      dateObj.setDate(dateObj.getDate() + 1);
      const dow = dateObj.getDay();
      if (dow !== 0 && dow !== 6) {
        remaining--;
      }
      guard++;
    }
  } else {
    let remaining = Math.min(Math.abs(days), 365);
    let guard = 0;
    while (remaining > 0 && guard < 600) {
      dateObj.setDate(dateObj.getDate() - 1);
      const dow = dateObj.getDay();
      if (dow !== 0 && dow !== 6) {
        remaining--;
      }
      guard++;
    }
  }

  const nextY = dateObj.getFullYear();
  const nextM = String(dateObj.getMonth() + 1).padStart(2, "0");
  const nextD = String(dateObj.getDate()).padStart(2, "0");
  return `${nextY}-${nextM}-${nextD}`;
}

/**
 * Resolves clean eligible list from active employees or fallback flyer roster.
 * Excludes employees whose status is not "Active" (e.g. Resigned or Inactive).
 */
export function resolveEligibleRoster(
  employees: Employee[],
  fallback: string[] = OFFICIAL_FLIER_ROSTER
): { id: string; name: string }[] {
  const activeEmps = employees.filter((e) => (e.status || "Active") === "Active");
  if (activeEmps.length >= 2) {
    return activeEmps.map((e) => ({
      id: e.id || "",
      name: e.fullName.trim()
    })).filter(e => Boolean(e.name));
  }
  return fallback.map((name, i) => ({
    id: `flyer-${i}`,
    name: name.trim()
  }));
}

/**
 * Initializes or repairs rotation state based on active employees and existing history
 */
export function initializeRotationState(
  activeRoster: string[],
  existingState?: Partial<DevotionRotationState> | null
): DevotionRotationState {
  const cleanRoster = activeRoster.length >= 2 ? activeRoster : OFFICIAL_FLIER_ROSTER;

  const devotionCohort = existingState?.devotionCohort && existingState.devotionCohort.length > 0
    ? existingState.devotionCohort.filter(n => cleanRoster.includes(n))
    : [...cleanRoster];

  const prayerCohort = existingState?.prayerCohort && existingState.prayerCohort.length > 0
    ? existingState.prayerCohort.filter(n => cleanRoster.includes(n))
    : [...cleanRoster];

  return {
    devotionCycleNumber: existingState?.devotionCycleNumber || 1,
    devotionCohort: devotionCohort.length >= 2 ? devotionCohort : [...cleanRoster],
    devotionAssigned: existingState?.devotionAssigned || [],
    prayerCycleNumber: existingState?.prayerCycleNumber || 1,
    prayerCohort: prayerCohort.length >= 2 ? prayerCohort : [...cleanRoster],
    prayerAssigned: existingState?.prayerAssigned || [],
    queuedNewEmployees: existingState?.queuedNewEmployees || [],
    lastMaintainedAt: new Date().toISOString()
  };
}

/**
 * Generates the NEXT single fair assignment for Devotion and Prayer adhering strictly to:
 * 1. Independent rotation cycles for Devotion and Prayer.
 * 2. Cohort completion rule: current cycle must exhaust its locked cohort before new employees enter.
 * 3. Newly added employees are queued for cycle N + 1.
 * 4. Mutual exclusion on the assigned day (devotionLeader !== prayerLeader).
 * 5. Single-pick exhaustion guarantee: everyone gets 1 turn before repeating.
 */
export function generateNextRotationPair(
  activeEmployees: Employee[],
  currentState: DevotionRotationState,
  lastAssignedDevotion?: string,
  lastAssignedPrayer?: string
): {
  devotion: string;
  prayer: string;
  devCycleNumber: number;
  prayCycleNumber: number;
  updatedState: DevotionRotationState;
  newCycleStartedDevotion: boolean;
  newCycleStartedPrayer: boolean;
} {
  const activeRosterObj = resolveEligibleRoster(activeEmployees);
  const activeNames = activeRosterObj.map(r => r.name);

  const state: DevotionRotationState = {
    ...currentState,
    devotionCohort: currentState.devotionCohort ? [...currentState.devotionCohort] : [...activeNames],
    devotionAssigned: currentState.devotionAssigned ? [...currentState.devotionAssigned] : [],
    prayerCohort: currentState.prayerCohort ? [...currentState.prayerCohort] : [...activeNames],
    prayerAssigned: currentState.prayerAssigned ? [...currentState.prayerAssigned] : [],
    queuedNewEmployees: currentState.queuedNewEmployees ? [...currentState.queuedNewEmployees] : []
  };

  // Find newly added active employees who are NOT in current devotion or prayer cohort
  const uncohortDevEmps = activeNames.filter(n => !state.devotionCohort.includes(n));
  const uncohortPrayEmps = activeNames.filter(n => !state.prayerCohort.includes(n));
  const newlyQueued = Array.from(new Set([...uncohortDevEmps, ...uncohortPrayEmps]));
  state.queuedNewEmployees = newlyQueued;

  // -------------------------------------------------------------
  // 1. DEVOTION LEADER SELECTION
  // -------------------------------------------------------------
  let devCycleNumber = state.devotionCycleNumber || 1;
  let devCohort = state.devotionCohort.filter(n => activeNames.includes(n)); // exclude inactive
  if (devCohort.length < 2) devCohort = [...activeNames];

  let devRemaining = devCohort.filter(n => !state.devotionAssigned.includes(n));
  let newCycleStartedDevotion = false;

  if (devRemaining.length === 0) {
    // Current cycle finished! Start next cycle with all active employees (including newly added!)
    devCycleNumber += 1;
    newCycleStartedDevotion = true;
    devCohort = [...activeNames];
    state.devotionCohort = devCohort;
    state.devotionAssigned = [];
    devRemaining = [...devCohort];

    // Avoid immediate back-to-back repeat of previous day's devotion leader if possible
    if (lastAssignedDevotion && devRemaining.length > 1) {
      const filtered = devRemaining.filter(n => n.toLowerCase() !== lastAssignedDevotion.toLowerCase());
      if (filtered.length > 0) devRemaining = filtered;
    }
  }

  // Pick randomly from remaining eligible candidates in this cycle
  const chosenDevotion = devRemaining[Math.floor(Math.random() * devRemaining.length)];
  state.devotionAssigned.push(chosenDevotion);
  state.devotionCycleNumber = devCycleNumber;

  // -------------------------------------------------------------
  // 2. PRAYER LEADER SELECTION (INDEPENDENT CYCLE)
  // -------------------------------------------------------------
  let prayCycleNumber = state.prayerCycleNumber || 1;
  let prayCohort = state.prayerCohort.filter(n => activeNames.includes(n)); // exclude inactive
  if (prayCohort.length < 2) prayCohort = [...activeNames];

  let prayRemaining = prayCohort.filter(n => !state.prayerAssigned.includes(n));
  let newCycleStartedPrayer = false;

  if (prayRemaining.length === 0) {
    // Current prayer cycle finished! Start next prayer cycle
    prayCycleNumber += 1;
    newCycleStartedPrayer = true;
    prayCohort = [...activeNames];
    state.prayerCohort = prayCohort;
    state.prayerAssigned = [];
    prayRemaining = [...prayCohort];

    // Avoid immediate back-to-back repeat of previous day's prayer leader if possible
    if (lastAssignedPrayer && prayRemaining.length > 1) {
      const filtered = prayRemaining.filter(n => n.toLowerCase() !== lastAssignedPrayer.toLowerCase());
      if (filtered.length > 0) prayRemaining = filtered;
    }
  }

  // -------------------------------------------------------------
  // 3. MUTUAL EXCLUSION: devotionLeader !== prayerLeader on this date
  // -------------------------------------------------------------
  let validPrayerCandidates = prayRemaining.filter(n => n.toLowerCase() !== chosenDevotion.toLowerCase());
  
  if (validPrayerCandidates.length === 0) {
    // If the only remaining person in prayerRemaining is chosenDevotion,
    // borrow from prayCohort members who are not chosenDevotion
    validPrayerCandidates = prayCohort.filter(n => n.toLowerCase() !== chosenDevotion.toLowerCase());
  }

  const chosenPrayer = validPrayerCandidates[Math.floor(Math.random() * validPrayerCandidates.length)];
  state.prayerAssigned.push(chosenPrayer);
  state.prayerCycleNumber = prayCycleNumber;

  return {
    devotion: chosenDevotion,
    prayer: chosenPrayer,
    devCycleNumber,
    prayCycleNumber,
    updatedState: state,
    newCycleStartedDevotion,
    newCycleStartedPrayer
  };
}

/**
 * Automatic Maintenance Engine:
 * - Checks eligible employees (must be >= 2).
 * - Archives expired schedules (date < todayStr) to "completed", NEVER deleting them.
 * - Automatically shifts any Saturday/Sunday upcoming schedules onto Monday–Friday (since Sat/Sun are Rest Days).
 * - Ensures exactly 15 upcoming weekday schedules exist in the database (10 for employees, 15 for admin).
 * - Uses a distributed lock in Firestore to prevent duplicate generation across multiple clients.
 */
let isLocalMaintenanceRunning = false;
let lastLocalMaintainTimestamp = 0;

export async function maintainRollingSchedule(
  db: Firestore,
  todayStr: string,
  employees: Employee[],
  currentSchedules: DevotionSchedule[],
  targetUpcomingCount: number = 15
): Promise<{ success: boolean; addedCount: number; warning?: string }> {
  if (isLocalMaintenanceRunning) {
    return { success: true, addedCount: 0 };
  }
  const nowTs = Date.now();
  if (nowTs - lastLocalMaintainTimestamp < 5000) {
    return { success: true, addedCount: 0 };
  }

  const activeEmps = employees.filter(e => (e.status || "Active") === "Active");
  if (activeEmps.length < 2) {
    return {
      success: false,
      addedCount: 0,
      warning: "Insufficient eligible employees: at least 2 active staff members are required to schedule Devotion and Prayer without conflict."
    };
  }

  isLocalMaintenanceRunning = true;
  lastLocalMaintainTimestamp = nowTs;

  try {
    // 1. Archive past schedules: DO NOT DELETE, update status to "completed"
    const pastUncompleted = currentSchedules.filter(s => s.date < todayStr && s.status !== "completed");
    if (pastUncompleted.length > 0) {
      for (const past of pastUncompleted) {
        if (past.id) {
          await updateDoc(doc(db, "devotion_schedules", past.id), {
            status: "completed",
            completedAt: new Date().toISOString()
          }).catch((err) => console.warn("Archive schedule note:", err));
        }
      }
    }

    // 2. Filter upcoming schedules (preserve all dates configured by admin)
    const upcomingSchedules = currentSchedules
      .filter(s => s.date >= todayStr && s.status !== "completed")
      .sort((a, b) => a.date.localeCompare(b.date));

    // If no upcoming schedules exist (e.g. admin is clearing devotions to input a fresh schedule),
    // or if upcoming schedules are already present, do NOT auto-inject unprompted rows.
    // Schedules are populated when the admin inputs or loops them.
    if (upcomingSchedules.length === 0 || upcomingSchedules.length >= 10) {
      return { success: true, addedCount: 0 };
    }

    // 3. Acquire Distributed Lock (devotion_settings/maintenance_lock) to prevent duplicate runs
    const lockDocRef = doc(db, "devotion_settings", "maintenance_lock");
    const now = Date.now();
    try {
      const lockSnap = await getDoc(lockDocRef);
      if (lockSnap.exists()) {
        const lockData = lockSnap.data();
        if (lockData.isLocked && lockData.expiresAt > now) {
          return { success: true, addedCount: 0 };
        }
      }
      await setDoc(lockDocRef, {
        isLocked: true,
        expiresAt: now + 12000,
        lockedAt: new Date().toISOString()
      });
    } catch (lockErr) {
      console.warn("Lock acquisition note:", lockErr);
    }

  try {
    // 4. Load or initialize rotation state
    const stateDocRef = doc(db, "devotion_settings", "rotation_state");
    let rotationState: DevotionRotationState;
    try {
      const stateSnap = await getDoc(stateDocRef);
      if (stateSnap.exists()) {
        rotationState = initializeRotationState(
          activeEmps.map(e => e.fullName.trim()),
          stateSnap.data() as DevotionRotationState
        );
      } else {
        rotationState = initializeRotationState(activeEmps.map(e => e.fullName.trim()));
      }
    } catch {
      rotationState = initializeRotationState(activeEmps.map(e => e.fullName.trim()));
    }

    // 5. Generate missing weekday schedule rows up to targetUpcomingCount (15)
    let currentUpcoming = [...upcomingSchedules];
    let lastDateStr = currentUpcoming.length > 0 
      ? currentUpcoming[currentUpcoming.length - 1].date 
      : addDaysToDateStr(ensureWeekdayDateStr(todayStr), -1, true);

    let addedCount = 0;
    const rowsToAdd = targetUpcomingCount - currentUpcoming.length;

    for (let i = 0; i < rowsToAdd; i++) {
      lastDateStr = addDaysToDateStr(lastDateStr, 1, true);
      
      // Prevent duplicate generation if date already exists in schedule list
      if (currentUpcoming.some(s => s.date === lastDateStr)) {
        continue;
      }

      const lastDev = currentUpcoming.length > 0 ? currentUpcoming[currentUpcoming.length - 1].devotionLeaderName : undefined;
      const lastPray = currentUpcoming.length > 0 ? currentUpcoming[currentUpcoming.length - 1].prayerLeaderName : undefined;

      const nextPair = generateNextRotationPair(activeEmps, rotationState, lastDev, lastPray);
      rotationState = nextPair.updatedState;

      // Try matching employee IDs for push notifications and account badges
      const matchedDev = activeEmps.find(e => e.fullName.toLowerCase() === nextPair.devotion.toLowerCase());
      const matchedPray = activeEmps.find(e => e.fullName.toLowerCase() === nextPair.prayer.toLowerCase());

      const newScheduleDoc: Partial<DevotionSchedule> = {
        date: lastDateStr,
        devotionLeaderId: matchedDev?.id || "",
        devotionLeaderName: nextPair.devotion,
        prayerLeaderId: matchedPray?.id || "",
        prayerLeaderName: nextPair.prayer,
        closingPrayerLeaderName: "",
        topic: "Daily Devotion & Shift Alignment",
        scripture: "Philippians 4:6-7",
        notes: `Fair Cycle Rotation (Devotion Cycle #${nextPair.devCycleNumber}, Prayer Cycle #${nextPair.prayCycleNumber})`,
        imageUrl: "/assets/aistudio/image_17b76ed3.png",
        status: "upcoming",
        cycleDevotionNumber: nextPair.devCycleNumber,
        cyclePrayerNumber: nextPair.prayCycleNumber,
        cycleDevotionCohort: [...rotationState.devotionCohort],
        cyclePrayerCohort: [...rotationState.prayerCohort],
        isAbsent: false,
        isPrayerAbsent: false,
        updatedAt: new Date().toISOString(),
        updatedBy: "System (Rolling Maintenance)"
      };

      const dateKeyedDoc: DevotionSchedule = {
        ...(newScheduleDoc as DevotionSchedule),
        id: lastDateStr,
        date: lastDateStr
      };
      await setDoc(doc(db, "devotion_schedules", lastDateStr), dateKeyedDoc, { merge: true });
      currentUpcoming.push(dateKeyedDoc);
      addedCount++;
    }

    // 6. Save updated rotation state
    await setDoc(stateDocRef, {
      ...rotationState,
      lastMaintainedAt: new Date().toISOString()
    });

    return { success: true, addedCount };
  } catch (err) {
    console.error("Schedule maintenance error:", err);
    return { success: false, addedCount: 0, warning: "Failed to maintain schedule." };
  } finally {
    // Release Lock
    setDoc(lockDocRef, { isLocked: false, expiresAt: 0 }).catch(() => {});
  }
  } finally {
    isLocalMaintenanceRunning = false;
  }
}

/**
/**
 * Helper to match an employee or string name against a roster pool.
 */
export function matchRosterMember(rawName: string, roster: string[]): string | undefined {
  if (!rawName) return undefined;
  const clean = rawName.trim().toLowerCase();
  const exact = roster.find(r => r.toLowerCase() === clean);
  if (exact) return exact;
  const wordMatch = roster.find(r => {
    const rLower = r.toLowerCase();
    return clean.includes(rLower) || rLower.includes(clean);
  });
  return wordMatch;
}

/**
 * Generates an automated schedule spanning totalDays using consecutive exhaustion cycles.
 * CRITICAL: Seamlessly continues from existing prior schedules so the rotation never restarts
 * from the top when adding new dates (e.g. Nov 1-5 followed by Nov 6-10)!
 */
export function generateFairRoster(
  roster: string[],
  startDateStr: string,
  totalDays: number,
  excludeWeekends: boolean = true,
  existingSchedules: { date: string; devotionLeaderName?: string; prayerLeaderName?: string }[] = [],
  activeEmployees: Employee[] = []
): {
  date: string;
  devotion: string;
  prayer: string;
  cycleNumber: number;
  dayInCycle: number;
  cycleTotal: number;
}[] {
  if (roster.length < 2 || totalDays <= 0) return [];

  const cleanRoster = roster.map(r => r.trim()).filter(Boolean);
  const results: {
    date: string;
    devotion: string;
    prayer: string;
    cycleNumber: number;
    dayInCycle: number;
    cycleTotal: number;
  }[] = [];

  // Filter prior schedules that occur strictly before startDateStr
  const priorSchedules = (existingSchedules || [])
    .filter(s => Boolean(s.date) && s.date < startDateStr && (s.devotionLeaderName || s.prayerLeaderName))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Determine who has already served as Devotion Leader in the current active cycle
  const devAssignedInCurrentCycle = new Set<string>();
  for (let i = priorSchedules.length - 1; i >= 0; i--) {
    const matched = matchRosterMember(priorSchedules[i].devotionLeaderName || "", cleanRoster);
    if (!matched) continue;
    if (devAssignedInCurrentCycle.has(matched)) {
      // Hit a repeat: this marks the boundary of the current cycle
      break;
    }
    devAssignedInCurrentCycle.add(matched);
    if (devAssignedInCurrentCycle.size >= cleanRoster.length) {
      break;
    }
  }

  // Determine who has already served as Prayer Leader in the current active cycle
  const prayAssignedInCurrentCycle = new Set<string>();
  for (let i = priorSchedules.length - 1; i >= 0; i--) {
    const matched = matchRosterMember(priorSchedules[i].prayerLeaderName || "", cleanRoster);
    if (!matched) continue;
    if (prayAssignedInCurrentCycle.has(matched)) {
      break;
    }
    prayAssignedInCurrentCycle.add(matched);
    if (prayAssignedInCurrentCycle.size >= cleanRoster.length) {
      break;
    }
  }

  // Candidates who have NOT yet served in the current cycle (maintains natural order instead of starting from top!)
  let remainingDevotion = cleanRoster.filter(name => !devAssignedInCurrentCycle.has(name));
  if (remainingDevotion.length === 0) {
    remainingDevotion = [...cleanRoster];
  }

  let remainingPrayer = cleanRoster.filter(name => !prayAssignedInCurrentCycle.has(name));
  if (remainingPrayer.length === 0) {
    remainingPrayer = [...cleanRoster];
  }

  let lastDev = priorSchedules.length > 0 
    ? matchRosterMember(priorSchedules[priorSchedules.length - 1].devotionLeaderName || "", cleanRoster)
    : undefined;
  let lastPray = priorSchedules.length > 0
    ? matchRosterMember(priorSchedules[priorSchedules.length - 1].prayerLeaderName || "", cleanRoster)
    : undefined;

  let devCycleNumber = Math.max(1, Math.floor(priorSchedules.length / cleanRoster.length) + 1);
  let prayCycleNumber = devCycleNumber;

  let [sy, sm, sd] = startDateStr.split("-").map(Number);
  let currentDate = new Date(sy, sm - 1, sd);
  let daysGenerated = 0;

  while (daysGenerated < totalDays) {
    const dayOfWeek = currentDate.getDay();
    if (excludeWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    // If devotion pool exhausted, advance cycle and refill
    if (remainingDevotion.length === 0) {
      devCycleNumber++;
      remainingDevotion = [...cleanRoster];
      if (lastDev && remainingDevotion.length > 1) {
        remainingDevotion = remainingDevotion.filter(n => n !== lastDev);
        remainingDevotion.push(lastDev);
      }
    }

    const chosenDevotion = remainingDevotion.shift()!;
    lastDev = chosenDevotion;

    // If prayer pool exhausted, advance cycle and refill
    if (remainingPrayer.length === 0) {
      prayCycleNumber++;
      remainingPrayer = [...cleanRoster];
      if (lastPray && remainingPrayer.length > 1) {
        remainingPrayer = remainingPrayer.filter(n => n !== lastPray);
        remainingPrayer.push(lastPray);
      }
    }

    // Ensure devotion !== prayer
    let chosenPrayerIdx = remainingPrayer.findIndex(p => p !== chosenDevotion);
    let chosenPrayer: string;
    if (chosenPrayerIdx === -1) {
      chosenPrayer = cleanRoster.find(n => n !== chosenDevotion) || cleanRoster[0];
    } else {
      chosenPrayer = remainingPrayer.splice(chosenPrayerIdx, 1)[0];
    }
    lastPray = chosenPrayer;

    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, "0");
    const d = String(currentDate.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;

    results.push({
      date: dateStr,
      devotion: chosenDevotion,
      prayer: chosenPrayer,
      cycleNumber: devCycleNumber,
      dayInCycle: cleanRoster.length - remainingDevotion.length,
      cycleTotal: cleanRoster.length
    });

    daysGenerated++;
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return results;
}

/**
 * Calculates the next single rotation suggestion for Add Modal.
 * Returns the next date after existing schedules and the next unassigned leaders.
 */
export function getNextRotationSuggestion(
  activeEmployees: Employee[],
  existingSchedules: { date: string; devotionLeaderName?: string; prayerLeaderName?: string }[] = [],
  targetDate?: string,
  roster: string[] = OFFICIAL_FLIER_ROSTER
): {
  nextDate: string;
  devotionName: string;
  devotionId: string;
  prayerName: string;
  prayerId: string;
} {
  const cleanRoster = roster.length >= 2 ? roster : OFFICIAL_FLIER_ROSTER;

  let effectiveDate = targetDate;
  if (!effectiveDate) {
    if (existingSchedules && existingSchedules.length > 0) {
      const maxDate = existingSchedules.reduce((max, s) => s.date > max ? s.date : max, existingSchedules[0].date);
      // Advance by 1 weekday (skips Saturday and Sunday)
      effectiveDate = addDaysToDateStr(maxDate, 1, true);
    } else {
      effectiveDate = ensureWeekdayDateStr(new Date().toISOString().split("T")[0]);
    }
  }

  const generated = generateFairRoster(cleanRoster, effectiveDate, 1, true, existingSchedules, activeEmployees);
  const row = generated[0] || { devotion: cleanRoster[0], prayer: cleanRoster[1] };

  const matchedDev = activeEmployees.find(e => 
    e.fullName.toLowerCase() === row.devotion.toLowerCase() ||
    e.fullName.toLowerCase().includes(row.devotion.toLowerCase()) ||
    row.devotion.toLowerCase().includes(e.fullName.toLowerCase())
  );
  const matchedPray = activeEmployees.find(e => 
    e.fullName.toLowerCase() === row.prayer.toLowerCase() ||
    e.fullName.toLowerCase().includes(row.prayer.toLowerCase()) ||
    row.prayer.toLowerCase().includes(e.fullName.toLowerCase())
  );

  return {
    nextDate: effectiveDate,
    devotionName: matchedDev ? matchedDev.fullName : row.devotion,
    devotionId: matchedDev?.id || "",
    prayerName: matchedPray ? matchedPray.fullName : row.prayer,
    prayerId: matchedPray?.id || ""
  };
}

/**
 * Generates a single exhaustion cycle where devotion !== prayer for all entries.
 */
export function generateSingleExhaustionCycle(
  roster: string[],
  previousLastDevotion?: string,
  previousLastPrayer?: string
): { devotion: string; prayer: string }[] {
  const n = roster.length;
  if (n < 2) return [];

  let devList = shuffleArray(roster);
  if (previousLastDevotion && devList[0] === previousLastDevotion && n > 2) {
    const swapTarget = Math.floor(Math.random() * (n - 1)) + 1;
    [devList[0], devList[swapTarget]] = [devList[swapTarget], devList[0]];
  }

  let prayerList = shuffleArray(roster);
  if (previousLastPrayer && prayerList[0] === previousLastPrayer && n > 2) {
    const swapTarget = Math.floor(Math.random() * (n - 1)) + 1;
    [prayerList[0], prayerList[swapTarget]] = [prayerList[swapTarget], prayerList[0]];
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    let hasCollision = false;
    for (let i = 0; i < n; i++) {
      if (devList[i] === prayerList[i]) {
        hasCollision = true;
        let solved = false;
        for (let j = 0; j < n; j++) {
          if (i !== j && devList[i] !== prayerList[j] && devList[j] !== prayerList[i]) {
            [prayerList[i], prayerList[j]] = [prayerList[j], prayerList[i]];
            solved = true;
            break;
          }
        }
        if (!solved) {
          const next = (i + 1) % n;
          [prayerList[i], prayerList[next]] = [prayerList[next], prayerList[i]];
        }
      }
    }
    if (!hasCollision) break;
  }

  return devList.map((dev, idx) => ({
    devotion: dev,
    prayer: prayerList[idx]
  }));
}

/**
 * Legacy single-pick generator for backward compatibility
 */
export function generateNextFairAssignment(
  roster: string[],
  recentSchedules: { devotionLeaderName: string; prayerLeaderName: string }[]
): { devotion: string; prayer: string; devCycleCount: number; prayCycleCount: number } {
  const cleanRoster = roster.length >= 2 ? roster.map(n => n.trim()).filter(Boolean) : OFFICIAL_FLIER_ROSTER;

  const devPickedInCycle = new Set<string>();
  for (let i = recentSchedules.length - 1; i >= 0; i--) {
    const rawName = recentSchedules[i]?.devotionLeaderName?.trim();
    if (!rawName) continue;
    const match = cleanRoster.find(r => r.toLowerCase() === rawName.toLowerCase());
    if (!match) continue;
    if (devPickedInCycle.has(match)) break;
    devPickedInCycle.add(match);
    if (devPickedInCycle.size >= cleanRoster.length) break;
  }

  let devCandidates = cleanRoster.filter(name => !devPickedInCycle.has(name));
  let devReset = false;
  if (devCandidates.length === 0) {
    devCandidates = [...cleanRoster];
    devReset = true;
    const lastDevRaw = recentSchedules[recentSchedules.length - 1]?.devotionLeaderName?.trim();
    const lastDevMatch = cleanRoster.find(r => r.toLowerCase() === (lastDevRaw || "").toLowerCase());
    if (lastDevMatch && devCandidates.length > 1) {
      const filtered = devCandidates.filter(n => n !== lastDevMatch);
      if (filtered.length > 0) devCandidates = filtered;
    }
  }

  const chosenDevotion = devCandidates[Math.floor(Math.random() * devCandidates.length)];

  const prayPickedInCycle = new Set<string>();
  for (let i = recentSchedules.length - 1; i >= 0; i--) {
    const rawName = recentSchedules[i]?.prayerLeaderName?.trim();
    if (!rawName) continue;
    const match = cleanRoster.find(r => r.toLowerCase() === rawName.toLowerCase());
    if (!match) continue;
    if (prayPickedInCycle.has(match)) break;
    prayPickedInCycle.add(match);
    if (prayPickedInCycle.size >= cleanRoster.length) break;
  }

  let prayCandidates = cleanRoster.filter(name => !prayPickedInCycle.has(name));
  if (prayCandidates.length === 0) {
    prayCandidates = [...cleanRoster];
    const lastPrayRaw = recentSchedules[recentSchedules.length - 1]?.prayerLeaderName?.trim();
    const lastPrayMatch = cleanRoster.find(r => r.toLowerCase() === (lastPrayRaw || "").toLowerCase());
    if (lastPrayMatch && prayCandidates.length > 1) {
      const filtered = prayCandidates.filter(n => n !== lastPrayMatch);
      if (filtered.length > 0) prayCandidates = filtered;
    }
  }

  let validPrayCandidates = prayCandidates.filter(name => name !== chosenDevotion);
  if (validPrayCandidates.length === 0) {
    validPrayCandidates = cleanRoster.filter(name => name !== chosenDevotion);
  }

  const chosenPrayer = validPrayCandidates[Math.floor(Math.random() * validPrayCandidates.length)];

  return {
    devotion: chosenDevotion,
    prayer: chosenPrayer,
    devCycleCount: devReset ? 1 : devPickedInCycle.size + 1,
    prayCycleCount: prayPickedInCycle.size + 1
  };
}

/**
 * Loops an ordered base pattern of devotion and prayer pairs across upcoming business days.
 * STRICT REST DAY RULE:
 * - Saturdays and Sundays are strictly no work / rest days.
 * - Schedules are strictly placed on Monday through Friday.
 */
export function generateLoopedSchedule(
  basePattern: { devotion: string; prayer: string }[],
  startDateStr: string,
  totalDays: number
): {
  date: string;
  devotion: string;
  prayer: string;
  loopIndex: number;
  patternIndex: number;
}[] {
  if (!basePattern || basePattern.length === 0 || totalDays <= 0) return [];

  const results: {
    date: string;
    devotion: string;
    prayer: string;
    loopIndex: number;
    patternIndex: number;
  }[] = [];

  let currentDateStr = ensureWeekdayDateStr(startDateStr);

  for (let i = 0; i < totalDays; i++) {
    const patternIdx = i % basePattern.length;
    const loopNum = Math.floor(i / basePattern.length) + 1;
    const pair = basePattern[patternIdx];

    results.push({
      date: currentDateStr,
      devotion: pair.devotion,
      prayer: pair.prayer,
      loopIndex: loopNum,
      patternIndex: patternIdx + 1
    });

    // Advance to next weekday (Monday - Friday only, skipping Saturday and Sunday)
    currentDateStr = addDaysToDateStr(currentDateStr, 1, true);
  }

  return results;
}

