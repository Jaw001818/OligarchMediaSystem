import { initializeApp } from "firebase/app";
import { 
  initializeFirestore, 
  getFirestore,
  persistentLocalCache, 
  persistentMultipleTabManager,
  doc as firestoreDoc, 
  getDoc as firestoreGetDoc,
  collection as firestoreCollection,
  addDoc as firestoreAddDoc,
  updateDoc as firestoreUpdateDoc,
  setDoc as firestoreSetDoc,
  deleteDoc as firestoreDeleteDoc,
  getDocs as firestoreGetDocs,
  onSnapshot as firestoreOnSnapshot,
  query as firestoreQuery,
  where as firestoreWhere,
  orderBy as firestoreOrderBy,
  limit as firestoreLimit,
  serverTimestamp
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { SyncQueueService } from "./sync/SyncQueueService";
import defaultFirebaseConfig from "../firebase-applet-config.json";

// Support both built-in config and optional environment variables
const envApiKey = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_FIREBASE_API_KEY) || "";
const envProjectId = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID) || "";
const envAuthDomain = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN) || "";
const envDbId = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_FIREBASE_DATABASE_ID) || "";

export const firebaseConfig = {
  ...defaultFirebaseConfig,
  ...(envApiKey ? { apiKey: envApiKey } : {}),
  ...(envProjectId ? { projectId: envProjectId } : {}),
  ...(envAuthDomain ? { authDomain: envAuthDomain } : {}),
  ...(envDbId ? { firestoreDatabaseId: envDbId } : {})
};

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Cloud Firestore as the ONE Central Database and Single Source of Truth
// Using persistent IndexedDB multi-tab cache for seamless offline caching & instant loads
const rawDbId = envDbId || (firebaseConfig as any).firestoreDatabaseId;
const isNamedDb = rawDbId && rawDbId !== "(default)" && rawDbId !== "default";
const activeDbId = isNamedDb ? rawDbId : undefined;

let dbInstance: any;
try {
  dbInstance = activeDbId
    ? initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      }, activeDbId)
    : initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      });
} catch {
  try {
    dbInstance = activeDbId ? initializeFirestore(app, {}, activeDbId) : initializeFirestore(app, {});
  } catch {
    dbInstance = activeDbId ? getFirestore(app, activeDbId) : getFirestore(app);
  }
}
export const db = dbInstance;

// Initialize Authentication and Storage
export const auth = getAuth(app);
export const storage = getStorage(app);

// Clean up any obsolete sandbox flags from previous versions
const isBrowser = typeof window !== "undefined" && typeof localStorage !== "undefined";
if (isBrowser) {
  try {
    localStorage.removeItem("local_sandbox_active");
  } catch {}
}

export const USE_SERVER_DATABASE = false;

// Sandbox mode is permanently deactivated — Firestore is the sole source of truth
export function isSandboxActive(): boolean {
  return false;
}

export function setSandboxActive(_active: boolean) {
  // No-op: Sandbox mode is permanently disabled
}

// In-memory cache helper for fast synchronous read fallbacks during component renders
const inMemoryCache: Record<string, any[]> = {};
const deletedTombstoneSet = new Set<string>();

export function getLocalData(collectionName: string): any[] {
  if (!collectionName || collectionName === "undefined") return [];
  return inMemoryCache[collectionName] || [];
}

export function setLocalData(collectionName: string, data: any[], _options?: any) {
  if (!collectionName || collectionName === "undefined") return;
  inMemoryCache[collectionName] = data;
}

export function clearAllLocalData() {
  Object.keys(inMemoryCache).forEach(k => delete inMemoryCache[k]);
  deletedTombstoneSet.clear();
}

export function clearDeletedTombstones() {
  deletedTombstoneSet.clear();
}

