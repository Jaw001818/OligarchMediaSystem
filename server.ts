import express from "express";
import path from "path";
import fs from "fs";
import dns from "dns";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { requireAuth, type AuthRequest } from "./src/middleware/auth.ts";
import { getUsers, getOrCreateUser } from "./src/db/users.ts";
import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getFirestore, 
  doc as fsDoc, 
  setDoc as fsSetDoc, 
  deleteDoc as fsDeleteDoc, 
  getDocs as fsGetDocs, 
  collection as fsCollection 
} from "firebase/firestore";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// In-memory or simulated database backup log (just to ensure manual DB exports work perfectly)
let emailLogs: Array<{
  id: string;
  to: string;
  subject: string;
  content: string;
  timestamp: string;
  status: string;
}> = [];

// Helper: build RFC 2822 base64url encoded MIME message for Gmail API
function createGmailRawMessage(from: string, to: string, subject: string, html: string): string {
  const cleanSubject = (subject || "").replace(/[\r\n]+/g, " ");
  const encodedSubject = `=?UTF-8?B?${Buffer.from(cleanSubject, "utf-8").toString("base64")}?=`;
  const mimeLines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf-8").toString("base64")
  ];
  return Buffer.from(mimeLines.join("\r\n"), "utf-8").toString("base64url");
}

async function sendViaGmailApi(accessToken: string, from: string, to: string, subject: string, html: string) {
  const raw = createGmailRawMessage(from, to, subject, html);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw })
  });
  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as any;
    throw new Error(errorData?.error?.message || `Gmail API HTTP ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as any;
}

// REST API endpoint: send manual notifications via Gmail API or SMTP or log them dynamically
app.post("/api/send-email", async (req, res) => {
  const { to, subject, content, smtpConfig, googleAccessToken } = req.body;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7).trim() : null;
  const effectiveGoogleToken = bearerToken || googleAccessToken;

  if (!to || !subject || !content) {
     res.status(400).json({ error: "Missing required mail fields (to, subject, content)" });
     return;
  }

  // Create audit/logged item
  const logId = "mail-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5);
  const logEntry: any = {
    id: logId,
    to,
    subject,
    content,
    timestamp: new Date().toISOString(),
    status: "Sent (Simulated)"
  };

  try {
    const senderName = smtpConfig?.senderName || process.env.SMTP_SENDER_NAME || "Oligarch Media Graphic Design Studio";
    const senderEmail = smtpConfig?.user || process.env.SMTP_USER || "hr.oligarchmedia@gmail.com";
    const fromHeader = `"${senderName.replace(/"/g, "")}" <${senderEmail}>`;

    // Priority 1: Gmail REST API with OAuth token
    if (effectiveGoogleToken) {
      try {
        const gmailResult = await sendViaGmailApi(effectiveGoogleToken, fromHeader, String(to).trim(), subject, content);
        logEntry.status = "Delivered";
        logEntry.messageId = gmailResult.id;
        logEntry.provider = "Gmail API (OAuth)";
        emailLogs.push(logEntry);
        res.json({ success: true, status: "Delivered", provider: "gmail", messageId: gmailResult.id, log: logEntry });
        return;
      } catch (gmailErr: any) {
        console.error("Gmail OAuth sending failed:", gmailErr);
        // If OAuth fails, continue to SMTP fallback
      }
    }

    const host = smtpConfig?.host || process.env.SMTP_HOST || "smtp.gmail.com";
    const port = smtpConfig?.port || process.env.SMTP_PORT || "587";
    const user = smtpConfig?.user || process.env.SMTP_USER;
    const rawPass = smtpConfig?.pass || process.env.SMTP_PASS;
    // Strip all spaces from password (common when copying 16-character Google App Passwords like "abcd efgh ijkl mnop")
    const pass = rawPass ? String(rawPass).trim().replace(/\s+/g, "") : "";
    const isPort465 = String(port) === "465";
    const secure = smtpConfig ? (smtpConfig.secure ?? isPort465) : (process.env.SMTP_SECURE === "true" || isPort465);

    if (host && user && pass) {
      const transporter = nodemailer.createTransport({
        host,
        port: parseInt(String(port), 10),
        secure,
        auth: {
          user: String(user).trim(),
          pass,
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      const info = await transporter.sendMail({
        from: `"${senderName}" <${String(user).trim()}>`,
        to: String(to).trim(),
        subject,
        html: content,
      });

      logEntry.status = "Delivered";
      logEntry.messageId = info.messageId;
      emailLogs.push(logEntry);
      res.json({ success: true, status: "Delivered", messageId: info.messageId, log: logEntry });
      return;
    } else {
      logEntry.status = "Simulated (No SMTP Password Configured)";
      emailLogs.push(logEntry);
      res.json({ 
        success: true, 
        simulated: true, 
        status: "Simulated",
        message: "No SMTP password configured for " + (user || "sender") + ". Email simulated and logged to audit logs. Configure your Google App Password to deliver live to inboxes.",
        log: logEntry 
      });
      return;
    }
  } catch (error: any) {
    console.error("Nodemailer dispatch failed:", error);
    let suggestion = "";
    if (error.message && (error.message.includes("535") || error.message.includes("Invalid login"))) {
      suggestion = " For Gmail, you must use a 16-character App Password (create at myaccount.google.com/apppasswords), NOT your normal Google password.";
    }
    logEntry.status = "Failed";
    logEntry.error = (error?.message || String(error)) + suggestion;
    emailLogs.push(logEntry);
    res.status(500).json({ 
      success: false, 
      status: "Failed", 
      error: (error?.message || "Failed to dispatch email via SMTP server.") + suggestion,
      log: logEntry 
    });
  }
});

