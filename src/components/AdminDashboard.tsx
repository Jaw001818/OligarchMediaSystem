import React, { useState, useEffect, useMemo } from "react";
import { 
  Users, 
  Calendar, 
  Clock, 
  TrendingUp, 
  AlertCircle, 
  Heart,
  Smile,
  ShieldCheck,
  CheckCircle,
  BarChart4,
  Download,
  Printer,
  Search,
  Building2,
  Coins,
  FileSpreadsheet,
  Award,
  Megaphone,
  Trash2,
  Plus,
  Send,
  Pencil,
  Archive,
  CheckCircle2,
  XCircle,
  Inbox,
  Filter,
  Check,
  X,
  ChevronRight,
  CalendarDays,
  ExternalLink,
  FileText,
  Sparkles,
  Smartphone,
  UserCheck,
  UserX,
  AlertTriangle,
  Layers,
  MessageSquare,
  Activity,
  Coffee,
  Radio,
  Zap
} from "lucide-react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  PieChart, 
  Pie, 
  Cell
} from "recharts";
import { Employee, Attendance, LeaveRequest, Payroll, AppSettings, Announcement, PayrollPeriod, AttendanceCopyRequest } from "../types";
import { calculateAttendanceHours, calculateLateMinutes, formatTo12Hour, sendNotificationEmail, getBusinessDate, getEmployeeSchedule, getBirthdayWeekInfo, getScheduleTimesForLog } from "../utils";
import { db, collection, getDocs, addDoc, doc, deleteDoc, updateDoc, onSnapshot } from "../firebase";

interface DashboardProps {
  employees: Employee[];
  attendance: Attendance[];
  requests: LeaveRequest[];
  payrolls: Payroll[];
  periods?: PayrollPeriod[];
  setCurrentTab: (tab: string) => void;
  settings?: AppSettings;
}

