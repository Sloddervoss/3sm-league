import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDebug: boolean;
  copied: boolean;
  componentStack: string;
}

const isDebugMode = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("debug") === "1";
  } catch {
    return false;
  }
};

const collectDebugInfo = (error: Error, info: ErrorInfo) => {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    componentStack: info.componentStack,
    pathname: window.location.pathname,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  };
};

const CHUNK_RELOAD_KEY = "3sm:chunk-reload-attempted";
const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

const isChunkLoadError = (error: Error) => {
  const message = error?.message || "";
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Loading chunk") ||
    message.includes("ChunkLoadError")
  );
};

const logErrorToConsole = (error: Error, info: ErrorInfo) => {
  try {
    console.error("[3SM ErrorBoundary]", {
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Never let logging itself throw
  }
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, showDebug: false, copied: false, componentStack: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, showDebug: false, copied: false, componentStack: "" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack });
    logErrorToConsole(error, info);

    const lastChunkReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (isChunkLoadError(error) && Date.now() - lastChunkReload > CHUNK_RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
      window.location.reload();
      return;
    }
  }

  toggleDebug = () => {
    this.setState((prev) => ({ showDebug: !prev.showDebug, copied: false }));
  };

  copyDetails = () => {
    if (!this.state.error) return;
    const debug = collectDebugInfo(this.state.error, { componentStack: this.state.componentStack || "" });
    const text = [
      `Name: ${debug.name}`,
      `Message: ${debug.message}`,
      `Stack: ${debug.stack}`,
      `ComponentStack: ${debug.componentStack}`,
      `Pathname: ${debug.pathname}`,
      `UserAgent: ${debug.userAgent}`,
      `Timestamp: ${debug.timestamp}`,
    ].join("\n\n");

    try {
      navigator.clipboard.writeText(text).then(
        () => this.setState({ copied: true }),
        () => this.fallbackCopy(text)
      );
    } catch {
      this.fallbackCopy(text);
    }
  };

  fallbackCopy = (text: string) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      this.setState({ copied: true });
    } catch {
      /* clipboard unavailable — user can manually copy from the visible details */
    }
  };

  reset = () => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    sessionStorage.removeItem("3sm:vite-reload-attempted");
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-card/50 border border-border rounded-lg p-6 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h1 className="text-xl font-bold mb-2">Er ging iets mis</h1>
            <p className="text-sm text-muted-foreground mb-4">
              Een onderdeel van de pagina kon niet geladen worden. Probeer de pagina te verversen.
            </p>
            {import.meta.env.DEV && this.state.error && (
              <pre className="text-xs text-left bg-black/30 p-3 rounded mb-4 overflow-auto max-h-40">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.reset}
                className="px-4 py-2 rounded bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold"
              >
                Probeer opnieuw
              </button>
              <button
                onClick={() => window.location.href = "/"}
                className="px-4 py-2 rounded bg-muted hover:bg-muted/80 text-sm font-bold"
              >
                Terug naar home
              </button>
            </div>
            {isDebugMode() && this.state.error && (
              <div className="mt-4 border-t border-border pt-3">
                <button
                  onClick={this.toggleDebug}
                  className="text-xs text-muted-foreground hover:text-foreground underline mb-2"
                >
                  {this.state.showDebug ? "Verberg" : "Toon"} technische foutdetails
                </button>
                <button
                  onClick={this.copyDetails}
                  className="text-xs text-orange-400 hover:text-orange-300 underline ml-3"
                >
                  {this.state.copied ? "✓ Gekopieerd" : "Kopieer foutdetails"}
                </button>
                {this.state.showDebug && (
                  <pre className="text-[10px] text-left text-muted-foreground bg-black/20 p-2 rounded mt-2 overflow-auto max-h-60 whitespace-pre-wrap break-all">
{`Name: ${this.state.error.name}
Message: ${this.state.error.message}
Stack: ${this.state.error.stack || "(geen stack)"}
ComponentStack: ${this.state.componentStack || "(geen componentStack)"}
Pathname: ${window.location.pathname}
UserAgent: ${navigator.userAgent}
Timestamp: ${new Date().toISOString()}`}</pre>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