// REST API endpoint: send bulk payroll emails per employee
app.post("/api/send-bulk-payroll-emails", async (req, res) => {
  const { items, smtpConfig, googleAccessToken } = req.body;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7).trim() : null;
  const effectiveGoogleToken = bearerToken || googleAccessToken;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "No email items provided in request body." });
    return;
  }

  const senderName = smtpConfig?.senderName || process.env.SMTP_SENDER_NAME || "Oligarch Media Graphic Design Studio";
  const senderEmail = smtpConfig?.user || process.env.SMTP_USER || "hr.oligarchmedia@gmail.com";
  const fromHeader = `"${senderName.replace(/"/g, "")}" <${senderEmail}>`;

  // IF Gmail OAuth token is available, dispatch directly through official Gmail REST API!
  if (effectiveGoogleToken) {
    const results: Array<{
      employeeId: string;
      fullName: string;
      employeeNumber: string;
      email: string;
      status: "Delivered" | "Simulated" | "Failed";
      messageId?: string;
      error?: string;
    }> = [];

    let deliveredCount = 0;
    let failedCount = 0;

    for (const item of items) {
      const to = String(item.to || item.email || "").trim();
      const subject = item.subject || "[Official Payslip] Oligarch Media";
      const content = item.content || item.payslipHtml || "";
      const employeeId = item.employeeId || "";
      const fullName = item.fullName || "Employee";
      const employeeNumber = item.employeeNumber || "";

      if (!to) {
        results.push({
          employeeId,
          fullName,
          employeeNumber,
          email: "",
          status: "Failed",
          error: "Missing employee email address."
        });
        failedCount++;
        continue;
      }

      const logId = "mail-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5);
      const logEntry: any = {
        id: logId,
        to,
        subject,
        employeeId,
        employeeName: fullName,
        provider: "Gmail API (OAuth)",
        timestamp: new Date().toISOString()
      };

      try {
        const gmailRes = await sendViaGmailApi(effectiveGoogleToken, fromHeader, to, subject, content);
        logEntry.status = "Delivered";
        logEntry.messageId = gmailRes.id;
        emailLogs.push(logEntry);

        results.push({
          employeeId,
          fullName,
          employeeNumber,
          email: to,
          status: "Delivered",
          messageId: gmailRes.id
        });
        deliveredCount++;

        // Brief delay between Gmail API calls to comply with quota
        await new Promise(r => setTimeout(r, 120));
      } catch (err: any) {
        console.error(`Gmail API send failed for ${to}:`, err);
        logEntry.status = "Failed";
        logEntry.error = err?.message || String(err);
        emailLogs.push(logEntry);

        results.push({
          employeeId,
          fullName,
          employeeNumber,
          email: to,
          status: "Failed",
          error: err?.message || "Gmail API delivery failed"
        });
        failedCount++;
      }
    }

    res.json({
      success: deliveredCount > 0,
      provider: "gmail",
      total: items.length,
      delivered: deliveredCount,
      simulated: 0,
      failed: failedCount,
      results
    });
    return;
  }

  // Fallback: SMTP delivery
  const host = smtpConfig?.host || process.env.SMTP_HOST || "smtp.gmail.com";
  const port = smtpConfig?.port || process.env.SMTP_PORT || "587";
  const user = smtpConfig?.user || process.env.SMTP_USER;
  const rawPass = smtpConfig?.pass || process.env.SMTP_PASS;
  const pass = rawPass ? String(rawPass).trim().replace(/\s+/g, "") : "";
  const isPort465 = String(port) === "465";
  const secure = smtpConfig ? (smtpConfig.secure ?? isPort465) : (process.env.SMTP_SECURE === "true" || isPort465);

  const hasCredentials = Boolean(host && user && pass);

  let transporter: any = null;
  if (hasCredentials) {
    try {
      transporter = nodemailer.createTransport({
        host,
        port: parseInt(String(port), 10),
        secure,
        auth: {
          user: String(user).trim(),
          pass,
        },
        tls: {
          rejectUnauthorized: false
        }
      });
      await transporter.verify();
    } catch (verifyErr: any) {
      console.error("Transporter verify failed for bulk email:", verifyErr);
      let suggestion = "";
      if (verifyErr.message && (verifyErr.message.includes("535") || verifyErr.message.includes("Invalid login"))) {
        suggestion = " For Gmail, you must use a 16-character App Password (create at myaccount.google.com/apppasswords), NOT your normal Google password.";
      }
      res.status(401).json({
        success: false,
        error: `SMTP authentication failed: ${verifyErr.message || verifyErr}${suggestion}`
      });
      return;
    }
  }

  const results: Array<{
    employeeId: string;
    fullName: string;
    employeeNumber: string;
    email: string;
    status: "Delivered" | "Simulated" | "Failed";
    messageId?: string;
    error?: string;
  }> = [];

  let deliveredCount = 0;
  let simulatedCount = 0;
  let failedCount = 0;

  for (const item of items) {
    const to = String(item.to || item.email || "").trim();
    const subject = item.subject || "[Official Payslip] Oligarch Media";
    const content = item.content || item.payslipHtml || "";
    const employeeId = item.employeeId || "";
    const fullName = item.fullName || "Employee";
    const employeeNumber = item.employeeNumber || "";

    if (!to) {
      results.push({
        employeeId,
        fullName,
        employeeNumber,
        email: "",
        status: "Failed",
        error: "Missing employee email address."
      });
      failedCount++;
      continue;
    }

    const logId = "mail-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5);
    const logEntry: any = {
      id: logId,
      to,
      subject,
      employeeId,
      employeeName: fullName,
      timestamp: new Date().toISOString()
    };

    if (transporter && hasCredentials) {
      try {
        const info = await transporter.sendMail({
          from: `"${senderName}" <${String(user).trim()}>`,
          to,
          subject,
          html: content
        });

        logEntry.status = "Delivered";
        logEntry.messageId = info.messageId;
        emailLogs.push(logEntry);

        results.push({
          employeeId,
          fullName,
          employeeNumber,
          email: to,
          status: "Delivered",
          messageId: info.messageId
        });
        deliveredCount++;

        // Brief delay between emails to avoid spam filters
        await new Promise(r => setTimeout(r, 150));
      } catch (sendErr: any) {
        console.error(`Error sending email to ${to}:`, sendErr);
        logEntry.status = "Failed";
        logEntry.error = sendErr?.message || String(sendErr);
        emailLogs.push(logEntry);

        results.push({
          employeeId,
          fullName,
          employeeNumber,
          email: to,
          status: "Failed",
          error: sendErr?.message || "Delivery failed"
        });
        failedCount++;
      }
    } else {
      logEntry.status = "Simulated (No SMTP Configured)";
      emailLogs.push(logEntry);
      results.push({
        employeeId,
        fullName,
        employeeNumber,
        email: to,
        status: "Simulated",
        error: "SMTP password not set. Simulated in database."
      });
      simulatedCount++;
    }
  }

  res.json({
    success: true,
    total: items.length,
    delivered: deliveredCount,
    simulated: simulatedCount,
    failed: failedCount,
    hasCredentials,
    message: hasCredentials
      ? `Completed dispatch: ${deliveredCount} delivered, ${failedCount} failed.`
      : `Emails simulated: ${simulatedCount} records logged. Provide a Gmail App Password for live delivery.`,
    results
  });
});

