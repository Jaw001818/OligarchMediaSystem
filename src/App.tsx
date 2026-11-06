import React, { useState, useEffect } from "react";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  sendPasswordResetEmail,
  User,
  signInAnonymously
} from "firebase/auth";
import { 
  db, 
  auth, 
  handleFirestoreError, 
  OperationType,
  onSnapshot, 
  collection, 
  query, 
  getDocs, 
  setDoc, 
  doc, 
  addDoc,
  where,
  updateDoc
} from "./firebase";
import { 
  Employee, 
  Attendance, 
  LeaveRequest, 
  Payroll, 
  PayrollPeriod, 
  SystemNotification, 
  AppSettings,
  AttendanceCopyRequest,
  CashAdvance,
  BossDebt,
  NoWorkDay
} from "./types";
import { seedInitialDataIfEmpty, ensureEmployee002Exists, recomputeAllAttendance, sanitizeLeaveAttendanceRecords } from "./utils";

// Sub-components
import Sidebar from "./components/Sidebar";
import Portal from "./components/Portal";
import AdminDashboard from "./components/AdminDashboard";
import EmployeeManager from "./components/EmployeeManager";
import AttendanceManager from "./components/AttendanceManager";
import AttendanceEditor from "./components/AttendanceEditor";
import PayrollManager from "./components/PayrollManager";
import RequestManager from "./components/RequestManager";
import NotificationsPanel from "./components/NotificationsPanel";
import SettingsPanel from "./components/SettingsPanel";
import PwaInstallPrompt from "./components/PwaInstallPrompt";
import { CashAdvancesManager } from "./components/CashAdvancesManager";
import DevotionManager from "./components/DevotionManager";
import RecycleBinManager from "./components/RecycleBinManager";
import { motion } from "motion/react";

import { 
  ShieldCheck, 
  Bell, 
  Users, 
  AlertTriangle, 
  Clock, 
  Cpu, 
  Menu,
  Smartphone,
  Lock,
  Mail,
  UserCheck,
  LayoutDashboard,
  CalendarDays,
  Sliders,
  CreditCard,
  MailWarning,
  Settings,
  LogOut,
  BookOpen,
  Trash2
} from "lucide-react";

