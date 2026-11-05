import { openDB, STORES } from "./idb";

export interface SyncLog {
  id: string;
  timestamp: number;
  recordId: string;
  action: string;
  status: "SUCCESS" | "ERROR";
  attempts: number;
  errorMessage?: string;
}

export class SyncLoggerService {
  static async log(entry: Omit<SyncLog, "id" | "timestamp">) {
    const log: SyncLog = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    };

    try {
      const db = await openDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.LOGS, "readwrite");
        const store = tx.objectStore(STORES.LOGS);
        store.put(log);
        tx.oncomplete = () => {
          window.dispatchEvent(new CustomEvent("sync-logs-updated"));
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      const key = "offline_sync_logs";
      const logs = JSON.parse(localStorage.getItem(key) || "[]");
      logs.push(log);
      // keep only last 100 logs
      if (logs.length > 100) logs.shift();
      localStorage.setItem(key, JSON.stringify(logs));
      window.dispatchEvent(new CustomEvent("sync-logs-updated"));
    }
  }

  static async getLogs(): Promise<SyncLog[]> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.LOGS, "readonly");
        const store = tx.objectStore(STORES.LOGS);
        const index = store.index("timestamp");
        const request = index.getAll();
        request.onsuccess = () => {
          resolve(request.result.reverse().slice(0, 100)); // Last 100 logs
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      const key = "offline_sync_logs";
      const logs = JSON.parse(localStorage.getItem(key) || "[]");
      return logs.reverse().slice(0, 100);
    }
  }
}