// REST API endpoint: Test SMTP connectivity
app.post("/api/test-smtp", async (req, res) => {
  const { host, port, user, pass, senderName, testRecipient } = req.body;
  if (!host || !user || !pass) {
    res.status(400).json({ success: false, error: "Host, username, and password are required for SMTP testing." });
    return;
  }

  try {
    const isPort465 = String(port) === "465";
    const secure = isPort465 || req.body.secure === true;
    const cleanPass = String(pass).trim().replace(/\s+/g, "");
    const cleanUser = String(user).trim();
    const transporter = nodemailer.createTransport({
      host: String(host).trim(),
      port: parseInt(String(port || 587), 10),
      secure,
      auth: { user: cleanUser, pass: cleanPass },
      tls: { rejectUnauthorized: false }
    });

    await transporter.verify();

    const targetRecipient = (testRecipient ? String(testRecipient).trim() : "") || cleanUser;
    const info = await transporter.sendMail({
      from: `"${senderName || 'Oligarch Media Graphic Design Studio'}" <${cleanUser}>`,
      to: targetRecipient,
      subject: `[Verified] Oligarch Media Payroll SMTP Connection Test (${new Date().toLocaleTimeString()})`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; border: 1px solid #10B981; border-radius: 12px; background-color: #F0FDF4; max-width: 540px; margin: 0 auto;">
          <h2 style="color: #059669; margin: 0 0 12px 0; font-size: 18px;">✓ SMTP Email Delivery Verified!</h2>
          <p style="margin: 0 0 12px 0; color: #1F2937; font-size: 14px; line-height: 1.5;">Your email dispatch settings for <strong>${senderName || 'Oligarch Media Graphic Design Studio'}</strong> are working perfectly. Automated payslips can now be delivered directly to employee inboxes.</p>
          <div style="background-color: #FFFFFF; padding: 12px; border-radius: 8px; border: 1px solid #D1FAE5; margin-bottom: 12px;">
            <p style="font-size: 12px; color: #374151; margin: 4px 0;"><strong>Sender:</strong> ${cleanUser}</p>
            <p style="font-size: 12px; color: #374151; margin: 4px 0;"><strong>Host:</strong> ${host}:${port || 587}</p>
            <p style="font-size: 12px; color: #374151; margin: 4px 0;"><strong>Delivered to:</strong> ${targetRecipient}</p>
            <p style="font-size: 12px; color: #374151; margin: 4px 0;"><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
          </div>
          <p style="font-size: 11px; color: #047857; margin: 0;">Oligarch Media Executive HR & Payroll System</p>
        </div>
      `
    });

    res.json({ success: true, message: `SMTP connected successfully! Live test email delivered to ${targetRecipient}.`, messageId: info.messageId });
  } catch (err: any) {
    console.error("SMTP verification error:", err);
    let suggestion = "";
    if (err.message && (err.message.includes("535") || err.message.includes("Invalid login")) && host.includes("gmail")) {
      suggestion = " For Gmail, you must use a 16-character App Password (generate at myaccount.google.com/apppasswords), NOT your normal Google account password.";
    }
    res.status(500).json({ success: false, error: (err.message || "Failed to verify SMTP credentials.") + suggestion });
  }
});

// REST API endpoint: Retrieve email transaction logs
app.get("/api/email-logs", (req, res) => {
  res.json({ logs: emailLogs });
});

// Persistent Server Disk Store (High-Speed Built-In Database, 100% Free & Unlimited)
const PERSISTENT_DB_DIR = path.join(process.cwd(), "data");
const PERSISTENT_DB_FILE = path.join(PERSISTENT_DB_DIR, "persistent_db.json");
let memoryPersistentStore: Record<string, any[]> = {};

// Cloud Firestore Server-Side Sync Engine
let serverDb: any = null;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const existingApps = getApps();
    const serverApp = existingApps.find(a => a.name === "server-firestore-sync") || initializeApp(config, "server-firestore-sync");
    serverDb = getFirestore(serverApp, config.firestoreDatabaseId || "ai-studio-2a6bf0ee-3447-4fcc-b543-9a65f6e88879");
    console.log("[Server DB] Initialized Cloud Firestore server sync engine:", config.firestoreDatabaseId);
  }
} catch (e) {
  console.warn("[Server DB] Firestore sync engine initialization warning:", e);
}

let serverFirestoreQuotaExhausted = false;
let serverFirestoreQuotaResetTime = 0;

function isServerQuotaExhausted(): boolean {
  if (!serverFirestoreQuotaExhausted) return false;
  if (Date.now() > serverFirestoreQuotaResetTime) {
    serverFirestoreQuotaExhausted = false;
    return false;
  }
  return true;
}

function handleServerQuotaError(err: any): boolean {
  const errMsg = String(err?.message || err?.code || err || "").toLowerCase();
  if (
    errMsg.includes("resource-exhausted") || 
    errMsg.includes("resource_exhausted") || 
    errMsg.includes("quota exceeded") || 
    errMsg.includes("quota limit exceeded")
  ) {
    if (!serverFirestoreQuotaExhausted) {
      console.warn("[Server DB] Cloud Firestore daily free-tier quota reached. Operating uninterrupted via high-speed persistent store & peer mesh.");
    }
    serverFirestoreQuotaExhausted = true;
    serverFirestoreQuotaResetTime = Date.now() + 2 * 60 * 60 * 1000;
    return true;
  }
  return false;
}

async function syncServerItemToFirestore(colName: string, item: any) {
  if (!serverDb || !colName || !item || isServerQuotaExhausted()) return;
  const targetDate = colName === "devotion_schedules" ? (item.date || (/^\d{4}-\d{2}-\d{2}$/.test(item.id) ? item.id : "")) : "";
  const effectiveId = targetDate || item.id || item.date;
  if (!effectiveId) return;
  try {
    const dRef = fsDoc(serverDb, colName, effectiveId);
    await fsSetDoc(dRef, item, { merge: true });
  } catch (err: any) {
    if (!handleServerQuotaError(err)) {
      console.warn(`[Server DB] Failed to sync ${colName}/${effectiveId} to Firestore:`, err?.message || err);
    }
  }
}

async function deleteServerItemFromFirestore(colName: string, id: string) {
  if (!serverDb || !colName || !id || isServerQuotaExhausted()) return;
  try {
    const dRef = fsDoc(serverDb, colName, id);
    await fsDeleteDoc(dRef);
  } catch (err: any) {
    if (!handleServerQuotaError(err)) {
      console.warn(`[Server DB] Failed to delete ${colName}/${id} from Firestore:`, err?.message || err);
    }
  }
}

// Background sync from Cloud Firestore to keep data/persistent_db.json completely synchronized
const SYNC_COLLECTIONS = [
  "settings", "employees", "payroll_periods", "attendance", "cash_advances", 
  "boss_debts", "leave_requests", "devotion_schedules", "devotion_settings", 
  "payroll", "no_work_days", "notifications", "audit_logs", "deleted_records",
  "announcements", "attendance_copy_requests"
];

async function pullAllFromFirestore() {
  if (!serverDb || isServerQuotaExhausted()) return;
  readPersistentDiskStore();
  let hasChanges = false;
  for (const col of SYNC_COLLECTIONS) {
    try {
      const snap = await fsGetDocs(fsCollection(serverDb, col));
      if (!snap || snap.empty) continue;
      const remoteItems = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      const localItems = memoryPersistentStore[col] || [];
      
      const map = new Map<string, any>();
      localItems.forEach((it: any) => {
        const k = (col === "devotion_schedules" && it.date) ? it.date : (it.id || it.date);
        if (k) map.set(k, it);
      });
      let colChanged = false;
      remoteItems.forEach((it: any) => {
        const k = (col === "devotion_schedules" && it.date) ? it.date : (it.id || it.date);
        if (k) {
          const curr = map.get(k);
          if (!curr) {
            map.set(k, it);
            colChanged = true;
          } else {
            const currTime = curr.updatedAt || curr.timestamp || 0;
            const itTime = it.updatedAt || it.timestamp || 0;
            if (itTime >= currTime) {
              map.set(k, { ...curr, ...it });
              colChanged = true;
            }
          }
        }
      });
      if (colChanged || remoteItems.length > localItems.length) {
        memoryPersistentStore[col] = Array.from(map.values());
        hasChanges = true;
      }
    } catch (err: any) {
      if (handleServerQuotaError(err)) {
        break;
      }
    }
  }
  if (hasChanges) {
    try {
      if (!fs.existsSync(PERSISTENT_DB_DIR)) fs.mkdirSync(PERSISTENT_DB_DIR, { recursive: true });
      fs.writeFileSync(PERSISTENT_DB_FILE, JSON.stringify(memoryPersistentStore, null, 2), "utf-8");
    } catch {}
  }
}

// Published container peer URL for real-time mesh sync between editing and published apps
const PUBLISHED_APP_URL = process.env.PUBLISHED_APP_URL || "https://oligarchmediamanagement.ai.studio";

async function syncWithPublishedApp() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${PUBLISHED_APP_URL}/api/persistent-store`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return;
    const json = await res.json() as any;
    const pubStore = json?.store || {};
    if (!pubStore || typeof pubStore !== "object") return;

    readPersistentDiskStore();
    let hasChanges = false;

    // 1. Build deleted tombstones map from local and incoming published store
    const localDeleted = memoryPersistentStore["deleted_records"] || [];
    const pubDeleted = Array.isArray(pubStore.deleted_records) ? pubStore.deleted_records : [];
    const deletedMap = new Map<string, any>();
    localDeleted.forEach((d: any) => {
      if (d && d.originalCollection && d.originalId && d.originalId !== "Y5fCWLfZk5lfg2Ocp1f9") {
        deletedMap.set(`${d.originalCollection}:${d.originalId}`, d);
      }
    });
    pubDeleted.forEach((d: any) => {
      if (d && d.originalCollection && d.originalId && d.originalId !== "Y5fCWLfZk5lfg2Ocp1f9") {
        const key = `${d.originalCollection}:${d.originalId}`;
        if (!deletedMap.has(key)) {
          deletedMap.set(key, d);
          hasChanges = true;
        }
      }
    });
    memoryPersistentStore["deleted_records"] = Array.from(deletedMap.values());

    for (const col of SYNC_COLLECTIONS) {
      if (col === "deleted_records") continue;
      const pubItems = pubStore[col];
      const localItems = memoryPersistentStore[col] || [];

      const map = new Map<string, any>();
      let colChanged = false;

      // Filter local items against tombstones
      localItems.forEach((it: any) => {
        const k = (col === "devotion_schedules" && it.date) ? it.date : (it.id || it.date);
        if (k && !deletedMap.has(`${col}:${k}`)) {
          map.set(k, it);
        } else if (k && deletedMap.has(`${col}:${k}`)) {
          colChanged = true;
        }
      });

      // Merge published items: if tombstoned, drop and instruct published to delete
      if (Array.isArray(pubItems)) {
        pubItems.forEach((it: any) => {
          const k = (col === "devotion_schedules" && it.date) ? it.date : (it.id || it.date);
          if (!k) return;
          if (deletedMap.has(`${col}:${k}`)) {
            if (map.has(k)) {
              map.delete(k);
              colChanged = true;
            }
            fetch(`${PUBLISHED_APP_URL}/api/persistent-store/delete-item`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ collection: col, id: k }),
              signal: AbortSignal.timeout(3000)
            }).catch(() => {});
            return;
          }
          const curr = map.get(k);
          if (!curr) {
            map.set(k, it);
            colChanged = true;
            syncServerItemToFirestore(col, it);
          } else {
            const currTime = curr.updatedAt || curr.timestamp || 0;
            const pubTime = it.updatedAt || it.timestamp || 0;
            if (pubTime > currTime) {
              map.set(k, { ...curr, ...it });
              colChanged = true;
              syncServerItemToFirestore(col, { ...curr, ...it });
            }
          }
        });
      }

      if (colChanged) {
        memoryPersistentStore[col] = Array.from(map.values());
        hasChanges = true;
        broadcastDbChange(col, "BULK");
      }
    }

    if (hasChanges) {
      try {
        if (!fs.existsSync(PERSISTENT_DB_DIR)) fs.mkdirSync(PERSISTENT_DB_DIR, { recursive: true });
        fs.writeFileSync(PERSISTENT_DB_FILE, JSON.stringify(memoryPersistentStore, null, 2), "utf-8");
        console.log("[Server DB] Synced newer records with anti-resurrection tombstones");
      } catch {}
    }
  } catch {
    // published site unreachable or timeout, ignore silently
  }
}

