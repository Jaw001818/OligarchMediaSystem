import React, { useState, useEffect } from "react";
import { Download, Smartphone, Share, X, Check, HelpCircle } from "lucide-react";

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // 1. Check if already running in standalone (PWA) mode
    const isInStandaloneMode = 
      window.matchMedia('(display-mode: standalone)').matches || 
      (window.navigator as any).standalone === true;
    
    setIsStandalone(isInStandaloneMode);

    // 2. Check if dismissed previously
    const dismissed = localStorage.getItem("pwa-install-prompt-dismissed") === "true";
    setIsDismissed(dismissed);

    // 3. Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIPhoneOrIPad = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIPhoneOrIPad);

    // 4. Handle Chromium direct installation event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // If on iOS and not in standalone, we want to offer the install guide as an option
    if (isIPhoneOrIPad && !isInStandaloneMode) {
      setIsInstallable(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowGuide(true);
      return;
    }

    if (!deferredPrompt) {
      // Fallback: show instructions if prompt was missed
      setShowGuide(true);
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to install prompt: ${outcome}`);
    
    // Reset state
    setDeferredPrompt(null);
    setIsInstallable(false);
  };

  const handleDismiss = () => {
    localStorage.setItem("pwa-install-prompt-dismissed", "true");
    setIsDismissed(true);
  };

  const handleResetDismiss = () => {
    localStorage.removeItem("pwa-install-prompt-dismissed");
    setIsDismissed(false);
    setShowGuide(false);
  };

  // Do not show anything if already standalone, dismissed, or not deemed installable
  if (isStandalone || (isDismissed && !showGuide) || !isInstallable) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-[380px] bg-slate-900 border border-indigo-500/30 text-white rounded-2xl shadow-2xl p-4 z-50 animate-in slide-in-from-bottom duration-300">
      {!showGuide ? (
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-400 flex items-center justify-center shrink-0 shadow-lg">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider">Install Oligarch Mobile</h4>
            <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
              Clock in/out faster, track leave requests, and view payslips on your cellphone with our standalone app.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleInstallClick}
                className="flex-1 bg-indigo-500 hover:bg-indigo-400 text-white text-[10px] font-extrabold uppercase tracking-wider py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isIOS ? "How to Install" : "Install App"}</span>
              </button>
              <button
                onClick={() => setShowGuide(true)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold py-1.5 px-2 rounded-lg transition-all cursor-pointer"
                title="Manual guide"
              >
                Guide
              </button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-white/5 transition-all cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <h4 className="text-xs font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-cyan-400" />
              <span>Mobile Installation Guide</span>
            </h4>
            <button
              onClick={() => setShowGuide(false)}
              className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-white/5 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3.5 text-xs text-slate-300 pr-1">
            {isIOS ? (
              <div className="space-y-2.5">
                <p className="text-[11px] leading-relaxed text-indigo-200">
                  Safari on iOS requires manual installation. Follow these 3 simple steps on your iPhone/iPad:
                </p>
                <ol className="space-y-2 text-[11px] list-decimal pl-4 leading-relaxed font-medium">
                  <li>
                    Tap the <strong className="text-white inline-flex items-center gap-0.5"><Share className="w-3.5 h-3.5 text-indigo-400" /> Share</strong> button in your bottom Safari toolbar.
                  </li>
                  <li>
                    Scroll down and select <strong className="text-white">"Add to Home Screen"</strong>.
                  </li>
                  <li>
                    Tap <strong className="text-white text-indigo-400">"Add"</strong> in the upper right corner to complete.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[11px] leading-relaxed text-indigo-200">
                  For Android and mobile Chrome browsers, follow these steps:
                </p>
                <ol className="space-y-2 text-[11px] list-decimal pl-4 leading-relaxed font-medium">
                  <li>
                    Tap the <strong className="text-white">three dots menu (⋮)</strong> in Chrome's top-right corner.
                  </li>
                  <li>
                    Tap <strong className="text-white">"Install app"</strong> or <strong className="text-white">"Add to Home screen"</strong>.
                  </li>
                  <li>
                    Tap <strong className="text-white text-indigo-400">"Install"</strong> in the pop-up to place the icon on your screen.
                  </li>
                </ol>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[10px]">
            <span className="text-slate-400">Can run fully offline!</span>
            <button
              onClick={handleDismiss}
              className="text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-wider py-1 cursor-pointer"
            >
              Close and Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