export default function App() {
  // Authentication states
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  // Portal vs Admin toggler
  const [portalMode, setPortalMode] = useState(true); // Default to Employee Portal
  const [isEmployeePortalLoggedIn, setIsEmployeePortalLoggedIn] = useState(false);
  const [urlView, setUrlView] = useState<"admin" | "employee" | "default">("default");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<"light" | "dark">("dark");

  // Operational states
  const [currentTab, setCurrentTab] = useState("dashboard");

  // Collections state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [attendanceCopyRequests, setAttendanceCopyRequests] = useState<AttendanceCopyRequest[]>([]);
  const [payrollPeriods, setPayrollPeriods] = useState<PayrollPeriod[]>([]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [cashAdvances, setCashAdvances] = useState<CashAdvance[]>([]);
  const [bossDebts, setBossDebts] = useState<BossDebt[]>([]);
  const [noWorkDays, setNoWorkDays] = useState<NoWorkDay[]>([]);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    companyName: "Oligarch Media Graphic Design Studio",
    adminEmail: "hr.oligarchmedia@gmail.com",
    workHourStart: "22:00",
    workHourEnd: "07:00",
    breakStart: "03:00",
    breakEnd: "04:00",
    currency: "₱",
    dstOffset: 0
  });

  // Track if portal path is requested direct in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view")?.toLowerCase();
    const h = window.location.hash.toLowerCase();
    const p = window.location.pathname.toLowerCase();

    if (viewParam === "admin" || h === "#admin" || h === "#/admin" || p === "/admin") {
      setPortalMode(false);
      setUrlView("admin");
    } else if (viewParam === "employee" || h === "#employee" || h === "#portal" || h === "#/request" || p === "/request") {
      setPortalMode(true);
      setUrlView("employee");
    } else {
      // Secure fallback default: Employee Portal is displayed and admin toggle is completely hidden.
      setPortalMode(true);
      setUrlView("default");
    }
  }, []);

  // Set html class matching Theme Mode
  useEffect(() => {
    const root = window.document.documentElement;
    if (themeMode === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [themeMode]);

  // Auth changed listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const savedSessionStr = localStorage.getItem("nova_admin_session");
      if (savedSessionStr) {
        try {
          const savedSession = JSON.parse(savedSessionStr);
          setCurrentUser({
            email: savedSession.email,
            uid: savedSession.uid || user?.uid || "local-admin",
            displayName: savedSession.displayName || "Admin",
          } as any);
          
          if (!user) {
            signInAnonymously(auth).catch((anonErr) => {
              console.warn("Continuing with local fallback authentication:", anonErr);
            });
          }
          setAuthLoading(false);
          return;
        } catch (e) {
          console.error("Failed to parse saved session", e);
        }
      }
      if (!user) {
        signInAnonymously(auth).catch((anonErr) => {
          console.warn("Continuing with anonymous portal authentication:", anonErr);
        });
      }
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  // Respect user-edited data: Do NOT run destructive migrations or forced position/department overwrites

  // Real-time Firestore synchronized listeners
  useEffect(() => {
    if (!currentUser) {
      setEmployees([]);
      setAttendance([]);
      setRequests([]);
      setAttendanceCopyRequests([]);
      setPayrollPeriods([]);
      setPayrolls([]);
      setCashAdvances([]);
      setBossDebts([]);
      setNoWorkDays([]);
      setNotifications([]);

      // Non-sensitive settings table lookup is safe for unauthenticated users
      const unsubSettings = onSnapshot(
        doc(db, "settings", "general"),
        (snapshot) => {
          if (snapshot.exists()) {
            setSettings(snapshot.data() as AppSettings);
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, "settings/general");
        }
      );
      return unsubSettings;
    }

    // 1. Listen Employees
    const unsubEmployees = onSnapshot(
      collection(db, "employees"),
      (snapshot) => {
        const list: Employee[] = [];
        snapshot.forEach((doc) => {
          list.push({ ...doc.data() as Employee, id: doc.id });
        });
        setEmployees(list);

        // Security enforcement: verify that if a logged-in session belongs to an employee admin, they are still Active
        if (currentUser && !currentUser.isSuperAdmin && currentUser.email) {
          const myProfile = list.find(e => e.email?.toLowerCase() === currentUser.email?.toLowerCase());
          if (myProfile) {
            const currentStatus = myProfile.status || "Active";
            if (currentStatus === "Inactive" || currentStatus === "Resigned" || currentStatus !== "Active") {
              console.warn("Revoking admin access: employee account status is", currentStatus);
              localStorage.removeItem("nova_admin_session");
              setCurrentUser(null);
              setAuthError(`Your administrator access has been revoked because your employee account was marked as ${String(currentStatus || "Inactive").toUpperCase()}.`);
            }
          }
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "employees");
      }
    );

    // 2. Listen Attendance
    const unsubAttendance = onSnapshot(
      collection(db, "attendance"),
      (snapshot) => {
        const list: Attendance[] = [];
        snapshot.forEach((doc) => {
          list.push({ ...doc.data() as Attendance, id: doc.id });
        });
        list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || (b.timeIn || "").localeCompare(a.timeIn || ""));
        setAttendance(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "attendance");
      }
    );

    // 3. Listen Requests
    const unsubRequests = onSnapshot(
      collection(db, "leave_requests"),
      (snapshot) => {
        const list: LeaveRequest[] = [];
        snapshot.forEach((doc) => {
          list.push({ ...doc.data() as LeaveRequest, id: doc.id });
        });
        list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
        setRequests(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "leave_requests");
      }
    );

    // 3.5. Listen Attendance Copy Requests
    const unsubAttendanceCopyRequests = onSnapshot(
      collection(db, "attendance_copy_requests"),
      (snapshot) => {
        const list: AttendanceCopyRequest[] = [];
        snapshot.forEach((doc) => {
          list.push({ ...doc.data() as AttendanceCopyRequest, id: doc.id });
        });
        list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
        setAttendanceCopyRequests(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "attendance_copy_requests");
      }
    );

    // 4. Listen periods
    const unsubPeriods = onSnapshot(
      collection(db, "payroll_periods"),
      (snapshot) => {
        const list: PayrollPeriod[] = [];
        snapshot.forEach((doc) => {
          list.push({ ...doc.data() as PayrollPeriod, id: doc.id });
        });
        // Sort start date desc
        list.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
        setPayrollPeriods(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "payroll_periods");
      }
    );

    // 5. Listen payroll records
    const unsubPayroll = onSnapshot(
      collection(db, "payroll"),
      (snapshot) => {
        const list: Payroll[] = [];
        snapshot.forEach((doc) => {
          list.push({ ...doc.data() as Payroll, id: doc.id });
        });
        list.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
        setPayrolls(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "payroll");
      }
    );

    // 5.5 Listen cash advances
    const unsubCashAdvances = onSnapshot(
      collection(db, "cash_advances"),
      (snapshot) => {
        const list: CashAdvance[] = [];
        snapshot.forEach((doc) => {
          list.push({ ...doc.data() as CashAdvance, id: doc.id });
        });
        list.sort((a, b) => new Date(b.dateGranted).getTime() - new Date(a.dateGranted).getTime());
        setCashAdvances(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "cash_advances");
      }
    );

    // 5.6. Listen boss debts (additional cash additions / boss utang to employee)
    const unsubBossDebts = onSnapshot(
      collection(db, "boss_debts"),
      (snapshot) => {
        const list: BossDebt[] = [];
        snapshot.forEach((doc) => {
          list.push({ ...doc.data() as BossDebt, id: doc.id });
        });
        list.sort((a, b) => new Date(b.dateGranted).getTime() - new Date(a.dateGranted).getTime());
        setBossDebts(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "boss_debts");
      }
    );

    // 5.7. Listen No Work Days
    const unsubNoWorkDays = onSnapshot(
      collection(db, "no_work_days"),
      (snapshot) => {
        const list: NoWorkDay[] = [];
        snapshot.forEach((doc) => {
          list.push({ ...doc.data() as NoWorkDay, id: doc.id });
        });
        list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        setNoWorkDays(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "no_work_days");
      }
    );

    // 6. Listen notifications (sorted desc)
    const unsubNotifs = onSnapshot(
      collection(db, "notifications"),
      (snapshot) => {
        const list: SystemNotification[] = [];
        snapshot.forEach((doc) => {
          list.push({ ...doc.data() as SystemNotification, id: doc.id });
        });
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setNotifications(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "notifications");
      }
    );

    // 7. Listen Settings
    const unsubSettings = onSnapshot(
      doc(db, "settings", "general"),
      (snapshot) => {
        if (snapshot.exists()) {
          setSettings(snapshot.data() as AppSettings);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "settings/general");
      }
    );

    return () => {
      unsubEmployees();
      unsubAttendance();
      unsubRequests();
      unsubAttendanceCopyRequests();
      unsubPeriods();
      unsubPayroll();
      unsubCashAdvances();
      unsubBossDebts();
      unsubNoWorkDays();
      unsubNotifs();
      unsubSettings();
    };
  }, [currentUser]);

  // Admin login trigger (Super Admin via passwordless, regular Admin via PIN)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthMessage("");
    const inputEmail = email.trim();
    const inputPass = password.trim();

    if (!inputEmail) {
      setAuthError("Please fill out the username or email address.");
      return;
    }

    const isSuperAdminEmail = 
      inputEmail.toLowerCase() === "hr.oligarchmedia@gmail.com" ||
      inputEmail.toLowerCase() === "oligarchmediaph@gmail.com" || 
      (settings?.adminEmail ? inputEmail.toLowerCase() === settings.adminEmail.toLowerCase() : false);

    // If they are not Super Admin, we require a password or PIN
    if (!isSuperAdminEmail && !inputPass) {
      setAuthError("Please enter your Admin PIN passcode.");
      return;
    }

    try {
      // Sign in anonymously to satisfy Firestore rules 'request.auth != null'
      try {
        await signInAnonymously(auth);
      } catch (anonErr) {
        console.warn("Continuing with client-only fallback authentication:", anonErr);
      }

      if (isSuperAdminEmail) {
        // Super Admin gets direct passwordless entry!
        const sessionUser = {
          email: inputEmail,
          uid: auth.currentUser?.uid || "super-admin-session",
          displayName: "Super Admin",
          isSuperAdmin: true,
        };
        localStorage.setItem("nova_admin_session", JSON.stringify(sessionUser));
        setCurrentUser(sessionUser);
        setAuthMessage("Authorized! Welcome Super Admin.");
        return;
      }

      // Check if there is an employee profile registered with this email
      const employeesRef = collection(db, "employees");
      const q = query(employeesRef, where("email", "==", inputEmail));
      const querySnapshot = await getDocs(q);

      let matchedEmployee: Employee | null = null;
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data() as Employee;
        const matchesAdminCriteria = data.isAdmin || 
          (data.position && data.position.toLowerCase().includes("admin")) || 
          (data.position && data.position.toLowerCase().includes("hr manager"));

        if (matchesAdminCriteria) {
          matchedEmployee = { ...data, id: docSnap.id };
        }
      });

      if (matchedEmployee) {
        // Yes, there is an Employee Admin!
        const emp = matchedEmployee as Employee;

        // Security check: Inactive or Resigned employees cannot log in
        const empStatus = emp.status || "Active";
        if (empStatus === "Inactive") {
          setAuthError(`Access denied. The employee account for ${emp.fullName} is currently marked as INACTIVE. Please contact the Super Admin.`);
          return;
        }
        if (empStatus === "Resigned") {
          setAuthError(`Access denied. The employee account for ${emp.fullName} is recorded as RESIGNED. Access has been revoked.`);
          return;
        }
        if (empStatus !== "Active") {
          setAuthError(`Access denied. The employee account for ${emp.fullName} is marked as "${empStatus}". Only active staff can access administrative tools.`);
          return;
        }

        const employeePin = emp.pin ? emp.pin.trim() : "";

        if (employeePin && employeePin === inputPass) {
          const sessionUser = {
            email: emp.email,
            uid: auth.currentUser?.uid || `admin-emp-${emp.id}`,
            displayName: emp.fullName,
            isSuperAdmin: false,
          };
          localStorage.setItem("nova_admin_session", JSON.stringify(sessionUser));
          setCurrentUser(sessionUser);
          setAuthMessage(`Authorized! Welcome back Admin, ${emp.fullName}.`);
        } else if (!employeePin) {
          setAuthError(`This employee (${emp.fullName}) does not have an Admin PIN configured. Please contact the Super Admin.`);
        } else {
          setAuthError("Invalid Admin PIN passcode. Please try again.");
        }
      } else {
        setAuthError("No administrator account associated with this email.");
      }
    } catch (err: any) {
      console.error(err);
      let errMsg = err.message || "Failed credentials matching.";
      setAuthError(errMsg);
    }
  };

  // Register Admin trigger
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      setAuthMessage("Admin ID created successfully! Please configure dashboard values.");
      setIsRegisterMode(false);
    } catch (err: any) {
      setAuthError(err.message || "Failed credentials creation.");
    }
  };

  // Password Reset trigger
  const handleResetPassword = async () => {
    if (!email) {
      setAuthError("Please provide your admin email first to receive reset triggers.");
      return;
    }
    setAuthError("");
    setAuthMessage("");
    try {
      await sendPasswordResetEmail(auth, email);
      setAuthMessage("Password recovery instructions dispatched to email.");
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem("nova_admin_session");
      await signOut(auth);
    } catch (err) {
      console.error(err);
    } finally {
      setCurrentUser(null);
      setCurrentTab("dashboard");
    }
  };

  // Quick refresh calculations
  const triggerFreshDataQuery = () => {
    // onSnapshot automatically refreshes in real-time, but we offer this state-hook for callback refreshers
    console.log("Forcing cloud synchronized refresh...");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center font-sans">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-zinc-500 font-mono mt-3">Initializing Oligarch Media Security Gate...</p>
      </div>
    );
  }

  const pendingRequestsCount = 
    requests.filter((r) => r.status === "Pending").length +
    attendanceCopyRequests.filter((r) => r.status === "Pending").length;

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-900 transition-colors duration-200 font-sans flex flex-col relative">
      {/* CORE FRAME: IF PUBLIC PORTAL VIEW MODE IS ACTIVATED */}
      {portalMode ? (
        <main className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col justify-between">
          <div className="flex-1">
            <Portal onLoginStateChange={setIsEmployeePortalLoggedIn} />
          </div>
          {!isEmployeePortalLoggedIn && (
            <div className="py-8 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200/60 dark:border-zinc-800/60 text-center flex flex-col items-center justify-center gap-2 mt-auto">
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
                Oligarch Media Secure Gateway • All activity is logged and monitored.
              </p>
              {currentUser ? (
                <button
                  onClick={() => setPortalMode(false)}
                  className="mt-1.5 flex items-center gap-1.5 px-4 py-2 rounded bg-indigo-50 hover:bg-indigo-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-indigo-600 dark:text-zinc-350 hover:text-indigo-700 dark:hover:text-white transition-all text-[10px] font-bold uppercase tracking-widest border border-indigo-200 dark:border-zinc-700/50 cursor-pointer shadow-xs"
                >
                  <Smartphone className="w-3 h-3 text-indigo-500 animate-pulse" />
                  <span>Return to Admin Console</span>
                </button>
              ) : (
                <button
                  onClick={() => setPortalMode(false)}
                  className="mt-1.5 flex items-center gap-1.5 px-4 py-2 rounded bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white transition-all text-[10px] font-bold uppercase tracking-widest border border-zinc-300 dark:border-zinc-700/50 cursor-pointer shadow-xs"
                >
                  <Lock className="w-3 h-3 text-amber-500 animate-pulse" />
                  <span>Summon Admin Area</span>
                </button>
              )}
            </div>
          )}
        </main>
      ) : (
        /* OTHERWISE: LOAD STANDARD ADMIN/LOGIN INTERACTIVE ACTIONS */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {!currentUser ? (
            /* PHASE A: AUTHENTICATION LOGIN DRAWER CARDS */
            <div className="flex-1 flex items-center justify-center p-4 overflow-y-auto">
              <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-805 w-full max-w-sm rounded-2xl overflow-hidden shadow-xl p-6 relative">
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-extrabold text-xl mx-auto mb-3 shadow-md">
                    N
                  </div>
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">Admin Authentication</h3>
                  <p className="text-[11px] text-zinc-400 mt-1 max-w-[200px] mx-auto">Access HR calculations directory files.</p>
                </div>

                {authError && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/20 text-red-750 dark:text-red-400 text-xs rounded-xl flex items-center gap-2 border border-red-100 dark:border-red-900/30 mb-4 font-mono">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                    <span className="break-all">{authError}</span>
                  </div>
                )}

                {authMessage && (
                  <div className="p-3 bg-green-50 dark:bg-green-950/20 text-green-750 dark:text-green-400 text-xs rounded-xl flex items-center gap-2 border border-green-100 dark:border-green-900/30 mb-4">
                    <UserCheck className="w-4 h-4 shrink-0 text-green-500" />
                    <span>{authMessage}</span>
                  </div>
                )}

                <form onSubmit={isRegisterMode ? handleRegister : handleLogin} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase tracking-wider">ADMIN USERNAME / EMAIL</label>
                    <input
                      type="email"
                      required
                      placeholder="e.g. admin@novacorporate.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full text-xs px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-xl focus:outline-none dark:text-zinc-100 font-mono"
                    />
                  </div>

                  {(() => {
                    const isSuperAdminEmail = 
                      email.trim().toLowerCase() === "hr.oligarchmedia@gmail.com" ||
                      email.trim().toLowerCase() === "oligarchmediaph@gmail.com" || 
                      (settings?.adminEmail ? email.trim().toLowerCase() === settings.adminEmail.toLowerCase() : false);
                    
                    if (isSuperAdminEmail && !isRegisterMode) {
                      return (
                        <div className="p-3.5 bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[10px] rounded-xl flex items-center gap-2.5 font-mono animate-in fade-in duration-200">
                          <ShieldCheck className="w-4 h-4 shrink-0 text-sky-400" />
                          <span>Identified as Super Admin. Password not required.</span>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-1 animate-in fade-in duration-200">
                        <label className="text-[10px] font-bold text-zinc-500 font-mono uppercase tracking-wider font-medium">PASSWORD OR ADMIN PIN</label>
                        <input
                          type="password"
                          required={!isSuperAdminEmail || isRegisterMode}
                          placeholder="Enter Password or 4-12 digit PIN"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full text-xs px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-808 rounded-xl focus:outline-none dark:text-zinc-100 font-mono text-center tracking-widest font-bold"
                        />
                      </div>
                    );
                  })()}

                  <button
                    type="submit"
                    className="w-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs shadow-sm transition-colors cursor-pointer"
                  >
                    {isRegisterMode ? "Confirm Setup Admin" : "Sign In Console"}
                  </button>
                </form>

                {/* Seeding / signup helper options */}
                <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-900 flex justify-between items-center text-[11px] font-semibold text-zinc-500">
                  <button onClick={handleResetPassword} className="hover:text-zinc-900 dark:hover:text-zinc-300">
                    Forgot Password?
                  </button>

                  <button 
                    onClick={() => setIsRegisterMode(!isRegisterMode)} 
                    className="text-blue-600 hover:underline cursor-pointer"
                  >
                    {isRegisterMode ? "Switch to Login" : "Register Admin"}
                  </button>
                </div>

                <div className="mt-4 p-3 bg-blue-50/50 dark:bg-zinc-900/60 rounded-xl text-[10px] text-zinc-500 leading-relaxed border border-zinc-200/50 dark:border-zinc-805 space-y-1.5">
                  <div>
                    <strong className="text-zinc-700 dark:text-zinc-300 font-bold">Super Admin access:</strong> Login with <strong>{settings?.adminEmail || "hr.oligarchmedia@gmail.com"}</strong>. <span className="text-sky-600 dark:text-sky-450 font-extrabold font-mono uppercase tracking-wide">No password required!</span>
                  </div>
                  <div className="pt-1.5 border-t border-zinc-150 dark:border-zinc-800">
                    <strong className="text-zinc-700 dark:text-zinc-300 font-bold">Staff Admin access:</strong> Assign any employee as <strong>Admin Power</strong> in the Directory, and set their <strong>PIN Code</strong>. They can log in using their primary <strong>Email</strong> and that <strong>PIN</strong>.
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-zinc-100 dark:border-zinc-900 flex justify-center">
                  <button
                    onClick={() => setPortalMode(true)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900/80 dark:hover:bg-zinc-800 text-zinc-650 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-800 cursor-pointer shadow-xs"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                    <span>Go to Employee Portal</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* PHASE B: IN_CONSOLE NAVIGATION BOARD DESKTOP */
            <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
              
              {/* Responsive sidebar drawers */}
              <div className="hidden md:block shrink-0">
                <Sidebar 
                  currentTab={currentTab} 
                  setCurrentTab={setCurrentTab} 
                  onLogout={handleLogout}
                  adminName={currentUser.email || "Admin Workspace"}
                  themeMode={themeMode}
                  setThemeMode={setThemeMode}
                  portalMode={portalMode}
                  setPortalMode={setPortalMode}
                  pendingRequestsCount={pendingRequestsCount}
                />
              </div>

              {/* Main Content Workspace viewport */}
              <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
                
                {/* Mobile Hamburger Title Rail */}
                <header className="p-4 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 flex md:hidden justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white font-black text-sm">OM</div>
                    <span className="font-bold text-sm text-zinc-900 dark:text-zinc-50">Oligarch Media Control Panel</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
                      className="p-1 px-2 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-650"
                    >
                      <Menu className="w-5 h-5" />
                    </button>
                  </div>
                </header>

                {/* Mobile dropdown menu drawers */}
                {mobileSidebarOpen && (
                  <div className="bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 md:hidden p-4 space-y-1 animate-in slide-in-from-top-3 z-40">
                    {[
                      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
                      { id: "devotion", label: "Devotion & Prayer", icon: BookOpen },
                      { id: "employees", label: "Employees", icon: Users },
                      { id: "attendance", label: "Attendance Tracker", icon: CalendarDays },
                      { id: "attendance-override", label: "Attendance Editor", icon: Sliders },
                      { id: "payroll", label: "Payroll Hub", icon: CreditCard },
                      { id: "cash-advances", label: "Advances & Boss Credits", icon: CreditCard },
                      { id: "requests", label: "Employee Requests", icon: MailWarning, count: pendingRequestsCount },
                      { id: "trash", label: "Recycle Bin", icon: Trash2 },
                      { id: "settings", label: "System Config", icon: Settings },
                    ].map((item) => {
                      const IconComponent = item.icon;
                      const isActive = currentTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setCurrentTab(item.id);
                            setMobileSidebarOpen(false);
                          }}
                          className={`w-full text-left font-bold px-3 py-2.5 text-xs rounded-lg flex items-center justify-between transition-all ${
                            isActive 
                              ? "bg-indigo-600 text-white dark:bg-indigo-500/20 dark:text-indigo-400 font-extrabold border-l-2 border-l-indigo-500" 
                              : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <IconComponent className="w-4 h-4 shrink-0" />
                            <span>{item.label}</span>
                          </div>
                          {item.count !== undefined && item.count > 0 && (
                            <span className="bg-sky-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] h-[18px] flex items-center justify-center leading-none">
                              {item.count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    <div className="border-t border-zinc-100 dark:border-zinc-900 my-2 pt-2 space-y-1">
                      <button
                        onClick={() => {
                          setPortalMode(true);
                          setMobileSidebarOpen(false);
                        }}
                        className="w-full text-left font-bold text-blue-600 dark:text-blue-400 px-3 py-2 text-xs rounded-lg flex items-center gap-2.5 hover:bg-blue-50/50 dark:hover:bg-blue-500/10 transition-all"
                      >
                        <Smartphone className="w-4 h-4 shrink-0" /> 
                        <span>Employee Portal Mode</span>
                      </button>
                      <button
                        onClick={() => {
                          handleLogout();
                          setMobileSidebarOpen(false);
                        }}
                        className="w-full text-left font-bold text-red-500 px-3 py-2 text-xs rounded-lg flex items-center gap-2.5 hover:bg-red-50/50 dark:hover:bg-red-500/10 transition-all"
                      >
                        <LogOut className="w-4 h-4 shrink-0" />
                        <span>Logout Session</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Dynamic Content Rendering switcher */}
                <main className="p-4 sm:p-6 md:p-8 flex-1 min-w-0 w-full max-w-full">
                  {currentTab === "dashboard" && (
                    <AdminDashboard 
                      employees={employees} 
                      attendance={attendance} 
                      requests={requests} 
                      payrolls={payrolls} 
                      periods={payrollPeriods}
                      setCurrentTab={setCurrentTab}
                      settings={settings}
                    />
                  )}
                  {currentTab === "devotion" && (
                    <DevotionManager 
                      employees={employees} 
                      currentUser={currentUser} 
                    />
                  )}
                  {currentTab === "employees" && (
                    <EmployeeManager 
                      employees={employees} 
                      onRefresh={triggerFreshDataQuery} 
                      settings={settings}
                      isSuperAdmin={
                        currentUser?.email?.toLowerCase() === "hr.oligarchmedia@gmail.com" ||
                        currentUser?.email?.toLowerCase() === "oligarchmediaph@gmail.com" || 
                        (settings?.adminEmail ? currentUser?.email?.toLowerCase() === settings.adminEmail.toLowerCase() : false)
                      }
                    />
                  )}
                  {currentTab === "attendance" && (
                    <AttendanceManager 
                      employees={employees} 
                      attendance={attendance} 
                      onRefresh={triggerFreshDataQuery}
                      workHourStart={settings.workHourStart}
                      workHourEnd={settings.workHourEnd}
                      dstOffset={settings.dstOffset}
                      periods={payrollPeriods}
                      requests={requests}
                      noWorkDays={noWorkDays}
                    />
                  )}
                  {currentTab === "attendance-override" && (
                    <AttendanceEditor 
                      employees={employees} 
                      attendance={attendance} 
                      onRefresh={triggerFreshDataQuery}
                      workHourStart={settings.workHourStart}
                      workHourEnd={settings.workHourEnd}
                      dstOffset={settings.dstOffset}
                      periods={payrollPeriods}
                    />
                  )}
                  {currentTab === "payroll" && (
                    <PayrollManager 
                      employees={employees} 
                      attendance={attendance} 
                      requests={requests} 
                      periods={payrollPeriods} 
                      payrolls={payrolls} 
                      cashAdvances={cashAdvances}
                      bossDebts={bossDebts}
                      noWorkDays={noWorkDays}
                      onRefresh={triggerFreshDataQuery}
                      currency={settings.currency}
                      settings={settings}
                    />
                  )}
                  {currentTab === "cash-advances" && (
                    <CashAdvancesManager
                      advances={cashAdvances}
                      employees={employees}
                      periods={payrollPeriods}
                      bossDebts={bossDebts}
                      onRefresh={triggerFreshDataQuery}
                    />
                  )}
                  {currentTab === "requests" && (
                    <RequestManager 
                      requests={requests} 
                      onRefresh={triggerFreshDataQuery}
                      employees={employees}
                      settings={settings}
                      attendanceCopyRequests={attendanceCopyRequests}
                    />
                  )}
                  {currentTab === "trash" && (
                    <RecycleBinManager
                      onRefresh={triggerFreshDataQuery}
                    />
                  )}
                  {currentTab === "settings" && (
                    <SettingsPanel 
                      settings={settings} 
                      onRefresh={triggerFreshDataQuery}
                      employees={employees} 
                      attendance={attendance} 
                      requests={requests}
                      attendanceCopyRequests={attendanceCopyRequests}
                      payrollPeriods={payrollPeriods}
                      payrolls={payrolls}
                      cashAdvances={cashAdvances}
                      bossDebts={bossDebts}
                      noWorkDays={noWorkDays}
                    />
                  )}
                </main>
              </div>

            </div>
          )}
        </div>
      )}
      <PwaInstallPrompt />
    </div>
  );
}