// Perform one-time initial pull only on server startup to seed local memory store,
// with zero automated periodic write-loops to strictly preserve Firestore free tier quota.
setTimeout(pullAllFromFirestore, 1500);
setTimeout(syncWithPublishedApp, 3000);

// Server-Sent Events (SSE) active subscriber pool for real-time cross-device updates
const sseSubscribers: Set<express.Response> = new Set();

function broadcastDbChange(collectionName: string, eventType: "UPSERT" | "DELETE" | "BULK", id?: string) {
  const payload = JSON.stringify({
    collection: collectionName,
    eventType,
    id,
    timestamp: Date.now()
  });
  for (const client of sseSubscribers) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      sseSubscribers.delete(client);
    }
  }
}

function readPersistentDiskStore(): Record<string, any[]> {
  try {
    if (fs.existsSync(PERSISTENT_DB_FILE)) {
      const raw = fs.readFileSync(PERSISTENT_DB_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        memoryPersistentStore = { ...memoryPersistentStore, ...parsed };
      }
    }
  } catch (err) {
    // Fallback to memoryPersistentStore
  }
  return memoryPersistentStore;
}

function writePersistentDiskStore(collectionName: string, data: any[]) {
  memoryPersistentStore[collectionName] = data;
  try {
    if (!fs.existsSync(PERSISTENT_DB_DIR)) {
      fs.mkdirSync(PERSISTENT_DB_DIR, { recursive: true });
    }
    fs.writeFileSync(PERSISTENT_DB_FILE, JSON.stringify(memoryPersistentStore, null, 2), "utf-8");
  } catch (err) {
    // Retained in memory store
  }
}