// Quota warning & error detection
const QUOTA_EXHAUSTED_KEY = "firestore_quota_exhausted_time";
export const FIRESTORE_UPGRADE_URL = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${activeDbId}/data?openUpgradeDialog=true`;

export function isQuotaExhaustedRecently(): boolean {
  if (!isBrowser) return false;
  try {
    const raw = localStorage.getItem(QUOTA_EXHAUSTED_KEY);
    if (!raw) return false;
    const time = parseInt(raw, 10);
    return Date.now() - time < 30 * 60 * 1000; // 30 minutes check
  } catch {
    return false;
  }
}

export function recordQuotaExhaustion() {
  if (!isBrowser) return;
  try {
    localStorage.setItem(QUOTA_EXHAUSTED_KEY, String(Date.now()));
    window.dispatchEvent(new CustomEvent("sync-status-changed", { detail: "QUOTA_EXHAUSTED" }));
    window.dispatchEvent(new CustomEvent("firestore-quota-exceeded", { 
      detail: { upgradeUrl: FIRESTORE_UPGRADE_URL } 
    }));
  } catch {}
}

export function pauseFirestoreNetworkOnQuota(reason?: string) {
  recordQuotaExhaustion();
  console.warn("⚠️ Cloud Firestore daily free-tier write limit reached. Pending operations preserved in IndexedDB queue.", reason || "");
}

export function checkAndActivateSandboxOnQuotaError(err: any): boolean {
  const errMsg = String(err?.message || err?.code || (err && JSON.stringify(err)) || err || "").toLowerCase();
  if (
    errMsg.includes("resource-exhausted") || 
    errMsg.includes("resource_exhausted") || 
    errMsg.includes("quota exceeded") ||
    errMsg.includes("quota limit exceeded")
  ) {
    recordQuotaExhaustion();
    return true;
  }
  return false;
}

// Global unhandled rejection listener to intercept Firestore gRPC stream quota errors
if (isBrowser) {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg = String(reason?.message || reason?.code || reason || "").toLowerCase();
    if (msg.includes("resource-exhausted") || msg.includes("resource_exhausted") || msg.includes("quota exceeded") || msg.includes("quota limit exceeded")) {
      event.preventDefault();
      checkAndActivateSandboxOnQuotaError(reason);
    }
  });
}

// Helper to extract collection and document reference info
function extractRefInfo(ref: any): {
  colName: string;
  docId: string;
  isDoc: boolean;
  constraints: any[];
} {
  if (!ref) return { colName: "", docId: "", isDoc: false, constraints: [] };

  const colName =
    ref.__metaColName ||
    ref.colName ||
    (ref.parent ? ref.parent.id || ref.parent.path : "") ||
    (typeof ref.path === "string" ? ref.path.split("/")[0] : "") ||
    (ref._query?.path?.segments ? ref._query.path.segments[0] : "") ||
    (ref._path?.segments ? ref._path.segments[0] : "") ||
    ref.id ||
    "";

  const isDoc =
    ref.__metaType === "doc" ||
    ref.type === "doc" ||
    ref.type === "document" ||
    Boolean(ref.__metaDocId || ref.docId || (typeof ref.path === "string" && ref.path.includes("/")));

  const docId =
    ref.__metaDocId ||
    ref.docId ||
    (isDoc && typeof ref.path === "string" ? ref.path.split("/")[1] : "") ||
    (isDoc ? ref.id : "") ||
    "";

  const constraints = ref.__metaConstraints || ref.constraints || [];
  return { colName, docId, isDoc, constraints };
}

// Reference builders
export function collection(referenceDbOrName: any, maybeName?: string): any {
  let targetDb: any = db;
  let name: string = "";

  if (typeof referenceDbOrName === "string") {
    name = referenceDbOrName;
    targetDb = db;
  } else {
    targetDb = referenceDbOrName || db;
    name = maybeName || "";
  }

  if (!name) name = "unknown";
  const colRef: any = firestoreCollection(targetDb, name);
  try {
    colRef.__metaColName = name;
    colRef.__metaType = "collection";
  } catch {}
  return colRef;
}

export function doc(referenceDbOrColOrPath: any, firstPath?: string, ...extraSegments: string[]): any {
  if (referenceDbOrColOrPath && (referenceDbOrColOrPath.type === "collection" || referenceDbOrColOrPath.__metaType === "collection")) {
    const colName = referenceDbOrColOrPath.__metaColName || referenceDbOrColOrPath.path || referenceDbOrColOrPath.id;
    const docId = firstPath || "";
    const dRef: any = extraSegments.length > 0
      ? firestoreDoc(referenceDbOrColOrPath, docId, ...extraSegments)
      : firestoreDoc(referenceDbOrColOrPath, docId);
    try {
      dRef.__metaColName = colName;
      dRef.__metaDocId = docId;
      dRef.__metaType = "doc";
    } catch {}
    return dRef;
  }

  let targetDb: any = db;
  let colName = "";
  let docId = "";

  if (typeof referenceDbOrColOrPath === "string") {
    targetDb = db;
    colName = referenceDbOrColOrPath;
    docId = firstPath || "";
  } else {
    targetDb = referenceDbOrColOrPath || db;
    colName = firstPath || "";
    docId = extraSegments[0] || "";
  }

  const dRef: any = extraSegments.length > 1
    ? firestoreDoc(targetDb, colName, docId, ...extraSegments.slice(1))
    : firestoreDoc(targetDb, colName, docId);

  try {
    dRef.__metaColName = colName;
    dRef.__metaDocId = docId;
    dRef.__metaType = "doc";
  } catch {}
  return dRef;
}

export function query(collectionRef: any, ...constraints: any[]): any {
  const { colName } = extractRefInfo(collectionRef);
  const targetRef = collectionRef?.__metaType === "collection" ? collectionRef : collection(db, colName);
  const qRef: any = firestoreQuery(targetRef, ...constraints);
  try {
    qRef.__metaColName = colName;
    qRef.__metaType = "query";
    qRef.__metaConstraints = constraints;
  } catch {}
  return qRef;
}

export function where(field: string, op: string, value: any): any {
  return firestoreWhere(field, op as any, value);
}

export function orderBy(field: string, direction?: "asc" | "desc"): any {
  return firestoreOrderBy(field, direction);
}

export function limit(n: number): any {
  return firestoreLimit(n);
}

export { serverTimestamp };

// =========================================================
// DUAL-ENGINE: SERVER PERSISTENT STORE & SSE MULTI-DEVICE MESH
// =========================================================

let sseConnection: EventSource | null = null;
const sseCollectionSubscribers = new Map<string, Set<() => void>>();

function ensureSseConnection() {
  if (!isBrowser || sseConnection) return;
  try {
    sseConnection = new EventSource("/api/db-events");
    sseConnection.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.collection) {
          const col = payload.collection;
          fetchServerCollection(col).then((updatedItems) => {
            if (updatedItems) {
              inMemoryCache[col] = updatedItems;
              const subs = sseCollectionSubscribers.get(col);
              if (subs) subs.forEach((cb) => cb());
            }
          }).catch(() => {});
        }
      } catch {}
    };
    sseConnection.onerror = () => {
      // EventSource auto-reconnects
    };
  } catch {}
}

async function fetchServerCollection(colName: string): Promise<any[] | null> {
  if (!isBrowser || !colName) return null;
  try {
    const res = await fetch(`/api/persistent-store?collection=${encodeURIComponent(colName)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json?.items) ? json.items : (Array.isArray(json?.data) ? json.data : null);
  } catch {
    return null;
  }
}

