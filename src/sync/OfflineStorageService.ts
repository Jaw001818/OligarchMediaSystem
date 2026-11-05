import { openDB, STORES } from "./idb";

export class OfflineStorageService {
  static async saveRecord(moduleName: string, record: any) {
    try {
      const db = await openDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.DATA, "readwrite");
        const store = tx.objectStore(STORES.DATA);
        store.put({ id: `${moduleName}_${record.id}`, moduleName, data: record, lastModified: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      // Fallback to localStorage
      const key = `offline_data_${moduleName}`;
      const existing = JSON.parse(localStorage.getItem(key) || "{}");
      existing[record.id] = record;
      localStorage.setItem(key, JSON.stringify(existing));
    }
  }

  static async getRecord(moduleName: string, id: string): Promise<any> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.DATA, "readonly");
        const store = tx.objectStore(STORES.DATA);
        const request = store.get(`${moduleName}_${id}`);
        request.onsuccess = () => resolve(request.result?.data || null);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      const key = `offline_data_${moduleName}`;
      const existing = JSON.parse(localStorage.getItem(key) || "{}");
      return existing[id] || null;
    }
  }

  static async getAllRecords(moduleName: string): Promise<any[]> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.DATA, "readonly");
        const store = tx.objectStore(STORES.DATA);
        const request = store.getAll();
        request.onsuccess = () => {
          const records = request.result.filter((r: any) => r.moduleName === moduleName).map((r: any) => r.data);
          resolve(records);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      const key = `offline_data_${moduleName}`;
      const existing = JSON.parse(localStorage.getItem(key) || "{}");
      return Object.values(existing);
    }
  }

  static async deleteRecord(moduleName: string, id: string) {
    try {
      const db = await openDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.DATA, "readwrite");
        const store = tx.objectStore(STORES.DATA);
        store.delete(`${moduleName}_${id}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      const key = `offline_data_${moduleName}`;
      const existing = JSON.parse(localStorage.getItem(key) || "{}");
      delete existing[id];
      localStorage.setItem(key, JSON.stringify(existing));
    }
  }
}