// Real-Time SSE Stream: Notifies all browser tabs and mobile devices when data changes
app.get("/api/db-events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Initial handshake
  res.write(`data: ${JSON.stringify({ type: "CONNECTED", timestamp: Date.now() })}\n\n`);
  sseSubscribers.add(res);

  req.on("close", () => {
    sseSubscribers.delete(res);
  });
});

// Secure Server-Side Employee PIN Verification
app.post("/api/auth/verify-pin", (req, res) => {
  const { employeeNumber, pin } = req.body || {};
  if (!employeeNumber || !pin) {
    res.status(400).json({ success: false, error: "Missing employeeNumber or PIN" });
    return;
  }
  const cleanNum = String(employeeNumber).trim().toUpperCase().replace(/^EMP-/, "");
  const cleanPin = String(pin).trim();

  readPersistentDiskStore();
  const employees = memoryPersistentStore["employees"] || [];
  const emp = employees.find((e: any) => {
    const eNum = String(e.employeeNumber || "").trim().toUpperCase().replace(/^EMP-/, "");
    return eNum === cleanNum;
  });

  if (!emp) {
    res.status(404).json({ success: false, error: "Employee profile not found" });
    return;
  }

  const status = emp.status || "Active";
  if (status !== "Active") {
    res.status(403).json({ success: false, error: `Account is ${status.toUpperCase()}. Access restricted.` });
    return;
  }

  const expectedPin = String(emp.pin || "1234").trim();
  if (cleanPin !== expectedPin) {
    res.status(401).json({ success: false, error: "Incorrect PIN" });
    return;
  }

  const sanitized = { ...emp };
  delete sanitized.pin;
  res.json({ success: true, employee: sanitized });
});

app.get("/api/persistent-store", (req, res) => {
  const store = readPersistentDiskStore();
  const col = req.query.collection as string | undefined;
  if (col) {
    const list = store[col] || [];
    res.json({ success: true, collection: col, data: list, items: list });
    return;
  }
  res.json({ success: true, store });
});

app.post("/api/persistent-store", (req, res) => {
  const { collection, data } = req.body || {};
  if (!collection || !Array.isArray(data)) {
    res.status(400).json({ error: "Missing collection or data array" });
    return;
  }
  readPersistentDiskStore();
  writePersistentDiskStore(collection, data);
  broadcastDbChange(collection, "BULK");
  // Sync to Cloud Firestore in background
  if (serverDb) {
    Promise.all(data.map(item => syncServerItemToFirestore(collection, item))).catch(() => {});
  }
  res.json({ success: true, collection, count: data.length });
});