async function syncToServerStore(colName: string, item: any, action: "UPSERT" | "DELETE") {
  if (!isBrowser || !colName) return;
  try {
    if (action === "UPSERT") {
      fetch("/api/persistent-store/upsert-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection: colName, item, syncToFirestore: false }),
        keepalive: true
      }).catch(() => {});
    } else {
      fetch("/api/persistent-store/delete-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection: colName, id: item?.id || item, syncToFirestore: false }),
        keepalive: true
      }).catch(() => {});
    }
  } catch {}
}

function notifyLocalSubscribers(colName: string) {
  const subs = sseCollectionSubscribers.get(colName);
  if (subs) {
    subs.forEach((cb) => {
      try { cb(); } catch {}
    });
  }
}

// =========================================================
// CENTRAL FIRESTORE & DUAL-ENGINE CRUD OPERATIONS
// =========================================================

export async function addDoc(collectionRef: any, data: any): Promise<any> {
  const { colName } = extractRefInfo(collectionRef);
  const effectiveCol = colName || "records";
  ensureSseConnection();

  // Deterministic ID for devotion_schedules by date
  if (effectiveCol === "devotion_schedules" && data?.date) {
    const dateDocRef = doc(db, "devotion_schedules", data.date);
    await setDoc(dateDocRef, { ...data, id: data.date, date: data.date }, { merge: true });
    return { id: data.date, __metaColName: "devotion_schedules", __metaDocId: data.date };
  }

  const generatedId = data?.id || ("doc-" + Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 7));
  const payload = {
    ...data,
    id: generatedId,
    updatedAt: Date.now()
  };

  // 1. Dual-Engine: Immediate commit to Unlimited Server Store & In-Memory Cache (NEVER BLOCKED)
  const existingList = inMemoryCache[effectiveCol] || [];
  inMemoryCache[effectiveCol] = [...existingList.filter((x: any) => x.id !== generatedId), payload];
  notifyLocalSubscribers(effectiveCol);
  syncToServerStore(effectiveCol, payload, "UPSERT");

  // 2. Dual-Engine: Mirror to Cloud Firestore if within quota
  try {
    const realRef = collection(db, effectiveCol);
    const res = await firestoreAddDoc(realRef, payload);
    return res;
  } catch (err: any) {
    checkAndActivateSandboxOnQuotaError(err);
    // Queue offline action in IndexedDB
    await SyncQueueService.enqueue({
      moduleName: effectiveCol,
      action: "CREATE",
      payload: { ...payload, id: generatedId, syncStatus: "PENDING_SYNC" }
    });
    return { id: generatedId, __metaColName: effectiveCol, __metaDocId: generatedId };
  }
}

