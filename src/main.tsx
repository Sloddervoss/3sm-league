import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

/* Vite preload error handler — diagnostic logging + controlled single reload */
(() => {
  const VITE_RELOAD_KEY = "3sm:vite-reload-attempted";

  const logVitePreloadError = (event: Event) => {
    try {
      const detail =
        (event as CustomEvent<{ error?: Error }>).detail ||
        (event as Record<string, unknown>).payload ||
        {};
      const error = detail?.error || detail;
      console.error("[3SM vite:preloadError]", {
        message: error?.message || "unknown",
        stack: error?.stack || undefined,
        payload: detail,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Never let logging itself throw
    }
  };

  window.addEventListener("vite:preloadError", (event: Event) => {
    logVitePreloadError(event);

    /* Max 1 automatic refresh per incident — sessionStorage prevents loops */
    if (!sessionStorage.getItem(VITE_RELOAD_KEY)) {
      sessionStorage.setItem(VITE_RELOAD_KEY, "1");
      event.preventDefault();
      window.location.reload();
      return;
    }
    /* Second occurrence within same session: just log, no reload */
  });

  /* Clear reload marker after app successfully starts (no vite:preloadError for 8s) */
  window.addEventListener("load", () => {
    setTimeout(() => {
      sessionStorage.removeItem(VITE_RELOAD_KEY);
    }, 8000);
  });
})();

createRoot(document.getElementById("root")!).render(<App />);
