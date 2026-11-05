import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from "firebase/auth";
import { app } from "../firebase";

export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
];

const auth = getAuth(app);

// Provider with Gmail sending scope
const provider = new GoogleAuthProvider();
SCOPES.forEach(scope => provider.addScope(scope));
// Prompt user to select account (especially hr.oligarchmedia@gmail.com)
provider.setCustomParameters({
  prompt: "select_account"
});

// In-memory cache for the access token ONLY (NEVER in localStorage/sessionStorage per security rules)
let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;
let isSigningIn = false;

// Listeners for auth state changes
type TokenListener = (token: string | null, user: User | null) => void;
const listeners = new Set<TokenListener>();

export function subscribeToGoogleAuth(listener: TokenListener): () => void {
  listeners.add(listener);
  listener(cachedAccessToken, cachedUser);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  listeners.forEach(listener => {
    try {
      listener(cachedAccessToken, cachedUser);
    } catch (e) {
      console.error("Error notifying auth listener:", e);
    }
  });
}

// Initialize Auth state listener
export const initGoogleAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      cachedUser = user;
      if (cachedAccessToken) {
        notifyListeners();
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        // User logged in to Firebase but needs fresh OAuth credential popup for Gmail scope token
        cachedAccessToken = null;
        notifyListeners();
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedUser = null;
      cachedAccessToken = null;
      notifyListeners();
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export interface GoogleAuthResult {
  user: User | null;
  accessToken: string | null;
  cancelled?: boolean;
}

/**
 * Interactive 1-click Google Sign-In with Gmail Send permissions
 */
export const signInWithGoogleGmail = async (): Promise<GoogleAuthResult> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Unable to obtain OAuth access token from Google Sign-In.");
    }

    cachedAccessToken = credential.accessToken;
    cachedUser = result.user;
    notifyListeners();
    return { user: result.user, accessToken: cachedAccessToken, cancelled: false };
  } catch (error: any) {
    // User voluntarily closed or cancelled the OAuth pop-up window
    if (
      error?.code === "auth/popup-closed-by-user" ||
      error?.code === "auth/cancelled-popup-request" ||
      error?.message?.includes("auth/popup-closed-by-user")
    ) {
      return { user: null, accessToken: null, cancelled: true };
    }
    console.error("Google Gmail Sign-In Error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Retrieve current cached access token (memory-only)
 */
export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

/**
 * Get current connected user (if any)
 */
export const getConnectedUser = (): User | null => {
  return cachedUser;
};

/**
 * Disconnect/Sign Out
 */
export const disconnectGoogleGmail = async (): Promise<void> => {
  try {
    await signOut(auth);
  } finally {
    cachedAccessToken = null;
    cachedUser = null;
    notifyListeners();
  }
};

/**
 * Helper to build RFC 2822 compliant MIME email string and base64url encode it
 */
export function buildMimeMessageBase64Url({
  from,
  to,
  subject,
  html
}: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): string {
  const cleanSubject = (subject || "").replace(/[\r\n]+/g, " ");
  // UTF-8 base64 encoded subject header as per RFC 2047
  const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(cleanSubject)))}?=`;
  
  // RFC 2822 Headers & Body
  const mimeLines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    btoa(unescape(encodeURIComponent(html)))
  ];

  const fullRaw = mimeLines.join("\r\n");
  // Encode into RFC 4648 Base64URL
  const base64 = btoa(unescape(encodeURIComponent(fullRaw)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Sends a single email directly via the official Gmail REST API using the user's OAuth access token.
 * No App Password or manual SMTP configuration needed!
 */
export async function sendEmailViaGmailApi({
  to,
  subject,
  html,
  fromName = "Oligarch Media Graphic Design Studio",
  fromEmail
}: {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
  fromEmail?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const token = await getAccessToken();
  if (!token) {
    return {
      success: false,
      error: "Google account not connected or access token expired. Please click 'Connect Google (hr.oligarchmedia@gmail.com)' first."
    };
  }

  const senderEmail = fromEmail || cachedUser?.email || "hr.oligarchmedia@gmail.com";
  const fromHeader = `"${fromName.replace(/"/g, "")}" <${senderEmail}>`;
  const rawBase64Url = buildMimeMessageBase64Url({
    from: fromHeader,
    to,
    subject,
    html
  });

  try {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw: rawBase64Url })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const errMsg = errJson?.error?.message || `Gmail API error (${res.status}: ${res.statusText})`;
      return { success: false, error: errMsg };
    }

    const data = await res.json();
    return { success: true, messageId: data.id };
  } catch (err: any) {
    console.error("Gmail API sending error:", err);
    return { success: false, error: err?.message || "Failed to communicate with Gmail API" };
  }
}
