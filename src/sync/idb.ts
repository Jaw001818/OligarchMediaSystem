export const DB_NAME = "OligarchMediaSyncDB";
export const DB_VERSION = 1;

export const STORES = {
  QUEUE: "sync_queue",
  DATA: "offline_data",
  LOGS: "sync_logs"
};

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains(STORES.QUEUE)) {
        const queueStore = db.createObjectStore(STORES.QUEUE, { keyPath: "id" });
        queueStore.createIndex("timestamp", "timestamp", { unique: false });
      }
      
      if (!db.objectStoreNames.contains(STORES.DATA)) {
        db.createObjectStore(STORES.DATA, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORES.LOGS)) {
        const logStore = db.createObjectStore(STORES.LOGS, { keyPath: "id" });
        logStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
