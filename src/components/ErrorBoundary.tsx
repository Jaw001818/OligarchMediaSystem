import * as React from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = (): void => {
    try {
      localStorage.removeItem("local_sandbox_active");
    } catch {}
    window.location.reload();
  };

  private handleResetToPortal = (): void => {
    try {
      localStorage.removeItem("local_sandbox_active");
      localStorage.removeItem("nova_admin_session");
    } catch {}
    window.location.href = "/";
  };

  public override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4 font-sans select-none">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-black text-white tracking-tight">System Recovered</h1>
              <p className="text-xs text-zinc-400 leading-relaxed">
                The application intercepted a runtime exception and prevented the browser tab from freezing. Your database records remain intact.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="p-3 bg-zinc-950/80 rounded-xl border border-zinc-800/80 text-left overflow-x-auto max-h-32">
                <p className="text-[10px] font-mono text-zinc-400 break-words">
                  {this.state.error.message.length > 250
                    ? this.state.error.message.substring(0, 250) + "..."
                    : this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload Application</span>
              </button>
              <button
                type="button"
                onClick={this.handleResetToPortal}
                className="w-full py-3 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono font-bold transition-all border border-zinc-700 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Home className="w-4 h-4" />
                <span>Return to Portal</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
