import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { DevotionSchedule, Employee } from "../types";
import { 
  X, 
  Download, 
  Copy, 
  Check, 
  Calendar, 
  Sparkles, 
  FileImage, 
  Printer, 
  Layers, 
  Settings2, 
  RefreshCw,
  PlusCircle,
  Eye,
  Sliders,
  Maximize2
} from "lucide-react";
import { addDaysToDateStr, isWeekendDateStr, ensureWeekdayDateStr } from "../utils/devotionScheduler";
import { db, setDoc, doc } from "../firebase";

interface DevotionLineupExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  schedules: DevotionSchedule[];
  employees: Employee[];
  todayStr: string;
  isAdmin: boolean;
  onScheduleUpdated?: () => void;
}

// Known mapping from full / partial employee names to standard studio lineup nicknames (from user screenshot)
const SHORT_NAME_MAP: Record<string, string> = {
  "pangan, joemarie": "JAO",
  "pangan, joemarie g": "JAO",
  "joemarie pangan": "JAO",
  "joemarie": "JAO",
  "jao": "JAO",
  "glorioso, jericho": "JERICHO",
  "jericho glorioso": "JERICHO",
  "jericho": "JERICHO",
  "roque, john cedric": "CEDRIC",
  "john cedric roque": "CEDRIC",
  "cedric": "CEDRIC",
  "laxa, israel": "ISRAEL",
  "laxa, israel p": "ISRAEL",
  "israel laxa": "ISRAEL",
  "israel": "ISRAEL",
  "mallari, herminio": "JR",
  "herminio mallari": "JR",
  "herminio": "JR",
  "jr": "JR",
  "sombillo, jermaine": "FRANKIE",
  "sombillo, jermaine f": "FRANKIE",
  "jermaine sombillo": "FRANKIE",
  "frankie": "FRANKIE",
  "cruz, aaron": "AARON",
  "cruz, aaron p": "AARON",
  "aaron cruz": "AARON",
  "aaron": "AARON",
  "cubol, roland": "ROLAND",
  "cubol, roland j": "ROLAND",
  "roland cubol": "ROLAND",
  "roland": "ROLAND",
  "taruc, rayvel": "RAYVEL",
  "taruc, rayvel m": "RAYVEL",
  "rayvel taruc": "RAYVEL",
  "rayvel": "RAYVEL",
  "gatus, mark lionel": "MARK",
  "mark lionel gatus": "MARK",
  "mark gatus": "MARK",
  "mark": "MARK",
  "daniel": "DANIEL",
  "raicen": "RAICEN",
};

// Polyfill for roundRect on 2D context
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

