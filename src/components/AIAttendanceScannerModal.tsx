import React, { useState, useEffect, useRef } from "react";
import { 
  Sparkles, 
  Upload, 
  FileSpreadsheet, 
  Check, 
  X, 
  AlertCircle, 
  CheckCircle2, 
  Calendar, 
  Users, 
  Clipboard, 
  RefreshCw, 
  ArrowRight,
  UserPlus,
  ShieldCheck,
  Eye,
  Sliders,
  Link as LinkIcon
} from "lucide-react";
import { collection, addDoc, doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Employee, Attendance } from "../types";
import { scanAttendanceClientSide, parseSpreadsheetTextClientSide } from "../utils/aiScannerClient";

interface ParsedEmployeeRow {
  employeeName: string; // Name as written in sheet / screenshot
  canonicalName: string; // Official system full name (e.g. MALLARI, HERMINIO JR L)
  matchedEmployeeId?: string;
  matchedEmployeeNumber?: string;
  isNewEmployee: boolean;
  createProfile: boolean;
  createStatus: "Resigned" | "Active";
  customSalary: number;
  records: Array<{
    date: string;
    status: "Present" | "Absent" | "Paid Leave" | "Birthday Leave" | "Rest Day";
    hoursWorked: number;
  }>;
  totalHours: number;
}

interface AIAttendanceScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  workHourStart?: string;
  workHourEnd?: string;
  onSuccess: () => void;
  initialYear?: number;
}

// Built-in dictionary of common nickname / informal name mappings for Philippine office environments
const KNOWN_NAME_ALIASES: Record<string, string[]> = {
  "MALLARI, HERMINIO JR L": [
    "jr mallari", "herminio jr", "jr", "mallari jr", "herminio mallari", "herminio", "herminio jr l", "mallari herminio jr"
  ],
  "CUBOL, ROLAND JHON G": [
    "roland jhon", "roland john", "roland", "roland jhon g", "cubol roland", "cubol roland jhon", "roland g"
  ],
  "LAXA, ISRAEL P": [
    "israel", "israel laxa", "laxa israel", "israel p"
  ],
  "PANGAN, JOEMARIE G.": [
    "jao", "jao pangan", "joemarie", "joemarie pangan", "pangan jao", "joemarie p"
  ],
  "LLANES, OSBORN B.": [
    "osborn", "osborn llanes", "llanes osborn"
  ],
  "CULALA, LANZ ROIE S.": [
    "lanz", "lanz roie", "culala lanz", "culala lanz roie", "roie culala", "lanz culala"
  ],
  "ROQUE, JOHN CEDRIC M.": [
    "john cedric", "cedric", "cedric roque", "john cedric roque", "roque john", "roque cedric"
  ]
};