app.post("/api/persistent-store/upsert-item", (req, res) => {
  const { collection, item } = req.body || {};
  if (!collection || !item || (!item.id && !item.date)) {
    res.status(400).json({ error: "Missing collection or item with valid id/date" });
    return;
  }
  readPersistentDiskStore();
  const list = memoryPersistentStore[collection] || [];
  const effectiveId = item.id || item.date;

  const now = Date.now();
  const itemTime = item.updatedAt ? Math.max(Number(item.updatedAt) || 0, now) : now;

  const idx = list.findIndex((x: any) =>
    (x.id && x.id === effectiveId) ||
    (collection === "devotion_schedules" && x.date && x.date === item.date)
  );

  let updatedItem = { ...item, updatedAt: itemTime };
  if (idx !== -1) {
    updatedItem = { ...list[idx], ...item, updatedAt: itemTime };
    list[idx] = updatedItem;
  } else {
    list.push(updatedItem);
  }

  // Remove any obsolete tombstone from deleted_records if being saved/updated
  if (memoryPersistentStore["deleted_records"]) {
    memoryPersistentStore["deleted_records"] = memoryPersistentStore["deleted_records"].filter(
      (d: any) => !(d.originalCollection === collection && (d.originalId === effectiveId || d.originalId === item.id))
    );
  }

  writePersistentDiskStore(collection, list);
  broadcastDbChange(collection, "UPSERT", effectiveId);
  // Persist to Cloud Firestore if syncToFirestore is not explicitly disabled
  if (req.body?.syncToFirestore !== false && !isServerQuotaExhausted()) {
    syncServerItemToFirestore(collection, updatedItem);
  }

  // Background peer push to published container
  if (PUBLISHED_APP_URL && !process.env.IS_PUBLISHED) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 4000);
      fetch(`${PUBLISHED_APP_URL}/api/persistent-store/upsert-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection, item: updatedItem }),
        signal: c.signal
      }).catch(() => {}).finally(() => clearTimeout(t));
    } catch {}
  }

  res.json({ success: true, collection, id: effectiveId, item: updatedItem });
});

app.post("/api/persistent-store/delete-item", (req, res) => {
  const { collection, id } = req.body || {};
  if (!collection || !id) {
    res.status(400).json({ error: "Missing collection or id" });
    return;
  }
  readPersistentDiskStore();
  let list = memoryPersistentStore[collection] || [];
  list = list.filter((x: any) => x.id !== id && !(collection === "devotion_schedules" && x.date === id));
  writePersistentDiskStore(collection, list);

  // Record tombstone in deleted_records
  const deletedList = memoryPersistentStore["deleted_records"] || [];
  if (!deletedList.some((d: any) => d.originalCollection === collection && d.originalId === id)) {
    deletedList.push({
      id: `trash_${collection}_${id}_${Date.now()}`,
      originalCollection: collection,
      originalId: id,
      deletedAt: new Date().toISOString(),
      deletedBy: "Admin"
    });
    memoryPersistentStore["deleted_records"] = deletedList;
    writePersistentDiskStore("deleted_records", deletedList);
  }

  broadcastDbChange(collection, "DELETE", id);
  // Delete from Cloud Firestore if syncToFirestore is not explicitly disabled
  if (req.body?.syncToFirestore !== false && !isServerQuotaExhausted()) {
    deleteServerItemFromFirestore(collection, id);
  }

  // Background peer delete to published container
  if (PUBLISHED_APP_URL && !process.env.IS_PUBLISHED) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 4000);
      fetch(`${PUBLISHED_APP_URL}/api/persistent-store/delete-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection, id }),
        signal: c.signal
      }).catch(() => {}).finally(() => clearTimeout(t));
    } catch {}
  }

  res.json({ success: true, collection, id });
});

app.all("/api/sync-realtime", async (req, res) => {
  await Promise.allSettled([pullAllFromFirestore(), syncWithPublishedApp()]);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    attendanceCount: (memoryPersistentStore["attendance"] || []).length,
    devotionCount: (memoryPersistentStore["devotion_schedules"] || []).length,
    payrollCount: (memoryPersistentStore["payroll"] || []).length
  });
});

app.post("/api/persistent-store/bulk", (req, res) => {
  const { collections } = req.body || {};
  if (!collections || typeof collections !== "object") {
    res.status(400).json({ error: "Missing collections object" });
    return;
  }
  readPersistentDiskStore();
  for (const [colName, list] of Object.entries(collections)) {
    if (Array.isArray(list)) {
      writePersistentDiskStore(colName, list);
      broadcastDbChange(colName, "BULK");
      if (serverDb && !isServerQuotaExhausted()) {
        Promise.all(list.map(item => syncServerItemToFirestore(colName, item))).catch(() => {});
      }
    }
  }
  res.json({ success: true, savedCollections: Object.keys(collections).length });
});

