import React, { useState, useEffect } from "react";
import { 
  signInWithGoogleGmail, 
  disconnectGoogleGmail, 
  subscribeToGoogleAuth, 
  getAccessToken,
  sendEmailViaGmailApi
} from "../services/googleAuth";
import { CheckCircle2, LogOut, RefreshCw, Send, AlertCircle, Sparkles, ExternalLink } from "lucide-react";

interface GoogleConnectButtonProps {
  compact?: boolean;
  onConnected?: (user: any, token: string) => void;
  onDisconnected?: () => void;
}

export default function GoogleConnectButton({
  compact = false,
  onConnected,
  onDisconnected
}: GoogleConnectButtonProps) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ 
    success: boolean; 
    message: string; 
    isUnauthorizedDomain?: boolean;
    domain?: string;
  } | null>(null);

  useEffect(() => {
    const unsub = subscribeToGoogleAuth((cachedToken, cachedUser) => {
      setToken(cachedToken);
      setUser(cachedUser);
    });
    return () => unsub();
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    setTestResult(null);
    try {
      const res = await signInWithGoogleGmail();
      if (res.cancelled || !res.accessToken || !res.user) {
        // User closed or cancelled popup window; cleanly abort without error banners
        return;
      }
      setToken(res.accessToken);
      setUser(res.user);
      if (onConnected) onConnected(res.user, res.accessToken);
    } catch (err: any) {
      if (
        err?.code !== "auth/popup-closed-by-user" &&
        err?.code !== "auth/cancelled-popup-request" &&
        !err?.message?.includes("popup-closed-by-user")
      ) {
        console.error("Google Auth error:", err);
        const isUnauthorizedDomain = 
          err?.code === "auth/unauthorized-domain" || 
          String(err?.message || "").includes("unauthorized-domain");

        if (isUnauthorizedDomain) {
          const currentDomain = typeof window !== "undefined" ? window.location.hostname : "your-domain";
          setTestResult({
            success: false,
            isUnauthorizedDomain: true,
            domain: currentDomain,
            message: `Firebase: Error (auth/unauthorized-domain). Domain "${currentDomain}" needs to be authorized.`
          });
        } else {
          setTestResult({
            success: false,
            message: err?.message || "Failed to connect Google account."
          });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await disconnectGoogleGmail();
      setToken(null);
      setUser(null);
      setTestResult(null);
      if (onDisconnected) onDisconnected();
    } catch (err) {
      console.error("Disconnect error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendTestEmail = async () => {
    const recipient = user?.email || "hr.oligarchmedia@gmail.com";
    setTesting(true);
    setTestResult(null);
    try {
      const subject = `[Test Verification] Gmail API Live Delivery - Oligarch Media`;
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e4e4e7; border-radius: 16px; background-color: #ffffff;">
          <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #f4f4f5;">
            <h2 style="margin: 0; color: #18181b; font-size: 20px;">Oligarch Media Graphic Design Studio</h2>
            <p style="margin: 4px 0 0; color: #71717a; font-size: 13px;">Gmail API 1-Click Verification Test</p>
          </div>
          <div style="padding: 24px 0;">
            <p style="font-size: 14px; color: #27272a; line-height: 1.6;">
              Hello Administrator,<br><br>
              This is a live test email sent directly through your authenticated Google account 
              (<strong>${recipient}</strong>) via the official Gmail REST API.
            </p>
            <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 16px; margin: 16px 0;">
              <p style="margin: 0; color: #065f46; font-size: 13px; font-weight: bold;">
                ✓ Direct Gmail Delivery Active
              </p>
              <p style="margin: 4px 0 0; color: #047857; font-size: 12px;">
                You are ready to auto-send official payslips directly to all employees without entering 16-character App Passwords.
              </p>
            </div>
            <p style="font-size: 11px; color: #a1a1aa; font-family: monospace;">
              Timestamp: ${new Date().toISOString()} • Service: Google Workspace Gmail API
            </p>
          </div>
        </div>
      `;

      const res = await sendEmailViaGmailApi({
        to: recipient,
        subject,
        html,
        fromEmail: recipient,
        fromName: "Oligarch Media Graphic Design Studio"
      });

      if (res.success) {
        setTestResult({
          success: true,
          message: `✓ Test email delivered live to ${recipient} (Message ID: ${res.messageId || "sent"})`
        });
      } else {
        setTestResult({
          success: false,
          message: `Test email failed: ${res.error || "Unknown error"}`
        });
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        message: e?.message || "Failed to dispatch test email."
      });
    } finally {
      setTesting(false);
    }
  };

  const isConnected = Boolean(token && user);
  const userEmail = user?.email || "hr.oligarchmedia@gmail.com";

  if (compact) {
    if (isConnected) {
      return (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Gmail: {userEmail}</span>
          </span>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={loading}
            className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 underline cursor-pointer"
          >
            Disconnect
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        disabled={loading}
        onClick={handleConnect}
        className="px-3 py-1.5 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        <span>{loading ? "Connecting..." : "Sign in with Google"}</span>
      </button>
    );
  }

  // Full banner / card view
  return (
    <div className={`p-4 rounded-2xl border transition-all ${
      isConnected 
        ? "bg-gradient-to-r from-emerald-50/80 to-teal-50/80 dark:from-emerald-950/20 dark:to-teal-950/20 border-emerald-300 dark:border-emerald-800"
        : "bg-gradient-to-r from-blue-50/70 to-indigo-50/70 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 dark:border-blue-800"
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xs shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-extrabold text-xs uppercase tracking-wider font-mono text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <span>1-Click Google Account Connection</span>
                <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold bg-blue-100/70 dark:bg-blue-900/40 px-2 py-0.5 rounded-full">
                  Recommended
                </span>
              </h4>
              {isConnected && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  Connected ({userEmail})
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 leading-normal">
              {isConnected ? (
                <>
                  Official Gmail sending is <strong>authorized and active</strong>. Payslips will be delivered live to employee inboxes directly from <strong>{userEmail}</strong> without requiring Google App Passwords!
                </>
              ) : (
                <>
                  Connect your Google Account (<strong>hr.oligarchmedia@gmail.com</strong>) with a single click. Sends official payslips directly via Gmail — <strong>no App Passwords or manual SMTP setup needed</strong>!
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={handleSendTestEmail}
                disabled={testing}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{testing ? "Sending..." : "Send Test to Me"}</span>
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={loading}
                className="px-3 py-1.5 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
              >
                <LogOut className="w-3 h-3 text-zinc-400" />
                <span>Disconnect</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={handleConnect}
              className="px-4 py-2 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-750 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2.5 cursor-pointer hover:border-blue-400"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                  <span>Connecting Google Account...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                  <span>Connect Google Account</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {testResult && (
        <div className={`mt-3 p-3 rounded-xl text-xs flex flex-col gap-2 border animate-in fade-in ${
          testResult.success
            ? "bg-emerald-100/90 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700 font-mono"
            : "bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200 border-rose-300 dark:border-rose-800"
        }`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 font-mono font-bold">
              {testResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
            <button 
              type="button" 
              onClick={() => setTestResult(null)} 
              className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-0.5 rounded cursor-pointer"
            >
              ✕
            </button>
          </div>

          {testResult.isUnauthorizedDomain && (
            <div className="mt-1 pt-2 border-t border-rose-200 dark:border-rose-900/60 text-[11px] space-y-2 font-sans">
              <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                Google security requires your current domain (<code className="px-1.5 py-0.5 bg-rose-200/50 dark:bg-rose-900/50 rounded font-mono font-bold text-rose-950 dark:text-rose-100">{testResult.domain}</code>) to be whitelisted in Firebase before popup sign-in is allowed.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="https://console.firebase.google.com/project/spherical-program-f3n78/authentication/settings"
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-xs transition-colors inline-flex items-center gap-1.5 text-[11px]"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open Firebase Authorized Domains</span>
                </a>
                <button
                  type="button"
                  onClick={() => {
                    if (testResult.domain) {
                      navigator.clipboard?.writeText(testResult.domain);
                      alert(`Copied "${testResult.domain}" to clipboard!`);
                    }
                  }}
                  className="px-2.5 py-1.5 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-semibold rounded-lg text-[11px] cursor-pointer"
                >
                  📋 Copy "{testResult.domain}"
                </button>
              </div>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                <strong>How to fix:</strong> In Firebase Console &rarr; <strong>Authorized domains</strong> &rarr; click <strong>Add domain</strong> &rarr; paste <code className="font-mono font-bold">{testResult.domain}</code> &rarr; click Save. Then click "Connect Google Account" again.
              </p>
              <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold">
                💡 <em>Alternative:</em> You can also use the <strong>16-character Google App Password</strong> right below, which works on ANY domain with no domain whitelisting needed!
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
