import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { NetworkStatusService } from "../sync/NetworkStatusService";
import { SyncQueueService, SyncAction } from "../sync/SyncQueueService";
import { SyncLoggerService, SyncLog } from "../sync/SyncLoggerService";
import { Database, Wifi, WifiOff, RefreshCcw, Activity, CheckCircle2, XCircle, Clock } from "lucide-react";
import { isSandboxActive } from "../firebase";

export function SyncCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(NetworkStatusService.getStatus());
  const [syncStatus, setSyncStatus] = useState<string>("ONLINE"); // ONLINE, OFFLINE, SYNCING
  const [queue, setQueue] = useState<SyncAction[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  const dragConstraintsRef = useRef(null);

  const clearAllPending = async () => {
    try {
      const q = await SyncQueueService.getQueue();
      for (const item of q) {
        await SyncQueueService.removeItem(item.id);
      }
      fetchState();
    } catch (err) {
      console.error(err);
    }
  };

  const fetchState = async () => {


    const q = await SyncQueueService.getQueue();
    const l = await SyncLoggerService.getLogs();
    setQueue(q);
    setLogs(l);
    
    const successLogs = l.filter(log => log.status === "SUCCESS");
    if (successLogs.length > 0) {
      setLastSyncTime(successLogs[0].timestamp);
    }
  };

  useEffect(() => {
    fetchState();

    const onNetwork = (e: any) => setIsOnline(e.detail);
    const onSyncStatus = (e: any) => setSyncStatus(e.detail);
    const onQueueUpdate = () => fetchState();
    const onLogsUpdate = () => fetchState();
    const onSandboxToggle = (e: any) => {
      if (e.detail) {
        setSyncStatus("OFFLINE");
      } else {
        setSyncStatus("ONLINE");
      }
    };

    window.addEventListener("network-status-changed", onNetwork);
    window.addEventListener("sync-status-changed", onSyncStatus);
    window.addEventListener("sync-queue-updated", onQueueUpdate);
    window.addEventListener("sync-logs-updated", onLogsUpdate);
    window.addEventListener("sandbox-mode-toggled", onSandboxToggle);

    // Initial check
    if (isSandboxActive()) {
      setSyncStatus("OFFLINE");
    }

    return () => {
      window.removeEventListener("network-status-changed", onNetwork);
      window.removeEventListener("sync-status-changed", onSyncStatus);
      window.removeEventListener("sync-queue-updated", onQueueUpdate);
      window.removeEventListener("sync-logs-updated", onLogsUpdate);
      window.removeEventListener("sandbox-mode-toggled", onSandboxToggle);
    };
  }, []);

  const handleForceSync = () => {
    window.dispatchEvent(new CustomEvent("force-sync"));
  };

  const getStatusColor = () => {
    if (syncStatus === "QUOTA_EXHAUSTED") return "bg-amber-500 animate-pulse";
    if (!isOnline || syncStatus === "OFFLINE") return "bg-red-500";
    if (syncStatus === "SYNCING") return "bg-yellow-500 animate-pulse";
    return "bg-emerald-500";
  };

  const pendingCount = queue.filter(q => q.status !== "FAILED").length;
  const failedCount = queue.filter(q => q.status === "FAILED").length;
  const successfulCount = logs.filter(l => l.status === "SUCCESS").length;

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition-colors"
      >
        <span className="text-xs font-medium text-zinc-300">
          {syncStatus === "QUOTA_EXHAUSTED" ? "Cloud Limit" : (!isOnline || syncStatus === "OFFLINE" ? "Offline Mode" : syncStatus === "SYNCING" ? "Syncing..." : "Cloud Synced")}
        </span>
        <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor()}`} />
        {pendingCount > 0 && (
          <span className="ml-1 text-xs bg-indigo-500 text-white px-1.5 rounded-full">
            {pendingCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[80vh]">
          <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-400" />
              Central Firestore Sync
            </h3>
            <button 
              onClick={handleForceSync}
              disabled={syncStatus === "SYNCING"}
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-50 transition-colors"
              title="Force Sync"
            >
              <RefreshCcw className={`w-4 h-4 ${syncStatus === "SYNCING" ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="px-4 py-2 bg-indigo-500/10 border-b border-indigo-500/20 text-[11px] text-indigo-300 font-medium flex items-center justify-between">
            <span>Database: ai-studio-2a6bf0ee...</span>
            <span className="font-bold text-[10px] uppercase tracking-wider text-emerald-400">Single Source</span>
          </div>

          {syncStatus === "QUOTA_EXHAUSTED" && (
            <div className="p-3 bg-amber-500/15 border-b border-amber-500/30 text-xs text-amber-200">
              <p className="font-semibold text-amber-300 mb-1">Daily Cloud Write Quota Exceeded</p>
              <p className="text-[11px] text-amber-200/80 mb-2 leading-relaxed">
                Free-tier daily write limit was reached. Offline queue is preserving all mutations safely. Quota resets daily at 00:00 PST.
              </p>
              <a 
                href="https://console.firebase.google.com/project/spherical-program-f3n78/firestore/databases/ai-studio-2a6bf0ee-3447-4fcc-b543-9a65f6e88879/data?openUpgradeDialog=true" 
                target="_blank" 
                rel="noreferrer"
                className="text-[11px] underline font-bold text-amber-300 hover:text-amber-100"
              >
                Open Firebase Console Database →
              </a>
            </div>
          )}

          <div className="p-4 grid grid-cols-2 gap-3 bg-zinc-900/50">
            <div className="bg-zinc-800/50 p-3 rounded-lg border border-zinc-700/50 flex flex-col">
              <span className="text-xs text-zinc-400 font-medium mb-1">Pending</span>
              <span className="text-xl font-bold text-white">{pendingCount}</span>
            </div>
            <div className="bg-zinc-800/50 p-3 rounded-lg border border-zinc-700/50 flex flex-col">
              <span className="text-xs text-zinc-400 font-medium mb-1">Failed</span>
              <span className="text-xl font-bold text-red-400">{failedCount}</span>
            </div>
            <div className="col-span-2 bg-zinc-800/50 p-3 rounded-lg border border-zinc-700/50 flex flex-col">
              <span className="text-xs text-zinc-400 font-medium mb-1">Last Synced</span>
              <span className="text-sm font-medium text-white">
                {lastSyncTime ? new Date(lastSyncTime).toLocaleString() : "Never"}
              </span>
            </div>
          </div>

          
          <div className="flex-1 overflow-y-auto p-4 border-t border-zinc-800">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Sync Queue</h4>
              {queue.length > 0 && (
                <button onClick={clearAllPending} className="text-[10px] bg-red-500/20 text-red-400 px-2 py-1 rounded hover:bg-red-500/30 transition-colors">
                  Clear All
                </button>
              )}
            </div>

            {queue.length === 0 ? (
              <div className="text-center py-6 text-zinc-500 text-sm">
                No pending actions.
              </div>
            ) : (
              <div className="space-y-3">
                {queue.map(item => (
                  <div key={item.id} className="bg-zinc-800/30 border border-zinc-800 rounded p-3">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs font-mono text-zinc-300">
                        {item.action} {item.moduleName || "UNDEFINED_MODULE"}
                      </span>
                      {item.status === "FAILED" ? (
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                      ) : item.status === "SYNCING" ? (
                        <RefreshCcw className="w-3.5 h-3.5 text-yellow-500 animate-spin" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-zinc-500" />
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 truncate">
                      {new Date(item.timestamp).toLocaleTimeString()} • Retries: {item.retryCount} • {logs.find(l => l.recordId === item.payload.id)?.errorMessage}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