export async function setDoc(docRef: any, data: any, options?: any): Promise<void> {
  const { colName, docId } = extractRefInfo(docRef);
  const effectiveCol = colName || "records";
  const effectiveId = docId || data?.id || data?.date;
  ensureSseConnection();

  const payload = {
    ...data,
    id: effectiveId,
    updatedAt: data?.updatedAt ? Math.max(Number(data.updatedAt) || 0, Date.now()) : Date.now()
  };

  // If re-saving an item, remove any stale tombstone
  if (effectiveCol !== "deleted_records") {
    deletedTombstoneSet.delete(`${effectiveCol}:${effectiveId}`);
  }

  // 1. Dual-Engine: Immediate commit to Unlimited Server Store & In-Memory Cache (NEVER BLOCKED)
  const existingList = inMemoryCache[effectiveCol] || [];
  const idx = existingList.findIndex((x: any) => x.id === effectiveId || (effectiveCol === "devotion_schedules" && x.date === effectiveId));
  if (idx !== -1) {
    existingList[idx] = options?.merge ? { ...existingList[idx], ...payload } : payload;
  } else {
    existingList.push(payload);
  }
  inMemoryCache[effectiveCol] = existingList;
  notifyLocalSubscribers(effectiveCol);
  syncToServerStore(effectiveCol, payload, "UPSERT");

  // 2. Dual-Engine: Mirror to Cloud Firestore if within quota
  try {
    const realDocRef = doc(db, effectiveCol, effectiveId);
    await firestoreSetDoc(realDocRef, payload, options);
  } catch (err: any) {
    checkAndActivateSandboxOnQuotaError(err);
    // Queue action in IndexedDB
    await SyncQueueService.enqueue({
      moduleName: effectiveCol,
      action: "UPDATE",
      payload: { ...payload, id: effectiveId, syncStatus: "PENDING_SYNC" }
    });
  }
}