export default function AIAttendanceScannerModal({
  isOpen,
  onClose,
  employees,
  workHourStart = "21:00",
  workHourEnd = "06:00",
  onSuccess,
  initialYear = 2025
}: AIAttendanceScannerModalProps) {
  const [activeTab, setActiveTab] = useState<"image" | "paste">("image");
  const [targetYear, setTargetYear] = useState<number>(initialYear);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState<string>("");
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Parsed result states
  const [parsedRows, setParsedRows] = useState<ParsedEmployeeRow[]>([]);
  const [parsedDates, setParsedDates] = useState<string[]>([]);
  const [selectedRowNames, setSelectedRowNames] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Listen for Clipboard paste of images (Ctrl+V)
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (event) => {
              const b64 = event.target?.result as string;
              setSelectedImage(b64);
              setImagePreview(b64);
              setActiveTab("image");
              setScanError(null);
            };
            reader.readAsDataURL(blob);
          }
          break;
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isOpen]);

  if (!isOpen) return null;

  // Comprehensive multi-tier name matching helper
  const findMatchingEmployee = (rawName: string, canonicalHint?: string): Employee | undefined => {
    if (!rawName && !canonicalHint) return undefined;
    const cleanRaw = (rawName || "").toLowerCase().trim();
    const cleanHint = (canonicalHint || "").toLowerCase().trim();

    // 0. Match by canonical hint returned by Gemini OCR if provided
    if (cleanHint) {
      const matchByHint = employees.find(emp => {
        const empClean = emp.fullName.toLowerCase().replace(/[^a-z0-9]/g, "");
        const hintClean = cleanHint.replace(/[^a-z0-9]/g, "");
        return empClean === hintClean || emp.fullName.toLowerCase().includes(cleanHint);
      });
      if (matchByHint) return matchByHint;
    }

    // 1. Check known aliases dictionary
    for (const [canonical, aliases] of Object.entries(KNOWN_NAME_ALIASES)) {
      const isAliasMatch = aliases.some(alias => {
        const aliasClean = alias.replace(/[^a-z0-9]/g, "");
        const rawClean = cleanRaw.replace(/[^a-z0-9]/g, "");
        return aliasClean === rawClean || cleanRaw === alias;
      });
      if (isAliasMatch) {
        const emp = employees.find(e => {
          const eClean = e.fullName.toLowerCase().replace(/[^a-z0-9]/g, "");
          const canClean = canonical.toLowerCase().replace(/[^a-z0-9]/g, "");
          return eClean === canClean || e.fullName.toLowerCase().includes(canonical.toLowerCase().split(",")[0]);
        });
        if (emp) return emp;
      }
    }

    // 2. Exact match (case & punctuation insensitive)
    const rawAlphaNum = cleanRaw.replace(/[^a-z0-9]/g, "");
    const exact = employees.find(emp => emp.fullName.toLowerCase().replace(/[^a-z0-9]/g, "") === rawAlphaNum);
    if (exact) return exact;

    // 3. Inverted comma format: "MALLARI, HERMINIO JR L" -> "HERMINIO JR L MALLARI"
    for (const emp of employees) {
      if (emp.fullName.includes(",")) {
        const [last, first] = emp.fullName.split(",").map(s => s.trim().toLowerCase());
        const natural = `${first} ${last}`.replace(/[^a-z0-9]/g, "");
        if (natural === rawAlphaNum) return emp;
      }
    }

    // 4. Token subset matching (e.g., "JR MALLARI" -> tokens ["jr", "mallari"])
    // Retains tokens of length >= 2 (so suffixes like "JR" are respected)
    const tokens = cleanRaw.split(/[\s,.-]+/).filter(t => t.length >= 2);
    if (tokens.length >= 2) {
      const candidates = employees.filter(emp => {
        if (!emp?.fullName) return false;
        const empLower = emp.fullName.toLowerCase();
        return tokens.every(token => {
          // Normalize "john" and "jhon"
          const altToken = token === "jhon" ? "john" : token === "john" ? "jhon" : token;
          return empLower.includes(token) || empLower.includes(altToken);
        });
      });
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) return candidates[0];
    }

    // 5. Single distinctive token match (e.g. "ISRAEL", "OSBORN", "JAO", "LANZ")
    if (tokens.length === 1 && tokens[0].length >= 3) {
      const singleToken = tokens[0];
      const singleMatches = employees.filter(emp => {
        if (!emp?.fullName) return false;
        const parts = emp.fullName.toLowerCase().split(/[\s,.-]+/);
        return parts.includes(singleToken) || emp.fullName.toLowerCase().includes(singleToken);
      });
      if (singleMatches.length === 1) return singleMatches[0];
    }

    return undefined;
  };

  // Process raw response data from Gemini
  const processExtractedData = (data: any, forcedYear: number) => {
    const allDatesSet = new Set<string>();
    const aggregatedMap = new Map<string, {
      employeeName: string;
      matchedCanonicalName?: string;
      recordsMap: Map<string, { status: any; hoursWorked: number }>;
      totalHours: number;
    }>();

    // Collect dates and records
    if (Array.isArray(data.datesFound)) {
      data.datesFound.forEach((d: string) => allDatesSet.add(d));
    }

    if (Array.isArray(data.aggregatedEmployees)) {
      data.aggregatedEmployees.forEach((emp: any) => {
        const name = (emp.employeeName || "").trim();
        if (!name) return;

        let entry = aggregatedMap.get(name);
        if (!entry) {
          entry = {
            employeeName: name,
            matchedCanonicalName: emp.matchedCanonicalName,
            recordsMap: new Map(),
            totalHours: emp.totalWorkingHours || 0
          };
          aggregatedMap.set(name, entry);
        }

        if (Array.isArray(emp.records)) {
          emp.records.forEach((r: any) => {
            let recordDate = r.date;
            if (recordDate) {
              if (forcedYear && recordDate.length === 10) {
                const parts = recordDate.split('-');
                if (parts.length === 3 && parseInt(parts[0], 10) !== forcedYear) {
                  recordDate = `${forcedYear}-${parts[1]}-${parts[2]}`;
                }
              }
              allDatesSet.add(recordDate);
              entry!.recordsMap.set(recordDate, {
                status: r.status || "Present",
                hoursWorked: r.status === "Absent" ? 0 : (r.hoursWorked || 8)
              });
            }
          });
        }
      });
    }

    // Also parse weeks structure if present
    if (Array.isArray(data.weeks)) {
      data.weeks.forEach((wk: any) => {
        if (Array.isArray(wk.dates)) {
          wk.dates.forEach((d: string) => {
            let recordDate = d;
            if (forcedYear && recordDate.length === 10) {
              const parts = recordDate.split('-');
              if (parts.length === 3 && parseInt(parts[0], 10) !== forcedYear) {
                recordDate = `${forcedYear}-${parts[1]}-${parts[2]}`;
              }
            }
            allDatesSet.add(recordDate);
          });
        }
        if (Array.isArray(wk.employees)) {
          wk.employees.forEach((emp: any) => {
            const name = (emp.employeeName || "").trim();
            if (!name) return;

            let entry = aggregatedMap.get(name);
            if (!entry) {
              entry = {
                employeeName: name,
                matchedCanonicalName: emp.matchedCanonicalName,
                recordsMap: new Map(),
                totalHours: emp.weeklyTotalHours || 0
              };
              aggregatedMap.set(name, entry);
            }

            if (emp.statuses && typeof emp.statuses === "object") {
              Object.entries(emp.statuses).forEach(([rawDate, st]) => {
                let d = rawDate;
                if (forcedYear && d.length === 10) {
                  const parts = d.split('-');
                  if (parts.length === 3 && parseInt(parts[0], 10) !== forcedYear) {
                    d = `${forcedYear}-${parts[1]}-${parts[2]}`;
                  }
                }
                allDatesSet.add(d);
                const statusStr = String(st || "Present");
                entry!.recordsMap.set(d, {
                  status: statusStr as any,
                  hoursWorked: statusStr === "Absent" ? 0 : 8
                });
              });
            }
          });
        }
      });
    }

    const sortedDates = Array.from(allDatesSet).sort();
    setParsedDates(sortedDates);

    // Build the processed rows
    const rows: ParsedEmployeeRow[] = [];
    const initialSelected = new Set<string>();

    aggregatedMap.forEach((val) => {
      const match = findMatchingEmployee(val.employeeName, val.matchedCanonicalName);
      const isNew = !match;
      const canonicalName = match ? match.fullName : (val.matchedCanonicalName || val.employeeName);

      const recordsArray = sortedDates.map(date => {
        const found = val.recordsMap.get(date);
        return {
          date,
          status: found ? found.status : "Present",
          hoursWorked: found ? found.hoursWorked : 8
        };
      });

      rows.push({
        employeeName: val.employeeName,
        canonicalName: canonicalName,
        matchedEmployeeId: match?.id,
        matchedEmployeeNumber: match?.employeeNumber,
        isNewEmployee: isNew,
        createProfile: isNew, // default to true for unlisted so 2025 former employees get auto-created
        createStatus: "Resigned", // default for 2025 former employees so they don't appear in 2026 daily punch cards!
        customSalary: match?.salary || 15000,
        records: recordsArray,
        totalHours: val.totalHours || (recordsArray.filter(r => r.status !== "Absent").length * 8)
      });

      initialSelected.add(val.employeeName);
    });

    setParsedRows(rows);
    setSelectedRowNames(initialSelected);
  };

  // Helper to ensure payload is base64
  const prepareBase64Payload = async (input: string): Promise<string> => {
    if (input.startsWith("/") || input.startsWith("http")) {
      try {
        const resp = await fetch(input);
        const blob = await resp.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.warn("Could not convert image path to base64 blob, passing original:", err);
      }
    }
    return input;
  };

  // Trigger Gemini API scan for image
  const handleScanImage = async () => {
    if (!selectedImage) {
      setScanError("Please select or paste an attendance spreadsheet image first.");
      return;
    }

    setIsScanning(true);
    setScanError(null);

    try {
      const base64Data = await prepareBase64Payload(selectedImage);
      let extractedData: any = null;

      try {
        const response = await fetch("/api/ai-scan-attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: base64Data,
            targetYear: targetYear,
            knownEmployees: employees.map(e => ({ fullName: e.fullName, employeeNumber: e.employeeNumber, id: e.id }))
          })
        });

        if (response.ok) {
          const resData = await response.json().catch(() => null);
          if (resData && resData.success) {
            extractedData = resData.data;
          }
        }
      } catch (backendErr) {
        console.warn("Backend /api not reachable, using client-side Gemini AI scanner fallback:", backendErr);
      }

      // If backend was not available (e.g. static Vercel hosting), execute Gemini scan in browser
      if (!extractedData) {
        extractedData = await scanAttendanceClientSide(base64Data, targetYear, employees);
      }

      processExtractedData(extractedData, targetYear);
    } catch (err: any) {
      console.error(err);
      setScanError(err.message || "Scanning failed. Please verify your Gemini API key in Vercel settings.");
    } finally {
      setIsScanning(false);
    }
  };

  // Trigger text parsing
  const handleParseText = async () => {
    if (!pastedText.trim()) {
      setScanError("Please paste spreadsheet text or CSV rows first.");
      return;
    }

    setIsScanning(true);
    setScanError(null);

    try {
      let extractedData: any = null;

      try {
        const response = await fetch("/api/ai-parse-spreadsheet-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rawText: pastedText,
            targetYear: targetYear,
            knownEmployees: employees.map(e => ({ fullName: e.fullName, employeeNumber: e.employeeNumber, id: e.id }))
          })
        });

        if (response.ok) {
          const resData = await response.json().catch(() => null);
          if (resData && resData.success) {
            extractedData = resData.data;
          }
        }
      } catch (backendErr) {
        console.warn("Backend /api not reachable, using client-side text parser fallback:", backendErr);
      }

      // If backend was not available, execute Gemini text parser in browser
      if (!extractedData) {
        extractedData = await parseSpreadsheetTextClientSide(pastedText, targetYear, employees);
      }

      processExtractedData(extractedData, targetYear);
    } catch (err: any) {
      console.error(err);
      setScanError(err.message || "Failed to parse text. Please check Gemini API key in Vercel settings.");
    } finally {
      setIsScanning(false);
    }
  };

  // Load sample image
  const handleLoadSample = (samplePath: string) => {
    setSelectedImage(samplePath);
    setImagePreview(samplePath);
    setScanError(null);
  };

  // Handle file picker selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const b64 = event.target?.result as string;
        setSelectedImage(b64);
        setImagePreview(b64);
        setScanError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  // Cell status toggler in preview
  const handleCellStatusChange = (employeeName: string, date: string, newStatus: any) => {
    setParsedRows(prev => prev.map(row => {
      if (row.employeeName !== employeeName) return row;
      const updatedRecords = row.records.map(rec => {
        if (rec.date !== date) return rec;
        return {
          ...rec,
          status: newStatus,
          hoursWorked: newStatus === "Absent" ? 0 : 8
        };
      });
      return {
        ...row,
        records: updatedRecords,
        totalHours: updatedRecords.filter(r => r.status !== "Absent").length * 8
      };
    }));
  };

  // Bulk import to Firestore with complete clock-in and clock-out timestamps
  const handleCommitImport = async () => {
    const rowsToImport = parsedRows.filter(r => selectedRowNames.has(r.employeeName));
    if (rowsToImport.length === 0) {
      setScanError("No employees selected for import.");
      return;
    }

    setIsImporting(true);
    setImportProgress("Writing attendance logs and linking employees...");

    try {
      let createdEmployeeCount = 0;
      let totalAttendanceRecords = 0;

      // Standardize shift times
      const sStart = (workHourStart && workHourStart.includes(":")) 
        ? (workHourStart.length === 5 ? `${workHourStart}:00` : workHourStart) 
        : "21:00:00";
      const sEnd = (workHourEnd && workHourEnd.includes(":")) 
        ? (workHourEnd.length === 5 ? `${workHourEnd}:00` : workHourEnd) 
        : "06:00:00";

      // 1. Process each employee
      for (const row of rowsToImport) {
        let finalEmpId = row.matchedEmployeeId;
        let finalEmpNum = row.matchedEmployeeNumber;
        let finalEmpName = row.canonicalName || row.employeeName;

        // Auto-create 2025 former employee only if no existing match was selected
        if (row.isNewEmployee && row.createProfile) {
          const randSuffix = Math.floor(100 + Math.random() * 900);
          finalEmpNum = `OM-${targetYear}-${randSuffix}`;

          const monthlySalary = Number(row.customSalary) || 15000;
          const dailyRate = Math.round((monthlySalary / 26) * 100) / 100;
          const otRate = Math.round((dailyRate / 8 * 1.25) * 100) / 100;

          // Create in Firestore
          const docRef = await addDoc(collection(db, "employees"), {
            fullName: row.employeeName,
            employeeNumber: finalEmpNum,
            email: `${row.employeeName.toLowerCase().replace(/[^a-z0-9]/g, "")}@oligarchmedia.internal`,
            phone: "09000000000",
            department: "Graphic Design",
            position: row.createStatus === "Resigned" ? "Former Artist (Historical 2025)" : "Graphic Designer",
            birthday: "2000-01-01",
            salary: monthlySalary,
            dailyRate,
            allowance: 0,
            otRate,
            status: row.createStatus, // "Resigned" keeps them off current daily cards!
            profilePicture: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120",
            employmentType: "Full-time",
            dateHired: `${targetYear}-01-01`,
            salaryHistory: [
              {
                id: `rate-${targetYear}-init`,
                effectiveFrom: `${targetYear}-01-01`,
                monthlySalary,
                dailyRate,
                hourlyRate: Math.round((dailyRate / 8) * 100) / 100,
                note: `${targetYear} Base Historical Rate for 13th Month`
              }
            ]
          });

          finalEmpId = docRef.id;
          finalEmpName = row.employeeName;
          createdEmployeeCount++;
        }

        // 2. Insert attendance records with complete clock-in AND clock-out
        for (const record of row.records) {
          const isAbsent = record.status === "Absent";
          const isRest = record.status === "Rest Day";
          const isLeave = record.status === "Paid Leave" || record.status === "Birthday Leave";

          const attendancePayload = {
            employeeId: finalEmpId || finalEmpNum || finalEmpName,
            employeeNumber: finalEmpNum || "HISTORICAL",
            employeeName: finalEmpName, // ALWAYS save canonical system name so Payroll & Attendance count it!
            date: record.date,
            status: record.status,
            hoursWorked: (isAbsent || isRest) ? 0 : (record.hoursWorked || 8),
            otHours: 0,
            lateMinutes: 0,
            isLateExcused: isLeave,
            timeIn: (isAbsent || isRest) ? null : sStart,
            timeOut: (isAbsent || isRest) ? null : sEnd, // CRITICAL: timeOut is recorded so it's completed and counts!
            breakStart: (isAbsent || isRest) ? null : "02:00:00",
            breakEnd: (isAbsent || isRest) ? null : "03:00:00",
            accumulatedBreakSeconds: (isAbsent || isRest) ? 0 : 3600,
            shiftStart: workHourStart,
            shiftEnd: workHourEnd,
            requiredHours: 8,
            importedViaAIScanner: true,
            createdAt: new Date().toISOString()
          };

          // Deterministic document ID to prevent duplicate logs on re-scans
          const safeKey = `${finalEmpId || finalEmpNum || finalEmpName}-${record.date}`.replace(/[\/\s#?]/g, "_");
          const safeDocId = `att-${safeKey}`;
          await setDoc(doc(db, "attendance", safeDocId), attendancePayload, { merge: true });
          totalAttendanceRecords++;
        }
      }

      setImportProgress(`Successfully imported ${totalAttendanceRecords} attendance logs! Auto-created ${createdEmployeeCount} profiles.`);
      setTimeout(() => {
        setIsImporting(false);
        onSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error("Commit import error:", err);
      setScanError(err.message || "Failed to commit records to database.");
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                <span>AI Attendance Screenshot & Spreadsheet Scanner</span>
                <span className="text-[10px] font-mono font-bold bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800">
                  Gemini Vision OCR
                </span>
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Automatically resolves informal names &amp; nicknames (e.g. JR MALLARI → MALLARI, HERMINIO JR L) with clock-out completion.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
          
          {/* Target Year and Mode Selector */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300 font-mono flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-indigo-500" /> Target Year:
              </span>
              <div className="flex items-center gap-1 bg-white dark:bg-zinc-950 p-1 rounded-xl border border-zinc-200 dark:border-zinc-800">
                {[2024, 2025, 2026, 2027].map(yr => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => setTargetYear(yr)}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer font-mono ${
                      targetYear === yr
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                    }`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1 bg-white dark:bg-zinc-950 p-1 rounded-xl border border-zinc-200 dark:border-zinc-800 self-start sm:self-auto">
              <button
                onClick={() => setActiveTab("image")}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === "image"
                    ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-black border border-indigo-200 dark:border-indigo-800/60"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Screenshot Image</span>
              </button>
              <button
                onClick={() => setActiveTab("paste")}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === "paste"
                    ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-black border border-indigo-200 dark:border-indigo-800/60"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                <Clipboard className="w-3.5 h-3.5" />
                <span>Paste Text/CSV</span>
              </button>
            </div>
          </div>

          {/* Upload / Input Section */}
          {parsedRows.length === 0 && (
            <div className="space-y-4">
              {activeTab === "image" ? (
                <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 hover:border-indigo-500/60 rounded-3xl p-6 sm:p-8 text-center transition-all bg-zinc-50/50 dark:bg-zinc-900/20">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  {imagePreview ? (
                    <div className="space-y-4 max-w-lg mx-auto">
                      <div className="relative rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-md max-h-60 bg-zinc-900">
                        <img
                          src={imagePreview}
                          alt="Spreadsheet Preview"
                          className="w-full h-auto object-contain max-h-60 mx-auto"
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs rounded-xl transition-all cursor-pointer"
                        >
                          Choose Different Image
                        </button>
                        <button
                          type="button"
                          onClick={handleScanImage}
                          disabled={isScanning}
                          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/20"
                        >
                          {isScanning ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>Scanning Sheet with AI...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4" />
                              <span>Analyze &amp; Extract Attendance</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 max-w-md mx-auto">
                      <div className="w-14 h-14 rounded-3xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 mx-auto flex items-center justify-center">
                        <Upload className="w-7 h-7" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
                          Upload, Drag &amp; Drop, or Paste (Ctrl+V) Attendance Screenshot
                        </p>
                        <p className="text-xs text-zinc-400 mt-1">
                          PNG, JPG, or WebP screenshot of your Excel or Google Sheets attendance ledger.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer"
                        >
                          Browse Files
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLoadSample("/assets/aistudio/image_34d254f7.png")}
                          className="px-4 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 font-bold text-xs rounded-xl border border-indigo-500/20 transition-all cursor-pointer"
                          title="Load the attached 2025/2026 spreadsheet screenshot"
                        >
                          Use Attached Screenshot
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLoadSample("/assets/aistudio/849319036_1103033339186341_1334204242181481_n_ed097bbd.jpg")}
                          className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 font-bold text-xs rounded-xl transition-all cursor-pointer"
                          title="Load Week 3 &amp; 4 Sheet"
                        >
                          Sample 2
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-zinc-600 dark:text-zinc-300 font-mono">
                      Paste Spreadsheet Grid Data (Tab-separated, CSV, or Text):
                    </label>
                  </div>
                  <textarea
                    rows={8}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={`Example:
JR MALLARI\tPRESENT\tPRESENT\tPRESENT\tPRESENT\tPRESENT\t40
ROLAND JHON\tPRESENT\tPRESENT\tPRESENT\tPRESENT\tPRESENT\t40
ISRAEL\tPRESENT\tPRESENT\tPAID LEAVE\tABSENT\tABSENT\t24`}
                    className="w-full p-3.5 text-xs font-mono bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleParseText}
                      disabled={isScanning || !pastedText.trim()}
                      className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                    >
                      {isScanning ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Parsing Spreadsheet Text...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>Parse Text with AI</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {scanError && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-2xl flex items-center gap-3 text-rose-700 dark:text-rose-300 text-xs">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{scanError}</span>
            </div>
          )}

          {/* Parsed Preview Table */}
          {parsedRows.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-zinc-50 dark:bg-zinc-900/40 p-4 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                      Successfully Extracted {parsedRows.length} Employees &amp; {parsedDates.length} Days
                    </h4>
                    <p className="text-[11px] text-zinc-500">
                      Review employee matching below. All "Present" days will be saved with clock-in &amp; clock-out so they count in Payroll.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedRowNames.size === parsedRows.length) {
                        setSelectedRowNames(new Set());
                      } else {
                        setSelectedRowNames(new Set(parsedRows.map(r => r.employeeName)));
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-bold rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-all cursor-pointer font-mono"
                  >
                    {selectedRowNames.size === parsedRows.length ? "Deselect All" : "Select All"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setParsedRows([]);
                      setParsedDates([]);
                      setSelectedRowNames(new Set());
                    }}
                    className="px-3 py-1.5 text-xs font-bold rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition-all cursor-pointer font-mono"
                  >
                    Reset &amp; Scan Another
                  </button>
                </div>
              </div>

              {/* Grid Scroll Table */}
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900/20 shadow-xs">
                <div className="overflow-x-auto max-h-[50vh]">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-zinc-100 dark:bg-zinc-800/90 text-zinc-600 dark:text-zinc-300 font-mono text-[11px] sticky top-0 z-10 uppercase tracking-wider">
                      <tr>
                        <th className="py-3 px-4 text-center w-12">Select</th>
                        <th className="py-3 px-4 min-w-[260px]">Employee &amp; Matching</th>
                        <th className="py-3 px-4 min-w-[190px]">Profile / Rate Action</th>
                        {parsedDates.map(date => (
                          <th key={date} className="py-3 px-3 text-center min-w-[110px]">
                            {date}
                          </th>
                        ))}
                        <th className="py-3 px-4 text-center font-bold">Total Hours</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 bg-white dark:bg-zinc-950 font-sans">
                      {parsedRows.map((row) => {
                        const isSelected = selectedRowNames.has(row.employeeName);
                        return (
                          <tr
                            key={row.employeeName}
                            className={`transition-colors ${
                              !isSelected ? "opacity-50 bg-zinc-50/50 dark:bg-zinc-900/20" : "hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                            }`}
                          >
                            {/* Checkbox */}
                            <td className="py-3 px-4 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const next = new Set(selectedRowNames);
                                  if (e.target.checked) {
                                    next.add(row.employeeName);
                                  } else {
                                    next.delete(row.employeeName);
                                  }
                                  setSelectedRowNames(next);
                                }}
                                className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                            </td>

                            {/* Name & Matching Selector */}
                            <td className="py-3 px-4">
                              <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold uppercase text-zinc-400 font-mono">Sheet:</span>
                                  <p className="font-extrabold text-zinc-900 dark:text-zinc-50 text-sm">{row.employeeName}</p>
                                </div>

                                {/* Reassign / Link Dropdown */}
                                <div className="flex items-center gap-1.5">
                                  <LinkIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                                  <select
                                    value={row.matchedEmployeeId || "NEW"}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setParsedRows(prev => prev.map(r => {
                                        if (r.employeeName !== row.employeeName) return r;
                                        if (val === "NEW") {
                                          return {
                                            ...r,
                                            matchedEmployeeId: undefined,
                                            matchedEmployeeNumber: undefined,
                                            canonicalName: r.employeeName,
                                            isNewEmployee: true,
                                            createProfile: true,
                                            createStatus: "Resigned",
                                            customSalary: 15000
                                          };
                                        }
                                        const selectedEmp = employees.find(emp => emp.id === val);
                                        if (!selectedEmp) return r;
                                        return {
                                          ...r,
                                          matchedEmployeeId: selectedEmp.id,
                                          matchedEmployeeNumber: selectedEmp.employeeNumber,
                                          canonicalName: selectedEmp.fullName,
                                          isNewEmployee: false,
                                          createProfile: false,
                                          customSalary: selectedEmp.salary || 15000
                                        };
                                      }));
                                    }}
                                    className="text-xs py-1 px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 font-semibold focus:ring-2 focus:ring-indigo-500 w-full max-w-[280px]"
                                  >
                                    <option value="NEW">+ Not in Staff List: Create 2025 Former Profile</option>
                                    <optgroup label="Link to Existing Employee (Canonical)">
                                      {employees.map(emp => (
                                        <option key={emp.id} value={emp.id}>
                                          {emp.fullName} (#{emp.employeeNumber || "N/A"})
                                        </option>
                                      ))}
                                    </optgroup>
                                  </select>
                                </div>

                                {row.isNewEmployee ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 w-fit">
                                    <UserPlus className="w-3 h-3" /> Creates 2025 Former Employee Profile
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 w-fit">
                                    <ShieldCheck className="w-3 h-3" /> Linked to {row.canonicalName} (#{row.matchedEmployeeNumber})
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Profile creation / 2025 Salary control */}
                            <td className="py-3 px-4">
                              {row.isNewEmployee ? (
                                <div className="space-y-1.5 font-mono text-[11px]">
                                  <div className="flex items-center gap-2">
                                    <select
                                      value={row.createStatus}
                                      onChange={(e) => {
                                        const val = e.target.value as "Resigned" | "Active";
                                        setParsedRows(prev => prev.map(r => r.employeeName === row.employeeName ? { ...r, createStatus: val } : r));
                                      }}
                                      className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 text-[10px] font-bold"
                                      title="Resigned keeps them from showing up on current 2026 daily punch cards"
                                    >
                                      <option value="Resigned">Former/2025 Staff (Resigned)</option>
                                      <option value="Active">Active Employee</option>
                                    </select>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-zinc-400">2025 Rate: ₱</span>
                                    <input
                                      type="number"
                                      value={row.customSalary}
                                      onChange={(e) => {
                                        const num = Number(e.target.value) || 0;
                                        setParsedRows(prev => prev.map(r => r.employeeName === row.employeeName ? { ...r, customSalary: num } : r));
                                      }}
                                      className="w-20 px-2 py-0.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded text-right font-bold text-emerald-600"
                                      placeholder="15000"
                                    />
                                    <span className="text-[9px] text-zinc-400">/mo</span>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-[11px] font-mono text-zinc-500 space-y-1">
                                  <span className="font-bold text-emerald-600">Rate: ₱{(row.customSalary || 0).toLocaleString()}/mo</span>
                                  <p className="text-[10px] text-zinc-400">No duplicate profile will be created</p>
                                </div>
                              )}
                            </td>

                            {/* Date columns */}
                            {parsedDates.map(date => {
                              const rec = row.records.find(r => r.date === date);
                              const st = rec ? rec.status : "Present";

                              const statusStyles: Record<string, string> = {
                                "Present": "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40",
                                "Birthday Leave": "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800/40",
                                "Paid Leave": "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400 border-purple-200 dark:border-purple-800/40",
                                "Absent": "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200 dark:border-rose-800/40",
                                "Rest Day": "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"
                              };

                              return (
                                <td key={date} className="py-3 px-2 text-center">
                                  <select
                                    value={st}
                                    onChange={(e) => handleCellStatusChange(row.employeeName, date, e.target.value)}
                                    className={`text-[10px] font-bold font-mono px-2 py-1 rounded-lg border cursor-pointer focus:outline-none ${statusStyles[st] || statusStyles["Present"]}`}
                                  >
                                    <option value="Present">Present (8 hrs)</option>
                                    <option value="Birthday Leave">Birthday</option>
                                    <option value="Paid Leave">Paid Leave</option>
                                    <option value="Absent">Absent</option>
                                    <option value="Rest Day">Rest Day</option>
                                  </select>
                                </td>
                              );
                            })}

                            {/* Total Hours */}
                            <td className="py-3 px-4 text-center font-mono font-bold text-zinc-900 dark:text-zinc-100">
                              {row.totalHours} hrs
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
            {parsedRows.length > 0 ? (
              <span>
                Selected: <strong className="text-indigo-600 dark:text-indigo-400">{selectedRowNames.size}</strong> of {parsedRows.length} employees ({selectedRowNames.size * parsedDates.length} logs ready with complete shift out)
              </span>
            ) : (
              <span>Ready to scan screenshot image or paste text</span>
            )}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              Cancel
            </button>

            {parsedRows.length > 0 && (
              <button
                type="button"
                onClick={handleCommitImport}
                disabled={isImporting || selectedRowNames.size === 0}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-600/20 disabled:opacity-50"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{importProgress || "Importing..."}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Commit &amp; Import to Attendance Ledger</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
