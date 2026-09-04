import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

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
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logErrorToConsole(error, info);

    const lastChunkReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (isChunkLoadError(error) && Date.now() - lastChunkReload > CHUNK_RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
      window.location.reload();
      return;
    }
  }

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
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
