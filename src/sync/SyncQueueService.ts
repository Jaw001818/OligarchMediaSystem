import { openDB, STORES } from "./idb";

export interface SyncAction {
  id: string;
  moduleName: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  payload: any;
  timestamp: number;
  retryCount: number;
  status: "WAITING" | "SYNCING" | "FAILED";
}

export class SyncQueueService {
  static async enqueue(action: Omit<SyncAction, "id" | "timestamp" | "retryCount" | "status">) {
    const processQueue = (queue: SyncAction[]): { updatedQueue: SyncAction[], itemAdded: boolean } => {
      // Find if there's already a waiting action for this specific document
      const existingIdx = queue.findIndex(q => 
        q.moduleName === action.moduleName && 
        q.payload?.id && 
        q.payload?.id === action.payload?.id && 
        q.status === "WAITING"
      );

      if (existingIdx !== -1) {
        const existing = queue[existingIdx];
        if (action.action === "DELETE") {
          if (existing.action === "CREATE") {
            // If created then deleted offline, remove it entirely
            queue.splice(existingIdx, 1);
          } else {
            // Convert to delete
            existing.action = "DELETE";
            existing.payload = action.payload;
            existing.timestamp = Date.now();
          }
        } else if (action.action === "UPDATE") {
          // Merge updates into the existing CREATE or UPDATE action
          existing.payload = { ...existing.payload, ...action.payload };
          existing.timestamp = Date.now();
        } else {
           // CREATE over existing (edge case)
           existing.payload = { ...existing.payload, ...action.payload };
           existing.timestamp = Date.now();
        }
        return { updatedQueue: queue, itemAdded: false };
      } else {
        const item: SyncAction = {
          ...action,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          retryCount: 0,
          status: "WAITING"
        };
        queue.push(item);
        return { updatedQueue: queue, itemAdded: true };
      }
    };

    try {
      const db = await openDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.QUEUE, "readwrite");
        const store = tx.objectStore(STORES.QUEUE);
        const request = store.getAll();
        
        request.onsuccess = () => {
          const queue = request.result as SyncAction[];
          const { updatedQueue, itemAdded } = processQueue(queue);
          
          if (!itemAdded) {
             // We modified an existing item or removed one.
             // Best to clear and rewrite to ensure it matches updatedQueue
             store.clear();
             updatedQueue.forEach(item => store.put(item));
          } else {
             // Just add the last one
             store.put(updatedQueue[updatedQueue.length - 1]);
          }
        };
        
        tx.oncomplete = () => {
          window.dispatchEvent(new CustomEvent("sync-queue-updated"));
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      const key = "offline_sync_queue";
      let queue: SyncAction[] = JSON.parse(localStorage.getItem(key) || "[]");
      const { updatedQueue } = processQueue(queue);
      localStorage.setItem(key, JSON.stringify(updatedQueue));
      window.dispatchEvent(new CustomEvent("sync-queue-updated"));
    }
  }

  static async getQueue(): Promise<SyncAction[]> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.QUEUE, "readwrite");
        const store = tx.objectStore(STORES.QUEUE);
        const index = store.index("timestamp");
        const request = index.getAll();
        request.onsuccess = () => {
          const items = request.result;
          const validItems = [];
          for (const item of items) {
             if (!item.moduleName || item.moduleName === "UNDEFINED_MODULE" || item.moduleName === "undefined" || item.moduleName === "") {
                store.delete(item.id);
             } else if (!item.payload || !item.payload.id) {
                // If it's an UPDATE or DELETE, it must have an id
                if (item.action !== "CREATE") {
                   store.delete(item.id);
                } else {
                   validItems.push(item);
                }
             } else {
                validItems.push(item);
             }
          }
          resolve(validItems);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      const key = "offline_sync_queue";
      let items = JSON.parse(localStorage.getItem(key) || "[]");
      const validItems = items.filter((item: any) => item.moduleName && item.moduleName !== "UNDEFINED_MODULE" && item.moduleName !== "undefined" && item.moduleName !== "" && !(item.action !== "CREATE" && (!item.payload || !item.payload.id)));
      if (items.length !== validItems.length) {
         localStorage.setItem(key, JSON.stringify(validItems));
      }
      return validItems;
    }
  }

  static async updateItem(item: SyncAction) {
    try {
      const db = await openDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.QUEUE, "readwrite");
        const store = tx.objectStore(STORES.QUEUE);
        store.put(item);
        tx.oncomplete = () => {
          window.dispatchEvent(new CustomEvent("sync-queue-updated"));
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      const key = "offline_sync_queue";
      const queue: SyncAction[] = JSON.parse(localStorage.getItem(key) || "[]");
      const index = queue.findIndex(q => q.id === item.id);
      if (index !== -1) queue[index] = item;
      localStorage.setItem(key, JSON.stringify(queue));
      window.dispatchEvent(new CustomEvent("sync-queue-updated"));
    }
  }

  static async removeItem(id: string) {
    try {
      const db = await openDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.QUEUE, "readwrite");
        const store = tx.objectStore(STORES.QUEUE);
        store.delete(id);
        tx.oncomplete = () => {
          window.dispatchEvent(new CustomEvent("sync-queue-updated"));
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      const key = "offline_sync_queue";
      let queue: SyncAction[] = JSON.parse(localStorage.getItem(key) || "[]");
      queue = queue.filter(q => q.id !== id);
      localStorage.setItem(key, JSON.stringify(queue));
      window.dispatchEvent(new CustomEvent("sync-queue-updated"));
    }
  }
}