export async function updateDoc(docRef: any, data: any): Promise<void> {
  const { colName, docId } = extractRefInfo(docRef);
  const effectiveCol = colName || "records";
  const effectiveId = docId || data?.id;
  ensureSseConnection();

  const payload = {
    ...data,
    id: effectiveId,
    updatedAt: Date.now()
  };

  // 1. Dual-Engine: Immediate commit to Unlimited Server Store & In-Memory Cache
  const existingList = inMemoryCache[effectiveCol] || [];
  const idx = existingList.findIndex((x: any) => x.id === effectiveId);
  if (idx !== -1) {
    existingList[idx] = { ...existingList[idx], ...payload };
    inMemoryCache[effectiveCol] = existingList;
    notifyLocalSubscribers(effectiveCol);
    syncToServerStore(effectiveCol, existingList[idx], "UPSERT");
  } else {
    notifyLocalSubscribers(effectiveCol);
    syncToServerStore(effectiveCol, payload, "UPSERT");
  }

  // 2. Dual-Engine: Mirror to Cloud Firestore
  try {
    const realDocRef = doc(db, effectiveCol, effectiveId);
    await firestoreUpdateDoc(realDocRef, payload);
  } catch (err: any) {
    if (!checkAndActivateSandboxOnQuotaError(err)) {
      try {
        const realDocRef = doc(db, effectiveCol, effectiveId);
        await firestoreSetDoc(realDocRef, payload, { merge: true });
      } catch (innerErr) {
        checkAndActivateSandboxOnQuotaError(innerErr);
        await SyncQueueService.enqueue({
          moduleName: effectiveCol,
          action: "UPDATE",
          payload: { ...payload, id: effectiveId, syncStatus: "PENDING_SYNC" }
        });
      }
    } else {
      await SyncQueueService.enqueue({
        moduleName: effectiveCol,
        action: "UPDATE",
        payload: { ...payload, id: effectiveId, syncStatus: "PENDING_SYNC" }
      });
    }
  }
}

export async function deleteDoc(docRef: any): Promise<void> {
  const { colName, docId } = extractRefInfo(docRef);
  if (!colName || !docId) return;
  ensureSseConnection();

  // Record tombstone in memory immediately
  deletedTombstoneSet.add(`${colName}:${docId}`);

  // 1. Dual-Engine: Delete from Unlimited Server Store & In-Memory Cache
  const existingList = inMemoryCache[colName] || [];
  inMemoryCache[colName] = existingList.filter((x: any) => x.id !== docId && !(colName === "devotion_schedules" && x.date === docId));
  notifyLocalSubscribers(colName);
  syncToServerStore(colName, { id: docId }, "DELETE");

  // Safeguard: Archive into deleted_records (Recycle Bin) before permanent deletion
  if (colName !== "deleted_records") {
    try {
      const realDocRef = doc(db, colName, docId);
      const snap = await firestoreGetDoc(realDocRef).catch(() => null);
      if (snap && snap.exists()) {
        const existingData = snap.data();
        const trashId = `trash_${colName}_${docId}_${Date.now()}`;
        const trashRecord = {
          id: trashId,
          originalCollection: colName,
          originalId: docId,
          title: existingData.fullName || existingData.employeeName || existingData.name || existingData.subject || existingData.date || `${colName} #${docId}`,
          subtitle: existingData.employeeNumber ? `Employee #${existingData.employeeNumber}` : existingData.department || existingData.position || "",
          data: existingData,
          deletedAt: new Date().toISOString(),
          deletedBy: "Admin"
        };
        await firestoreSetDoc(doc(db, "deleted_records", trashId), trashRecord).catch(() => {});
      }
    } catch {}
  }

  // 2. Dual-Engine: Mirror deletion to Cloud Firestore
  try {
    const realDocRef = doc(db, colName, docId);
    await firestoreDeleteDoc(realDocRef);
  } catch (err: any) {
    checkAndActivateSandboxOnQuotaError(err);
    await SyncQueueService.enqueue({
      moduleName: colName,
      action: "DELETE",
      payload: { id: docId }
    });
  }
}