// High-speed atomic database restore endpoint (Clean Replace & Merge)
app.post("/api/persistent-store/restore", (req, res) => {
  const { collections, settings, isClean } = req.body || {};
  if (!collections || typeof collections !== "object") {
    res.status(400).json({ error: "Missing collections object" });
    return;
  }
  readPersistentDiskStore();

  if (isClean) {
    // Purge memory store and tombstones for clean overwrite
    for (const key of Object.keys(memoryPersistentStore)) {
      memoryPersistentStore[key] = [];
    }
    memoryPersistentStore["deleted_records"] = [];
  }

  // Populate collections
  for (const [colName, list] of Object.entries(collections)) {
    if (Array.isArray(list)) {
      writePersistentDiskStore(colName, list);
      broadcastDbChange(colName, "BULK");
    }
  }

  // Restore settings if provided
  if (settings && typeof settings === "object") {
    writePersistentDiskStore("settings", [{ id: "general", ...settings }]);
    broadcastDbChange("settings", "BULK");
  }

  // Background sync priority operational collections to Cloud Firestore (non-blocking)
  if (serverDb && !isServerQuotaExhausted()) {
    const PRIORITY_SYNC_COLS = [
      "settings", "employees", "attendance", "payroll_periods", 
      "payroll", "leave_requests", "cash_advances", "boss_debts", 
      "no_work_days", "devotion_schedules", "devotion_settings"
    ];
    (async () => {
      try {
        for (const col of PRIORITY_SYNC_COLS) {
          const items = collections[col];
          if (Array.isArray(items)) {
            for (let i = 0; i < items.length; i += 25) {
              const batch = items.slice(i, i + 25);
              await Promise.allSettled(batch.map(item => syncServerItemToFirestore(col, item)));
              if (isServerQuotaExhausted()) break;
            }
          }
          if (isServerQuotaExhausted()) break;
        }
      } catch (syncErr) {
        console.warn("[Server DB] Background Firestore restore sync notice:", syncErr);
      }
    })();
  }

  const totalCount = Object.values(collections).reduce((sum: number, c: any) => sum + (Array.isArray(c) ? c.length : 0), 0);
  console.log(`[Server DB] Successfully restored ${totalCount} records (isClean=${isClean})`);
  res.json({ success: true, restoredCount: totalCount, isClean });
});

// REST API endpoints: Cloud SQL User Management
app.get("/api/users", requireAuth, async (req: AuthRequest, res) => {
  try {
    const users = await getUsers();
    res.json(users);
  } catch (error: any) {
    console.error("Failed to fetch users from Cloud SQL:", error);
    res.status(500).json({ error: error.message || "Failed to fetch users" });
  }
});

app.post("/api/users/sync", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.uid) {
      res.status(401).json({ error: "Missing authenticated user credentials" });
      return;
    }
    const email = req.user.email || req.body.email || "no-email@company.internal";
    const user = await getOrCreateUser(req.user.uid, email);
    res.json({ success: true, user });
  } catch (error: any) {
    console.error("Failed to sync user to Cloud SQL:", error);
    res.status(500).json({ error: error.message || "Failed to sync user" });
  }
});

// REST API endpoint: Backup database payload (mock data / triggers)
app.post("/api/backup-data", (req, res) => {
  // We can receive a full dump of the state and send it as file download
  const { payload } = req.body;
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    size: JSON.stringify(payload || {}).length,
    downloadUrl: `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload || {}))}`
  });
});

