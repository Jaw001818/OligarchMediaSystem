import React, { useState } from "react";
import { db, handleFirestoreError, OperationType, doc, updateDoc, addDoc, collection, deleteDoc, getDocs, setDoc } from "../firebase";
import { LeaveRequest, Employee, AppSettings, AttendanceCopyRequest } from "../types";
import { sendNotificationEmail, getBirthdayWeekInfo } from "../utils";
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  FileText, 
  MessageSquare, 
  ExternalLink, 
  ShieldCheck, 
  Search,
  Filter,
  Check,
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Trash2
} from "lucide-react";

interface RequestManagerProps {
  requests: LeaveRequest[];
  onRefresh: () => void;
  employees?: Employee[];
  settings?: AppSettings;
  attendanceCopyRequests?: AttendanceCopyRequest[];
}

export default function RequestManager({ requests, onRefresh, employees, settings, attendanceCopyRequests = [] }: RequestManagerProps) {
  const [filterType, setFilterType] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [search, setSearch] = useState("");

  const [managerTab, setManagerTab] = useState<"leave" | "attendance_copy">("leave");
  const [attendanceRequests, setAttendanceRequests] = useState<AttendanceCopyRequest[]>([]);
  const [loadingAttCopy, setLoadingAttCopy] = useState(false);

  const [quickBirthdayEmp, setQuickBirthdayEmp] = useState<Employee | null>(null);
  const [quickBirthdayVal, setQuickBirthdayVal] = useState("");
  const [showQuickBirthdayModal, setShowQuickBirthdayModal] = useState(false);
  const [isSavingQuickBirthday, setIsSavingQuickBirthday] = useState(false);

  const pendingLeavesCount = requests.filter(r => r.status === "Pending").length;
  const pendingAttendanceCount = (attendanceCopyRequests.length > 0 ? attendanceCopyRequests : attendanceRequests).filter(r => r.status === "Pending").length;

  const fetchAttendanceRequests = async () => {
    setLoadingAttCopy(true);
    try {
      const snap = await getDocs(collection(db, "attendance_copy_requests"));
      const list: AttendanceCopyRequest[] = [];
      snap.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() } as AttendanceCopyRequest);
      });
      // Sort by submittedAt descending
      list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      setAttendanceRequests(list);
    } catch (err) {
      console.error("Failed to load attendance copy requests:", err);
    } finally {
      setLoadingAttCopy(false);
    }
  };

  React.useEffect(() => {
    fetchAttendanceRequests();
  }, []);

  // Approve Attendance Copy Request
  const handleApproveAttendanceCopy = async (req: AttendanceCopyRequest) => {
    if (!req.id) return;
    setAnsweringId(req.id);

    const adminFeedback = notesObj[req.id] || "Approved by HR Administration.";
    const employee = employees?.find(e => 
      (e.id && req.employeeId && e.id === req.employeeId) || 
      (e.employeeNumber && req.employeeNumber && e.employeeNumber.trim().toLowerCase() === req.employeeNumber.trim().toLowerCase())
    );
    const recipientEmail = employee?.email || "hr.oligarchmedia@gmail.com";

    try {
      const docRef = doc(db, "attendance_copy_requests", req.id);
      await updateDoc(docRef, {
        status: "Approved",
        adminNotes: adminFeedback,
        approvedAt: new Date().toISOString()
      });

      // Email dispatch
      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #E4E4E7; border-radius: 12px;">
          <h3 style="color: #10B981;">Attendance Record Copy Approved</h3>
          <p>Dear ${req.employeeName},</p>
          <p>Your request for an official copy of your attendance records has been approved.</p>
          <p>📅 <strong>Requested Range:</strong> ${req.startDate} to ${req.endDate}</p>
          <p>💬 <strong>Admin Notes:</strong> ${adminFeedback}</p>
          <p>You can now log into your Employee Portal, search for this request with tracking number <strong>${req.trackingNumber}</strong> in the tracking tab, and download your official PDF copy.</p>
          <hr style="border: 0; border-top: 1px solid #F4F4F5;" />
          <p style="font-size: 11px; color: #71717A;">Oligarch Media Graphic Design Studio • HR Administration</p>
        </div>
      `;

      const emailResponse = await sendNotificationEmail(
        recipientEmail,
        `[APPROVED] Attendance copy request ${req.trackingNumber}`,
        emailHtml
      );
      const emailStatus = emailResponse && emailResponse.success ? "Success" : "Failed";

      // Save email log
      try {
        await addDoc(collection(db, "email_logs"), {
          recipient: `${req.employeeName} (${recipientEmail})`,
          subject: `Approved Attendance Copy: ${req.trackingNumber}`,
          status: emailStatus,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error("Failed to write email log:", err);
      }

      // Save system audit log
      try {
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Approved Attendance Copy Request",
          details: `${req.employeeName} - Period ${req.startDate} to ${req.endDate} Approved.`,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error("Failed to write audit log:", err);
      }

      // Automated system notifications collection trigger
      try {
        await addDoc(collection(db, "notifications"), {
          title: `Attendance Copy Approved`,
          message: `Approved: Request voucher ${req.trackingNumber} for ${req.employeeName} has been approved.`,
          type: "Success",
          read: false,
          createdAt: new Date().toISOString(),
          employeeId: req.employeeId,
          attendanceCopyRequestId: req.id
        });
      } catch (err) {
        console.error("Failed to write notification:", err);
      }

      triggerToast(`Request ${req.trackingNumber} Approved successfully.`);
      fetchAttendanceRequests();
    } catch (err) {
      console.error(err);
      triggerToast(err instanceof Error ? err.message : "Failed to approve request.");
    } finally {
      setAnsweringId(null);
    }
  };

  // Reject Attendance Copy Request
  const handleRejectAttendanceCopy = async (req: AttendanceCopyRequest) => {
    if (!req.id) return;
    setAnsweringId(req.id);

    const adminFeedback = notesObj[req.id] || "Rejected due to validation errors.";
    const employee = employees?.find(e => 
      (e.id && req.employeeId && e.id === req.employeeId) || 
      (e.employeeNumber && req.employeeNumber && e.employeeNumber.trim().toLowerCase() === req.employeeNumber.trim().toLowerCase())
    );
    const recipientEmail = employee?.email || "hr.oligarchmedia@gmail.com";

    try {
      const docRef = doc(db, "attendance_copy_requests", req.id);
      await updateDoc(docRef, {
        status: "Rejected",
        adminNotes: adminFeedback
      });

      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #E4E4E7; border-radius: 12px;">
          <h3 style="color: #EF4444;">Attendance Record Copy Rejected</h3>
          <p>Dear ${req.employeeName},</p>
          <p>Unfortunately, your request for an official copy of your attendance records from ${req.startDate} to ${req.endDate} has been rejected.</p>
          <p>💬 <strong>Admin Notes:</strong> ${adminFeedback}</p>
          <hr style="border: 0; border-top: 1px solid #F4F4F5;" />
          <p style="font-size: 11px; color: #71717A;">Oligarch Media Graphic Design Studio • HR Administration</p>
        </div>
      `;

      const emailResponse = await sendNotificationEmail(
        recipientEmail,
        `[REJECTED] Attendance copy request ${req.trackingNumber}`,
        emailHtml
      );
      const emailStatus = emailResponse && emailResponse.success ? "Success" : "Failed";

      // Save email log
      try {
        await addDoc(collection(db, "email_logs"), {
          recipient: `${req.employeeName} (${recipientEmail})`,
          subject: `Rejected Attendance Copy: ${req.trackingNumber}`,
          status: emailStatus,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error("Failed to write email log:", err);
      }

      // Save audit
      try {
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Rejected Attendance Copy Request",
          details: `${req.employeeName} - Period ${req.startDate} to ${req.endDate} Rejected.`,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error("Failed to write audit log:", err);
      }

      // Automated system notifications collection trigger
      try {
        await addDoc(collection(db, "notifications"), {
          title: `Attendance Copy Rejected`,
          message: `Rejected: Request voucher ${req.trackingNumber} for ${req.employeeName} has been rejected.`,
          type: "Alert",
          read: false,
          createdAt: new Date().toISOString(),
          employeeId: req.employeeId,
          attendanceCopyRequestId: req.id
        });
      } catch (err) {
        console.error("Failed to write notification:", err);
      }

      triggerToast(`Request ${req.trackingNumber} Rejected.`);
      fetchAttendanceRequests();
    } catch (err) {
      console.error(err);
      triggerToast(err instanceof Error ? err.message : "Failed to reject request.");
    } finally {
      setAnsweringId(null);
    }
  };

  // Delete Attendance Copy Request
  const handleDeleteAttendanceCopy = async (req: AttendanceCopyRequest) => {
    if (!req.id) return;
    triggerConfirm(
      "Confirm Deletion",
      `Are you sure you want to permanently delete the attendance copy request "${req.trackingNumber}" for ${req.employeeName}? This action cannot be undone.`,
      async () => {
        try {
          await deleteDoc(doc(db, "attendance_copy_requests", req.id));
          
          try {
            await addDoc(collection(db, "audit_logs"), {
              user: "Admin",
              action: "Deleted Attendance Copy Request",
              details: `Permanently deleted attendance copy request ${req.trackingNumber} for ${req.employeeName}.`,
              timestamp: new Date().toISOString()
            });
          } catch (auditErr) {
            console.warn("Failed to log deleted request to audit_logs", auditErr);
          }

          triggerToast(`Successfully deleted request ${req.trackingNumber}.`);
          fetchAttendanceRequests();
        } catch (err) {
          console.error(err);
          triggerToast("Failed to delete request.");
        }
      }
    );
  };

  const [notesObj, setNotesObj] = useState<{ [reqId: string]: string }>({});
  const [answeringId, setAnsweringId] = useState<string | null>(null);

  // Calendar States
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(new Date().getMonth()); // 0-11
  const [selectedDate, setSelectedDate] = useState<string | null>(null); // YYYY-MM-DD format if selected

  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Alert/Confirm Dialog States
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
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

  // 1. Approve Leave Request
  const handleApprove = async (req: LeaveRequest) => {
    if (!req.id) return;
    setAnsweringId(req.requestId);

    const adminFeedback = notesObj[req.requestId] || "Approved by HR Administration.";
    const employee = employees?.find(e => 
      (e.id && req.employeeId && e.id === req.employeeId) || 
      (e.employeeNumber && req.employeeNumber && e.employeeNumber.trim().toLowerCase() === req.employeeNumber.trim().toLowerCase())
    );
    const recipientEmail = employee?.email || "hr.oligarchmedia@gmail.com";

    let bdayInfo: any = null;
    if (req.type === "Birthday Leave") {
      if (!employee?.birthday) {
        alert(`Cannot Approve Birthday Leave: Employee "${req.employeeName}" does not have a birthday registered in their profile. Please set their birthday first.`);
        setQuickBirthdayEmp(employee || null);
        setQuickBirthdayVal("");
        setShowQuickBirthdayModal(true);
        return;
      }
      bdayInfo = getBirthdayWeekInfo(employee.birthday, req.startDate);
      if (!bdayInfo.isValid) {
        alert(`Cannot Approve Birthday Leave: Invalid birthday for "${req.employeeName}" (${employee.birthday}). Please update to YYYY-MM-DD.`);
        return;
      }
      if (!bdayInfo.isInBirthdayWeek(req.startDate)) {
        alert(`Cannot Approve Birthday Leave: Per company policy, Birthday Leave can ONLY be approved during the employee's birthday week (${bdayInfo.weekStartMondayStr} to ${bdayInfo.weekEndFridayStr}). The requested date (${req.startDate}) is outside the birthday week for ${req.employeeName} (Birthday: ${bdayInfo.birthdayFormatted}).`);
        return;
      }
    }

    try {
      try {
        const docRef = doc(db, "leave_requests", req.id);
        await updateDoc(docRef, {
          status: "Approved",
          adminNotes: adminFeedback
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `leave_requests/${req.id}`);
      }

      // Automatically create or update attendance credit record for the approved leave dates
      if (req.startDate) {
        try {
          const startD = new Date(req.startDate);
          const endD = new Date(req.endDate || req.startDate);
          
          // Get all attendance documents to find matching records for this employee
          const attSnap = await getDocs(collection(db, "attendance"));
          
          for (let cur = new Date(startD); cur <= endD; cur.setDate(cur.getDate() + 1)) {
            const curStr = cur.toISOString().split("T")[0];
            const matchingDocs: any[] = [];
            
            attSnap.forEach(d => {
              const data = d.data();
              if (data.date === curStr) {
                const matchId = req.employeeId && data.employeeId === req.employeeId;
                const matchNum = req.employeeNumber && data.employeeNumber === req.employeeNumber;
                const matchName = req.employeeName && data.employeeName && data.employeeName.trim().toLowerCase() === req.employeeName.trim().toLowerCase();
                if (matchId || matchNum || matchName) {
                  matchingDocs.push({ id: d.id, ...data });
                }
              }
            });

            const targetHours = req.type === "Absent Notice" ? 0 : 8;
            const noteText = req.type === "Birthday Leave"
              ? `Approved Birthday Leave (${bdayInfo?.birthdayFormatted || "Birthday"}, week ${bdayInfo?.weekStartMondayStr || ""}–${bdayInfo?.weekEndFridayStr || ""})`
              : `Approved ${req.type} Credit`;

            if (matchingDocs.length > 0) {
              // Update the primary document to remove any late minutes or clock-in records
              const primaryDocId = matchingDocs[0].id;
              await updateDoc(doc(db, "attendance", primaryDocId), {
                status: req.type,
                hoursWorked: targetHours,
                otHours: 0,
                lateMinutes: 0,
                isLateExcused: true,
                timeIn: null,
                timeOut: null,
                breakStart: null,
                breakEnd: null,
                notes: noteText
              });

              // Clean up any extraneous duplicate attendance entries for this employee on this date
              for (let i = 1; i < matchingDocs.length; i++) {
                try {
                  await deleteDoc(doc(db, "attendance", matchingDocs[i].id));
                } catch (delErr) {
                  console.error("Error deleting duplicate attendance doc:", delErr);
                }
              }
            } else {
              // Create clean attendance credit
              const targetDocId = `${req.employeeId || req.employeeNumber}_${curStr}`;
              await setDoc(doc(db, "attendance", targetDocId), {
                employeeId: req.employeeId || "",
                employeeNumber: req.employeeNumber || "",
                employeeName: req.employeeName || "",
                date: curStr,
                timeIn: null,
                timeOut: null,
                breakStart: null,
                breakEnd: null,
                status: req.type,
                hoursWorked: targetHours,
                otHours: 0,
                lateMinutes: 0,
                isLateExcused: true,
                notes: noteText
              });
            }
          }
        } catch (attErr) {
          console.error("Error creating/updating attendance credit for leave:", attErr);
        }
      }

      // Email dispatch
      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #E4E4E7; border-radius: 12px;">
          <h3 style="color: #10B981;">Leave Request Approved</h3>
          <p>Dear ${req.employeeName},</p>
          <p>We are pleased to inform you that your request for <strong>${req.type}</strong> has been approved.</p>
          <p>📅 <strong>Scheduled Date(s):</strong> ${req.type === "Paid Leave" ? `${req.startDate} to ${req.endDate}` : req.startDate}</p>
          <p>💬 <strong>Admin Notes:</strong> ${adminFeedback}</p>
          <hr style="border: 0; border-top: 1px solid #F4F4F5;" />
          <p style="font-size: 11px; color: #71717A;">Oligarch Media Graphic Design Studio • HR Administration</p>
        </div>
      `;

      const emailResponse = await sendNotificationEmail(
        recipientEmail,
        `[APPROVED] Request voucher ${req.trackingNumber}`,
        emailHtml
      );
      const emailStatus = emailResponse && emailResponse.success ? "Success" : "Failed";

      // Save email log
      try {
        await addDoc(collection(db, "email_logs"), {
          recipient: `${req.employeeName} (${recipientEmail})`,
          subject: `Approved: ${req.trackingNumber}`,
          status: emailStatus,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, "email_logs");
      }

      // Save system audit log
      try {
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Approved Leave Request",
          details: `${req.employeeName} - ${req.type} Approved.`,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, "audit_logs");
      }

      // Automated system notifications collection trigger
      try {
        await addDoc(collection(db, "notifications"), {
          title: `Leave Request Approved`,
          message: `Approved: Request voucher ${req.trackingNumber} for ${req.employeeName} has been approved.`,
          type: "Success",
          read: false,
          createdAt: new Date().toISOString(),
          employeeId: req.employeeId,
          leaveRequestId: req.id || req.requestId
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, "notifications");
      }

      triggerToast(`Request ${req.trackingNumber} Approved successfully.`);
      onRefresh();
    } catch (err) {
      console.error(err);
      triggerToast(err instanceof Error ? err.message : "Failed to approve request.");
    } finally {
      setAnsweringId(null);
    }
  };

  // 2. Reject Leave Request
  const handleReject = async (req: LeaveRequest) => {
    if (!req.id) return;
    setAnsweringId(req.requestId);

    const adminFeedback = notesObj[req.requestId] || "Rejected due to operational requirements.";
    const employee = employees?.find(e => 
      (e.id && req.employeeId && e.id === req.employeeId) || 
      (e.employeeNumber && req.employeeNumber && e.employeeNumber.trim().toLowerCase() === req.employeeNumber.trim().toLowerCase())
    );
    const recipientEmail = employee?.email || "hr.oligarchmedia@gmail.com";

    try {
      try {
        const docRef = doc(db, "leave_requests", req.id);
        await updateDoc(docRef, {
          status: "Rejected",
          adminNotes: adminFeedback
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `leave_requests/${req.id}`);
      }

      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #E4E4E7; border-radius: 12px;">
          <h3 style="color: #EF4444;">Leave Request Rejected</h3>
          <p>Dear ${req.employeeName},</p>
          <p>Unfortunately, your request for <strong>${req.type}</strong> has been rejected or postponed.</p>
          <p>💬 <strong>Admin Notes:</strong> ${adminFeedback}</p>
          <hr style="border: 0; border-top: 1px solid #F4F4F5;" />
          <p style="font-size: 11px; color: #71717A;">Oligarch Media Graphic Design Studio • HR Administration</p>
        </div>
      `;

      const emailResponse = await sendNotificationEmail(
        recipientEmail,
        `[REJECTED] Request voucher ${req.trackingNumber}`,
        emailHtml
      );
      const emailStatus = emailResponse && emailResponse.success ? "Success" : "Failed";

      // Save email log
      try {
        await addDoc(collection(db, "email_logs"), {
          recipient: `${req.employeeName} (${recipientEmail})`,
          subject: `Rejected: ${req.trackingNumber}`,
          status: emailStatus,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, "email_logs");
      }

      // Save audit
      try {
        await addDoc(collection(db, "audit_logs"), {
          user: "Admin",
          action: "Rejected Leave Request",
          details: `${req.employeeName} - ${req.type} Rejected.`,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, "audit_logs");
      }

      // Automated system notifications collection trigger
      try {
        await addDoc(collection(db, "notifications"), {
          title: `Leave Request Rejected`,
          message: `Rejected: Request voucher ${req.trackingNumber} for ${req.employeeName} has been rejected.`,
          type: "Alert",
          read: false,
          createdAt: new Date().toISOString(),
          employeeId: req.employeeId,
          leaveRequestId: req.id || req.requestId
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, "notifications");
      }

      triggerToast(`Request ${req.trackingNumber} Rejected.`);
      onRefresh();
    } catch (err) {
      console.error(err);
      triggerToast(err instanceof Error ? err.message : "Failed to reject request.");
    } finally {
      setAnsweringId(null);
    }
  };

  // 3. Delete Leave Request
  const handleDelete = async (req: LeaveRequest) => {
    if (!req.id) return;
    triggerConfirm(
      "Confirm Request Deletion",
      `Are you sure you want to permanently delete the leave request/notice voucher "${req.trackingNumber}" for ${req.employeeName}? This action cannot be undone.`,
      async () => {
        try {
          await deleteDoc(doc(db, "leave_requests", req.id));
          
          try {
            await addDoc(collection(db, "audit_logs"), {
              user: "Admin",
              action: "Deleted Leave Request",
              details: `Permanently deleted leave request voucher ${req.trackingNumber} for ${req.employeeName}.`,
              timestamp: new Date().toISOString()
            });
          } catch (auditErr) {
            console.warn("Failed to log deleted request to audit_logs", auditErr);
          }

          triggerToast(`Successfully deleted request voucher ${req.trackingNumber}.`);
          onRefresh();
        } catch (err) {
          console.error(err);
          handleFirestoreError(err, OperationType.DELETE, `leave_requests/${req.id}`);
        }
      }
    );
  };

  // Filter requests
  const filteredRequests = requests.filter((req) => {
    const matchesSearch = 
      req.employeeName.toLowerCase().includes(search.toLowerCase()) ||
      req.trackingNumber.toLowerCase().includes(search.toLowerCase());

    const matchesType = filterType === "All" || req.type === filterType;
    const matchesStatus = filterStatus === "All" || req.status === filterStatus;

    return matchesSearch && matchesType && matchesStatus;
  });

  const filteredAttendanceRequests = (attendanceCopyRequests.length > 0 ? attendanceCopyRequests : attendanceRequests).filter((req) => {
    const matchesSearch = 
      req.employeeName.toLowerCase().includes(search.toLowerCase()) ||
      req.trackingNumber.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = filterStatus === "All" || req.status === filterStatus;

    return matchesSearch && matchesStatus;
  });

  // Calendar Helpers
  const getCalendarDays = () => {
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const startDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();

    const gridDays: { dayNum: number; isCurrentMonth: boolean; dateString: string }[] = [];
    
    // Previous month's trailing days
    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const pm = currentMonth === 0 ? 11 : currentMonth - 1;
      const py = currentMonth === 0 ? currentYear - 1 : currentYear;
      const dNum = prevMonthDays - i;
      gridDays.push({
        dayNum: dNum,
        isCurrentMonth: false,
        dateString: `${py}-${String(pm + 1).padStart(2, "0")}-${String(dNum).padStart(2, "0")}`
      });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      gridDays.push({
        dayNum: d,
        isCurrentMonth: true,
        dateString: `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      });
    }

    // Next month's leading days to fill exactly 42 cells (6-row grid)
    const remainingSlots = 42 - gridDays.length;
    for (let n = 1; n <= remainingSlots; n++) {
      const nm = currentMonth === 11 ? 0 : currentMonth + 1;
      const ny = currentMonth === 11 ? currentYear + 1 : currentYear;
      gridDays.push({
        dayNum: n,
        isCurrentMonth: false,
        dateString: `${ny}-${String(nm + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`
      });
    }

    return gridDays;
  };

  const getApprovedLeavesForDate = (dateString: string) => {
    return requests.filter((req) => {
      if (req.status !== "Approved") return false;
      if (req.type === "Paid Leave" && req.endDate) {
        return dateString >= req.startDate && dateString <= req.endDate;
      }
      return dateString === req.startDate;
    });
  };

  // Get approved leaves for the currently viewed month
  const getApprovedLeavesInMonth = () => {
    const targetPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`;
    return requests.filter((req) => {
      if (req.status !== "Approved") return false;
      const startsInMonth = req.startDate.startsWith(targetPrefix);
      const endsInMonth = req.endDate ? req.endDate.startsWith(targetPrefix) : false;
      
      const startOfMonthStr = `${targetPrefix}-01`;
      const endOfMonthStr = `${targetPrefix}-31`;
      const overlapsCompletely = req.endDate 
        ? (req.startDate <= startOfMonthStr && req.endDate >= endOfMonthStr)
        : false;

      return startsInMonth || endsInMonth || overlapsCompletely;
    });
  };

  const calendarDays = getCalendarDays();
  const approvedLeavesThisMonth = getApprovedLeavesInMonth();
  const selectedDateLeaves = selectedDate ? getApprovedLeavesForDate(selectedDate) : [];

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
    setSelectedDate(null);
  };

  const handleTodayGo = () => {
    const today = new Date();
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    setSelectedDate(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
  };

  return (
    <div className="space-y-6">
      {/* Title block */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-904 dark:text-zinc-50 tracking-tight flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-500" /> Administrative Requests Center
          </h2>
          <p className="text-xs text-zinc-500 mt-1 font-mono">Review leave forms and update cutoff parameters</p>
        </div>

        {/* View mode switcher tabs */}
        <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl self-start">
          <button
            onClick={() => setViewMode("list")}
            className={`px-3 py-1.5 text-xs font-bold font-mono transition-all rounded-lg flex items-center gap-1.5 cursor-pointer ${
              viewMode === "list"
                ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-blue-500" /> List ({filteredRequests.length})
          </button>
          <button
            onClick={() => setViewMode("calendar")}
            className={`px-3 py-1.5 text-xs font-bold font-mono transition-all rounded-lg flex items-center gap-1.5 cursor-pointer ${
              viewMode === "calendar"
                ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-indigo-500" /> Calendar ({requests.filter(r => r.status === "Approved").length} approved)
          </button>
        </div>
      </div>

      {viewMode === "list" ? (
        <>
          {/* Sub-tabs for Requests category: Leave vs Attendance Copy */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-800 mb-6 bg-zinc-100/50 dark:bg-zinc-900/50 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setManagerTab("leave");
                setSearch("");
                setFilterStatus("All");
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                managerTab === "leave"
                  ? "bg-white dark:bg-zinc-850 text-blue-600 dark:text-blue-400 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <span>Leave & Notice Vouchers ({filteredRequests.length})</span>
              {pendingLeavesCount > 0 && (
                <span className="bg-sky-500 text-white text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[17px] h-[17px] flex items-center justify-center leading-none shadow-xs">
                  {pendingLeavesCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setManagerTab("attendance_copy");
                setSearch("");
                setFilterStatus("All");
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                managerTab === "attendance_copy"
                  ? "bg-white dark:bg-zinc-850 text-blue-600 dark:text-blue-400 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <span>Attendance Copy Requests ({filteredAttendanceRequests.length})</span>
              {pendingAttendanceCount > 0 && (
                <span className="bg-sky-500 text-white text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[17px] h-[17px] flex items-center justify-center leading-none shadow-xs">
                  {pendingAttendanceCount}
                </span>
              )}
            </button>
          </div>

          {managerTab === "leave" ? (
            <>
              {/* Internal filters */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div className="relative">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-3.5" />
                  <input
                    type="text"
                    placeholder="Search matching name or voucher..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full text-xs pl-9 pr-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-100"
                  />
                </div>

                <div>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="w-full text-xs px-3 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 rounded-xl focus:outline-none dark:text-zinc-100"
                  >
                    <option value="All">All Categories</option>
                    <option value="Paid Leave">Paid Leave Only</option>
                    <option value="Birthday Leave">Birthday Leave Only</option>
                    <option value="Absent Notice">Absent Notice Only</option>
                  </select>
                </div>

                <div>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full text-xs px-3 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 rounded-xl focus:outline-none dark:text-zinc-100"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Pending">Pending Approvals</option>
                    <option value="Approved">Approved / Logged</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
              </div>

              {/* Requests table listing */}
              <div className="space-y-4">
                {filteredRequests.length === 0 ? (
                  <div className="p-12 text-center bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-zinc-400">
                    <CheckCircle className="w-12 h-12 mx-auto mb-2 text-zinc-300" />
                    <p className="text-sm font-semibold">Zero pending review requests.</p>
                    <p className="text-xs mt-1">Leave applications or absent forms submitted by employees appear here.</p>
                  </div>
                ) : (
                  filteredRequests.map((req) => {
                    const isProcessing = answeringId === req.requestId;
                    const employee = employees?.find(e => 
                      (e.id && req.employeeId && e.id === req.employeeId) || 
                      (e.employeeNumber && req.employeeNumber && e.employeeNumber.trim().toLowerCase() === req.employeeNumber.trim().toLowerCase())
                    );
                    const recipientEmail = employee?.email || "No Registered Email";

                    return (
                      <div 
                        key={req.id} 
                        className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-805 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row gap-5 items-start justify-between"
                      >
                        <div className="space-y-3 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-bold bg-blue-50 dark:bg-blue-955/20 text-blue-650 dark:text-blue-300 px-3 py-0.5 rounded-full uppercase tracking-wider">
                              {req.trackingNumber}
                            </span>
                            <span className="text-xs font-semibold text-zinc-500 font-mono">
                              {req.type}
                            </span>
                            <span className="text-zinc-350">•</span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                              Submitted: {new Date(req.submittedAt).toLocaleDateString()}
                            </span>
                          </div>

                          <div>
                            <h4 className="font-bold text-zinc-900 dark:text-zinc-100 text-sm">{req.employeeName}</h4>
                            <p className="text-xs font-mono text-zinc-450 mt-0.5">Emp-ID: {req.employeeNumber} {recipientEmail !== "No Registered Email" && `| ✉️ ${recipientEmail}`}</p>
                          </div>

                          <p className="text-xs text-zinc-550 dark:text-zinc-400 leading-normal bg-zinc-50/50 dark:bg-zinc-900/40 p-3 rounded-xl border border-zinc-200/50 dark:border-zinc-800 italic">
                            "{req.reason}"
                          </p>

                          <div className="text-xs text-zinc-650 dark:text-zinc-350 space-y-1 bg-zinc-50/50 dark:bg-zinc-900/40 p-3.5 rounded-xl border border-zinc-200/50 dark:border-zinc-800 font-mono">
                            <p>📅 <strong>Schedule dates:</strong> {req.type === "Paid Leave" ? `${req.startDate} to ${req.endDate}` : req.startDate}</p>
                            {req.attachment && (
                              <p className="flex items-center gap-1 font-sans">
                                📎 <strong>Attachment:</strong> 
                                <a href={req.attachment} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-0.5 font-bold">
                                  {req.attachment} <ExternalLink className="w-3 h-3" />
                                </a>
                              </p>
                            )}
                          </div>

                          {/* Birthday Leave Policy & Week Validation for Admin */}
                          {req.type === "Birthday Leave" && (
                            <div className="mt-1">
                              {!employee?.birthday ? (
                                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <span className="flex items-center gap-1.5 font-bold">
                                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                    Employee has NO birthday set in profile. Birthday Leave cannot be approved until birthday is configured.
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setQuickBirthdayEmp(employee || null);
                                      setQuickBirthdayVal("");
                                      setShowQuickBirthdayModal(true);
                                    }}
                                    className="px-3 py-1 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-xs cursor-pointer shrink-0"
                                  >
                                    Set Birthday
                                  </button>
                                </div>
                              ) : (() => {
                                const bInfo = getBirthdayWeekInfo(employee.birthday, req.startDate);
                                const inWeek = bInfo.isInBirthdayWeek(req.startDate);
                                return (
                                  <div className={`p-3 rounded-xl text-xs border space-y-1.5 ${
                                    inWeek
                                      ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                                      : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300"
                                  }`}>
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                                      <span className="font-bold flex items-center gap-1">
                                        🎂 Employee Birthday: <strong>{bInfo.birthdayFormatted}</strong>
                                      </span>
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider shrink-0 ${
                                        inWeek ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                                      }`}>
                                        {inWeek ? "✓ In Birthday Week (Eligible)" : "⚠️ Outside Birthday Week (Cannot Approve)"}
                                      </span>
                                    </div>
                                    <p className="text-[11px] font-mono">
                                      Eligible Birthday Week: <strong>Monday, {bInfo.weekStartMondayStr} to Friday, {bInfo.weekEndFridayStr}</strong>
                                    </p>
                                    {!inWeek && (
                                      <p className="text-[10px] text-red-700 dark:text-red-400 font-medium">
                                        * Policy Rule: Birthday Leave is strictly approved during the birthday week ({bInfo.weekStartMondayStr} to {bInfo.weekEndFridayStr}). Requested date ({req.startDate}) is outside.
                                      </p>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Feedback Notes input */}
                          {req.status === "Pending" && (
                            <div className="space-y-1 max-w-md">
                              <label className="text-[10px] font-bold text-zinc-550 font-mono tracking-wider flex items-center gap-1">
                                <MessageSquare className="w-3.5 h-3.5 text-blue-500" /> Admin Approval Notes / Notes response
                              </label>
                              <input
                                type="text"
                                placeholder="Add special HR notes feedback..."
                                value={notesObj[req.requestId] || ""}
                                onChange={(e) => setNotesObj({
                                  ...notesObj,
                                  [req.requestId]: e.target.value
                                })}
                                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-888 rounded-lg outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-100 font-semibold"
                              />
                            </div>
                          )}

                          {req.adminNotes && (
                            <p className="text-xs bg-yellow-50 dark:bg-yellow-950/20 text-yellow-800 dark:text-yellow-400 p-2.5 rounded-lg border border-yellow-100 dark:border-yellow-900/30">
                              <strong>Admin Feedback:</strong> {req.adminNotes}
                            </p>
                          )}
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                          {req.status === "Pending" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleApprove(req)}
                                disabled={isProcessing}
                                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-zinc-400 text-white font-bold text-xs rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" /> Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReject(req)}
                                disabled={isProcessing}
                                className="px-3 py-1.5 bg-red-650 hover:bg-red-700 disabled:bg-zinc-400 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
                              >
                                Reject
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(req)}
                                disabled={isProcessing}
                                className="p-1.5 bg-zinc-100 hover:bg-red-100 dark:bg-zinc-900 dark:hover:bg-red-950/40 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 rounded-xl transition-colors cursor-pointer"
                                title="Delete Request"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className={`px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full text-xs font-bold font-mono tracking-wider uppercase ${
                                req.status === "Approved"
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-red-550 dark:text-red-400"
                              }`}>
                                {req.status}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDelete(req)}
                                className="p-1.5 bg-zinc-100 hover:bg-red-100 dark:bg-zinc-900 dark:hover:bg-red-950/40 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 rounded-xl transition-colors cursor-pointer"
                                title="Delete Request"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <>
              {/* Attendance Copy Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div className="relative">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-3.5" />
                  <input
                    type="text"
                    placeholder="Search matching employee or tracking number..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full text-xs pl-9 pr-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-100"
                  />
                </div>

                <div>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full text-xs px-3 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 rounded-xl focus:outline-none dark:text-zinc-100"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Pending">Pending Approvals</option>
                    <option value="Approved">Approved / Authorized</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
              </div>

              {/* Attendance copy requests listing */}
              <div className="space-y-4">
                {loadingAttCopy ? (
                  <div className="p-8 text-center bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-zinc-400 font-mono text-xs">
                    Loading copy requests from secure database...
                  </div>
                ) : filteredAttendanceRequests.length === 0 ? (
                  <div className="p-12 text-center bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-zinc-400">
                    <CheckCircle className="w-12 h-12 mx-auto mb-2 text-zinc-300" />
                    <p className="text-sm font-semibold">Zero matching attendance copy requests.</p>
                    <p className="text-xs mt-1">Requests submitted by employees for their attendance copies will appear here.</p>
                  </div>
                ) : (
                  filteredAttendanceRequests.map((req) => {
                    const isProcessing = answeringId === req.id;
                    const employee = employees?.find(e => 
                      (e.id && req.employeeId && e.id === req.employeeId) || 
                      (e.employeeNumber && req.employeeNumber && e.employeeNumber.trim().toLowerCase() === req.employeeNumber.trim().toLowerCase())
                    );
                    const recipientEmail = employee?.email || "No Registered Email";

                    return (
                      <div 
                        key={req.id} 
                        className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-855 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row gap-5 items-start justify-between"
                      >
                        <div className="space-y-3 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-bold bg-blue-50 dark:bg-blue-955/20 text-blue-650 dark:text-blue-300 px-3 py-0.5 rounded-full uppercase tracking-wider">
                              {req.trackingNumber}
                            </span>
                            <span className="text-xs font-semibold text-zinc-500 font-mono">
                              Attendance Copy Request
                            </span>
                            <span className="text-zinc-350">•</span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                              Submitted: {new Date(req.submittedAt).toLocaleDateString()}
                            </span>
                          </div>

                          <div>
                            <h4 className="font-bold text-zinc-900 dark:text-zinc-100 text-sm">{req.employeeName}</h4>
                            <p className="text-xs font-mono text-zinc-450 mt-0.5">Emp-ID: {req.employeeNumber} {recipientEmail !== "No Registered Email" && `| ✉️ ${recipientEmail}`}</p>
                          </div>

                          <div className="text-xs text-zinc-650 dark:text-zinc-350 space-y-1 bg-zinc-50/50 dark:bg-zinc-900/40 p-3.5 rounded-xl border border-zinc-200/50 dark:border-zinc-800">
                            <p>📅 <strong>Requested Range:</strong> <span className="text-blue-650 dark:text-blue-400 font-bold">{req.startDate} to {req.endDate}</span></p>
                            <p className="mt-1.5 italic">"Reason: {req.reason}"</p>
                          </div>

                          {/* Feedback Notes input */}
                          {req.status === "Pending" && (
                            <div className="space-y-1 max-w-md">
                              <label className="text-[10px] font-bold text-zinc-550 font-mono tracking-wider flex items-center gap-1">
                                <MessageSquare className="w-3.5 h-3.5 text-blue-500" /> Admin Approval Notes / Feedback
                              </label>
                              <input
                                type="text"
                                placeholder="Add special HR notes/instructions..."
                                value={notesObj[req.id || ""] || ""}
                                onChange={(e) => setNotesObj({
                                  ...notesObj,
                                  [req.id || ""]: e.target.value
                                })}
                                className="w-full text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg outline-none focus:ring-1 focus:ring-blue-550 dark:text-zinc-100 font-semibold"
                              />
                            </div>
                          )}

                          {req.adminNotes && (
                            <p className="text-xs bg-yellow-50 dark:bg-yellow-950/20 text-yellow-850 dark:text-yellow-400 p-2.5 rounded-lg border border-yellow-105 dark:border-yellow-900/30">
                              <strong>Admin Feedback:</strong> {req.adminNotes}
                            </p>
                          )}
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                          {req.status === "Pending" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleApproveAttendanceCopy(req)}
                                disabled={isProcessing}
                                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-zinc-400 text-white font-bold text-xs rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" /> Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRejectAttendanceCopy(req)}
                                disabled={isProcessing}
                                className="px-3 py-1.5 bg-red-650 hover:bg-red-700 disabled:bg-zinc-400 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
                              >
                                Reject
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteAttendanceCopy(req)}
                                disabled={isProcessing}
                                className="p-1.5 bg-zinc-100 hover:bg-red-100 dark:bg-zinc-900 dark:hover:bg-red-950/40 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 rounded-xl transition-colors cursor-pointer"
                                title="Delete Request"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className={`px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full text-xs font-bold font-mono tracking-wider uppercase ${
                                req.status === "Approved"
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-red-550 dark:text-red-400"
                              }`}>
                                {req.status}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeleteAttendanceCopy(req)}
                                className="p-1.5 bg-zinc-100 hover:bg-red-100 dark:bg-zinc-900 dark:hover:bg-red-950/40 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 rounded-xl transition-colors cursor-pointer"
                                title="Delete Request"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </>
      ) : (
        /* Team Visual Calendar View */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Block: Interactive Month Calendar Calendar */}
          <div className="lg:col-span-8 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-850 rounded-2xl shadow-xs overflow-hidden">
            
            {/* Calendar Header with navigation */}
            <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-indigo-500" />
                <h3 className="font-black text-sm sm:text-base text-zinc-900 dark:text-zinc-50 font-sans tracking-tight">
                  {MONTHS[currentMonth]} {currentYear}
                </h3>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handlePrevMonth}
                  className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg text-zinc-650 dark:text-zinc-350 transition-colors cursor-pointer"
                  title="Previous Month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={handleTodayGo}
                  className="px-2.5 py-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-[10px] uppercase tracking-wider font-bold text-zinc-600 dark:text-zinc-300 rounded-lg transition-colors cursor-pointer border border-zinc-200 dark:border-zinc-700 font-mono"
                >
                  Today
                </button>
                <button
                  onClick={handleNextMonth}
                  className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg text-zinc-650 dark:text-zinc-350 transition-colors cursor-pointer"
                  title="Next Month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Days of week header */}
            <div className="grid grid-cols-7 text-center border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30">
              {DAYS_OF_WEEK.map((d) => (
                <div key={d} className="py-2 text-[10px] font-bold font-mono uppercase tracking-widest text-zinc-400 dark:text-zinc-500 font-semibold">
                  {d}
                </div>
              ))}
            </div>

            {/* Main Calendar Grid cells (6 rows * 7 columns = 42 cells) */}
            <div className="grid grid-cols-7 gap-px bg-zinc-150 dark:bg-zinc-800/80">
              {calendarDays.map((cell, index) => {
                const dayApprovedLeaves = getApprovedLeavesForDate(cell.dateString);
                const hasLeaves = dayApprovedLeaves.length > 0;
                
                // Determine if this cell is today's real local day
                const today = new Date();
                const isToday = 
                  today.getFullYear() === currentYear &&
                  today.getMonth() === currentMonth &&
                  cell.dayNum === today.getDate() &&
                  cell.isCurrentMonth;

                // Determine if cell matches selectedDate state
                const isSelected = selectedDate === cell.dateString;

                return (
                  <div
                    key={`${cell.dateString}-${index}`}
                    onClick={() => setSelectedDate(cell.dateString)}
                    className={`min-h-[85px] sm:min-h-[105px] flex flex-col p-1.5 sm:p-2 transition-all cursor-pointer relative ${
                      cell.isCurrentMonth 
                        ? "bg-white dark:bg-zinc-950" 
                        : "bg-zinc-50/50 dark:bg-zinc-900/30 text-zinc-400 dark:text-zinc-600"
                    } ${
                      isSelected 
                        ? "ring-2 ring-blue-500 ring-inset dark:ring-blue-400 z-10" 
                        : "hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20"
                    }`}
                  >
                    {/* Day number header */}
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-[10px] sm:text-xs font-mono font-bold w-5 h-5 flex items-center justify-center rounded-full ${
                          isToday
                            ? "bg-blue-600 text-white font-black"
                            : cell.isCurrentMonth
                              ? "text-zinc-700 dark:text-zinc-300"
                              : "text-zinc-400 dark:text-zinc-600"
                        }`}
                      >
                        {cell.dayNum}
                      </span>
                      
                      {/* Condensed indicator dots for smaller screens / summaries */}
                      {hasLeaves && (
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse sm:hidden" />
                      )}
                    </div>

                    {/* Approved Leaves list in cellular display */}
                    <div className="flex-1 space-y-1 overflow-y-auto max-h-[60px] sm:max-h-[80px] hidden sm:block">
                      {dayApprovedLeaves.map((leave) => {
                        // Badge colors based on Leave Type
                        let badgeClass = "bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300 border-teal-200/40";
                        if (leave.type === "Birthday Leave") {
                          badgeClass = "bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300 border-violet-200/40";
                        } else if (leave.type === "Absent Notice") {
                          badgeClass = "bg-orange-50 text-orange-850 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200/40";
                        }

                        // Short name helper (e.g. "Michael Scott" -> "Michael S.")
                        const parts = leave.employeeName.trim().split(" ");
                        const displayName = parts.length > 1 && parts[1]
                          ? `${parts[0]} ${parts[1][0]}.`
                          : leave.employeeName;

                        return (
                          <div
                            key={leave.id || leave.requestId}
                            className={`px-1 py-0.5 text-[9px] rounded-md font-sans font-medium border truncate block tracking-tight ${badgeClass}`}
                            title={`${leave.employeeName} — ${leave.type}: "${leave.reason}"`}
                          >
                            {displayName}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Block: Sidebar Leave Agenda Information */}
          <div className="lg:col-span-4 bg-zinc-50 dark:bg-zinc-900/20 border border-zinc-200/80 dark:border-zinc-800/60 rounded-2xl p-4 sm:p-5 space-y-5">
            
            {/* Title / Header of the Agenda card */}
            <div>
              <h4 className="text-xs font-black font-mono uppercase text-zinc-450 dark:text-zinc-500 tracking-wider">
                Leave Agenda Panel
              </h4>
              <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mt-1">
                {selectedDate 
                  ? `Details for ${new Date(selectedDate).toLocaleDateString(undefined, { dateStyle: 'long' })}`
                  : `${MONTHS[currentMonth]} ${currentYear} Summary`
                }
              </p>
            </div>

            {/* Displaying leaves on a clicked date */}
            {selectedDate ? (
              <div className="space-y-4">
                {selectedDateLeaves.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-zinc-950/40 border border-zinc-200/60 dark:border-zinc-850/40 rounded-xl">
                    <Clock className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                    <p className="text-xs text-zinc-550 font-medium">Fully Available Team</p>
                    <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">No approved leaves scheduled on this day.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-zinc-500 font-mono font-semibold">
                      {selectedDateLeaves.length} {selectedDateLeaves.length === 1 ? "Employee" : "Employees"} logged:
                    </p>
                    
                    {selectedDateLeaves.map((leave) => (
                      <div 
                        key={leave.id || leave.requestId}
                        className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-zinc-850 space-y-2.5 shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-md uppercase tracking-wider">
                            {leave.trackingNumber}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[9.5px] font-bold font-mono tracking-wider uppercase px-2 py-0.5 rounded-md ${
                              leave.type === "Paid Leave"
                                ? "bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300"
                                : leave.type === "Birthday Leave"
                                  ? "bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300"
                                  : "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300"
                            }`}>
                              {leave.type}
                            </span>
                            <button
                              onClick={() => handleDelete(leave)}
                              className="p-1 bg-zinc-150 hover:bg-red-100 dark:bg-zinc-900 dark:hover:bg-red-950/40 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 rounded-md transition-colors cursor-pointer"
                              title="Delete Request"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{leave.employeeName}</p>
                          <p className="text-[10px] text-zinc-400 font-mono mt-0.5">ID: {leave.employeeNumber}</p>
                        </div>

                        <p className="text-xs text-zinc-550 dark:text-zinc-400 italic bg-zinc-50 dark:bg-zinc-900 p-2.5 rounded-lg leading-normal">
                          "{leave.reason}"
                        </p>

                        <div className="text-[11px] text-zinc-500 space-y-1 border-t border-zinc-100 dark:border-zinc-800/60 pt-2 font-mono">
                          <p>📅 <strong>Period:</strong> {leave.type === "Paid Leave" ? `${leave.startDate} to ${leave.endDate}` : leave.startDate}</p>
                          {leave.adminNotes && (
                            <p className="text-[10.5px] text-amber-600 dark:text-amber-400 font-sans mt-1">
                              <strong>HR Note:</strong> {leave.adminNotes}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Reset selected date button */}
                <button
                  onClick={() => setSelectedDate(null)}
                  className="w-full text-center px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-bold font-mono rounded-xl transition-colors cursor-pointer"
                >
                  Clear Selection & Monthly Overview
                </button>
              </div>
            ) : (
              // Monthly Agenda Overview default list
              <div className="space-y-4">
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/60 dark:border-zinc-800/55">
                  <span className="text-xs text-zinc-500 font-mono font-semibold">Approved leaves this month</span>
                  <span className="text-xs font-bold font-mono bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full">
                    {approvedLeavesThisMonth.length} Active
                  </span>
                </div>

                {approvedLeavesThisMonth.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-zinc-950/40 border border-zinc-200/60 dark:border-zinc-850/40 rounded-xl text-zinc-400">
                    <Clock className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                    <p className="text-xs font-bold">Zero Approved Leaves</p>
                    <p className="text-[10px] text-zinc-550 leading-relaxed mt-0.5">No team members are approved or scheduled to go on leave during this entire month.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
                    {approvedLeavesThisMonth.map((leave) => (
                      <div
                        key={leave.id || leave.requestId}
                        className="bg-white dark:bg-zinc-950 p-3 rounded-xl border border-zinc-200 dark:border-zinc-850 flex items-center justify-between gap-3 shadow-xs hover:border-zinc-350 dark:hover:border-zinc-700 transition-colors cursor-pointer"
                        onClick={() => setSelectedDate(leave.startDate)}
                      >
                        <div className="space-y-0.5 min-w-0">
                          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                            {leave.employeeName}
                          </p>
                          <p className="text-[9.5px] font-mono text-zinc-450 truncate">
                            {leave.type === "Paid Leave" ? `${leave.startDate} to ${leave.endDate}` : leave.startDate}
                          </p>
                        </div>
                        <span className={`text-[9px] font-mono font-bold tracking-wider uppercase px-2 py-0.5 rounded-md shrink-0 block text-[9.5px] ${
                          leave.type === "Paid Leave"
                            ? "bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300"
                            : leave.type === "Birthday Leave"
                              ? "bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300"
                              : "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300"
                        }`}>
                          {leave.type === "Paid Leave" ? "PL" : leave.type === "Birthday Leave" ? "B-Day" : "Absent"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Note of instructions */}
                <div className="text-[10px] text-zinc-450 leading-normal flex gap-1.5 p-3 rounded-xl bg-orange-50/20 border border-orange-100/20 dark:border-orange-900/10">
                  <span className="shrink-0">💡</span>
                  <span>Click on any cell in the monthly calendar to explore individual leave reasons, custom attachment files, and approvals.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom Confirmation Dialog */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-200 text-zinc-900 dark:text-white">
            <h3 className="text-sm font-extrabold text-amber-500 uppercase tracking-wider font-mono flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 animate-pulse" /> {confirmModal.title}
            </h3>
            <p className="text-xs text-zinc-650 dark:text-zinc-350 leading-relaxed font-sans">
              {confirmModal.message}
            </p>
            <div className="flex justify-end gap-3 pt-2 font-mono">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-white rounded-lg text-sm font-bold shadow-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmModal.onConfirm();
                }}
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
        <div className="fixed bottom-5 right-5 z-50 max-w-sm bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-950 px-4 py-3.5 rounded-xl shadow-lg border border-zinc-850 dark:border-zinc-200 flex items-center gap-2.5 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold font-mono tracking-tight">{toastMessage}</span>
        </div>
      )}

      {/* Admin Quick Birthday Input Modal */}
      {showQuickBirthdayModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              🎂 Set Employee Birthday
            </h3>
            <p className="text-xs text-zinc-500">
              Set the date of birth for <strong>{quickBirthdayEmp?.fullName || "Employee"}</strong> ({quickBirthdayEmp?.employeeNumber || ""}). This allows the system to validate and approve Birthday Leave requests during their birthday week.
            </p>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold font-mono text-zinc-500 uppercase">DATE OF BIRTH (YYYY-MM-DD)</label>
              <input
                type="date"
                required
                value={quickBirthdayVal}
                onChange={(e) => setQuickBirthdayVal(e.target.value)}
                className="w-full text-sm px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-900 dark:text-white"
              />
            </div>
            {quickBirthdayVal && (() => {
              const bInfo = getBirthdayWeekInfo(quickBirthdayVal);
              return bInfo.isValid ? (
                <div className="p-3 rounded-xl bg-pink-50 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-800/60 text-[11px] text-pink-700 dark:text-pink-300 font-mono space-y-0.5">
                  <p><strong>Birthday:</strong> {bInfo.birthdayFormatted}</p>
                  <p><strong>Birthday Week:</strong> Mon {bInfo.weekStartMondayStr} to Fri {bInfo.weekEndFridayStr}</p>
                </div>
              ) : null;
            })()}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowQuickBirthdayModal(false);
                  setQuickBirthdayEmp(null);
                }}
                className="px-4 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!quickBirthdayVal || isSavingQuickBirthday}
                onClick={async () => {
                  if (!quickBirthdayEmp?.id || !quickBirthdayVal) return;
                  setIsSavingQuickBirthday(true);
                  try {
                    await updateDoc(doc(db, "employees", quickBirthdayEmp.id), { birthday: quickBirthdayVal });
                    setShowQuickBirthdayModal(false);
                    triggerToast(`Birthday saved for ${quickBirthdayEmp.fullName}`);
                    onRefresh();
                  } catch (err: any) {
                    alert("Failed to save: " + err.message);
                  } finally {
                    setIsSavingQuickBirthday(false);
                  }
                }}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white shadow-md cursor-pointer"
              >
                {isSavingQuickBirthday ? "Saving..." : "Save Birthday"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