export async function getDocs(queryOrColRef: any): Promise<any> {
  const { colName } = extractRefInfo(queryOrColRef);
  ensureSseConnection();

  try {
    const snap = await firestoreGetDocs(queryOrColRef);
    if (colName === "deleted_records") {
      // Update local tombstone set from remote deleted_records
      snap.forEach((d: any) => {
        const data = d.data();
        if (data.originalCollection && data.originalId && data.originalId !== "Y5fCWLfZk5lfg2Ocp1f9") {
          deletedTombstoneSet.add(`${data.originalCollection}:${data.originalId}`);
        }
      });
      return snap;
    }

    // Cache Firestore results into inMemoryCache
    const items = snap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
    if (items.length > 0) {
      inMemoryCache[colName] = items;
    }

    // Filter out any tombstoned items
    if (deletedTombstoneSet.size > 0 && colName) {
      const filteredDocs = snap.docs.filter((d: any) => !deletedTombstoneSet.has(`${colName}:${d.id}`));
      return {
        empty: filteredDocs.length === 0,
        size: filteredDocs.length,
        docs: filteredDocs,
        forEach: (callback: (d: any) => void) => filteredDocs.forEach(callback)
      };
    }
    return snap;
  } catch (err: any) {
    checkAndActivateSandboxOnQuotaError(err);
    // Dual-Engine Fallback: read from server store / memory cache
    const serverItems = (await fetchServerCollection(colName)) || inMemoryCache[colName] || [];
    const validItems = serverItems.filter((d: any) => !deletedTombstoneSet.has(`${colName}:${d.id}`));
    const syntheticDocs = validItems.map((item: any) => ({
      id: item.id || item.date,
      data: () => item,
      exists: () => true
    }));
    return {
      empty: syntheticDocs.length === 0,
      size: syntheticDocs.length,
      docs: syntheticDocs,
      forEach: (callback: (d: any) => void) => syntheticDocs.forEach(callback)
    };
  }
}

export async function getDoc(docRef: any): Promise<any> {
  const { colName, docId } = extractRefInfo(docRef);
  ensureSseConnection();

  if (colName && docId && deletedTombstoneSet.has(`${colName}:${docId}`) && colName !== "deleted_records") {
    return {
      exists: () => false,
      id: docId,
      data: () => null
    };
  }
  try {
    const snap = await firestoreGetDoc(docRef);
    if (snap.exists()) {
      return snap;
    }
    // If not in firestore, check server persistent store
    const serverItems = inMemoryCache[colName] || (await fetchServerCollection(colName)) || [];
    const item = serverItems.find((x: any) => x.id === docId || (colName === "devotion_schedules" && x.date === docId));
    if (item) {
      return {
        exists: () => true,
        id: docId,
        data: () => item
      };
    }
    return snap;
  } catch (err: any) {
    checkAndActivateSandboxOnQuotaError(err);
    const serverItems = inMemoryCache[colName] || (await fetchServerCollection(colName)) || [];
    const item = serverItems.find((x: any) => x.id === docId || (colName === "devotion_schedules" && x.date === docId));
    if (item) {
      return {
        exists: () => true,
        id: docId,
        data: () => item
      };
    }
    return {
      exists: () => false,
      id: docId,
      data: () => null
    };
  }
}

