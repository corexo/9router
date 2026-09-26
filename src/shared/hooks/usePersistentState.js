"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Persists a state value in localStorage so that navigation / tab switches
 * preserve user selections (e.g. time range pickers, auto-refresh intervals).
 *
 * Fully hydration-safe for Next.js SSR, and syncs across tabs via the storage event.
 */
export function usePersistentState(key, defaultValue) {
  const [value, setValue] = useState(defaultValue);

  // Hydrate from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        try {
          setValue(JSON.parse(stored));
        } catch {
          setValue(stored);
        }
      }
    } catch {
      // LocalStorage unavailable
    }
  }, [key]);

  // Sync across tabs
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setValue(JSON.parse(e.newValue));
        } catch {
          setValue(e.newValue);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [key]);

  const setPersistentValue = useCallback(
    (newValueOrFn) => {
      setValue((prev) => {
        const nextValue = typeof newValueOrFn === "function" ? newValueOrFn(prev) : newValueOrFn;
        try {
          localStorage.setItem(key, JSON.stringify(nextValue));
        } catch {
          // LocalStorage full or disabled
        }
        return nextValue;
      });
    },
    [key]
  );

  return [value, setPersistentValue];
}