// REST API endpoint: AI Attendance Screenshot Scanner (Gemini Vision)
app.post("/api/ai-scan-attendance", async (req, res) => {
  try {
    const { imageBase64, mimeType = "image/jpeg", targetYear, knownEmployees = [] } = req.body;
    if (!imageBase64) {
      res.status(400).json({ error: "Missing imageBase64 payload" });
      return;
    }

    let effectiveMime = mimeType || "image/jpeg";
    let cleanBase64 = imageBase64;

    if (imageBase64.startsWith("data:")) {
      const matchMime = imageBase64.match(/^data:([^;]+);base64,/);
      if (matchMime && matchMime[1]) {
        effectiveMime = matchMime[1];
      }
      cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    } else if (imageBase64.startsWith("/") || imageBase64.includes("assets/")) {
      const cleanRel = imageBase64.startsWith("/") ? imageBase64.slice(1) : imageBase64;
      const possiblePaths = [
        path.join(process.cwd(), "public", cleanRel),
        path.join(process.cwd(), cleanRel),
        path.join(process.cwd(), "public", "assets", "aistudio", path.basename(imageBase64))
      ];
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          const buf = fs.readFileSync(p);
          cleanBase64 = buf.toString("base64");
          if (p.endsWith(".png")) effectiveMime = "image/png";
          else if (p.endsWith(".jpg") || p.endsWith(".jpeg")) effectiveMime = "image/jpeg";
          else if (p.endsWith(".webp")) effectiveMime = "image/webp";
          break;
        }
      }
    }

    const knownListText = Array.isArray(knownEmployees) && knownEmployees.length > 0
      ? `Known Company Employees in System:\n${knownEmployees.map((e: any) => typeof e === 'string' ? e : `${e.fullName || e.name || ''} (#${e.employeeNumber || ''})`).join('\n')}`
      : "";

    const prompt = `You are a professional HR timesheet data extractor.
Analyze this attendance spreadsheet screenshot image very carefully.
Extract every employee and their attendance status for each day/date column shown in the sheet.

${knownListText}

Rules:
1. Column Headers / Dates:
   - Identify all dates in the column headers (e.g., "May 18, 2026", "May 19", "05/18/2025", etc.).
   - Standardize all dates to strict "YYYY-MM-DD" format.
   - If the year is not mentioned on the header, use target year ${targetYear || 2025}.
   - If the header explicitly has a year (e.g. 2026 or 2025), respect it unless the user requested year is explicitly forced.
2. Row Headers / Employee Names & Nickname Resolution:
   - Note that in spreadsheet screenshots, employees often use informal nicknames, first names only, or inverted names:
     * "JR MALLARI" or "HERMINIO MALLARI" -> "MALLARI, HERMINIO JR L"
     * "ROLAND JHON" or "ROLAND JOHN" -> "CUBOL, ROLAND JHON G"
     * "ISRAEL" or "ISRAEL LAXA" -> "LAXA, ISRAEL P"
     * "JAO" or "JAO PANGAN" -> "PANGAN, JOEMARIE G."
     * "OSBORN" or "OSBORN LLANES" -> "LLANES, OSBORN B."
     * "LANZ" or "LANZ ROIE" -> "CULALA, LANZ ROIE S."
     * "JOHN CEDRIC" or "CEDRIC" -> "ROQUE, JOHN CEDRIC M."
   - Extract the exact name text from the screenshot into "employeeName".
   - If it clearly corresponds to one of the known employees above, also return "matchedCanonicalName": "<Full System Name>".
3. Status Mapping:
   - "PRESENT" -> "Present"
   - "BIRTHD..." or "BIRTHDAY" -> "Birthday Leave"
   - "PAID LE..." or "PAID LEAVE" -> "Paid Leave"
   - "ABSENT" -> "Absent"
   - "OFF" or "REST" -> "Rest Day"
   - "LATE" -> "Late"
   - Empty or unlogged -> "Absent" or "Not Logged"
4. Multi-Week Layouts:
   - Often the image contains multiple weekly blocks stacked vertically (e.g. "WEEK3" and "WEEK4").
   - Extract every single week and date block present in the image.
   - Merge all dates for each unique employee in the aggregated list.

Return ONLY a valid JSON object matching this exact structure:
{
  "detectedYear": ${targetYear || 2025},
  "datesFound": ["YYYY-MM-DD", ...],
  "weeks": [
    {
      "weekLabel": "WEEK3",
      "dates": ["YYYY-MM-DD", ...],
      "employees": [
        {
          "employeeName": "NAME IN SHEET",
          "matchedCanonicalName": "OPTIONAL FULL CANONICAL NAME IF RECOGNIZED",
          "statuses": {
            "YYYY-MM-DD": "Present"
          },
          "weeklyTotalHours": 40
        }
      ]
    }
  ],
  "aggregatedEmployees": [
    {
      "employeeName": "NAME IN SHEET",
      "matchedCanonicalName": "OPTIONAL FULL CANONICAL NAME IF RECOGNIZED",
      "records": [
        {
          "date": "YYYY-MM-DD",
          "status": "Present",
          "hoursWorked": 8.0
        }
      ],
      "totalWorkingHours": 40
    }
  ]
}`;

    let responseText = "";
    const modelsToTry = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
    let lastError: any = null;

    for (const model of modelsToTry) {
      try {
        const response = await getGenAI().models.generateContent({
          model,
          contents: {
            parts: [
              { inlineData: { mimeType: effectiveMime, data: cleanBase64 } },
              { text: prompt }
            ]
          },
          config: {
            responseMimeType: "application/json"
          }
        });
        responseText = response.text || "";
        if (responseText) break;
      } catch (err: any) {
        lastError = err;
        console.warn(`[AI Scan] Model ${model} retry note:`, err.message);
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    if (!responseText) {
      throw lastError || new Error("No response generated from Gemini Vision");
    }

    const cleaned = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsedData = JSON.parse(cleaned);

    res.json({ success: true, data: parsedData });
  } catch (error: any) {
    console.error("AI attendance scan error:", error);
    res.status(500).json({ error: error.message || "Failed to process attendance image" });
  }
});

// REST API endpoint: Parse pasted spreadsheet text / CSV / TSV directly
app.post("/api/ai-parse-spreadsheet-text", async (req, res) => {
  try {
    const { rawText, targetYear = 2025, knownEmployees = [] } = req.body;
    if (!rawText || !rawText.trim()) {
      res.status(400).json({ error: "Missing rawText" });
      return;
    }

    const knownListText = Array.isArray(knownEmployees) && knownEmployees.length > 0
      ? `Known Company Employees in System:\n${knownEmployees.map((e: any) => typeof e === 'string' ? e : `${e.fullName || e.name || ''} (#${e.employeeNumber || ''})`).join('\n')}`
      : "";

    const prompt = `Parse this copied spreadsheet attendance table text into structured attendance JSON.
Target year: ${targetYear}.

${knownListText}

Nickname Resolution Guidelines:
- "JR MALLARI" or "HERMINIO MALLARI" -> "MALLARI, HERMINIO JR L"
- "ROLAND JHON" or "ROLAND JOHN" -> "CUBOL, ROLAND JHON G"
- "ISRAEL" or "ISRAEL LAXA" -> "LAXA, ISRAEL P"
- "JAO" or "JAO PANGAN" -> "PANGAN, JOEMARIE G."
- "OSBORN" -> "LLANES, OSBORN B."
- "LANZ" -> "CULALA, LANZ ROIE S."
- "JOHN CEDRIC" or "CEDRIC" -> "ROQUE, JOHN CEDRIC M."

Ensure dates are in "YYYY-MM-DD" format and statuses are standardized to "Present", "Absent", "Paid Leave", "Birthday Leave", "Rest Day".
Return JSON with:
{
  "detectedYear": ${targetYear},
  "datesFound": ["YYYY-MM-DD"],
  "aggregatedEmployees": [
    {
      "employeeName": "NAME IN SHEET",
      "matchedCanonicalName": "OPTIONAL FULL CANONICAL NAME IF RECOGNIZED",
      "records": [
        { "date": "YYYY-MM-DD", "status": "Present", "hoursWorked": 8.0 }
      ],
      "totalWorkingHours": 40
    }
  ]
}

Data text:
${rawText}`;

    let responseText = "";
    const modelsToTry = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
    let lastError: any = null;

    for (const model of modelsToTry) {
      try {
        const response = await getGenAI().models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json"
          }
        });
        responseText = response.text || "";
        if (responseText) break;
      } catch (err: any) {
        lastError = err;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!responseText) {
      throw lastError || new Error("Failed to parse text with Gemini");
    }

    const cleaned = (responseText || "").replace(/```json/g, "").replace(/```/g, "").trim();
    const parsedData = JSON.parse(cleaned);

    res.json({ success: true, data: parsedData });
  } catch (error: any) {
    console.error("AI text parse error:", error);
    res.status(500).json({ error: error.message || "Failed to parse spreadsheet text" });
  }
});

// HEALTH CHECK SERVICE
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", time: new Date().toISOString() });
});

// Vite middleware integration (Vite asset serving and SPA fallback routing)
async function setupVite() {
  const distPath = path.join(process.cwd(), "dist");
  const isProduction = process.env.NODE_ENV === "production";

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    // Support SPA router fallback
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

export default app;

if (!process.env.VERCEL) {
  setupVite().then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`[FULL-STACK] Express server live at http://0.0.0.0:${PORT}`);
    });
  });
}