export default function AdminDashboard({
  employees,
  attendance,
  requests,
  payrolls,
  periods = [],
  setCurrentTab,
  settings
}: DashboardProps) {
  const [time, setTime] = useState(new Date());
  const [activeSubTab, setActiveSubTab] = useState<"overview" | "overtime" | "announcements" | "pending_tasks">("overview");

  // Mobile HR Tasks & Approvals View States
  const [mobileHrFilter, setMobileHrFilter] = useState<"all" | "leaves" | "attendance_copy" | "today">("all");
  const [mobileHrSearch, setMobileHrSearch] = useState("");
  const [attendanceCopyRequests, setAttendanceCopyRequests] = useState<AttendanceCopyRequest[]>([]);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [mobileAdminNotes, setMobileAdminNotes] = useState<{ [id: string]: string }>({});

  // Announcements State
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annTitle, setAnnTitle] = useState("");
  const [annMessage, setAnnMessage] = useState("");
  const [pubDate, setPubDate] = useState(() => getBusinessDate());
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([]);
  const [mentionSearch, setMentionSearch] = useState("");
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionTriggerIndex, setMentionTriggerIndex] = useState(-1);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  // Custom visual state for non-blocking confirmation dialog & success alerts (fixes iframe issues)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmTitle, setDeleteConfirmTitle] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"success" | "error" | "info">("success");

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToastMessage(message);
    setToastType(type);
    setTimeout(() => {
      setToastMessage((prev) => prev === message ? null : prev);
    }, 4500);
  };

  const fetchAnnouncements = async () => { /* Replaced by listener */ };
  
  useEffect(() => {
    setLoadingAnnouncements(true);
    const unsub = onSnapshot(collection(db, "announcements"), (snap) => {
      const list: Announcement[] = [];
      snap.forEach(d => {
        list.push({ ...d.data(), id: d.id } as Announcement);
      });
      list.sort((a, b) => {
        const dateA = a.publicationDate || a.createdAt;
        const dateB = b.publicationDate || b.createdAt;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });
      setAnnouncements(list);
      setLoadingAnnouncements(false);
    });

    // Real-time listener for attendance copy requests
    const unsubAttCopy = onSnapshot(collection(db, "attendance_copy_requests"), (snap) => {
      const list: AttendanceCopyRequest[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as AttendanceCopyRequest);
      });
      list.sort((a, b) => new Date(b.submittedAt || "").getTime() - new Date(a.submittedAt || "").getTime());
      setAttendanceCopyRequests(list);
    });

    return () => {
      unsub();
      unsubAttCopy();
    };
  }, []);

  const displayedAnnouncements = useMemo(() => {
    if (showArchived) {
      return announcements;
    }
    return announcements.filter((a) => !a.isArchived);
  }, [announcements, showArchived]);

  const handleToggleArchiveAnnouncement = async (bulletin: Announcement) => {
    if (!bulletin.id) return;
    try {
      const newArchivedState = !bulletin.isArchived;
      await updateDoc(doc(db, "announcements", bulletin.id), {
        isArchived: newArchivedState,
      });

      // Add audit log
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: newArchivedState ? "Archived Announcement" : "Unarchived Announcement",
        details: `${newArchivedState ? "Archived" : "Unarchived"} company bulletin: "${bulletin.title}"`,
        timestamp: new Date().toISOString()
      });

      showToast(newArchivedState ? "Announcement archived successfully." : "Announcement unarchived successfully.", "success");
      fetchAnnouncements();
    } catch (err) {
      console.error(err);
      showToast("Failed to change archive status.", "error");
    }
  };

  useEffect(() => {
    if (activeSubTab === "announcements") {
      fetchAnnouncements();
    }
  }, [activeSubTab]);

  const handleStartEditAnnouncement = (bulletin: Announcement) => {
    setEditingAnnId(bulletin.id || null);
    setAnnTitle(bulletin.title);
    setAnnMessage(bulletin.message);
    if (bulletin.publicationDate) {
      setPubDate(bulletin.publicationDate);
    } else if (bulletin.createdAt) {
      setPubDate(bulletin.createdAt.split("T")[0]);
    }
    setSelectedMentionIds(bulletin.mentionedEmployeeIds || []);
    setMentionSearch("");
  };

  const handleCancelEditAnnouncement = () => {
    setEditingAnnId(null);
    setAnnTitle("");
    setAnnMessage("");
    setPubDate(getBusinessDate());
    setSelectedMentionIds([]);
    setMentionSearch("");
  };

  const notifyMentionedEmployees = async (employeeIds: string[], title: string, message: string) => {
    const promises = employeeIds.map(async (empId) => {
      const employee = employees.find((e) => e.id === empId);
      if (!employee) return;

      await addDoc(collection(db, "notifications"), {
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        title: "Mentioned in Announcement",
        message: `You were tagged/mentioned in: "${title.trim()}" by Admin. "${message.substring(0, 100)}..."`,
        type: "Mention",
        read: false,
        createdAt: new Date().toISOString()
      });

      if (employee.email) {
        const emailSubject = `[Oligarch Media] You were tagged in an Announcement: "${title.trim()}"`;
        const emailHtml = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 25px; border: 1px solid #e4e4e7; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
            <div style="text-align: center; margin-bottom: 20px;">
              <span style="font-size: 40px;">📢</span>
            </div>
            <h2 style="color: #4f46e5; margin-top: 0; font-weight: 800; font-size: 22px; text-align: center;">You've Been Mentioned!</h2>
            <p style="color: #3f3f46; font-size: 14px; line-height: 1.6;">Hi <strong>${employee.fullName}</strong>,</p>
            <p style="color: #3f3f46; font-size: 14px; line-height: 1.6;">An administrator has explicitly tagged you in a newly published announcement/bulletin:</p>
            
            <div style="background-color: #f8fafc; border-left: 4px solid #4f46e5; padding: 18px; margin: 24px 0; border-radius: 8px; border: 1px solid #e2e8f0; border-left-width: 4px;">
              <h3 style="margin: 0 0 8px 0; color: #0f172a; font-size: 16px; font-weight: 700;">${title.trim()}</h3>
              <p style="margin: 0; color: #64748b; font-size: 11px; font-family: monospace; text-transform: uppercase;">Publication Date: ${pubDate}</p>
              <div style="margin-top: 12px; color: #334155; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${message.trim()}</div>
            </div>
            
            <div style="text-align: center; margin-top: 28px;">
              <a href="${window.location.origin}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block;">Open Employee Portal</a>
            </div>
            
            <p style="color: #94a3b8; font-size: 11px; line-height: 1.5; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center;">
              This is an automated notification. Please do not reply directly to this email.
            </p>
          </div>
        `;
        try {
          await sendNotificationEmail(employee.email, emailSubject, emailHtml);
        } catch (emailErr) {
          console.error("Nodemailer failed to dispatch mention email:", emailErr);
        }
      }
    });

    await Promise.all(promises);
  };

  const parseMentionsFromText = (text: string, allEmployees: Employee[]): string[] => {
    const detectedIds = new Set<string>();
    const lowerText = text.toLowerCase();
    
    allEmployees.forEach((emp) => {
      if (!emp.id) return;
      const fullName = emp.fullName.trim();
      const lowerFullName = fullName.toLowerCase();
      
      // 1. Direct check for @FullName
      if (lowerText.includes(`@${lowerFullName}`)) {
        detectedIds.add(emp.id);
        return;
      }

      // Check without punctuation just in case
      const cleanFullName = lowerFullName.replace(/[,.]/g, "");
      if (lowerText.includes(`@${cleanFullName}`)) {
        detectedIds.add(emp.id);
        return;
      }
      
      // 2. Check for @FirstName, e.g. @Mark
      const parts = fullName.split(/\s+/);
      const firstWord = parts[0]?.replace(/[,.]/g, "").trim().toLowerCase();
      if (firstWord && firstWord.length > 1) {
        const escapedFirstWord = firstWord.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`@${escapedFirstWord}\\b`, "i");
        if (regex.test(lowerText)) {
          detectedIds.add(emp.id);
          return;
        }
      }

      // 3. Check for @LastName or other parts of name
      for (const part of parts) {
        const cleanPart = part.replace(/[,.]/g, "").trim().toLowerCase();
        if (cleanPart && cleanPart.length > 2) {
          const escapedPart = cleanPart.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`@${escapedPart}\\b`, "i");
          if (regex.test(lowerText)) {
            detectedIds.add(emp.id);
            break;
          }
        }
      }
    });

    return Array.from(detectedIds);
  };

  const handleSendAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annMessage.trim() || !pubDate) {
      showToast("Please fill in all required fields (Title, Content, and Publication Date).", "error");
      return;
    }
    setIsBroadcasting(true);
    try {
      // Auto-detect typed @mentions and combine with selected list
      const autoDetectedIds = parseMentionsFromText(annMessage, employees);
      const combinedMentionIds = Array.from(new Set([...selectedMentionIds, ...autoDetectedIds]));

      const mentionedNames = employees
        .filter((emp) => combinedMentionIds.includes(emp.id || ""))
        .map((emp) => emp.fullName);

      if (editingAnnId) {
        // Edit existing announcement
        try {
          await updateDoc(doc(db, "announcements", editingAnnId), {
            title: annTitle.trim(),
            message: annMessage.trim(),
            publicationDate: pubDate,
            mentionedEmployeeIds: combinedMentionIds,
            mentionedEmployeeNames: mentionedNames
          });

          // Add audit log
          await addDoc(collection(db, "audit_logs"), {
            user: "Admin",
            action: "Edited Public Announcement",
            details: `Edited company bulletin: "${annTitle.trim()}" set for ${pubDate}`,
            timestamp: new Date().toISOString()
          });

          // Dispatch system notification
          await addDoc(collection(db, "notifications"), {
            title: "Announcement Edited",
            message: `Corporate announcement "${annTitle.trim()}" has been updated.`,
            type: "System",
            read: false,
            createdAt: new Date().toISOString()
          });

          // If there are mentions, trigger notifications & emails
          if (combinedMentionIds.length > 0) {
            await notifyMentionedEmployees(combinedMentionIds, annTitle, annMessage);
          }

          setEditingAnnId(null);
          setAnnTitle("");
          setAnnMessage("");
          setSelectedMentionIds([]);
          setMentionSearch("");
          showToast("Announcement updated successfully.", "success");
        } catch (updateErr: any) {
          const errMsg = updateErr?.message || "";
          if (errMsg.includes("No document to update") || errMsg.includes("not-found") || errMsg.includes("NOT_FOUND") || updateErr?.code === "not-found") {
            console.warn("Announcement document not found, falling back to creating as a new one:", updateErr);
            
            const payload = {
              title: annTitle.trim(),
              message: annMessage.trim(),
              publicationDate: pubDate,
              createdAt: new Date().toISOString(),
              sender: "Oligarch Admin",
              mentionedEmployeeIds: combinedMentionIds,
              mentionedEmployeeNames: mentionedNames
            };
            await addDoc(collection(db, "announcements"), payload);
            
            // Add audit log
            await addDoc(collection(db, "audit_logs"), {
              user: "Admin",
              action: "Created Public Announcement (Fallback)",
              details: `Published fallback company bulletin: "${annTitle.trim()}" set for ${pubDate}`,
              timestamp: new Date().toISOString()
            });

            // Dispatch system notification
            await addDoc(collection(db, "notifications"), {
              title: "Announcement Published (Fallback)",
              message: `New fallback corporate announcement "${annTitle.trim()}" has been published.`,
              type: "System",
              read: false,
              createdAt: new Date().toISOString()
            });

            // Trigger notifications and emails for mentioned employees
            if (combinedMentionIds.length > 0) {
              await notifyMentionedEmployees(combinedMentionIds, annTitle, annMessage);
            }

            setEditingAnnId(null);
            setAnnTitle("");
            setAnnMessage("");
            setSelectedMentionIds([]);
            setMentionSearch("");
            showToast("Original announcement was deleted. Created a new announcement with your edits.", "info");
          } else {
            throw updateErr;
          }
        }
      } else {
        // Create new announcement
        const payload: Omit<Announcement, "id"> & { publicationDate: string } = {
          title: annTitle.trim(),
          message: annMessage.trim(),
          publicationDate: pubDate,
          createdAt: new Date().toISOString(),
          sender: "Oligarch Admin",
          mentionedEmployeeIds: combinedMentionIds,
          mentionedEmployeeNames: mentionedNames
        };
        await addDoc(collection(db, "announcements"), payload);
        
        // Add audit log
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Published Public Announcement",
          details: `Published company bulletin: "${annTitle.trim()}" set for ${pubDate}`,
          timestamp: new Date().toISOString()
        });

        // Dispatch system notification
        await addDoc(collection(db, "notifications"), {
          title: "Announcement Sent",
          message: `Corporate announcement "${annTitle.trim()}" is now published.`,
          type: "System",
          read: false,
          createdAt: new Date().toISOString()
        });

        // Trigger notifications and emails for mentioned employees
        if (combinedMentionIds.length > 0) {
          await notifyMentionedEmployees(combinedMentionIds, annTitle, annMessage);
        }

        setAnnTitle("");
        setAnnMessage("");
        setSelectedMentionIds([]);
        setMentionSearch("");
        showToast("Announcement successfully published and tagged employees notified.", "success");
      }
      fetchAnnouncements();
    } catch (err) {
      console.error(err);
      showToast(editingAnnId ? "Failed to update announcement." : "Failed to publish announcement.", "error");
    } finally {
      setIsBroadcasting(false);
    }
  };

  const handleDeleteAnnouncement = (id: string, title: string) => {
    // Instead of blocked window.confirm, trigger our custom modal!
    setDeleteConfirmId(id);
    setDeleteConfirmTitle(title);
  };

  const executeDeleteAnnouncement = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteDoc(doc(db, "announcements", deleteConfirmId));
      
      try {
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Deleted Announcement",
          details: `Deleted company bulletin: "${deleteConfirmTitle}"`,
          timestamp: new Date().toISOString()
        });
      } catch (auditErr) {
        console.warn("Audit log failed on delete", auditErr);
      }

      showToast("Announcement deleted successfully.", "success");
      fetchAnnouncements();
    } catch (err) {
      console.error(err);
      showToast("Failed to delete announcement.", "error");
    } finally {
      setDeleteConfirmId(null);
      setDeleteConfirmTitle("");
    }
  };

  // -------------------------------------------------------------
  // MOBILE-FRIENDLY ONE-TOUCH HR ACTIONS & LEAVE APPROVALS
  // -------------------------------------------------------------

  // Quick Approve Leave Request
  const handleMobileApproveLeave = async (req: LeaveRequest) => {
    if (!req.id) return;
    setProcessingRequestId(req.id);

    const adminFeedback = mobileAdminNotes[req.id] || "Approved via Mobile HR Action Desk.";
    const employee = employees.find((e) => 
      (e.id && req.employeeId && e.id === req.employeeId) || 
      (e.employeeNumber && req.employeeNumber && e.employeeNumber.trim().toLowerCase() === req.employeeNumber.trim().toLowerCase())
    );

    // If Birthday Leave, check official company policy (must be birthday week)
    let bdayInfo: any = null;
    if (req.type === "Birthday Leave") {
      if (!employee?.birthday) {
        showToast(`Cannot Approve: ${req.employeeName} has no registered birthday in profile.`, "error");
        setProcessingRequestId(null);
        return;
      }
      bdayInfo = getBirthdayWeekInfo(employee.birthday, req.startDate);
      if (!bdayInfo.isValid) {
        showToast(`Cannot Approve: Invalid birthday format for ${req.employeeName}.`, "error");
        setProcessingRequestId(null);
        return;
      }
      if (!bdayInfo.isInBirthdayWeek(req.startDate)) {
        showToast(`Birthday Leave must be taken during the official birthday week (${bdayInfo.weekStartMondayStr} to ${bdayInfo.weekEndFridayStr}).`, "error");
        setProcessingRequestId(null);
        return;
      }
    }

    try {
      // 1. Update leave request document
      const docRef = doc(db, "leave_requests", req.id);
      await updateDoc(docRef, {
        status: "Approved",
        adminNotes: adminFeedback,
        approvedAt: new Date().toISOString()
      });

      // 2. Automatically record/update attendance credits
      if (req.startDate) {
        try {
          const startD = new Date(req.startDate);
          const endD = new Date(req.endDate || req.startDate);
          const attSnap = await getDocs(collection(db, "attendance"));
          
          for (let cur = new Date(startD); cur <= endD; cur.setDate(cur.getDate() + 1)) {
            const curStr = cur.toISOString().split("T")[0];
            let existingId: string | null = null;
            
            attSnap.forEach(d => {
              const data = d.data();
              if (data.date === curStr) {
                const matchId = req.employeeId && data.employeeId === req.employeeId;
                const matchNum = req.employeeNumber && data.employeeNumber === req.employeeNumber;
                const matchName = req.employeeName && data.employeeName && data.employeeName.trim().toLowerCase() === req.employeeName.trim().toLowerCase();
                if (matchId || matchNum || matchName) {
                  existingId = d.id;
                }
              }
            });

            const targetHours = req.type === "Absent Notice" ? 0 : 8;
            const targetStatus = req.type === "Birthday Leave" 
              ? "Birthday Leave" 
              : req.type === "Paid Leave" 
              ? "Paid Leave" 
              : "Absent";
            
            const noteText = req.type === "Birthday Leave"
              ? `Approved Birthday Leave (${bdayInfo?.birthdayFormatted || "Birthday"})`
              : `Approved ${req.type} Credit`;

            if (existingId) {
              await updateDoc(doc(db, "attendance", existingId), {
                status: targetStatus,
                hoursWorked: targetHours,
                notes: noteText
              });
            } else {
              await addDoc(collection(db, "attendance"), {
                employeeId: req.employeeId || employee?.id || "",
                employeeNumber: req.employeeNumber || employee?.employeeNumber || "",
                employeeName: req.employeeName,
                date: curStr,
                timeIn: "00:00",
                timeOut: "00:00",
                status: targetStatus,
                hoursWorked: targetHours,
                notes: noteText
              });
            }
          }
        } catch (attErr) {
          console.warn("Attendance sync error on leave approval:", attErr);
        }
      }

      // 3. Audit log
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin (Mobile Desk)",
        action: "Approved Leave Request",
        details: `Approved ${req.type} for ${req.employeeName} (${req.startDate} to ${req.endDate || req.startDate})`,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      // 4. Notification
      await addDoc(collection(db, "notifications"), {
        title: "Leave Request Approved",
        message: `Your ${req.type} for ${req.startDate} to ${req.endDate || req.startDate} has been approved by HR.`,
        type: "Leave",
        employeeId: req.employeeId,
        read: false,
        createdAt: new Date().toISOString()
      }).catch(() => {});

      // 5. Email
      if (employee?.email) {
        sendNotificationEmail(
          employee.email,
          `[APPROVED] ${req.type} Request - Oligarch Media`,
          `<div style="font-family: sans-serif; padding: 20px;"><h3 style="color:#10b981;">Leave Request Approved</h3><p>Hi ${req.employeeName},</p><p>Your <strong>${req.type}</strong> from <strong>${req.startDate}</strong> to <strong>${req.endDate || req.startDate}</strong> has been approved.</p><p><strong>Admin Note:</strong> ${adminFeedback}</p></div>`
        ).catch(() => {});
      }

      showToast(`Approved ${req.type} for ${req.employeeName}!`, "success");
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Failed to approve leave.", "error");
    } finally {
      setProcessingRequestId(null);
    }
  };

  // Quick Reject Leave Request
  const handleMobileRejectLeave = async (req: LeaveRequest) => {
    if (!req.id) return;
    setProcessingRequestId(req.id);

    const adminFeedback = mobileAdminNotes[req.id] || "Request declined by HR Administration.";
    const employee = employees.find((e) => 
      (e.id && req.employeeId && e.id === req.employeeId) || 
      (e.employeeNumber && req.employeeNumber && e.employeeNumber.trim().toLowerCase() === req.employeeNumber.trim().toLowerCase())
    );

    try {
      const docRef = doc(db, "leave_requests", req.id);
      await updateDoc(docRef, {
        status: "Rejected",
        adminNotes: adminFeedback,
        rejectedAt: new Date().toISOString()
      });

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin (Mobile Desk)",
        action: "Rejected Leave Request",
        details: `Rejected ${req.type} for ${req.employeeName}: "${adminFeedback}"`,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      await addDoc(collection(db, "notifications"), {
        title: "Leave Request Rejected",
        message: `Your ${req.type} for ${req.startDate} was rejected. Note: ${adminFeedback}`,
        type: "Leave",
        employeeId: req.employeeId,
        read: false,
        createdAt: new Date().toISOString()
      }).catch(() => {});

      showToast(`Rejected leave request for ${req.employeeName}.`, "info");
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Failed to reject leave.", "error");
    } finally {
      setProcessingRequestId(null);
    }
  };

  // Quick Approve Attendance Copy Request
  const handleMobileApproveAttCopy = async (req: AttendanceCopyRequest) => {
    if (!req.id) return;
    setProcessingRequestId(req.id);

    const adminFeedback = mobileAdminNotes[req.id] || "Approved by HR via Mobile Action Desk.";
    try {
      const docRef = doc(db, "attendance_copy_requests", req.id);
      await updateDoc(docRef, {
        status: "Approved",
        adminNotes: adminFeedback,
        approvedAt: new Date().toISOString()
      });

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin (Mobile Desk)",
        action: "Approved Attendance Copy Request",
        details: `Approved attendance copy ${req.trackingNumber} for ${req.employeeName}`,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      await addDoc(collection(db, "notifications"), {
        title: "Attendance Record Copy Approved",
        message: `Your attendance record request (${req.trackingNumber}) has been approved. You can download the PDF voucher from your portal.`,
        type: "Success",
        employeeId: req.employeeId,
        read: false,
        createdAt: new Date().toISOString()
      }).catch(() => {});

      showToast(`Attendance voucher ${req.trackingNumber} approved!`, "success");
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Failed to approve attendance copy.", "error");
    } finally {
      setProcessingRequestId(null);
    }
  };

  // Quick Reject Attendance Copy Request
  const handleMobileRejectAttCopy = async (req: AttendanceCopyRequest) => {
    if (!req.id) return;
    setProcessingRequestId(req.id);

    const adminFeedback = mobileAdminNotes[req.id] || "Request declined by HR Administration.";
    try {
      const docRef = doc(db, "attendance_copy_requests", req.id);
      await updateDoc(docRef, {
        status: "Rejected",
        adminNotes: adminFeedback,
        rejectedAt: new Date().toISOString()
      });

      await addDoc(collection(db, "audit_logs"), {
        user: "Admin (Mobile Desk)",
        action: "Rejected Attendance Copy Request",
        details: `Rejected attendance copy ${req.trackingNumber} for ${req.employeeName}`,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      showToast(`Declined attendance copy ${req.trackingNumber}.`, "info");
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Failed to reject attendance copy.", "error");
    } finally {
      setProcessingRequestId(null);
    }
  };

  // Overtime Filters State
  const [otSearch, setOtSearch] = useState("");
  const [otDept, setOtDept] = useState("All");
  
  const [otPeriodId, setOtPeriodId] = useState<string>("custom");

  // Default date range: start of present month to today
  const [otStartDate, setOtStartDate] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}-01`;
  });
  const [otEndDate, setOtEndDate] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  });

  useEffect(() => {
    if (periods && periods.length > 0 && otPeriodId === "custom") {
      const active = periods.find(p => p.status === "Open" || p.status === "Processing") || periods[0];
      if (active && active.startDate && active.endDate) {
        setOtPeriodId(active.periodId || active.id || "custom");
        setOtStartDate(active.startDate);
        setOtEndDate(active.endDate);
      }
    }
  }, [periods, otPeriodId]);

  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pId = e.target.value;
    setOtPeriodId(pId);
    if (pId !== "custom") {
      const p = periods?.find(per => per.periodId === pId || per.id === pId);
      if (p) {
        setOtStartDate(p.startDate);
        setOtEndDate(p.endDate);
      }
    }
  };

  // Set up real-time ticking clock
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Studio floor radar filter state
  const [studioFloorFilter, setStudioFloorFilter] = useState<"all" | "present" | "break" | "offline">("all");

  const isPhtNightShift = useMemo(() => {
    const phtHour = (time.getUTCHours() + 8) % 24;
    return phtHour >= 22 || phtHour < 7;
  }, [time]);

  // Compute stats metrics
  const validEmployees = employees.filter((e) => e && e.fullName);
  const totalEmployees = validEmployees.length;
  const activeEmployees = validEmployees.filter((e) => e.status === "Active");
  
  // Today's attendance details
  const todayStr = getBusinessDate();
  const todayLogs = attendance.filter((a) => a.date === todayStr);

  const isAttendanceLate = (a: Attendance) => {
    const isLeave = a.status === "Absent" || 
                    a.status === "Paid Leave" || 
                    a.status === "Birthday Leave" || 
                    (typeof a.status === "string" && a.status.toLowerCase().includes("leave"));
    if (a.isLateExcused || isLeave) return false;
    
    // Check if covered by any approved leave request
    const hasApprovedLeave = requests.some(r => 
      r.status === "Approved" && 
      (r.employeeId === a.employeeId || r.employeeNumber === a.employeeNumber || (r.employeeName && a.employeeName && r.employeeName.trim().toLowerCase() === a.employeeName.trim().toLowerCase())) &&
      a.date >= r.startDate && a.date <= (r.endDate || r.startDate)
    );
    if (hasApprovedLeave) return false;

    if ((a.lateMinutes && a.lateMinutes > 0) || a.status === "Late") return true;
    if (a.timeIn) {
      const emp = employees.find(e => (a.employeeId && e.id === a.employeeId) || (a.employeeNumber && e.employeeNumber === a.employeeNumber));
      const schedTimes = getScheduleTimesForLog(a, emp, settings);
      return calculateLateMinutes(a.timeIn, schedTimes.shiftStart, schedTimes.shiftEnd, settings?.gracePeriodMinutes || 0, false, a.status) > 0;
    }
    return false;
  };

  const presentCount = todayLogs.filter((a) => {
    return a.status === "Present" || a.status === "On Break" || a.status === "Timed Out" || a.status === "Late";
  }).length;
  const lateCount = todayLogs.filter(isAttendanceLate).length;
  const onBreakCount = todayLogs.filter((a) => a.status === "On Break").length;
  const timedOutCount = todayLogs.filter((a) => a.status === "Timed Out").length;
  const absentCount = todayLogs.filter((a) => a.status === "Absent").length;
  const unloggedCount = Math.max(0, activeEmployees.length - todayLogs.length);

  const pendingLeaves = useMemo(() => {
    return requests
      .filter((r) => r.status === "Pending")
      .sort((a, b) => new Date(b.submittedAt || "").getTime() - new Date(a.submittedAt || "").getTime());
  }, [requests]);

  const pendingAttendanceCopies = useMemo(() => {
    return attendanceCopyRequests
      .filter((r) => r.status === "Pending")
      .sort((a, b) => new Date(b.submittedAt || "").getTime() - new Date(a.submittedAt || "").getTime());
  }, [attendanceCopyRequests]);

  const totalPendingHRTasks = pendingLeaves.length + pendingAttendanceCopies.length;
  const pendingRequestsCount = totalPendingHRTasks;

  const filteredMobileLeaves = useMemo(() => {
    let list = pendingLeaves;
    if (mobileHrSearch.trim()) {
      const q = mobileHrSearch.toLowerCase().trim();
      list = list.filter((r) => 
        (r.employeeName || "").toLowerCase().includes(q) ||
        (r.employeeNumber || "").toLowerCase().includes(q) ||
        (r.type || "").toLowerCase().includes(q) ||
        (r.trackingNumber && r.trackingNumber.toLowerCase().includes(q))
      );
    }
    return list;
  }, [pendingLeaves, mobileHrSearch]);

  const filteredMobileAttCopies = useMemo(() => {
    let list = pendingAttendanceCopies;
    if (mobileHrSearch.trim()) {
      const q = mobileHrSearch.toLowerCase().trim();
      list = list.filter((r) => 
        (r.employeeName || "").toLowerCase().includes(q) ||
        (r.employeeNumber || "").toLowerCase().includes(q) ||
        (r.trackingNumber && r.trackingNumber.toLowerCase().includes(q))
      );
    }
    return list;
  }, [pendingAttendanceCopies, mobileHrSearch]);

  // Birthdays coming up this month (June)
  const currentMonthNum = new Date().getMonth() + 1; // 1-indexed
  const upcomingBirthdays = employees.filter((e) => {
    if (!e.birthday) return false;
    let bMonth = 0;
    if (e.birthday.includes("-")) {
      const parts = e.birthday.split("-");
      if (parts[0].length === 4) {
        bMonth = parseInt(parts[1], 10);
      } else {
        bMonth = parseInt(parts[0], 10);
      }
    } else if (e.birthday.includes("/")) {
      const parts = e.birthday.split("/");
      bMonth = parseInt(parts[0], 10);
    }
    return bMonth === currentMonthNum;
  });

  // Recharts attendance analytics source - dynamically computed for accuracy using the last 5 calendar working days
  const last5Days = useMemo(() => {
    const list: { dateStr: string; label: string }[] = [];
    const now = new Date();
    let cnt = 0;
    let offset = 0;
    while (cnt < 5 && offset < 15) {
      const d = new Date(now);
      d.setDate(now.getDate() - offset);
      const day = d.getDay();
      if (day !== 0 && day !== 6) { // Skip weekends (Sunday=0, Saturday=6)
        const dateStr = d.toISOString().split("T")[0];
        const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        list.unshift({
          dateStr,
          label: `${weekdays[d.getDay()]} (${mm}/${dd})`
        });
        cnt++;
      }
      offset++;
    }
    return list;
  }, []);

  const weekdayLogs = useMemo(() => {
    return last5Days.map(({ dateStr, label }) => {
      const logs = attendance.filter((a) => a.date === dateStr);
      const present = logs.filter((a) => a.status === "Present" || a.status === "On Break" || a.status === "Timed Out" || a.status === "Late").length;
      const late = logs.filter(isAttendanceLate).length;
      const absent = logs.filter((a) => a.status === "Absent").length;
      return {
        day: label,
        Present: present,
        Late: late,
        Absent: absent
      };
    });
  }, [last5Days, attendance]);

  const payrollTrendData = useMemo(() => {
    return payrolls.map((p) => ({
      name: p.fullName.split(" ")[0],
      Amount: p.finalSalary,
      OT: p.otPay
    }));
  }, [payrolls]);

  // Leave Requests Distribution - dynamically computed for accuracy
  const approvedReqs = requests.filter((r) => r.status === "Approved").length;
  const pendingReqs = requests.filter((r) => r.status === "Pending").length;
  const rejectedReqs = requests.filter((r) => r.status === "Rejected").length;
  const totalReqs = approvedReqs + pendingReqs + rejectedReqs;

  const leaveDistribution = useMemo(() => {
    return [
      { name: "Approved", value: approvedReqs, color: "#10B981" },
      { name: "Pending", value: pendingReqs, color: "#F59E0B" },
      { name: "Rejected", value: rejectedReqs, color: "#EF4444" }
    ];
  }, [approvedReqs, pendingReqs, rejectedReqs]);


  // --- OVERTIME REPORT CALCULATIONS ---
  
  // Extract all unique departments for filters
  const departmentsList = useMemo(() => {
    const list = new Set(employees.map(e => e.department).filter(Boolean));
    return ["All", ...Array.from(list)];
  }, [employees]);

  // Aggregate OT stats for each employee within the selected date limits
  const employeeOtSummary = useMemo(() => {
    return employees.map((emp) => {
      // Find all completed attendance logs for this employee in the range
      const logsInRange = attendance.filter((a) => {
        if (a.employeeId !== emp.id && a.employeeNumber !== emp.employeeNumber) return false;
        if (!a.date) return false;
        const matchesStart = !otStartDate || a.date >= otStartDate;
        const matchesEnd = !otEndDate || a.date <= otEndDate;
        return matchesStart && matchesEnd;
      });

      let totalWorkedHours = 0;
      let totalOtHours = 0;
      let shiftsCompleted = 0;

      logsInRange.forEach((log) => {
        // Only count valid shift entries (Present, Late, or Timed Out)
        if (log.status === "Absent") return;
        shiftsCompleted++;

        let hrs = log.hoursWorked || 0;
        let ot = log.otHours || 0;

        // Fallback calculations in case fields are unseeded
        if (hrs === 0 && log.timeIn && log.timeOut) {
          const sched = getEmployeeSchedule(emp, settings);
          const math = calculateAttendanceHours(
            log.timeIn,
            log.breakStart,
            log.breakEnd,
            log.timeOut,
            log.shiftStart || sched.workHourStart,
            log.shiftEnd || sched.workHourEnd,
            settings?.dstOffset || 0,
            0, null, false, settings?.gracePeriodMinutes ?? 0,
            log.isLateExcused || false,
            log.approvedEarlyTime,
            log.requiredHours || sched.requiredHours
          );
          hrs = math.hoursWorked;
          ot = math.otHours;
        }

        totalWorkedHours += hrs;
        totalOtHours += ot;
      });

      const hourlyOtRate = emp.otRate || 0;
      const calculatedPay = totalOtHours * hourlyOtRate;

      return {
        ...emp,
        shiftsCount: shiftsCompleted,
        totalWorkedHours: parseFloat((totalWorkedHours || 0).toFixed(2)),
        totalOtHours: parseFloat((totalOtHours || 0).toFixed(2)),
        estimatedOtPay: parseFloat((calculatedPay || 0).toFixed(2)),
        logs: logsInRange
      };
    });
  }, [employees, attendance, otStartDate, otEndDate, settings]);

  // Apply Search query & Department dropdown filters
  const filteredOtSummary = useMemo(() => {
    return employeeOtSummary.filter((item) => {
      if (!item) return false;
      const queryLower = (otSearch || "").toLowerCase();
      const matchesSearch = (item.fullName || "").toLowerCase().includes(queryLower) || 
                            (item.employeeNumber || "").toLowerCase().includes(queryLower) ||
                            (item.position || "").toLowerCase().includes(queryLower);
      const matchesDept = otDept === "All" || item.department === otDept;
      return matchesSearch && matchesDept;
    });
  }, [employeeOtSummary, otSearch, otDept]);

  // Compute accumulated metric summaries across filtered items
  const otAggregation = useMemo(() => {
    let grandTotalOtHours = 0;
    let grandTotalOtPay = 0;
    let staffWithOvertimeCount = 0;
    let maximumOtHours = 0;
    let maximumOtEmployeeName = "N/A";

    filteredOtSummary.forEach((item) => {
      grandTotalOtHours += item.totalOtHours;
      grandTotalOtPay += item.estimatedOtPay;
      if (item.totalOtHours > 0) {
        staffWithOvertimeCount++;
      }
      if (item.totalOtHours > maximumOtHours) {
        maximumOtHours = item.totalOtHours;
        maximumOtEmployeeName = item.fullName;
      }
    });

    return {
      grandTotalOtHours: parseFloat((grandTotalOtHours || 0).toFixed(2)),
      grandTotalOtPay: parseFloat((grandTotalOtPay || 0).toFixed(2)),
      staffWithOvertimeCount,
      maximumOtHours: parseFloat((maximumOtHours || 0).toFixed(2)),
      maximumOtEmployeeName,
      highestSingleOtHours: parseFloat((maximumOtHours || 0).toFixed(2)),
      highestOtEmployeeName: maximumOtEmployeeName
    };
  }, [filteredOtSummary]);

  // Recharts horizontal OT load charting dataset
  const otChartDataset = useMemo(() => {
    return filteredOtSummary
      .filter((item) => item.totalOtHours > 0)
      .map((item) => ({
        name: item.fullName.split(" ")[0],
        "OT Hours": item.totalOtHours,
        "Est. Pay": item.estimatedOtPay
      }))
      .sort((a, b) => b["OT Hours"] - a["OT Hours"])
      .slice(0, 8); // Top 8 contributors
  }, [filteredOtSummary]);

  const filteredMentionEmployees = useMemo(() => {
    const activeEmps = employees.filter((e) => e && e.fullName && e.status === "Active");
    if (!mentionSearch.trim()) return activeEmps;
    const q = mentionSearch.toLowerCase().trim();
    return activeEmps.filter((e) =>
      (e.fullName || "").toLowerCase().includes(q) ||
      (e.department && (e.department || "").toLowerCase().includes(q))
    );
  }, [employees, mentionSearch]);

  const handleToggleMention = (empId: string) => {
    setSelectedMentionIds((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const mentionDropdownEmployees = useMemo(() => {
    const activeEmps = employees.filter((e) => e && e.fullName && e.status === "Active");
    if (!mentionQuery) return activeEmps.slice(0, 5);
    const q = mentionQuery.toLowerCase().trim();
    return activeEmps.filter((e) =>
      (e.fullName || "").toLowerCase().includes(q) ||
      (e.department && (e.department || "").toLowerCase().includes(q))
    ).slice(0, 5);
  }, [employees, mentionQuery]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setAnnMessage(text);

    const cursor = e.target.selectionStart || 0;
    const textBeforeCursor = text.slice(0, cursor);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Valid query must not have space or newline, and be reasonably short
      if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n") && textAfterAt.length < 25) {
        setShowMentionDropdown(true);
        setMentionQuery(textAfterAt);
        setMentionTriggerIndex(lastAtIndex);
        setActiveMentionIndex(0);
        return;
      }
    }
    setShowMentionDropdown(false);
  };

  const handleSelectEmployeeMention = (emp: Employee) => {
    const before = annMessage.slice(0, mentionTriggerIndex);
    const after = annMessage.slice(mentionTriggerIndex + mentionQuery.length + 1);
    const mentionText = `@${emp.fullName} `;
    const newText = before + mentionText + after;
    setAnnMessage(newText);
    
    if (emp.id && !selectedMentionIds.includes(emp.id)) {
      setSelectedMentionIds((prev) => [...prev, emp.id!]);
    }
    
    setShowMentionDropdown(false);
    
    setTimeout(() => {
      const textarea = document.getElementById("announcement-textarea") as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        const newCursorPos = before.length + mentionText.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 50);
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showMentionDropdown || mentionDropdownEmployees.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveMentionIndex((prev) => (prev + 1) % mentionDropdownEmployees.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveMentionIndex((prev) => (prev - 1 + mentionDropdownEmployees.length) % mentionDropdownEmployees.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const selectedEmp = mentionDropdownEmployees[activeMentionIndex];
      if (selectedEmp) {
        handleSelectEmployeeMention(selectedEmp);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowMentionDropdown(false);
    }
  };

  // Export payroll CSV Integration File
  const handleExportCSV = () => {
    const csvHeaders = [
      "Employee Number",
      "Full Name",
      "Department",
      "Position",
      "Logged Shifts",
      "Est. Standard Hours (8h/shift)",
      "Total Logged Work Hours",
      "Accumulated OT Hours",
      "Hourly OT Rate",
      "Overtime Wage Burden"
    ];

    const dataRows = filteredOtSummary.map((item) => [
      `"${item.employeeNumber}"`,
      `"${item.fullName}"`,
      `"${item.department}"`,
      `"${item.position}"`,
      item.shiftsCount,
      item.shiftsCount * 8,
      item.totalWorkedHours,
      item.totalOtHours,
      item.otRate || 0,
      item.estimatedOtPay
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [csvHeaders.join(","), ...dataRows.map(row => row.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", encodedUri);
    linkElement.setAttribute("download", `Oligarch_Media_Overtime_Payroll_Export_${otStartDate}_to_${otEndDate}.csv`);
    document.body.appendChild(linkElement);
    linkElement.click();
    document.body.removeChild(linkElement);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-8 w-full min-w-0">
      {/* Real-time Studio Command Center Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950/70 to-slate-950 border border-indigo-500/25 text-white p-6 md:p-8 shadow-2xl print:hidden">
        {/* Subtle decorative mesh glows */}
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute right-1/3 -bottom-24 w-60 h-60 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div className="space-y-3 max-w-xl">
            {/* Live Studio Status Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold tracking-wide bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                <span>Oligarch Studio Engine</span>
              </span>

              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold tracking-wide ${
                isPhtNightShift 
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" 
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              }`}>
                <span className={`w-2 h-2 rounded-full ${isPhtNightShift ? "bg-emerald-400 animate-ping" : "bg-amber-400"}`} />
                <span>{isPhtNightShift ? "Night Shift Active (10:00 PM – 7:00 AM PHT)" : "Day Prep Window • Shift at 10:00 PM"}</span>
              </span>
            </div>

            {/* Studio Title */}
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2.5">
                <span>Oligarch Media Control Center</span>
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 mt-1 leading-relaxed">
                Live operational cockpit for Graphic Design & Creative Operations. Real-time timecards, PHT night-shift audits, and payroll processing.
              </p>
            </div>

            {/* Micro Metadata Strip (Zero-Pill Discipline) */}
            <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-xs text-slate-400 font-mono pt-1">
              <span className="text-slate-200 font-semibold">{totalEmployees} Roster Artists</span>
              <span>·</span>
              <span className="text-emerald-400 font-semibold">{presentCount} Clocked On Shift</span>
              <span>·</span>
              <span className="text-indigo-300">Spark Firebase Active</span>
              {totalPendingHRTasks > 0 && (
                <>
                  <span>·</span>
                  <span className="text-amber-400 font-bold">{totalPendingHRTasks} Tasks Pending</span>
                </>
              )}
            </div>
          </div>

          {/* Real-time Manila Digital Clock & Quick Actions */}
          <div className="flex flex-col sm:flex-row lg:flex-col items-start lg:items-end justify-between gap-4 w-full lg:w-auto pt-4 lg:pt-0 border-t border-white/10 lg:border-t-0">
            <div className="text-left lg:text-right">
              <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">
                MANILA TIME (PHT, UTC+8)
              </div>
              <div className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-sky-200 to-emerald-300 tabular-nums mt-0.5">
                {time.toLocaleTimeString()}
              </div>
              <div className="text-xs text-slate-300 font-mono mt-0.5">
                {time.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
              </div>
            </div>

            {/* Hero Quick Actions */}
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              {totalPendingHRTasks > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveSubTab("pending_tasks")}
                  className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-mono font-black flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                >
                  <Inbox className="w-3.5 h-3.5" />
                  <span>Review Tasks ({totalPendingHRTasks})</span>
                </button>
              )}
              <button
                type="button"
                onClick={handlePrint}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-mono font-bold flex items-center gap-1.5 transition-all border border-white/10 cursor-pointer"
                title="Print Dashboard Summary"
              >
                <Printer className="w-3.5 h-3.5 text-slate-300" />
                <span className="hidden sm:inline">Print Report</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-tab Switcher - Modern Segmented Pill Track */}
      <div className="p-1.5 bg-slate-100 dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-white/10 flex overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden gap-1.5 print:hidden">
        <button
          onClick={() => setActiveSubTab("overview")}
          className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold font-mono tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === "overview"
              ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/60 dark:ring-indigo-500/40"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/5"
          }`}
          id="overview_tab"
        >
          <BarChart4 className="w-4 h-4 text-indigo-500 dark:text-indigo-200" />
          <span>Studio Analytics & Floor</span>
        </button>
        <button
          onClick={() => setActiveSubTab("pending_tasks")}
          className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold font-mono tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === "pending_tasks"
              ? "bg-white dark:bg-amber-500 text-slate-900 dark:text-slate-950 shadow-sm ring-1 ring-slate-200/60 dark:ring-amber-400/40"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/5"
          }`}
          id="pending_tasks_tab"
        >
          <Inbox className="w-4 h-4 text-amber-500" />
          <span>Pending HR Tasks & Approvals</span>
          {totalPendingHRTasks > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-slate-950 dark:bg-slate-950 dark:text-amber-400 shadow-xs">
              {totalPendingHRTasks}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab("overtime")}
          className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold font-mono tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === "overtime"
              ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/60 dark:ring-indigo-500/40"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/5"
          }`}
          id="overtime_tab"
        >
          <Clock className="w-4 h-4 text-sky-500 dark:text-sky-300" />
          <span>Overtime Audit & Payroll Export</span>
        </button>
        <button
          onClick={() => setActiveSubTab("announcements")}
          className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold font-mono tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === "announcements"
              ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/60 dark:ring-indigo-500/40"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/5"
          }`}
          id="announcements_tab"
        >
          <Megaphone className="w-4 h-4 text-pink-500 dark:text-pink-300" />
          <span>Company Announcements</span>
        </button>
      </div>

      {activeSubTab === "overview" && (
        <>
          {/* Dedicated Mobile Quick-Action Banner */}
          {totalPendingHRTasks > 0 && (
            <div className="p-4 bg-gradient-to-r from-amber-500/15 via-slate-900 to-slate-900 border border-amber-500/30 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md print:hidden">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-black uppercase text-amber-400 tracking-wider">
                      MOBILE APPROVAL DESK
                    </span>
                    <span className="px-1.5 py-0.2 text-[9px] font-black font-mono rounded bg-amber-500 text-slate-950 uppercase">
                      {totalPendingHRTasks} Pending
                    </span>
                  </div>
                  <p className="text-xs font-bold text-white mt-0.5">
                    {pendingLeaves.length} leave request{pendingLeaves.length !== 1 ? "s" : ""} & {pendingAttendanceCopies.length} attendance voucher{pendingAttendanceCopies.length !== 1 ? "s" : ""} awaiting your signature.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveSubTab("pending_tasks")}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-mono font-black transition-all shadow-md flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
              >
                <span>Open Review Desk</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* High-Impact Modern KPI Cards Grid (Modern Pastel & High-Contrast Aesthetic) */}
          <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
            {/* Total Staff */}
            <div className="p-5 bg-gradient-to-br from-indigo-50/70 via-white to-indigo-50/30 dark:from-slate-900/95 dark:to-indigo-950/20 border border-indigo-100 dark:border-white/10 rounded-3xl flex flex-col justify-between shadow-xs hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 font-mono uppercase tracking-wider">Total Staff</span>
                <div className="w-9 h-9 rounded-2xl bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-700 dark:text-indigo-300 shadow-xs">
                  <Users className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-4">
                <p className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">{totalEmployees}</p>
                <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100/80 dark:bg-emerald-950/50 border border-emerald-200/60 dark:border-emerald-800/40 text-[11px] text-emerald-800 dark:text-emerald-300 font-mono font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>{activeEmployees.length} Active Artists</span>
                </div>
              </div>
            </div>

            {/* Present Today */}
            <div className="p-5 bg-gradient-to-br from-emerald-50/70 via-white to-emerald-50/30 dark:from-slate-900/95 dark:to-emerald-950/20 border border-emerald-100 dark:border-white/10 rounded-3xl flex flex-col justify-between shadow-xs hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 font-mono uppercase tracking-wider">On Shift</span>
                <div className="w-9 h-9 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-700 dark:text-emerald-300 shadow-xs">
                  <CheckCircle className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-4">
                <p className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">{presentCount}</p>
                <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100/80 dark:bg-emerald-950/50 border border-emerald-200/60 dark:border-emerald-800/40 text-[11px] text-emerald-800 dark:text-emerald-300 font-mono font-bold">
                  <span>{onBreakCount > 0 ? `${onBreakCount} break · ` : ""}{lateCount} late</span>
                </div>
              </div>
            </div>

            {/* Absent Today */}
            <div className="p-5 bg-gradient-to-br from-rose-50/70 via-white to-rose-50/30 dark:from-slate-900/95 dark:to-rose-950/20 border border-rose-100 dark:border-white/10 rounded-3xl flex flex-col justify-between shadow-xs hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 font-mono uppercase tracking-wider">Offline / Off</span>
                <div className="w-9 h-9 rounded-2xl bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center text-rose-700 dark:text-rose-300 shadow-xs">
                  <AlertCircle className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-4">
                <p className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">{absentCount}</p>
                <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-700 dark:text-slate-300 font-mono font-medium">
                  <span>{unloggedCount > 0 ? `${unloggedCount} not signed in` : "All logged in"}</span>
                </div>
              </div>
            </div>

            {/* Pending Requests */}
            <div 
              className="p-5 bg-gradient-to-br from-amber-50/80 via-white to-amber-50/30 dark:from-slate-900/95 dark:to-amber-950/20 border border-amber-200/80 dark:border-white/10 rounded-3xl flex flex-col justify-between shadow-xs hover:shadow-md hover:border-amber-400/50 dark:hover:border-amber-400/40 transition-all cursor-pointer group" 
              onClick={() => setActiveSubTab("pending_tasks")}
              id="pending_requests_card"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 font-mono uppercase tracking-wider">Pending HR</span>
                <div className="w-9 h-9 rounded-2xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-700 dark:text-amber-300 group-hover:scale-105 transition-transform shadow-xs">
                  <TrendingUp className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-4">
                <p className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">{pendingRequestsCount}</p>
                <div className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-white dark:bg-amber-400 dark:text-slate-950 text-[11px] font-mono font-black shadow-xs group-hover:bg-indigo-600 transition-colors">
                  <span>Review Tasks</span>
                  <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </div>

            {/* Upcoming Birthdays count */}
            <div className="p-5 bg-gradient-to-br from-pink-50/70 via-white to-pink-50/30 dark:from-slate-900/95 dark:to-pink-950/20 border border-pink-100 dark:border-white/10 rounded-3xl flex flex-col justify-between shadow-xs hover:shadow-md transition-all col-span-2 sm:col-span-1 md:col-span-4 lg:col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 font-mono uppercase tracking-wider">Birthdays</span>
                <div className="w-9 h-9 rounded-2xl bg-pink-100 dark:bg-pink-500/20 flex items-center justify-center text-pink-700 dark:text-pink-300 shadow-xs">
                  <Heart className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-4">
                <p className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">{upcomingBirthdays.length}</p>
                <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-pink-100/80 dark:bg-pink-950/50 border border-pink-200/60 dark:border-pink-800/40 text-[11px] text-pink-800 dark:text-pink-300 font-mono font-bold">
                  <span>{(time instanceof Date && !isNaN(time.getTime()) ? time : new Date()).toLocaleString(undefined, { month: "short" })} Parties</span>
                </div>
              </div>
            </div>
          </section>

          {/* ============================================================== */}
          {/* LIVE STUDIO FLOOR & ATTENDANCE RADAR (ALL 11 DESIGN ARTISTS)   */}
          {/* ============================================================== */}
          <section className="p-5 sm:p-6 bg-white dark:bg-slate-900/90 border border-slate-200/90 dark:border-white/10 rounded-3xl shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                    <span>Live Studio Floor & Staff Attendance</span>
                  </h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Real-time status of all 11 official studio team members for today's night shift.
                </p>
              </div>

              {/* Studio floor quick filters */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-950/80 rounded-xl border border-slate-200/80 dark:border-white/10 text-xs font-mono font-bold">
                <button
                  type="button"
                  onClick={() => setStudioFloorFilter("all")}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    studioFloorFilter === "all"
                      ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-300"
                  }`}
                >
                  All ({activeEmployees.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStudioFloorFilter("present")}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    studioFloorFilter === "present"
                      ? "bg-emerald-500 text-white shadow-xs"
                      : "text-slate-500 hover:text-emerald-500"
                  }`}
                >
                  On Shift ({presentCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStudioFloorFilter("break")}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    studioFloorFilter === "break"
                      ? "bg-amber-500 text-slate-950 shadow-xs"
                      : "text-slate-500 hover:text-amber-500"
                  }`}
                >
                  Break ({onBreakCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStudioFloorFilter("offline")}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    studioFloorFilter === "offline"
                      ? "bg-slate-700 text-white shadow-xs"
                      : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-300"
                  }`}
                >
                  Not In ({unloggedCount})
                </button>
              </div>
            </div>

            {/* 11 Studio Team Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {activeEmployees
                .filter((emp) => {
                  const log = todayLogs.find((l) => l.employeeId === emp.id || l.employeeNumber === emp.employeeNumber);
                  const isPresent = log && (log.status === "Present" || log.status === "On Break" || log.status === "Late" || log.status === "Timed Out" || (log.timeIn && !log.timeOut));
                  const isOnBreak = log && log.status === "On Break";
                  if (studioFloorFilter === "present") return isPresent && !isOnBreak;
                  if (studioFloorFilter === "break") return isOnBreak;
                  if (studioFloorFilter === "offline") return !isPresent;
                  return true;
                })
                .map((emp) => {
                  const log = todayLogs.find((l) => l.employeeId === emp.id || l.employeeNumber === emp.employeeNumber);
                  const isPresent = log && (log.status === "Present" || log.status === "On Break" || log.status === "Late" || log.status === "Timed Out" || (log.timeIn && !log.timeOut));
                  const isOnBreak = log && log.status === "On Break";
                  const isLate = log && isAttendanceLate(log);
                  const isTimedOut = log && Boolean(log.timeOut);

                  // Check if on approved leave
                  const approvedLeave = requests.find(r => 
                    (r.employeeNumber === emp.employeeNumber || r.employeeId === emp.id) &&
                    r.status === "Approved" &&
                    r.startDate <= todayStr &&
                    r.endDate >= todayStr
                  );

                  return (
                    <div
                      key={emp.id || emp.employeeNumber}
                      className="p-3.5 rounded-2xl bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/5 hover:border-indigo-400/40 transition-all flex flex-col justify-between gap-3 group"
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Avatar with status indicator ring */}
                          <div className="relative shrink-0">
                            <img
                              src={emp.profilePicture || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"}
                              alt={emp.fullName}
                              referrerPolicy="no-referrer"
                              className={`w-10 h-10 rounded-full object-cover ring-2 ${
                                isOnBreak
                                  ? "ring-amber-400"
                                  : isPresent
                                  ? "ring-emerald-400"
                                  : approvedLeave
                                  ? "ring-purple-400"
                                  : "ring-slate-300 dark:ring-slate-700"
                              }`}
                            />
                            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
                              isOnBreak
                                ? "bg-amber-400"
                                : isPresent
                                ? "bg-emerald-500 animate-pulse"
                                : approvedLeave
                                ? "bg-purple-500"
                                : "bg-slate-400"
                            }`} />
                          </div>

                          <div className="min-w-0">
                            <h4 className="font-bold text-xs text-slate-900 dark:text-white truncate group-hover:text-indigo-500 transition-colors">
                              {emp.fullName}
                            </h4>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate mt-0.5">
                              #{emp.employeeNumber} · {emp.position || "Designer"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Status indicator row */}
                      <div className="pt-2 border-t border-slate-200/60 dark:border-white/5 flex items-center justify-between text-[11px] font-mono">
                        <div className="text-slate-500 dark:text-slate-400 truncate">
                          {log?.timeIn ? (
                            <span>In: <strong className="text-slate-800 dark:text-slate-200">{formatTo12Hour(log.timeIn)}</strong></span>
                          ) : (
                            <span className="text-slate-400">Shift: 10PM–7AM</span>
                          )}
                        </div>

                        <div>
                          {isOnBreak ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                              <Coffee className="w-3 h-3" />
                              <span>On Break</span>
                            </span>
                          ) : isTimedOut ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/25">
                              <Check className="w-3 h-3" />
                              <span>Shift Done</span>
                            </span>
                          ) : isPresent ? (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isLate 
                                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25" 
                                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25"
                            }`}>
                              <Activity className="w-3 h-3" />
                              <span>{isLate ? "Clocked Late" : "On Shift"}</span>
                            </span>
                          ) : approvedLeave ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25">
                              <CalendarDays className="w-3 h-3" />
                              <span>On Leave</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200/60 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                              <span>Not In Yet</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>

          {/* Analytics Charts Grid */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Attendance Trend Chart */}
            <div className="p-5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm">
              <h3 className="font-bold text-sm text-zinc-800 dark:text-zinc-250 uppercase font-mono tracking-wider mb-4 flex items-center gap-1.5">
                <BarChart4 className="w-4 h-4 text-blue-500" /> Weekly Attendance Summary
              </h3>
              <div className="h-64 sm:h-72 w-full">
                <ResponsiveContainer width="100%" height="105%">
                  <BarChart data={weekdayLogs} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" />
                    <XAxis dataKey="day" style={{ fontSize: "10px", fontFamily: "monospace" }} stroke="currentColor" className="text-zinc-400 dark:text-zinc-600" />
                    <YAxis style={{ fontSize: "10px", fontFamily: "monospace" }} stroke="currentColor" className="text-zinc-400 dark:text-zinc-600" />
                    <Tooltip 
                      contentStyle={{ 
                        borderRadius: "12px", 
                        backgroundColor: "var(--color-bg-popover, #18181b)",
                        border: "1px solid var(--color-border-popover, #27272a)", 
                        fontSize: "11px",
                        color: "#f4f4f5"
                      }} 
                    />
                    <Bar dataKey="Present" fill="#10B981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Late" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Payroll Trend Chart */}
            <div className="p-5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm">
              <h3 className="font-bold text-sm text-zinc-800 dark:text-zinc-250 uppercase font-mono tracking-wider mb-4 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-orange-500" /> Employee Payroll Output
              </h3>
              {payrolls.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 sm:h-72 text-center text-zinc-400">
                  <div className="w-12 h-12 rounded-full border-2 border-dashed border-zinc-200 dark:border-zinc-800 flex items-center justify-center mb-2">
                    <Coins className="w-5 h-5 text-zinc-400 dark:text-zinc-650" />
                  </div>
                  <p className="text-xs font-semibold">No payroll sheets compiled yet</p>
                  <p className="text-[10px] text-zinc-500 mt-1 max-w-xs leading-relaxed">
                    Once you compile and draft pay sheets in the Payroll Manager, actual disbursement trends will display here.
                  </p>
                </div>
              ) : (
                <div className="h-64 sm:h-72 w-full">
                  <ResponsiveContainer width="100%" height="105%">
                    <AreaChart data={payrollTrendData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="colorAmt" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25}/>
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" />
                      <XAxis dataKey="name" style={{ fontSize: "10px" }} stroke="currentColor" className="text-zinc-400 dark:text-zinc-600" />
                      <YAxis 
                        style={{ fontSize: "10px", fontFamily: "monospace" }} 
                        tickFormatter={(val) => `${settings?.currency || "₱"}${val >= 1000 ? (val / 1000) + 'k' : val}`}
                        stroke="currentColor" 
                        className="text-zinc-400 dark:text-zinc-600" 
                      />
                      <Tooltip 
                        formatter={(value: any) => [`${settings?.currency || "₱"}${Number(value || 0).toLocaleString()}`, "Amount"]}
                        contentStyle={{ 
                          borderRadius: "12px", 
                          backgroundColor: "#18181b",
                          border: "1px solid #27272a", 
                          fontSize: "11px",
                          color: "#f4f4f5"
                        }}
                      />
                      <Area type="monotone" dataKey="Amount" stroke="#3B82F6" fillOpacity={1} fill="url(#colorAmt)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </section>

          {/* Second Analytics Section: Birthdays & Requests Distribution */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Requests Donut Status Chart */}
            <div className="p-5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm">
              <h3 className="font-bold text-sm text-zinc-800 dark:text-zinc-250 uppercase font-mono tracking-wider mb-2">Leave Status Allocation</h3>
              {totalReqs === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center text-zinc-400 h-48">
                  <div className="w-12 h-12 rounded-full border-2 border-dashed border-zinc-200 dark:border-zinc-800 flex items-center justify-center mb-2">
                    <Calendar className="w-5 h-5 text-zinc-400 dark:text-zinc-650" />
                  </div>
                  <p className="text-xs font-semibold">No leave requests logged</p>
                  <p className="text-[10px] text-zinc-500 mt-1 max-w-xs leading-relaxed">
                    Employee leave requests and status splits will populate here.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-center justify-around h-auto sm:h-48 mt-2 gap-4">
                  <div className="h-40 w-40 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={leaveDistribution}
                          innerRadius={50}
                          outerRadius={65}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {leaveDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  
                  <div className="space-y-2 w-full sm:w-auto">
                    {leaveDistribution.map((item) => (
                      <div key={item.name} className="flex items-center gap-2 justify-start sm:justify-start">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-350">{item.name} ({item.value})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Birthday Celebrations List */}
            <div className="p-5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm lg:col-span-2">
              <h3 className="font-bold text-sm text-zinc-800 dark:text-zinc-250 uppercase font-mono tracking-wider mb-4 flex items-center gap-1.5">
                <Smile className="w-4.5 h-4.5 text-pink-500" /> Birthday Celebrations inside June
              </h3>
              
              {upcomingBirthdays.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-center text-zinc-400 h-32">
                  <Heart className="w-10 h-10 text-zinc-250 dark:text-zinc-800 mb-2" />
                  <p className="text-xs">No employee birthdays logged in this month.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-48 overflow-y-auto pr-1">
                  {upcomingBirthdays.map((e) => {
                    const formatBirthday = (bday: string | null | undefined): string => {
                      if (!bday) return "—";
                      try {
                        const dateParts = bday.split(/[-/]/);
                        let year = 2000, month = 0, day = 1;
                        if (dateParts.length === 3) {
                          if (dateParts[0].length === 4) {
                            year = parseInt(dateParts[0], 10);
                            month = parseInt(dateParts[1], 10) - 1;
                            day = parseInt(dateParts[2], 10);
                          } else {
                            month = parseInt(dateParts[0], 10) - 1;
                            day = parseInt(dateParts[1], 10);
                            year = parseInt(dateParts[2], 10);
                          }
                          const tempDate = new Date(year, month, day);
                          if (!isNaN(tempDate.getTime())) {
                            return tempDate.toLocaleDateString(undefined, { month: "long", day: "numeric" });
                          }
                        }
                      } catch {}
                      return bday;
                    };

                    return (
                      <div key={e.employeeNumber} className="border border-zinc-150 dark:border-zinc-800 rounded-xl p-3 flex items-center gap-4 bg-zinc-50/50 dark:bg-zinc-900/40">
                        <img 
                          src={e.profilePicture || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"} 
                          className="w-10 h-10 rounded-full object-cover shrink-0 border border-zinc-200 dark:border-zinc-700" 
                          alt="avatar" 
                          referrerPolicy="no-referrer"
                        />
                        <div>
                          <h5 className="font-bold text-zinc-800 dark:text-zinc-200 text-xs">{e.fullName}</h5>
                          <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{e.employeeNumber} • {e.department}</p>
                          <p className="text-[10px] text-pink-600 dark:text-pink-400 font-bold font-mono mt-1 flex items-center gap-1">
                            🎁 Celebrates: {formatBirthday(e.birthday)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* ============================================================== */}
      {/* DEDICATED MOBILE-FRIENDLY HR TASKS & LEAVE APPROVALS ACTION HUB */}
      {/* ============================================================== */}
      {activeSubTab === "pending_tasks" && (
        <div className="space-y-6 animate-fadeIn pb-12" id="mobile_hr_action_hub">
          {/* Header Card */}
          <div className="p-5 bg-gradient-to-r from-amber-500/15 via-zinc-900 to-zinc-900 border border-amber-500/30 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-md">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <Smartphone className="w-3 h-3" /> Mobile Touch Desk
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  {totalPendingHRTasks} Pending Action{totalPendingHRTasks !== 1 ? "s" : ""}
                </span>
              </div>
              <h3 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                <span>Pending HR Tasks & Approvals</span>
              </h3>
              <p className="text-xs text-zinc-400 mt-1 max-w-xl">
                Dedicated responsive view designed for one-touch approvals on phones, tablets, or quick reviews without navigating complex data tables.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <button
                type="button"
                onClick={() => setCurrentTab("requests")}
                className="w-full md:w-auto px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono font-bold flex items-center justify-center gap-1.5 border border-zinc-700 transition-all cursor-pointer"
              >
                <span>Full Request Manager</span>
                <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar (Touch 4-Card Grid) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => setMobileHrFilter("leaves")}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                mobileHrFilter === "leaves" 
                  ? "bg-amber-950/30 border-amber-500 text-amber-300 shadow-sm" 
                  : "bg-zinc-900/80 border-zinc-800 text-zinc-300 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-1">
                <span>LEAVE APPROVALS</span>
                <CalendarDays className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-black text-white">{pendingLeaves.length}</div>
              <div className="text-[10px] text-amber-400 font-mono mt-0.5">● Awaiting Review</div>
            </button>

            <button
              type="button"
              onClick={() => setMobileHrFilter("attendance_copy")}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                mobileHrFilter === "attendance_copy" 
                  ? "bg-sky-950/30 border-sky-500 text-sky-300 shadow-sm" 
                  : "bg-zinc-900/80 border-zinc-800 text-zinc-300 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-1">
                <span>ATTENDANCE COPIES</span>
                <FileText className="w-4 h-4 text-sky-400" />
              </div>
              <div className="text-2xl font-black text-white">{pendingAttendanceCopies.length}</div>
              <div className="text-[10px] text-sky-400 font-mono mt-0.5">● Official Vouchers</div>
            </button>

            <button
              type="button"
              onClick={() => setMobileHrFilter("today")}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                mobileHrFilter === "today" 
                  ? "bg-emerald-950/30 border-emerald-500 text-emerald-300 shadow-sm" 
                  : "bg-zinc-900/80 border-zinc-800 text-zinc-300 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-1">
                <span>ON SHIFT TODAY</span>
                <UserCheck className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-black text-white">{presentCount}</div>
              <div className="text-[10px] text-emerald-400 font-mono mt-0.5">● Logged Active</div>
            </button>

            <button
              type="button"
              onClick={() => setMobileHrFilter("today")}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                mobileHrFilter === "today" 
                  ? "bg-rose-950/30 border-rose-500 text-rose-300 shadow-sm" 
                  : "bg-zinc-900/80 border-zinc-800 text-zinc-300 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-1">
                <span>OFFLINE / ABSENT</span>
                <UserX className="w-4 h-4 text-rose-400" />
              </div>
              <div className="text-2xl font-black text-white">{absentCount + unloggedCount}</div>
              <div className="text-[10px] text-rose-400 font-mono mt-0.5">● Absent / Yet to check in</div>
            </button>
          </div>

          {/* Filter Pills & Instant Search */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-zinc-900/70 p-3 rounded-2xl border border-zinc-800">
            {/* Filter Pills */}
            <div className="flex overflow-x-auto gap-1.5 pb-1 sm:pb-0 scrollbar-none">
              <button
                type="button"
                onClick={() => setMobileHrFilter("all")}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all whitespace-nowrap cursor-pointer ${
                  mobileHrFilter === "all"
                    ? "bg-amber-500 text-slate-950 shadow-sm"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-750"
                }`}
              >
                All Pending ({totalPendingHRTasks})
              </button>
              <button
                type="button"
                onClick={() => setMobileHrFilter("leaves")}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all whitespace-nowrap cursor-pointer ${
                  mobileHrFilter === "leaves"
                    ? "bg-amber-500 text-slate-950 shadow-sm"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-750"
                }`}
              >
                Leave Approvals ({pendingLeaves.length})
              </button>
              <button
                type="button"
                onClick={() => setMobileHrFilter("attendance_copy")}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all whitespace-nowrap cursor-pointer ${
                  mobileHrFilter === "attendance_copy"
                    ? "bg-amber-500 text-slate-950 shadow-sm"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-750"
                }`}
              >
                Attendance Copies ({pendingAttendanceCopies.length})
              </button>
              <button
                type="button"
                onClick={() => setMobileHrFilter("today")}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all whitespace-nowrap cursor-pointer ${
                  mobileHrFilter === "today"
                    ? "bg-amber-500 text-slate-950 shadow-sm"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-750"
                }`}
              >
                Today's Roster ({todayLogs.length})
              </button>
            </div>

            {/* Instant Search Bar */}
            <div className="relative w-full sm:w-64 shrink-0">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search staff, ID, or leave..."
                value={mobileHrSearch}
                onChange={(e) => setMobileHrSearch(e.target.value)}
                className="w-full text-xs font-mono pl-9 pr-8 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
              />
              {mobileHrSearch && (
                <button
                  type="button"
                  onClick={() => setMobileHrSearch("")}
                  className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* SECTION 1: PENDING LEAVE REQUESTS */}
          {(mobileHrFilter === "all" || mobileHrFilter === "leaves") && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                  <CalendarDays className="w-4 h-4" />
                  <span>Pending Leave Approvals ({filteredMobileLeaves.length})</span>
                </h4>
                {filteredMobileLeaves.length > 0 && (
                  <span className="text-[10px] font-mono text-zinc-400">
                    Tap to review & action
                  </span>
                )}
              </div>

              {filteredMobileLeaves.length === 0 ? (
                <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 text-center space-y-1.5">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                  <p className="text-xs font-bold text-white">No Pending Leave Requests</p>
                  <p className="text-[11px] text-zinc-400 max-w-sm mx-auto">
                    All employee leave submissions have been processed. New leave requests will appear here automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredMobileLeaves.map((req) => {
                    const emp = employees.find((e) => 
                      e.id === req.employeeId || 
                      (e.employeeNumber && req.employeeNumber && e.employeeNumber === req.employeeNumber)
                    );
                    const isProcessing = processingRequestId === req.id;
                    const bdayInfo = req.type === "Birthday Leave" && emp?.birthday ? getBirthdayWeekInfo(emp.birthday, req.startDate) : null;
                    const isBdayValid = bdayInfo ? bdayInfo.isInBirthdayWeek(req.startDate) : true;

                    // Calculate days count
                    let daysCount = 1;
                    try {
                      if (req.startDate && req.endDate && req.startDate !== req.endDate) {
                        const diffTime = Math.abs(new Date(req.endDate).getTime() - new Date(req.startDate).getTime());
                        daysCount = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                      }
                    } catch {}

                    return (
                      <div
                        key={req.id || req.requestId}
                        className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 transition-all space-y-3 shadow-md"
                      >
                        {/* Top Row: Employee Info & Type Badge */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-400 text-white font-bold text-sm flex items-center justify-center shrink-0 border border-indigo-300/30">
                              {(req.employeeName || "E").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h5 className="text-sm font-black text-white">{req.employeeName}</h5>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold">
                                  #{req.employeeNumber}
                                </span>
                              </div>
                              <p className="text-[10px] text-zinc-400 font-mono">
                                {emp?.department || "Studio"} • Submitted: {new Date(req.submittedAt || Date.now()).toLocaleDateString()}
                              </p>
                            </div>
                          </div>

                          {/* Leave Type Badge */}
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase shrink-0 flex items-center gap-1 ${
                            req.type === "Birthday Leave"
                              ? "bg-pink-500/20 text-pink-400 border border-pink-500/40"
                              : req.type === "Paid Leave"
                              ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                              : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                          }`}>
                            {req.type === "Birthday Leave" ? "🎂 Birthday Leave" : req.type === "Paid Leave" ? "💵 Paid Leave" : "🚨 Absent Notice"}
                          </span>
                        </div>

                        {/* Date Range & Tracking */}
                        <div className="p-2.5 rounded-xl bg-zinc-950/70 border border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                          <div className="flex items-center gap-2 text-zinc-200">
                            <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="font-bold text-white">{req.startDate}</span>
                            {req.endDate && req.endDate !== req.startDate && (
                              <>
                                <span className="text-zinc-500">→</span>
                                <span className="font-bold text-white">{req.endDate}</span>
                              </>
                            )}
                            <span className="text-zinc-400 text-[10px]">({daysCount} day{daysCount > 1 ? "s" : ""})</span>
                          </div>
                          {req.trackingNumber && (
                            <span className="text-[10px] text-zinc-400">
                              Ref: <strong className="text-zinc-300">{req.trackingNumber}</strong>
                            </span>
                          )}
                        </div>

                        {/* Reason Box */}
                        {req.reason && (
                          <div className="text-xs text-zinc-300 bg-zinc-950/40 p-2.5 rounded-xl border border-zinc-855 italic">
                            "{req.reason}"
                          </div>
                        )}

                        {/* Birthday Week Policy Verification Alert */}
                        {req.type === "Birthday Leave" && (
                          <div className={`p-2.5 rounded-xl border text-[11px] font-mono flex items-start gap-2 ${
                            isBdayValid 
                              ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-300"
                              : "bg-rose-950/20 border-rose-500/40 text-rose-300"
                          }`}>
                            {isBdayValid ? (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                <div>
                                  <strong>Verified Birthday Week:</strong> Valid during {bdayInfo?.weekStartMondayStr} to {bdayInfo?.weekEndFridayStr} (Employee Birthday: {bdayInfo?.birthdayFormatted}).
                                </div>
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                                <div>
                                  <strong>Policy Warning:</strong> Requested date ({req.startDate}) is outside the employee's birthday week ({bdayInfo ? `${bdayInfo.weekStartMondayStr} to ${bdayInfo.weekEndFridayStr}` : "No birthday registered"}).
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {/* Quick Admin Note Input */}
                        <div className="space-y-1">
                          <input
                            type="text"
                            placeholder="Optional admin note / approval remark..."
                            value={mobileAdminNotes[req.id || req.requestId] || ""}
                            onChange={(e) => setMobileAdminNotes((prev) => ({ ...prev, [req.id || req.requestId]: e.target.value }))}
                            className="w-full text-xs font-mono px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                          />
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {["Approved per policy", "Approved with pay", "Medical noted"].map((chip) => (
                              <button
                                key={chip}
                                type="button"
                                onClick={() => setMobileAdminNotes((prev) => ({ ...prev, [req.id || req.requestId]: chip }))}
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 cursor-pointer"
                              >
                                + {chip}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Touch Action Buttons */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={() => handleMobileApproveLeave(req)}
                            className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Check className="w-4 h-4" />
                            <span>{isProcessing ? "Processing..." : "Approve Leave"}</span>
                          </button>

                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={() => handleMobileRejectLeave(req)}
                            className="py-2.5 px-3 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <X className="w-4 h-4" />
                            <span>Reject</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SECTION 2: PENDING ATTENDANCE COPY REQUESTS */}
          {(mobileHrFilter === "all" || mobileHrFilter === "attendance_copy") && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                  <FileText className="w-4 h-4" />
                  <span>Attendance Copy Vouchers ({filteredMobileAttCopies.length})</span>
                </h4>
              </div>

              {filteredMobileAttCopies.length === 0 ? (
                <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 text-center space-y-1.5">
                  <CheckCircle2 className="w-8 h-8 text-sky-400 mx-auto" />
                  <p className="text-xs font-bold text-white">No Pending Attendance Copies</p>
                  <p className="text-[11px] text-zinc-400">
                    No employees are currently requesting official attendance vouchers.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredMobileAttCopies.map((req) => {
                    const isProcessing = processingRequestId === req.id;
                    return (
                      <div
                        key={req.id || req.trackingNumber}
                        className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3 shadow-md"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h5 className="text-sm font-black text-white">{req.employeeName}</h5>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-bold">
                                #{req.employeeNumber}
                              </span>
                            </div>
                            <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                              Voucher Tracking: <strong className="text-sky-300">{req.trackingNumber}</strong>
                            </p>
                          </div>

                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/20 text-sky-400 border border-sky-500/40 uppercase">
                            Official Copy
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-zinc-950/70 border border-zinc-800/80 text-xs font-mono flex items-center gap-2 text-zinc-300">
                          <Calendar className="w-3.5 h-3.5 text-sky-400" />
                          <span>Range: <strong>{req.startDate}</strong> to <strong>{req.endDate}</strong></span>
                        </div>

                        {req.purpose && (
                          <div className="text-xs text-zinc-300 bg-zinc-950/40 p-2.5 rounded-xl border border-zinc-855 italic">
                            "{req.purpose}"
                          </div>
                        )}

                        {/* Admin note input */}
                        <input
                          type="text"
                          placeholder="Admin note for voucher (optional)..."
                          value={mobileAdminNotes[req.id || ""] || ""}
                          onChange={(e) => setMobileAdminNotes((prev) => ({ ...prev, [req.id || ""]: e.target.value }))}
                          className="w-full text-xs font-mono px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500"
                        />

                        {/* Touch Actions */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={() => handleMobileApproveAttCopy(req)}
                            className="py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-mono text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Check className="w-4 h-4" />
                            <span>{isProcessing ? "Processing..." : "Approve Voucher"}</span>
                          </button>

                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={() => handleMobileRejectAttCopy(req)}
                            className="py-2.5 px-3 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <X className="w-4 h-4" />
                            <span>Decline</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SECTION 3: TODAY'S SHIFT ROSTER STATUS (MOBILE VIEW) */}
          {mobileHrFilter === "today" && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4" />
                  <span>Today's Shift Roster ({todayLogs.length} Checked In, {unloggedCount} Unlogged)</span>
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {activeEmployees.map((emp) => {
                  const log = todayLogs.find((l) => l.employeeId === emp.id || l.employeeNumber === emp.employeeNumber);
                  const isPresent = log && (log.status === "Present" || log.status === "On Break" || log.status === "Late" || log.status === "Timed Out");
                  const isLate = log && isAttendanceLate(log);

                  return (
                    <div
                      key={emp.id || emp.employeeNumber}
                      className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          isPresent ? (isLate ? "bg-amber-400" : "bg-emerald-400") : "bg-zinc-600"
                        }`} />
                        <div className="truncate">
                          <div className="font-bold text-white truncate">{emp.fullName}</div>
                          <div className="text-[10px] text-zinc-400 font-mono">
                            #{emp.employeeNumber} • {emp.department}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                          isPresent 
                            ? (isLate ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30")
                            : "bg-zinc-800 text-zinc-400"
                        }`}>
                          {isPresent ? (isLate ? "Late" : log?.status || "Present") : "Not In"}
                        </span>
                        {log?.timeIn && (
                          <div className="text-[9px] text-zinc-500 font-mono mt-0.5">
                            In: {formatTo12Hour(log.timeIn)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {activeSubTab === "overtime" && (
        /* --- BRAND NEW SPECIALIZED OVERTIME AUDIT AND EXPORT PANEL --- */
        <div className="space-y-6 animate-fadeIn pb-12" id="overtime_reporting_module">
          
          {/* Section Heading with date constraints details */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-105 dark:border-zinc-900 pb-4">
            <div>
              <h3 className="text-lg font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-550" /> Overtime Performance & Payroll Integration Ledger
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                Calculated dynamically based on real log punchcards against standard shift parameters (break duration excluded).
              </p>
            </div>
            
            {/* Quick Actions Control Bar */}
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button
                onClick={handlePrint}
                className="px-3.5 py-2 text-xs font-semibold font-mono tracking-wide bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-850 text-zinc-800 dark:text-zinc-250 border border-zinc-200 dark:border-zinc-800 rounded-xl transition-all flex items-center gap-1.5"
                id="btn_print_pdf"
              >
                <Printer className="w-4 h-4" /> Print PDF Ledger
              </button>
              <button
                onClick={handleExportCSV}
                className="px-4 py-2 text-xs font-semibold font-mono tracking-wide bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-all shadow-sm flex items-center gap-1.5"
                id="btn_export_csv"
              >
                <FileSpreadsheet className="w-4 h-4" /> Export CSV Spreadsheet
              </button>
            </div>
          </div>

          {/* Group 2: Live Accumulated Overtime KPIs */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* KPI 1: Staff on Overtime */}
            <div className="p-4 bg-zinc-50/50 dark:bg-zinc-900/30 border border-zinc-150 dark:border-zinc-850 rounded-2xl shadow-xs">
              <span className="text-[10px] font-bold text-zinc-500 font-mono uppercase tracking-wider block">OT Staff Count</span>
              <div className="mt-2.5 flex items-baseline gap-2">
                <span className="text-2xl font-black text-zinc-850 dark:text-zinc-100">{otAggregation.staffWithOvertimeCount}</span>
                <span className="text-xs text-zinc-450 dark:text-zinc-500 font-medium font-mono">officially clocked</span>
              </div>
              <div className="w-full bg-zinc-250 dark:bg-zinc-800 h-1 rounded-full mt-3 overflow-hidden">
                <div 
                  className="bg-blue-500 h-full rounded-full" 
                  style={{ width: `${totalEmployees ? (otAggregation.staffWithOvertimeCount / totalEmployees) * 100 : 0}%` }} 
                />
              </div>
            </div>

            {/* KPI 2: Total OT Hours Accumulated */}
            <div className="p-4 bg-zinc-50/50 dark:bg-zinc-900/30 border border-zinc-150 dark:border-zinc-850 rounded-2xl shadow-xs">
              <span className="text-[10px] font-bold text-zinc-500 font-mono uppercase tracking-wider block">Total Clocked OT</span>
              <div className="mt-2.5 flex items-baseline gap-1">
                <span className="text-2xl font-black text-zinc-850 dark:text-zinc-100 font-mono">{otAggregation.grandTotalOtHours}</span>
                <span className="text-xs text-zinc-450 dark:text-zinc-500 font-medium font-mono">hours total</span>
              </div>
              <span className="text-[9px] text-zinc-450 font-mono mt-2 block">Accumulated over active range limit</span>
            </div>

            {/* KPI 3: Overtime Financial Liability summary */}
            <div className="p-4 bg-zinc-50/50 dark:bg-zinc-900/30 border border-zinc-150 dark:border-zinc-850 rounded-2xl shadow-xs">
              <span className="text-[10px] font-bold text-zinc-500 font-mono uppercase tracking-wider block">Estimated Wages Burden</span>
              <div className="mt-2.5 flex items-baseline gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="text-2xl font-black font-mono">{settings?.currency || "₱"}{(otAggregation?.grandTotalOtPay || 0).toLocaleString()}</span>
                <span className="text-[10px] font-mono font-bold">PHP</span>
              </div>
              <span className="text-[9px] text-zinc-455 dark:text-zinc-500 font-mono mt-2 block font-medium">Reflecting distinct OT premium ratios</span>
            </div>

            {/* KPI 4: Peak OT Contributor */}
            <div className="p-4 bg-zinc-50/50 dark:bg-zinc-900/30 border border-zinc-150 dark:border-zinc-850 rounded-2xl shadow-xs">
              <span className="text-[10px] font-bold text-zinc-500 font-mono uppercase tracking-wider block">Peak Hours Contributor</span>
              <div className="mt-2.5 flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-500 shrink-0" />
                <div className="truncate">
                  <span className="text-sm font-bold text-zinc-800 dark:text-zinc-150 block truncate">{otAggregation.highestOtEmployeeName}</span>
                  <span className="text-[10px] font-mono text-zinc-500 block font-bold">{otAggregation.highestSingleOtHours} Overtime Hrs</span>
                </div>
              </div>
            </div>
          </section>

          {/* Group 3: Realtime Ledger Filter and Range controls */}
          <div className="p-4 bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-850 rounded-2xl grid grid-cols-1 md:grid-cols-5 gap-4 print:hidden">
            
            {/* Search filter input block */}
            <div className="space-y-1.5 col-span-1 md:col-span-1">
              <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 font-mono uppercase block">Filter Staff / Role</label>
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Search by name, ID..."
                  value={otSearch}
                  onChange={(e) => setOtSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-800 dark:text-zinc-100"
                  id="ot_search_input"
                />
              </div>
            </div>

            {/* Department selector dropdown */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 font-mono uppercase block">Studio Department</label>
              <select
                value={otDept}
                onChange={(e) => setOtDept(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-800 dark:text-zinc-100 font-mono"
                id="ot_dept_select"
              >
                {departmentsList.map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>

            {/* Payroll Period Selector */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 font-mono uppercase block font-medium">Payroll Period Cutoff</label>
              <select
                value={otPeriodId}
                onChange={handlePeriodChange}
                className="w-full px-3 py-2 text-xs border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-850 dark:text-zinc-150 font-mono"
              >
                <option value="custom">Custom Date Range</option>
                {periods?.map(p => (
                  <option key={p.id} value={p.periodId || p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Start Date Limits selection */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 font-mono uppercase block font-medium">Cutoff From</label>
              <input
                type="date"
                value={otStartDate}
                onChange={(e) => { setOtStartDate(e.target.value); setOtPeriodId("custom"); }}
                className="w-full px-3 py-2 text-xs border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-850 dark:text-zinc-150 font-mono"
                id="ot_start_date_picker"
              />
            </div>

            {/* End Date Limits selection */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 font-mono uppercase block font-medium">Cutoff To</label>
              <input
                type="date"
                value={otEndDate}
                onChange={(e) => { setOtEndDate(e.target.value); setOtPeriodId("custom"); }}
                className="w-full px-3 py-2 text-xs border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-850 dark:text-zinc-150 font-mono"
                id="ot_end_date_picker"
              />
            </div>
          </div>

          {/* Group 4: Split Analytics Grid (Ledger + Recharts horizontal rating) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Visual Chart displaying OT contribution shares */}
            <div className="lg:col-span-1 p-5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs flex flex-col justify-between">
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider font-mono text-zinc-650 dark:text-zinc-400 mb-1 flex items-center gap-1.5 block">
                  <TrendingUp className="w-4 h-4 text-blue-500" /> Overtime Contributors List
                </h4>
                <p className="text-[10px] text-zinc-500">
                  Visual ranks of top employees with accumulated overtime hours in range logs configuration.
                </p>
              </div>

              {otChartDataset.length === 0 ? (
                <div className="h-60 flex flex-col items-center justify-center text-center text-zinc-450 font-mono">
                  <Clock className="w-8 h-8 text-zinc-300 dark:text-zinc-800 mb-2 animate-pulse" />
                  <p className="text-[10px] italic">Zero overtime logs in specified period range.</p>
                </div>
              ) : (
                <div className="h-64 sm:h-72 w-full mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={otChartDataset}
                      layout="vertical"
                      margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="2 2" horizontal={false} stroke="currentColor" className="text-zinc-150 dark:text-zinc-900" />
                      <XAxis type="number" style={{ fontSize: "9px", fontFamily: "monospace" }} stroke="currentColor" className="text-zinc-400" />
                      <YAxis dataKey="name" type="category" style={{ fontSize: "9px" }} stroke="currentColor" className="text-zinc-400" />
                      <Tooltip
                        contentStyle={{ 
                          borderRadius: "10px", 
                          backgroundColor: "#18181b",
                          border: "1px solid #27272a", 
                          fontSize: "10px",
                          color: "#f4f4f5"
                        }}
                      />
                      <Bar dataKey="OT Hours" fill="#2563EB" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Complete Data Ledger table */}
            <div className="lg:col-span-2 p-5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs space-y-4">
              <div className="flex md:items-center justify-between border-b border-zinc-100 dark:border-zinc-900 pb-3 flex-col sm:flex-row gap-2">
                <div>
                  <h4 className="font-bold text-xs uppercase tracking-wider font-mono text-zinc-650 dark:text-zinc-400 block">
                    Oligarch Payroll-Ready Spreadsheet Audit
                  </h4>
                  <p className="text-[10px] text-zinc-500">
                    Matching individual profiles against recorded shifts log history.
                  </p>
                </div>
                <div className="text-xs font-mono font-bold bg-blue-50 dark:bg-blue-955/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-md self-start sm:self-center">
                  Total Items: {filteredOtSummary.length} employees
                </div>
              </div>

              {filteredOtSummary.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center text-zinc-400 font-mono">
                  <Users className="w-10 h-10 text-zinc-200 dark:text-zinc-800 mb-2" />
                  <p className="text-xs">Zero records found matching selection criteria.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-150 dark:border-zinc-850 text-zinc-500 uppercase tracking-wider font-mono text-[9px] font-bold">
                        <th className="py-2.5">Staff details</th>
                        <th className="py-2.5">Department</th>
                        <th className="py-2.5 text-center">Shifts</th>
                        <th className="py-2.5 text-right">Standard Hrs</th>
                        <th className="py-2.5 text-right">Worked Hrs</th>
                        <th className="py-2.5 text-right text-blue-600 dark:text-blue-450">OT Hours</th>
                        <th className="py-2.5 text-right font-bold">OT Rate</th>
                        <th className="py-2.5 text-right text-emerald-600 dark:text-emerald-450">OT Pay</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-105 dark:divide-zinc-900">
                      {filteredOtSummary.map((item) => (
                        <tr 
                          key={item.employeeNumber} 
                          className={`hover:bg-zinc-50/50 dark:hover:bg-zinc-900/10 transition-colors text-xs text-zinc-700 dark:text-zinc-300 ${
                            item.totalOtHours > 0 ? "font-medium" : ""
                          }`}
                        >
                          {/* Staff name & number profile */}
                          <td className="py-3 flex items-center gap-2.5">
                            <img
                              src={item.profilePicture || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"}
                              className="w-8 h-8 rounded-full border border-zinc-200 dark:border-zinc-800 shrink-0 object-cover"
                              alt="Staff Avatar"
                              referrerPolicy="no-referrer"
                            />
                            <div>
                              <span className="font-bold text-zinc-800 dark:text-zinc-200 block leading-tight">{item.fullName}</span>
                              <span className="text-[10px] text-zinc-500 font-mono block">{item.employeeNumber}</span>
                            </div>
                          </td>

                          {/* Dept / role description label */}
                          <td className="py-3">
                            <span className="text-[10px] font-bold font-mono text-zinc-500 block leading-tight">{item.department}</span>
                            <span className="text-[9px] text-zinc-450 block truncate max-w-[110px]">{item.position}</span>
                          </td>

                          {/* shifts count badge */}
                          <td className="py-3 text-center">
                            <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded font-mono text-[10px]">
                              {item.shiftsCount}
                            </span>
                          </td>

                          {/* Est standard hours (shifts * 8) */}
                          <td className="py-3 text-right font-mono text-[10px] text-zinc-500">
                            {item.shiftsCount * 8}h
                          </td>

                          {/* Gross logged hours */}
                          <td className="py-3 text-right font-mono text-[10px]">
                            {item.totalWorkedHours}
                          </td>

                          {/* accumulated OT hours badge */}
                          <td className="py-3 text-right">
                            {item.totalOtHours > 0 ? (
                              <span className="px-2 py-0.5 bg-blue-55 dark:bg-blue-955/20 text-blue-600 dark:text-blue-400 font-bold font-mono rounded text-[10.5px]">
                                {item.totalOtHours} hrs
                              </span>
                            ) : (
                              <span className="font-mono text-zinc-400 text-[10px]">0.00</span>
                            )}
                          </td>

                          {/* ot multiplier rate hourly */}
                          <td className="py-3 text-right font-mono text-[10px]">
                            {settings?.currency || "₱"}{item.otRate || 0}
                          </td>

                          {/* computed estimated pay wages burden */}
                          <td className="py-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {settings?.currency || "₱"}{(item?.estimatedOtPay || 0).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeSubTab === "announcements" && (
        <div className="space-y-6 animate-fadeIn pb-12">
          {/* Section Heading */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-100 dark:border-zinc-800 pb-4">
            <div>
              <h3 className="text-lg font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-blue-500" /> Company Bulletins & Announcements System
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                Publish company-wide announcements instantly to the employee-facing portal.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Announcement Form */}
            <div className="lg:col-span-1 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
              <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 flex items-center justify-between mb-4">
                <span className="flex items-center gap-2">
                  {editingAnnId ? <Pencil className="w-4 h-4 text-amber-500" /> : <Plus className="w-4 h-4 text-blue-500" />}
                  {editingAnnId ? "Edit Announcement" : "Create Announcement"}
                </span>
                {editingAnnId && (
                  <button
                    type="button"
                    onClick={handleCancelEditAnnouncement}
                    className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 uppercase font-bold cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </h4>
              <form onSubmit={handleSendAnnouncement} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-500 font-mono">ANNOUNCEMENT TITLE</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. System Maintenance Schedule"
                    value={annTitle}
                    onChange={(e) => setAnnTitle(e.target.value)}
                    className="w-full text-sm px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 dark:text-zinc-100"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-500 font-mono">PUBLICATION DATE</label>
                  <input
                    type="date"
                    required
                    value={pubDate}
                    onChange={(e) => setPubDate(e.target.value)}
                    className="w-full text-sm px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 dark:text-zinc-100"
                  />
                </div>

                <div className="space-y-1.5 relative">
                  <label className="text-xs font-semibold text-zinc-500 font-mono">CONTENT / MESSAGE</label>
                  <div className="relative">
                    <textarea
                      id="announcement-textarea"
                      rows={6}
                      required
                      placeholder="Type the announcement message details here (use @ to mention employees)..."
                      value={annMessage}
                      onChange={handleTextareaChange}
                      onKeyDown={handleTextareaKeyDown}
                      className="w-full text-sm px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 dark:text-zinc-100 resize-none font-sans"
                    />
                    
                    {/* Floating Mention Autocomplete Dropdown */}
                    {showMentionDropdown && mentionDropdownEmployees.length > 0 && (
                      <div className="absolute left-0 bottom-full mb-2.5 z-50 w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
                        <div className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-150 dark:border-zinc-800 flex items-center justify-between">
                          <span className="text-[10px] font-bold text-zinc-500 font-mono uppercase tracking-wider">Mention Employee</span>
                          <span className="text-[9px] text-zinc-400 font-mono">↑↓ to navigate, ↵ to select</span>
                        </div>
                        <div className="p-1 max-h-48 overflow-y-auto space-y-0.5">
                          {mentionDropdownEmployees.map((emp, idx) => {
                            const isSelected = idx === activeMentionIndex;
                            return (
                              <button
                                type="button"
                                key={emp.id}
                                onClick={() => handleSelectEmployeeMention(emp)}
                                onMouseEnter={() => setActiveMentionIndex(idx)}
                                className={`w-full text-left px-2.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                                  isSelected
                                    ? "bg-blue-600 text-white shadow-xs"
                                    : "hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                                }`}
                              >
                                <span className="truncate">@{emp.fullName}</span>
                                <span className={`text-[9px] font-mono truncate ml-2 uppercase ${isSelected ? "text-blue-200" : "text-zinc-450 dark:text-zinc-500"}`}>
                                  {emp.department}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* TAG / MENTION EMPLOYEES */}
                <div className="space-y-2 border-t border-zinc-100 dark:border-zinc-900 pt-4 mt-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-500 font-mono">TAG / MENTION EMPLOYEES</label>
                    {selectedMentionIds.length > 0 && (
                      <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-full font-mono">
                        {selectedMentionIds.length} SELECTED
                      </span>
                    )}
                  </div>
                  
                  <div className="relative mt-1">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Search active employee name or department..."
                      value={mentionSearch}
                      onChange={(e) => setMentionSearch(e.target.value)}
                      className="w-full text-xs pl-8 pr-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 dark:text-zinc-100 font-semibold"
                    />
                  </div>

                  <div className="max-h-36 overflow-y-auto border border-zinc-150 dark:border-zinc-850 rounded-xl p-2.5 space-y-1 bg-zinc-50/30 dark:bg-zinc-950/20">
                    {filteredMentionEmployees.length === 0 ? (
                      <p className="text-[10px] text-zinc-400 text-center py-4 font-mono">No active employees found</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-1">
                        {filteredMentionEmployees.map((emp) => {
                          const isTagged = selectedMentionIds.includes(emp.id || "");
                          return (
                            <button
                              type="button"
                              key={emp.id}
                              onClick={() => handleToggleMention(emp.id || "")}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                                isTagged
                                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 dark:border-blue-500/30 shadow-xs"
                                  : "hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-transparent text-zinc-700 dark:text-zinc-300"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-1.5 h-1.5 rounded-full transition-transform ${isTagged ? "bg-blue-500 scale-125" : "bg-zinc-300 dark:bg-zinc-700"}`} />
                                <span className="truncate max-w-[140px]">{emp.fullName}</span>
                              </div>
                              <span className="text-[9px] text-zinc-400 font-mono font-medium truncate ml-2">
                                {emp.department}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {selectedMentionIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                      {selectedMentionIds.map((empId) => {
                        const emp = employees.find((e) => e.id === empId);
                        if (!emp) return null;
                        return (
                          <div 
                            key={empId}
                            className="inline-flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 text-[10px] px-2 py-0.5 rounded-md font-medium border border-zinc-200 dark:border-zinc-800 animate-in fade-in zoom-in-95 duration-150"
                          >
                            <span>@{emp.fullName.split(" ")[0]}</span>
                            <button 
                              type="button"
                              onClick={() => handleToggleMention(empId)}
                              className="hover:text-red-500 font-bold transition-colors cursor-pointer"
                            >
                              &times;
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isBroadcasting}
                    className={`flex-1 font-bold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                      editingAnnId
                        ? "bg-amber-600 hover:bg-amber-700 text-white disabled:bg-zinc-400"
                        : "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-zinc-400"
                    }`}
                  >
                    {editingAnnId ? (
                      <>
                        <Pencil className="w-4 h-4" /> {isBroadcasting ? "Updating..." : "Update Announcement"}
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" /> {isBroadcasting ? "Publishing..." : "Publish Announcement"}
                      </>
                    )}
                  </button>
                  {editingAnnId && (
                    <button
                      type="button"
                      onClick={handleCancelEditAnnouncement}
                      className="px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-750 dark:text-zinc-300 font-semibold rounded-xl text-sm transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Announcement Feed */}
            <div className="lg:col-span-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
              <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-2 border-b border-zinc-100 dark:border-zinc-900">
                <span>Active Published Bulletins ({displayedAnnouncements.length})</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(e) => setShowArchived(e.target.checked)}
                      className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:bg-zinc-900 dark:border-zinc-800 w-3.5 h-3.5"
                    />
                    <span>Show Archived</span>
                  </label>
                  <span className="text-[10px] text-zinc-400 font-mono hidden sm:inline">| Sorted by latest</span>
                </div>
              </h4>

              {loadingAnnouncements ? (
                <div className="text-center py-12 text-zinc-500 font-mono text-xs">
                  Loading active announcements...
                </div>
              ) : displayedAnnouncements.length === 0 ? (
                <div className="text-center py-16 text-zinc-450 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-zinc-50/50 dark:bg-zinc-900/10">
                  <Megaphone className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold">No bulletins found in this view.</p>
                  <p className="text-[10px] text-zinc-400 mt-1">Try toggling "Show Archived" or fill out the form on the left to publish.</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-[550px] overflow-y-auto pr-1">
                  {displayedAnnouncements.map((bulletin) => (
                    <div
                      key={bulletin.id}
                      className={`p-4 border rounded-xl bg-zinc-50/30 dark:bg-zinc-900/10 hover:border-zinc-350 dark:hover:border-zinc-750 transition-colors ${
                        bulletin.isArchived 
                          ? "opacity-65 border-zinc-250 dark:border-zinc-850 bg-zinc-100/20 dark:bg-zinc-900/5" 
                          : "border-zinc-150 dark:border-zinc-800"
                      }`}
                    >
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1">
                          <h5 className="font-extrabold text-zinc-900 dark:text-zinc-100 text-sm flex items-center gap-2 flex-wrap">
                            <span>{bulletin.title}</span>
                            {bulletin.isArchived && (
                              <span className="text-[8px] bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-450 px-2 py-0.5 rounded-full font-mono uppercase font-bold tracking-wider">
                                Archived
                              </span>
                            )}
                          </h5>
                          <p className="text-[10.5px] text-zinc-500 font-mono">
                            Publication Date: <span className="font-bold text-blue-600 dark:text-blue-400">{bulletin.publicationDate ? new Date(bulletin.publicationDate).toLocaleDateString() : new Date(bulletin.createdAt).toLocaleDateString()}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleToggleArchiveAnnouncement(bulletin)}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              bulletin.isArchived
                                ? "text-blue-600 bg-blue-50 dark:bg-blue-955/20 hover:bg-blue-100 dark:hover:bg-blue-950/40"
                                : "text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-955/20"
                            }`}
                            title={bulletin.isArchived ? "Unarchive Bulletin" : "Archive Bulletin"}
                          >
                            <Archive className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleStartEditAnnouncement(bulletin)}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              editingAnnId === bulletin.id
                                ? "text-amber-500 bg-amber-50 dark:bg-amber-950/20"
                                : "text-zinc-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                            }`}
                            title="Edit Bulletin"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => bulletin.id && handleDeleteAnnouncement(bulletin.id, bulletin.title)}
                            className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors cursor-pointer"
                            title="Delete Bulletin"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-zinc-600 dark:text-zinc-350 mt-3 whitespace-pre-wrap font-sans leading-relaxed">
                        {bulletin.message}
                      </p>
                      {bulletin.mentionedEmployeeNames && bulletin.mentionedEmployeeNames.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2.5">
                          <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-mono self-center mr-1">TAGGED:</span>
                          {bulletin.mentionedEmployeeNames.map((name, i) => (
                            <span 
                              key={i} 
                              className="text-[9px] bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold px-1.5 py-0.5 rounded-md font-mono"
                            >
                              @{name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Displayed reactions for admin view */}
                      {bulletin.reactions && Object.keys(bulletin.reactions).length > 0 && (
                        <div className="mt-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-900 flex flex-wrap items-center gap-2">
                          <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-mono self-center mr-1">REACTIONS ({Object.keys(bulletin.reactions).length}):</span>
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

                            return Object.entries(grouped).map(([emoji, people]) => {
                              const listNames = people.map(p => p.name).join(", ");
                              return (
                                <span 
                                  key={emoji}
                                  className="inline-flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 px-2 py-0.5 rounded-full text-xs border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 font-sans cursor-help group relative"
                                  title={`Reacted by: ${listNames}`}
                                >
                                  <span>{emoji}</span>
                                  <span className="font-mono text-[10px] font-bold">{people.length}</span>
                                  
                                  {/* Hover tooltip for admin */}
                                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1.5 hidden group-hover:block z-20 bg-zinc-900 text-white text-[9px] rounded px-2 py-1 whitespace-nowrap shadow-md pointer-events-none">
                                    {listNames}
                                  </div>
                                </span>
                              );
                            });
                          })()}
                        </div>
                      )}
                      <div className="mt-3 pt-2.5 border-t border-dashed border-zinc-150 dark:border-zinc-800 flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                        <span>Published by {bulletin.sender || "Oligarch Admin"}</span>
                        <span>Created: {new Date(bulletin.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 animate-in fade-in slide-in-from-bottom-5 duration-300 max-w-sm bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 px-4 py-3 rounded-2xl shadow-xl border border-zinc-800 dark:border-zinc-200 flex items-center gap-3">
          {toastType === "success" ? (
            <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          )}
          <span className="text-xs font-semibold leading-relaxed font-sans">{toastMessage}</span>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            
            <div className="text-center space-y-1.5">
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 font-sans">
                Delete Announcement?
              </h3>
              <p className="text-xs text-zinc-550 dark:text-zinc-400 leading-relaxed font-sans">
                Are you sure you want to delete the bulletin <strong className="text-zinc-800 dark:text-zinc-200">"{deleteConfirmTitle}"</strong>? This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmId(null);
                  setDeleteConfirmTitle("");
                }}
                className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-white rounded-lg text-sm font-bold shadow-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeDeleteAnnouncement}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
