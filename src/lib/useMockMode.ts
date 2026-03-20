import { useState, useEffect } from "react";

const KEY = "preview_mock_mode";

export function useMockMode() {
  const [mockMode, setMockModeState] = useState(() => {
    try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
  });

  const setMockMode = (val: boolean | ((prev: boolean) => boolean)) => {
    setMockModeState(prev => {
      const next = typeof val === "function" ? val(prev) : val;
      try { localStorage.setItem(KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };

  return [mockMode, setMockMode] as const;
}
