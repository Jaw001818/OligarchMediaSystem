import React, { useState, useEffect } from "react";
import { db, handleFirestoreError, OperationType, collection, getDocs, addDoc, doc, deleteDoc } from "../firebase";
import { SystemNotification, AuditLog, Announcement } from "../types";
import { 
  Bell, 
  Trash2, 
  Mail, 
  Layers, 
  Check, 
  AlertTriangle,
  Download,
  Printer,
  FileMinus,
  Megaphone,
  Send
} from "lucide-react";

interface NotificationsPanelProps {
  notifications: SystemNotification[];
  onRefresh: () => void;
}

export default function NotificationsPanel({
  notifications,
  onRefresh
}: NotificationsPanelProps) {
  const [emailLogs, setEmailLogs] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  // Announcement posting form states
  const [annTitle, setAnnTitle] = useState("");
  const [annMessage, setAnnMessage] = useState("");
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

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

  // Fetch announcements
  const fetchAnnouncements = async () => {
    try {
      const snap = await getDocs(collection(db, "announcements"));
      const list: Announcement[] = [];
      snap.forEach(d => {
        list.push({ ...d.data() as Announcement, id: d.id });
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setAnnouncements(list);
    } catch (err) {
      console.error("Error fetching announcements:", err);
    }
  };

  // Broadcast function
  const handleSendAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annMessage.trim()) return;
    setIsBroadcasting(true);
    try {
      const payload: Omit<Announcement, "id"> = {
        title: annTitle.trim(),
        message: annMessage.trim(),
        createdAt: new Date().toISOString(),
        sender: "Oligarch Admin"
      };
      await addDoc(collection(db, "announcements"), payload);
      
      // Also add an audit log
      await addDoc(collection(db, "audit_logs"), {
        user: "Admin",
        action: "Broadcasted Public Announcement",
        details: `Published company bulletin: "${annTitle.trim()}"`,
        timestamp: new Date().toISOString()
      });

      // Also dispatch a system notification to keep alerts feed updated
      await addDoc(collection(db, "notifications"), {
        title: "Announcement Sent",
        message: `Bulk corporate announcement "${annTitle.trim()}" broadcasted.`,
        type: "System",
        read: false,
        createdAt: new Date().toISOString()
      });

      setAnnTitle("");
      setAnnMessage("");
      showToast("Announcement successfully posted. It is now live in the employee hub.", "success");
      fetchAnnouncements();
      onRefresh();
    } catch (err) {
      console.error(err);
      showToast("Failed to publish company bulletin.", "error");
    } finally {
      setIsBroadcasting(false);
    }
  };

  // Delete Announcement
  const handleDeleteAnnouncement = (id: string, title: string) => {
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
        console.warn("Failed to log deleted announcement to audit_logs", auditErr);
      }

      showToast("Announcement deleted successfully.", "success");
      fetchAnnouncements();
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.DELETE, `announcements/${deleteConfirmId}`);
    } finally {
      setDeleteConfirmId(null);
      setDeleteConfirmTitle("");
    }
  };

  // Fetch Node backend email dispatch actions
  const fetchLogsAndAudits = async () => {
    setLoading(true);
    try {
      // Fetch simulated Node JS log
      const res = await fetch("/api/email-logs");
      if (res.ok) {
        const data = await res.json();
        if (data.logs) {
          setEmailLogs(data.logs);
        }
      } else {
        console.warn(`Could not load email logs from server (Status ${res.status})`);
      }

      // Fetch Firestore audits
      const snap = await getDocs(collection(db, "audit_logs"));
      const logs: AuditLog[] = [];
      snap.forEach(d => {
        logs.push({ ...d.data() as AuditLog, id: d.id });
      });
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setAuditLogs(logs);

      // Fetch broadcasts
      await fetchAnnouncements();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogsAndAudits();
  }, [notifications]);

  return (
    <div className="space-y-6">
      {/* Top Banner layout */}
      <div>
        <h2 className="text-xl font-bold text-zinc-904 dark:text-zinc-50 tracking-tight flex items-center gap-2">
          <Bell className="w-5 h-5 text-blue-500 animate-bounce" /> Live Alerts & Broadcast Console
        </h2>
        <p className="text-xs text-zinc-500 mt-1 font-mono">Real-time alerts, public employee portal announcements, and audit trace logs</p>
      </div>

      {/* BULK COMPANEY ANNOUNCEMENT BROADCAST PORTLET */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Compose Form */}
        <div className="lg:col-span-1 bg-white dark:bg-[#111224] border border-zinc-200 dark:border-white/10 rounded-2xl p-5 shadow-lg space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-100 dark:border-white/5">
            <Megaphone className="w-4 h-4 text-emerald-450 text-blue-400" />
            <h3 className="font-extrabold text-xs font-mono uppercase tracking-wider text-zinc-800 dark:text-white">
              Compose Portal Bulletin
            </h3>
          </div>
          
          <form onSubmit={handleSendAnnouncement} className="space-y-3.5">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-mono">Announcement Title</label>
              <input
                type="text"
                required
                maxLength={80}
                placeholder="e.g. Server Maintenance or Holiday Schedule"
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                className="w-full text-xs px-3 py-2.5 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-blue-550 focus:ring-1 focus:ring-blue-550 font-medium"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-mono">Message Broadcast Body</label>
              <textarea
                required
                rows={4}
                maxLength={500}
                placeholder="Write message details clearly here. This message will be permanently visible to all employees on the public HR portal until deleted...."
                value={annMessage}
                onChange={(e) => setAnnMessage(e.target.value)}
                className="w-full text-xs px-3 py-2.5 bg-zinc-50 dark:bg-[#181825] border border-zinc-200 dark:border-white/5 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-blue-550 focus:ring-1 focus:ring-blue-550 resize-none font-sans leading-relaxed"
              ></textarea>
            </div>

            <button
              type="submit"
              disabled={isBroadcasting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2.5 px-4 rounded-xl text-xs shadow-sm transition-colors flex items-center justify-center gap-1.5 cursor-pointer font-bold uppercase tracking-wider"
            >
              {isBroadcasting ? (
                "Publishing Announcement..."
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" /> Post Announcement
                </>
              )}
            </button>
          </form>
        </div>

        {/* Announcements Registry list for Portal */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-805 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
            <h3 className="font-bold text-xs uppercase tracking-wider font-mono text-zinc-600 dark:text-zinc-400">
              Active Portal Broadcast Registry ({announcements.length})
            </h3>
            <span className="px-2 py-0.5 bg-blue-50 dark:bg-zinc-900 border border-blue-105 dark:border-zinc-800 rounded-full text-[9px] font-mono text-blue-600 dark:text-zinc-400 uppercase font-black tracking-widest leading-none">
              Live Feed
            </span>
          </div>

          <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
            {announcements.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-zinc-400 space-y-1">
                <p className="text-xs italic">No portal postings broadcasted.</p>
                <p className="text-[10px]">Use the composer to write a bulk announcement that will render immediately in the Hub.</p>
              </div>
            ) : (
              announcements.map((ann) => (
                <div 
                  key={ann.id} 
                  className="p-3 bg-zinc-50  dark:bg-zinc-900/30 rounded-xl border border-zinc-150 dark:border-zinc-800 flex items-start justify-between gap-3 text-xs shadow-xs"
                >
                  <div className="space-y-1">
                    <h5 className="font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                      <Megaphone className="w-3.5 h-3.5 text-blue-500" />
                      {ann.title}
                    </h5>
                    <p className="text-zinc-500 font-sans leading-relaxed whitespace-pre-wrap">{ann.message}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[9px] px-1.5 py-0.5 font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded-md">
                        {ann.sender || "Admin"}
                      </span>
                      <span className="text-[9px] text-zinc-400 font-mono">
                        Posted: {new Date(ann.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteAnnouncement(ann.id || "", ann.title)}
                    className="p-1 px-1.5 text-red-500/60 hover:text-red-500 hover:bg-red-500/10 rounded-lg border border-transparent hover:border-red-500/15 transition-all text-[9.5px] cursor-pointer inline-flex items-center gap-0.5"
                    title="Remove public announcement"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* SECTION 1: SYSTEM NOTIFICATIONS (REAL TIME) */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-805 rounded-2xl p-5 shadow-xs space-y-4">
          <h3 className="font-bold text-xs uppercase tracking-wider font-mono text-zinc-600 dark:text-zinc-400">
            Realtime alerts feed ({notifications.length})
          </h3>

          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            {notifications.length === 0 ? (
              <p className="text-xs text-zinc-400 italic py-6 text-center">Zero active system notifications logged.</p>
            ) : (
              notifications.map((notif) => (
                <div 
                  key={notif.id} 
                  className="p-3 bg-zinc-50 dark:bg-zinc-900/40 rounded-xl border border-zinc-150 dark:border-zinc-800 flex items-start gap-2.5 text-xs"
                >
                  <Bell className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-bold text-zinc-800 dark:text-zinc-200">{notif.title}</h5>
                    <p className="text-zinc-500 mt-0.5">{notif.message}</p>
                    <span className="text-[10px] text-zinc-400 font-mono block mt-1">
                      {new Date(notif.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* SECTION 2: EMAIL LOGS DISPATCH */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-805 rounded-2xl p-5 shadow-xs space-y-4">
          <h3 className="font-bold text-xs uppercase tracking-wider font-mono text-zinc-600 dark:text-zinc-400">
            Email logs dispatch history ({emailLogs.length})
          </h3>

          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            {emailLogs.length === 0 ? (
              <p className="text-xs text-zinc-400 italic py-6 text-center">No SMTP mail transmissions triggered yet.</p>
            ) : (
              emailLogs.map((log) => (
                <div 
                  key={log.id} 
                  className="p-3 bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-150 dark:border-zinc-800 rounded-xl text-xs space-y-1 font-mono"
                >
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-blue-500 font-bold">{log.id}</span>
                    <span className="text-green-600 font-bold uppercase">{log.status}</span>
                  </div>
                  <p className="font-bold text-zinc-800 dark:text-zinc-200">TO: {log.to}</p>
                  <p className="text-zinc-500 font-sans font-semibold">SUBJECT: {log.subject}</p>
                  <span className="text-[9px] text-zinc-400 font-mono block">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* SECTION 3: AUDIT COMPLIANCE ROW */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-850 rounded-2xl p-5 shadow-xs space-y-4">
        <h3 className="font-bold text-xs uppercase tracking-wider font-mono text-zinc-650 dark:text-zinc-400">
          Admin compliance audit trace logs ({auditLogs.length})
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-600">
                <th className="py-2.5 px-4">TIMESTAMP</th>
                <th className="py-2.5 px-4 text-center">OPERATOR</th>
                <th className="py-2.5 px-4 font-sans font-bold">ACTION DESCRIPTOR</th>
                <th className="py-2.5 px-4">DETAILS LOG</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 text-[11px] text-zinc-500">
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-zinc-400 italic">No admin actions compiled in audits.</td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4">{new Date(log.timestamp).toLocaleString()}</td>
                    <td className="py-2.5 px-4 text-center font-bold text-zinc-800 dark:text-zinc-300">{log.user}</td>
                    <td className="py-2.5 px-4 font-sans font-bold text-zinc-700 dark:text-zinc-200">{log.action}</td>
                    <td className="py-2.5 px-4 text-zinc-500 italic">{log.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 animate-in fade-in slide-in-from-bottom-5 duration-300 max-w-sm bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 px-4 py-3 rounded-2xl shadow-xl border border-zinc-800 dark:border-zinc-200 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-emerald-500 shrink-0" />
          <span className="text-xs font-semibold leading-relaxed font-sans">{toastMessage}</span>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
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
