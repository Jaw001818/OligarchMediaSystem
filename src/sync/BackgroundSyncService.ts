import { NetworkStatusService } from "./NetworkStatusService";
import { SyncQueueService, SyncAction } from "./SyncQueueService";
import { SyncLoggerService } from "./SyncLoggerService";
import { 
  app, db, auth, storage,
  doc as firestoreDoc, 
  getDoc as firestoreGetDoc,
  collection as firestoreCollection,
  addDoc as firestoreAddDoc,
  updateDoc as firestoreUpdateDoc,
  setDoc as firestoreSetDoc,
  deleteDoc as firestoreDeleteDoc,
  query,
  where,
  getDocs as firestoreGetDocs,
  isSandboxActive,
  setSandboxActive,
  checkAndActivateSandboxOnQuotaError
} from "../firebase";
import { ConflictResolverService } from "./ConflictResolverService";


function sanitizePayload(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizePayload);
  const newObj: any = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      newObj[key] = sanitizePayload(obj[key]);
    }
  }
  return newObj;
}

export class BackgroundSyncService {
  private static isSyncing = false;
  private static syncInterval: any;

  static start() {
    this.sync();
    // 3 minutes interval to preserve Firestore read/write quota
    this.syncInterval = setInterval(() => this.sync(), 180000);

    // Trigger on network reconnect
    NetworkStatusService.subscribe((isOnline) => {
      if (isOnline) {
        this.sync();
      }
    });

    // Listen for manual sync requests
    window.addEventListener("force-sync", () => this.sync());
  }

  static async sync() {
    if (this.isSyncing) return;
    if (!NetworkStatusService.getStatus()) return;

    this.isSyncing = true;
    window.dispatchEvent(new CustomEvent("sync-status-changed", { detail: "SYNCING" }));

    try {
      const queue = await SyncQueueService.getQueue();
      const waiting = queue.filter(q => q.status === "WAITING" || q.status === "FAILED");
      
      // Sort chronologically
      waiting.sort((a, b) => a.timestamp - b.timestamp);

      for (const item of waiting) {
        if (!item.moduleName || item.moduleName === "UNDEFINED_MODULE" || item.moduleName === "undefined") {
           await SyncQueueService.removeItem(item.id);
           continue;
        }
        item.status = "SYNCING";
        await SyncQueueService.updateItem(item);

        try {
          item.payload = sanitizePayload(item.payload);
          await this.processItem(item);
          await SyncQueueService.removeItem(item.id);
          
          await SyncLoggerService.log({
            recordId: item.payload.id || "N/A",
            action: `${item.action} ${item.moduleName}`,
            status: "SUCCESS",
            attempts: item.retryCount + 1
          });
          
        } catch (error: any) {
          if (checkAndActivateSandboxOnQuotaError(error)) {
             // Quota exceeded during sync. Stop syncing and revert status.
             item.status = "WAITING";
             await SyncQueueService.updateItem(item);
             break; // Stop loop
          }

          item.retryCount += 1;
          if (item.retryCount > 10) {
             console.warn("Item exceeded max retries, deleting:", item);
             await SyncQueueService.removeItem(item.id);
             continue;
          }
          item.status = "FAILED";
          await SyncQueueService.updateItem(item);

          await SyncLoggerService.log({
            recordId: item.payload.id || "N/A",
            action: `${item.action} ${item.moduleName}`,
            status: "ERROR",
            attempts: item.retryCount,
            errorMessage: error.message || "Unknown error"
          });
        }
      }

      window.dispatchEvent(new CustomEvent("sync-status-changed", { detail: "ONLINE" }));
    } catch (err) {
      console.error("Sync loop error:", err);
      window.dispatchEvent(new CustomEvent("sync-status-changed", { detail: "OFFLINE" }));
    } finally {
      this.isSyncing = false;
    }
  }

  private static async processItem(item: SyncAction) {
    const colRef = firestoreCollection(db, item.moduleName);
    
    if (item.action === "CREATE") {
      // Avoid Duplicate employeeNumber for employees
      if (item.moduleName === "employees" && item.payload.employeeNumber) {
         const empQuery = query(colRef, where("employeeNumber", "==", item.payload.employeeNumber));
         const existing = await firestoreGetDocs(empQuery);
         if (!existing.empty) {
             // Duplicate exists! 
             // The user explicitly requested NOT to overwrite the online employee if there's a collision.
             // We will simply discard this offline CREATE action to preserve the online truth.
             console.warn(`[Sync] Discarding offline employee creation due to duplicate employeeNumber: ${item.payload.employeeNumber}`);
             return;
         }
      }

      const finalPayload = {
        ...item.payload,
        syncStatus: "SYNCED",
        syncedAtCloud: new Date().toISOString()
      };
      delete finalPayload.isOfflinePending;

      if (finalPayload.id && typeof finalPayload.id === 'string' && !finalPayload.id.startsWith("mock-")) {
        const docRef = firestoreDoc(db, item.moduleName, finalPayload.id);
        await firestoreSetDoc(docRef, finalPayload, { merge: true });
      } else {
        const dataToSave = { ...finalPayload };
        delete dataToSave.id;
        await firestoreAddDoc(colRef, dataToSave);
      }
    } else if (item.action === "UPDATE") {
      const docRef = firestoreDoc(db, item.moduleName, item.payload.id);
      const finalPayload = {
        ...item.payload,
        syncStatus: "SYNCED",
        syncedAtCloud: new Date().toISOString()
      };
      delete finalPayload.isOfflinePending;
      
      // Conflict Resolution: get current server doc
      try {
         const remoteSnap = await firestoreGetDoc(docRef);
         if (remoteSnap.exists()) {
             const resolvedData = ConflictResolverService.resolve(finalPayload, remoteSnap.data());
             await firestoreSetDoc(docRef, resolvedData, { merge: true });
         } else {
             await firestoreSetDoc(docRef, finalPayload, { merge: true });
         }
      } catch (e) {
          throw e;
      }
      
    } else if (item.action === "DELETE") {
      const docRef = firestoreDoc(db, item.moduleName, item.payload.id);
      await firestoreDeleteDoc(docRef);
    }
  }
}