// Real-Time Snapshot Listener: Live synchronization across all devices and preview/published apps
export function onSnapshot(
  queryOrDocRef: any,
  onNext: (snapshot: any) => void,
  onError?: (error: any) => void
): () => void {
  const { colName, docId, isDoc } = extractRefInfo(queryOrDocRef);
  ensureSseConnection();

  let isSubscribed = true;

  // Helper to build synthetic snapshot from cache / server store
  const emitLocalSnapshot = async () => {
    if (!isSubscribed || !colName) return;
    if (isDoc) {
      const items = inMemoryCache[colName] || (await fetchServerCollection(colName)) || [];
      const item = items.find((x: any) => x.id === docId || (colName === "devotion_schedules" && x.date === docId));
      if (!item || (deletedTombstoneSet.has(`${colName}:${docId}`) && colName !== "deleted_records")) {
        onNext({ exists: () => false, id: docId, data: () => null });
      } else {
        onNext({ exists: () => true, id: docId, data: () => item });
      }
    } else {
      let items = inMemoryCache[colName];
      if (!items || items.length === 0) {
        items = (await fetchServerCollection(colName)) || [];
        if (items.length > 0) inMemoryCache[colName] = items;
      }
      const valid = items.filter((d: any) => !deletedTombstoneSet.has(`${colName}:${d.id}`));
      const docs = valid.map((item: any) => ({
        id: item.id || item.date,
        data: () => item,
        exists: () => true
      }));
      onNext({
        empty: docs.length === 0,
        size: docs.length,
        docs,
        forEach: (cb: (d: any) => void) => docs.forEach(cb)
      });
    }
  };

  // Register with SSE collection subscriber
  if (colName) {
    if (!sseCollectionSubscribers.has(colName)) {
      sseCollectionSubscribers.set(colName, new Set());
    }
    sseCollectionSubscribers.get(colName)!.add(emitLocalSnapshot);
    // Proactively emit server snapshot immediately so UI renders instantaneously without quota delays
    emitLocalSnapshot();
  }

  const unsubscribeFirestore = firestoreOnSnapshot(
    queryOrDocRef,
    (snap: any) => {
      if (!isSubscribed) return;
      if (isDoc) {
        if (colName && docId && deletedTombstoneSet.has(`${colName}:${docId}`) && colName !== "deleted_records") {
          onNext({
            exists: () => false,
            id: docId,
            data: () => null
          });
          return;
        }
        onNext(snap);
      } else {
        if (colName === "deleted_records") {
          snap.forEach((d: any) => {
            const data = d.data();
            if (data.originalCollection && data.originalId && data.originalId !== "Y5fCWLfZk5lfg2Ocp1f9") {
              deletedTombstoneSet.add(`${data.originalCollection}:${data.originalId}`);
            }
          });
          onNext(snap);
          return;
        }

        // Cache remote items into inMemoryCache
        const remoteItems = snap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
        if (remoteItems.length > 0) {
          inMemoryCache[colName] = remoteItems;
        }

        if (deletedTombstoneSet.size > 0 && colName) {
          const validDocs = snap.docs.filter((d: any) => !deletedTombstoneSet.has(`${colName}:${d.id}`));
          onNext({
            empty: validDocs.length === 0,
            size: validDocs.length,
            docs: validDocs,
            forEach: (callback: (d: any) => void) => validDocs.forEach(callback)
          });
          return;
        }
        onNext(snap);
      }
    },
    (err: any) => {
      checkAndActivateSandboxOnQuotaError(err);
      // Seamless Dual-Engine fallback to server store
      emitLocalSnapshot();
      if (onError) onError(err);
    }
  );

  return () => {
    isSubscribed = false;
    if (colName && sseCollectionSubscribers.has(colName)) {
      sseCollectionSubscribers.get(colName)!.delete(emitLocalSnapshot);
    }
    try {
      unsubscribeFirestore();
    } catch {}
  };
}

// ---------------------------------------------------------
// RECYCLE BIN / DELETED RECORDS RESTORATION HELPERS
// ---------------------------------------------------------

export async function restoreDeletedRecord(trashId: string): Promise<boolean> {
  try {
    const trashDocRef = doc(db, "deleted_records", trashId);
    const snap = await firestoreGetDoc(trashDocRef);
    const trashItem = snap.data() as any;
    if (!trashItem || !trashItem.originalCollection || !trashItem.originalId) return false;

    const { originalCollection, originalId, data } = trashItem;
    deletedTombstoneSet.delete(`${originalCollection}:${originalId}`);

    // Restore into original collection
    const targetRef = doc(db, originalCollection, originalId);
    await firestoreSetDoc(targetRef, { ...data, updatedAt: Date.now() }, { merge: true });

    // Remove from deleted_records
    await firestoreDeleteDoc(trashDocRef);
    return true;
  } catch (err) {
    console.error("Failed to restore deleted record:", err);
    return false;
  }
}

export async function permanentlyDeleteTrashRecord(trashId: string): Promise<boolean> {
  try {
    const trashDocRef = doc(db, "deleted_records", trashId);
    await firestoreDeleteDoc(trashDocRef);
    return true;
  } catch (err) {
    console.error("Failed to purge trash record:", err);
    return false;
  }
}

export async function emptyTrash(): Promise<void> {
  try {
    const snap = await firestoreGetDocs(collection(db, "deleted_records"));
    for (const d of snap.docs) {
      await firestoreDeleteDoc(doc(db, "deleted_records", d.id)).catch(() => {});
    }
  } catch (err) {
    console.error("Failed to empty trash:", err);
  }
}

// ---------------------------------------------------------
// FIRESTORE ERROR HANDLING (STANDARDIZED PER SKILL)
// ---------------------------------------------------------

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): void {
  checkAndActivateSandboxOnQuotaError(error);
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.warn('[Handled Firestore Notice]:', JSON.stringify(errInfo));
}