export default function DevotionLineupExportModal({
  isOpen,
  onClose,
  schedules,
  employees,
  todayStr,
  isAdmin,
  onScheduleUpdated
}: DevotionLineupExportModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Export controls (defaults to exact Canva reference screenshot format)
  const [layoutMode, setLayoutMode] = useState<"three_columns" | "two_columns" | "date_tagged">("three_columns");
  const [colorTheme, setColorTheme] = useState<"white_minimal" | "dark_luxury">("white_minimal");
  const [nameFormat, setNameFormat] = useState<"short" | "full">("short");
  const [shiftCount, setShiftCount] = useState<number>(20); // ~20 rows matches reference image
  const [includeDateSubtitle, setIncludeDateSubtitle] = useState<boolean>(true);
  const [customTitle, setCustomTitle] = useState<string>("Oligarch Media Devotion");

  // Status
  const [isDownloading, setIsDownloading] = useState(false);
  const [copiedSuccess, setCopiedSuccess] = useState(false);
  const [isGeneratingMore, setIsGeneratingMore] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>("");

  // Helper to format short names
  const getDisplayName = useCallback((fullName: string): string => {
    if (!fullName) return "—";
    if (nameFormat === "full") return fullName.toUpperCase();

    const normalized = fullName.trim().toLowerCase();
    if (SHORT_NAME_MAP[normalized]) {
      return SHORT_NAME_MAP[normalized];
    }

    const matchedEmp = employees.find(
      (e) =>
        e.fullName.toLowerCase() === normalized ||
        (e.id && e.id === fullName) ||
        (e.firstName && e.firstName.toLowerCase() === normalized)
    );
    if (matchedEmp?.firstName) {
      const matchShort = SHORT_NAME_MAP[matchedEmp.fullName.toLowerCase()] || SHORT_NAME_MAP[matchedEmp.firstName.toLowerCase()];
      if (matchShort) return matchShort;
      return matchedEmp.firstName.toUpperCase();
    }

    if (fullName.includes(",")) {
      const parts = fullName.split(",");
      if (parts[1]) {
        const firstWords = parts[1].trim().split(" ");
        if (firstWords.length > 1 && firstWords[1].length > 1) {
          return firstWords[1].toUpperCase();
        }
        return firstWords[0].toUpperCase();
      }
    }

    const words = fullName.trim().split(" ");
    return words[0].toUpperCase();
  }, [employees, nameFormat]);

  // Filter schedules to upcoming (from todayStr onwards, or all available)
  const sortedUpcoming = useMemo(() => {
    return [...schedules]
      .filter((s) => s.date >= todayStr && s.status !== "completed")
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [schedules, todayStr]);

  // Displayed rows based on shiftCount
  const displayedRows = useMemo(() => {
    if (shiftCount === 0) return sortedUpcoming;
    return sortedUpcoming.slice(0, shiftCount);
  }, [sortedUpcoming, shiftCount]);

  // Compute date range for subtitle
  const dateRangeLabel = useMemo(() => {
    if (displayedRows.length === 0) return "";
    const firstDate = displayedRows[0].date;
    const lastDate = displayedRows[displayedRows.length - 1].date;

    const formatShort = (dateStr: string) => {
      try {
        const [y, m, d] = dateStr.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      } catch {
        return dateStr;
      }
    };

    return `${formatShort(firstDate).toUpperCase()} – ${formatShort(lastDate).toUpperCase()} • NIGHT SHIFT 12:00 AM`;
  }, [displayedRows]);

  // Format date cell
  const formatDateCell = (dateStr: string) => {
    try {
      const [y, m, d] = dateStr.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      const weekday = dt.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
      const month = dt.toLocaleDateString(undefined, { month: "short" }).toUpperCase();
      return `${month} ${d} (${weekday})`;
    } catch {
      return dateStr;
    }
  };

  // =========================================================================
  // BULLETPROOF CANVAS 2D RENDERER (Ensures 100% of all rows are fully rendered)
  // =========================================================================
  const drawLineupOnCanvas = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Ensure fonts are loaded before painting
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (e) {
        // Continue even if font loading throws
      }
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isWhite = colorTheme === "white_minimal";
    const pixelRatio = 2; // 2x crisp retina resolution

    // Dimensions
    const logicalWidth = 720;
    const paddingX = 40;
    const contentWidth = logicalWidth - paddingX * 2; // 640px

    const paddingTop = 44;
    const titleHeight = 65;
    const subtitleHeight = includeDateSubtitle && dateRangeLabel ? 32 : 12;
    const colHeaderHeight = 44;
    const colHeaderGap = 12;
    
    // Row geometry
    const rowHeight = layoutMode === "date_tagged" ? 42 : 38;
    const rowGap = layoutMode === "date_tagged" ? 18 : 8;
    const totalRowsHeight = displayedRows.length > 0
      ? displayedRows.length * (rowHeight + rowGap)
      : 120;
    const footerHeight = 56;
    const paddingBottom = 40;

    const logicalHeight =
      paddingTop +
      titleHeight +
      subtitleHeight +
      colHeaderHeight +
      colHeaderGap +
      totalRowsHeight +
      footerHeight +
      paddingBottom;

    // Set canvas dimensions
    canvas.width = logicalWidth * pixelRatio;
    canvas.height = logicalHeight * pixelRatio;
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;

    // Scale for crisp retina
    ctx.save();
    ctx.scale(pixelRatio, pixelRatio);

    // 1. Draw Background
    ctx.fillStyle = isWhite ? "#FFFFFF" : "#0D1017";
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    // Optional subtle border
    if (!isWhite) {
      ctx.strokeStyle = "#1E293B";
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, logicalWidth, logicalHeight);
    }

    // 2. Draw Calligraphy Title ("Oligarch Media Devotion")
    const centerX = logicalWidth / 2;
    let currentY = paddingTop + 44;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Exact fluid cursive script font stack matching reference image
    ctx.font = "normal 54px 'Allura', 'Alex Brush', 'Great Vibes', 'Sacramento', cursive";
    ctx.fillStyle = isWhite ? "#111111" : "#F3F4F6";
    ctx.fillText(customTitle, centerX, currentY);

    // 3. Draw Subtitle (Date range or Shift note)
    currentY += 34;
    if (includeDateSubtitle && dateRangeLabel) {
      ctx.font = "bold 11px 'Plus Jakarta Sans', system-ui, sans-serif";
      ctx.letterSpacing = "1.5px";
      ctx.fillStyle = isWhite ? "#6B7280" : "#F59E0B";
      ctx.fillText(dateRangeLabel, centerX, currentY);
      currentY += 24;
    } else {
      currentY += 8;
    }

    // 4. Draw Column Headers
    const headerY = currentY;
    const colHeaderRadius = 8;
    ctx.font = "900 13px 'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.letterSpacing = "1.5px";

    if (layoutMode === "three_columns") {
      // 3 Columns: DATE (200px) | DEVOTION (214px) | PRAYER (214px)
      const gap = 10;
      const dateW = 190;
      const leaderW = (contentWidth - dateW - gap * 2) / 2;

      const dateX = paddingX;
      const devX = dateX + dateW + gap;
      const prayX = devX + leaderW + gap;

      // Date Header Box
      drawRoundRect(ctx, dateX, headerY, dateW, colHeaderHeight, colHeaderRadius);
      ctx.fillStyle = isWhite ? "#B0B0B0" : "#1E293B";
      ctx.fill();
      ctx.fillStyle = isWhite ? "#111111" : "#FFFFFF";
      ctx.fillText("DATE", dateX + dateW / 2, headerY + colHeaderHeight / 2);

      // Devotion Header Box
      drawRoundRect(ctx, devX, headerY, leaderW, colHeaderHeight, colHeaderRadius);
      ctx.fillStyle = isWhite ? "#B0B0B0" : "#1E293B";
      ctx.fill();
      ctx.fillStyle = isWhite ? "#111111" : "#FFFFFF";
      ctx.fillText("DEVOTION", devX + leaderW / 2, headerY + colHeaderHeight / 2);

      // Prayer Header Box
      drawRoundRect(ctx, prayX, headerY, leaderW, colHeaderHeight, colHeaderRadius);
      ctx.fillStyle = isWhite ? "#B0B0B0" : "#1E293B";
      ctx.fill();
      ctx.fillStyle = isWhite ? "#111111" : "#FFFFFF";
      ctx.fillText("PRAYER", prayX + leaderW / 2, headerY + colHeaderHeight / 2);

    } else {
      // 2 Columns: DEVOTION (314px) | PRAYER (314px) (Exact reference format)
      const gap = 12;
      const colW = (contentWidth - gap) / 2;
      const devX = paddingX;
      const prayX = devX + colW + gap;

      // Devotion Header Box
      drawRoundRect(ctx, devX, headerY, colW, colHeaderHeight, colHeaderRadius);
      ctx.fillStyle = isWhite ? "#B0B0B0" : "#1E293B";
      ctx.fill();
      ctx.fillStyle = isWhite ? "#111111" : "#FFFFFF";
      ctx.fillText("DEVOTION", devX + colW / 2, headerY + colHeaderHeight / 2);

      // Prayer Header Box
      drawRoundRect(ctx, prayX, headerY, colW, colHeaderHeight, colHeaderRadius);
      ctx.fillStyle = isWhite ? "#B0B0B0" : "#1E293B";
      ctx.fill();
      ctx.fillStyle = isWhite ? "#111111" : "#FFFFFF";
      ctx.fillText("PRAYER", prayX + colW / 2, headerY + colHeaderHeight / 2);
    }

    currentY = headerY + colHeaderHeight + colHeaderGap;

    // 5. Draw Every Row
    const pillRadius = 8;

    if (displayedRows.length === 0) {
      ctx.font = "italic 13px 'Plus Jakarta Sans', system-ui, sans-serif";
      ctx.fillStyle = isWhite ? "#9CA3AF" : "#64748B";
      ctx.fillText("No upcoming devotion schedules recorded.", centerX, currentY + 40);
      currentY += 80;
    } else {
      displayedRows.forEach((row, idx) => {
        const rowY = currentY + idx * (rowHeight + rowGap);
        const dateText = formatDateCell(row.date);

        const devName = getDisplayName(
          row.isAbsent && row.substituteDevotionLeaderName
            ? `${row.substituteDevotionLeaderName} (Sub)`
            : row.devotionLeaderName
        );
        const prayName = getDisplayName(
          row.isPrayerAbsent && row.substitutePrayerLeaderName
            ? `${row.substitutePrayerLeaderName} (Sub)`
            : row.prayerLeaderName
        );

        if (layoutMode === "three_columns") {
          const gap = 10;
          const dateW = 190;
          const leaderW = (contentWidth - dateW - gap * 2) / 2;

          const dateX = paddingX;
          const devX = dateX + dateW + gap;
          const prayX = devX + leaderW + gap;

          // Date Pill
          drawRoundRect(ctx, dateX, rowY, dateW, rowHeight, pillRadius);
          ctx.fillStyle = isWhite ? "#D4D4D8" : "#1A202C";
          ctx.fill();
          if (!isWhite) {
            ctx.strokeStyle = "#2D3748";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.font = "bold 11px 'JetBrains Mono', monospace";
          ctx.letterSpacing = "0.5px";
          ctx.fillStyle = isWhite ? "#27272A" : "#CBD5E1";
          ctx.fillText(dateText, dateX + dateW / 2, rowY + rowHeight / 2);

          // Devotion Leader Pill
          drawRoundRect(ctx, devX, rowY, leaderW, rowHeight, pillRadius);
          ctx.fillStyle = isWhite ? "#BDBDBD" : "#151A24";
          ctx.fill();
          if (!isWhite) {
            ctx.strokeStyle = "#283042";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.font = "900 13px 'Plus Jakarta Sans', system-ui, sans-serif";
          ctx.letterSpacing = "0.8px";
          ctx.fillStyle = isWhite ? "#111111" : "#FFFFFF";
          ctx.fillText(devName, devX + leaderW / 2, rowY + rowHeight / 2);

          // Prayer Leader Pill
          drawRoundRect(ctx, prayX, rowY, leaderW, rowHeight, pillRadius);
          ctx.fillStyle = isWhite ? "#BDBDBD" : "#151A24";
          ctx.fill();
          if (!isWhite) {
            ctx.strokeStyle = "#283042";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.font = "900 13px 'Plus Jakarta Sans', system-ui, sans-serif";
          ctx.letterSpacing = "0.8px";
          ctx.fillStyle = isWhite ? "#111111" : "#FFFFFF";
          ctx.fillText(prayName, prayX + leaderW / 2, rowY + rowHeight / 2);

        } else if (layoutMode === "date_tagged") {
          // 2 Columns with Date Badge above
          const gap = 12;
          const colW = (contentWidth - gap) / 2;
          const devX = paddingX;
          const prayX = devX + colW + gap;

          // Draw small date tag text above
          ctx.textAlign = "left";
          ctx.font = "bold 9px 'JetBrains Mono', monospace";
          ctx.letterSpacing = "1px";
          ctx.fillStyle = isWhite ? "#6B7280" : "#F59E0B";
          ctx.fillText(`ROW ${idx + 1} • ${dateText}`, devX + 2, rowY - 5);
          ctx.textAlign = "center";

          // Devotion Leader Pill
          drawRoundRect(ctx, devX, rowY, colW, rowHeight, pillRadius);
          ctx.fillStyle = isWhite ? "#BDBDBD" : "#151A24";
          ctx.fill();
          if (!isWhite) {
            ctx.strokeStyle = "#283042";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.font = "900 13px 'Plus Jakarta Sans', system-ui, sans-serif";
          ctx.letterSpacing = "0.8px";
          ctx.fillStyle = isWhite ? "#111111" : "#FFFFFF";
          ctx.fillText(devName, devX + colW / 2, rowY + rowHeight / 2);

          // Prayer Leader Pill
          drawRoundRect(ctx, prayX, rowY, colW, rowHeight, pillRadius);
          ctx.fillStyle = isWhite ? "#BDBDBD" : "#151A24";
          ctx.fill();
          if (!isWhite) {
            ctx.strokeStyle = "#283042";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.font = "900 13px 'Plus Jakarta Sans', system-ui, sans-serif";
          ctx.letterSpacing = "0.8px";
          ctx.fillStyle = isWhite ? "#111111" : "#FFFFFF";
          ctx.fillText(prayName, prayX + colW / 2, rowY + rowHeight / 2);

        } else {
          // Standard 2 Columns (Exact Reference Screenshot match)
          const gap = 12;
          const colW = (contentWidth - gap) / 2;
          const devX = paddingX;
          const prayX = devX + colW + gap;

          // Devotion Leader Pill
          drawRoundRect(ctx, devX, rowY, colW, rowHeight, pillRadius);
          ctx.fillStyle = isWhite ? "#BDBDBD" : "#151A24";
          ctx.fill();
          if (!isWhite) {
            ctx.strokeStyle = "#283042";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.font = "900 13px 'Plus Jakarta Sans', system-ui, sans-serif";
          ctx.letterSpacing = "0.8px";
          ctx.fillStyle = isWhite ? "#111111" : "#FFFFFF";
          ctx.fillText(devName, devX + colW / 2, rowY + rowHeight / 2);

          // Prayer Leader Pill
          drawRoundRect(ctx, prayX, rowY, colW, rowHeight, pillRadius);
          ctx.fillStyle = isWhite ? "#BDBDBD" : "#151A24";
          ctx.fill();
          if (!isWhite) {
            ctx.strokeStyle = "#283042";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.font = "900 13px 'Plus Jakarta Sans', system-ui, sans-serif";
          ctx.letterSpacing = "0.8px";
          ctx.fillStyle = isWhite ? "#111111" : "#FFFFFF";
          ctx.fillText(prayName, prayX + colW / 2, rowY + rowHeight / 2);
        }
      });

      currentY += displayedRows.length * (rowHeight + rowGap);
    }

    // 6. Draw Footer Branding
    currentY += 20;
    ctx.strokeStyle = isWhite ? "#E5E7EB" : "#1E293B";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingX, currentY);
    ctx.lineTo(logicalWidth - paddingX, currentY);
    ctx.stroke();

    currentY += 20;
    ctx.textAlign = "center";
    ctx.font = "bold 10px 'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.letterSpacing = "1.5px";
    ctx.fillStyle = isWhite ? "#9CA3AF" : "#64748B";
    ctx.fillText(
      "OLIGARCH MEDIA GRAPHIC DESIGN STUDIO • SPIRITUAL MINISTRY & FELLOWSHIP",
      centerX,
      currentY
    );

    ctx.restore();

    // Update live preview URL
    try {
      const url = canvas.toDataURL("image/png");
      setImagePreviewUrl(url);
    } catch (e) {
      // Ignored
    }
  }, [
    colorTheme,
    customTitle,
    dateRangeLabel,
    displayedRows,
    getDisplayName,
    includeDateSubtitle,
    layoutMode
  ]);

  // Redraw whenever configuration or schedule rows change
  useEffect(() => {
    if (isOpen) {
      drawLineupOnCanvas();
    }
  }, [isOpen, drawLineupOnCanvas]);

  // Download high-res PNG image directly from the Canvas
  const handleDownloadImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDownloading(true);

    try {
      // Ensure canvas is fully painted
      await drawLineupOnCanvas();

      const dataUrl = canvas.toDataURL("image/png");
      const firstDate = displayedRows[0]?.date || "advance";
      const lastDate = displayedRows[displayedRows.length - 1]?.date || "lineup";
      const fileName = `Oligarch_Media_Devotion_Lineup_${firstDate}_to_${lastDate}.png`;

      const link = document.createElement("a");
      link.download = fileName;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to download devotion lineup image:", err);
      alert("Could not generate image. Please try again or use the print option.");
    } finally {
      setIsDownloading(false);
    }
  };

  // Copy Image to Clipboard directly from Canvas
  const handleCopyImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDownloading(true);

    try {
      await drawLineupOnCanvas();

      canvas.toBlob(async (blob) => {
        if (blob && navigator.clipboard && window.ClipboardItem) {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob })
            ]);
            setCopiedSuccess(true);
            setTimeout(() => setCopiedSuccess(false), 3000);
          } catch (e) {
            handleDownloadImage();
          }
        } else {
          handleDownloadImage();
        }
        setIsDownloading(false);
      }, "image/png");
    } catch (err) {
      console.warn("Direct clipboard copy failed, downloading instead:", err);
      handleDownloadImage();
      setIsDownloading(false);
    }
  };

  // Quick helper: Generate advance days if fewer than desired rows exist
  const handleGenerateAdvanceDays = async () => {
    if (employees.length < 2) {
      alert("At least 2 active employees are needed to generate schedules.");
      return;
    }
    setIsGeneratingMore(true);
    try {
      const activeEmps = employees.filter((e) => (e.status || "Active") === "Active");
      const names = activeEmps.map((e) => e.fullName.trim());

      let lastDate = sortedUpcoming.length > 0 
        ? sortedUpcoming[sortedUpcoming.length - 1].date 
        : ensureWeekdayDateStr(todayStr);

      const daysToAdd = 10;
      let currIndex = sortedUpcoming.length % names.length;

      for (let i = 0; i < daysToAdd; i++) {
        lastDate = addDaysToDateStr(lastDate, 1, true); // strictly weekday
        const devName = names[(currIndex + i) % names.length];
        const prayName = names[(currIndex + i + 1) % names.length];

        const newDoc: Partial<DevotionSchedule> = {
          id: lastDate,
          date: lastDate,
          devotionLeaderName: devName,
          prayerLeaderName: prayName,
          status: "upcoming",
          topic: "Daily Devotion & Shift Alignment",
          scripture: "Philippians 4:6-7",
          notes: "Advance Lineup Roster",
          isAbsent: false,
          isPrayerAbsent: false,
          updatedAt: new Date().toISOString(),
          updatedBy: "Admin Advance Generator"
        };

        await setDoc(doc(db, "devotion_schedules", lastDate), newDoc, { merge: true });
      }

      if (onScheduleUpdated) onScheduleUpdated();
    } catch (err) {
      console.error("Error generating advance devotion days:", err);
    } finally {
      setIsGeneratingMore(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[95vh] overflow-hidden print:border-none print:shadow-none print:max-h-none print:w-full">
        
        {/* Top Header / Modal Bar (Hidden on print) */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/90 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-xs">
              <FileImage className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white tracking-tight">
                  Download Advance Devotion Lineup Image
                </h3>
                <span className="px-2 py-0.5 rounded text-[9px] font-mono font-extrabold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Admin Exclusive
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Generate and download high-resolution graphic rosters matching official studio Canva format to share in advance with team members.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main Body: Left Controls, Right Live Preview */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 print:p-0 print:block">
          
          {/* Controls Panel (Hidden when printing) */}
          <div className="lg:col-span-4 space-y-4 print:hidden">
            <div className="p-4 bg-slate-950/60 border border-slate-800/90 rounded-2xl space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-mono font-bold uppercase text-slate-400 flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5 text-amber-400" />
                  Lineup Format & Options
                </span>
              </div>

              {/* Layout Mode */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider block">
                  Column Layout
                </label>
                <div className="grid grid-cols-1 gap-1.5 text-xs font-mono">
                  <button
                    type="button"
                    onClick={() => setLayoutMode("three_columns")}
                    className={`p-2 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                      layoutMode === "three_columns"
                        ? "bg-amber-500/15 border-amber-500/50 text-white font-bold"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>3 Columns (Date | Devotion | Prayer)</span>
                    {layoutMode === "three_columns" && <Check className="w-3.5 h-3.5 text-amber-400" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setLayoutMode("two_columns")}
                    className={`p-2 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                      layoutMode === "two_columns"
                        ? "bg-amber-500/15 border-amber-500/50 text-white font-bold"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>2 Columns (Exact Reference Screenshot)</span>
                    {layoutMode === "two_columns" && <Check className="w-3.5 h-3.5 text-amber-400" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setLayoutMode("date_tagged")}
                    className={`p-2 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                      layoutMode === "date_tagged"
                        ? "bg-amber-500/15 border-amber-500/50 text-white font-bold"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>2 Columns with Date Badge Headers</span>
                    {layoutMode === "date_tagged" && <Check className="w-3.5 h-3.5 text-amber-400" />}
                  </button>
                </div>
              </div>

              {/* Theme Selection */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider block">
                  Canvas Style
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <button
                    type="button"
                    onClick={() => setColorTheme("white_minimal")}
                    className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                      colorTheme === "white_minimal"
                        ? "bg-white text-slate-900 font-black border-white shadow-md"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    White Paper (Reference)
                  </button>
                  <button
                    type="button"
                    onClick={() => setColorTheme("dark_luxury")}
                    className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                      colorTheme === "dark_luxury"
                        ? "bg-slate-800 text-amber-300 font-black border-amber-500/50 shadow-md"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    Studio Dark (Night Shift)
                  </button>
                </div>
              </div>

              {/* Name Format */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider block">
                  Name Display
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <button
                    type="button"
                    onClick={() => setNameFormat("short")}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      nameFormat === "short"
                        ? "bg-indigo-600 text-white font-bold border-indigo-500"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    Short (JR, CEDRIC, AARON)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNameFormat("full")}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      nameFormat === "full"
                        ? "bg-indigo-600 text-white font-bold border-indigo-500"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    Full Names
                  </button>
                </div>
              </div>

              {/* Number of Shifts */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                    Number of Shifts
                  </label>
                  <span className="text-xs font-mono text-amber-400 font-bold">
                    {shiftCount === 0 ? "All Available" : `${shiftCount} shifts`}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 text-xs font-mono">
                  {[10, 15, 20, 0].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setShiftCount(count)}
                      className={`py-1.5 rounded-lg border text-center transition-all cursor-pointer ${
                        shiftCount === count
                          ? "bg-indigo-600 text-white font-bold border-indigo-500"
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      {count === 0 ? "All" : `${count}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date subtitle toggle */}
              <label className="flex items-center gap-2 pt-1 text-xs text-slate-300 font-mono cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeDateSubtitle}
                  onChange={(e) => setIncludeDateSubtitle(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0"
                />
                <span>Include Date Range Banner</span>
              </label>

              {/* Advance generation button if rows are limited */}
              {displayedRows.length < 15 && (
                <div className="pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={handleGenerateAdvanceDays}
                    disabled={isGeneratingMore}
                    className="w-full py-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-mono font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {isGeneratingMore ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Generating Advance Days...</span>
                      </>
                    ) : (
                      <>
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>Add +10 More Advance Shifts</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Quick Action Buttons */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={handleDownloadImage}
                disabled={isDownloading || displayedRows.length === 0}
                className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs sm:text-sm font-black font-mono transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                {isDownloading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Saving High-Res Image...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download High-Res PNG</span>
                  </>
                )}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleCopyImage}
                  disabled={isDownloading || displayedRows.length === 0}
                  className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-mono font-bold transition-all flex items-center justify-center gap-1.5 border border-slate-700 cursor-pointer disabled:opacity-50"
                  title="Copy to clipboard for instant pasting into Telegram/WhatsApp/Messenger"
                >
                  {copiedSuccess ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied Image!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Image</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-mono font-bold transition-all flex items-center justify-center gap-1.5 border border-slate-700 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print PDF</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Preview Viewport (The rendered Canvas) */}
          <div className="lg:col-span-8 flex flex-col items-center justify-start overflow-auto">
            <div className="w-full text-center pb-2 text-[11px] font-mono text-slate-400 flex items-center justify-between print:hidden">
              <span className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-amber-400" />
                Live Generated PNG Image Preview
              </span>
              <span>{displayedRows.length} shifts rendered</span>
            </div>

            {/* THE PRINTABLE / EXPORTABLE CANVAS VIEWPORT */}
            <div className="w-full overflow-x-auto pb-6 flex justify-center">
              <canvas
                ref={canvasRef}
                id="devotion-lineup-canvas"
                className="max-w-full rounded-2xl shadow-2xl transition-all border border-slate-800/80"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
