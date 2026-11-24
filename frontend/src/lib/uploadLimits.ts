import { useEffect, useState } from "react";

/** The upload limits the server was started with (MAX_UPLOAD_MB, MAX_UPLOAD_ROWS). Defaults match the server's measured safe defaults. */
export type UploadLimits = { mb: number; rows: number };
export const DEFAULT_LIMITS: UploadLimits = { mb: 60, rows: 1_000_000 };
let cached: UploadLimits | null = null;
export function useUploadLimits(): UploadLimits {
  const [limits, setLimits] = useState<UploadLimits>(cached ?? DEFAULT_LIMITS);
  useEffect(() => {
    if (cached) return;
    let current = true;
    fetch("/api/health").then((r) => (r.ok ? r.json() : null)).then((body) => {
      if (!current || !body || typeof body.upload_limit_mb !== "number") return;
      cached = { mb: body.upload_limit_mb, rows: body.upload_limit_rows };
      setLimits(cached);
    }).catch(() => undefined);
    return () => { current = false; };
  }, []);
  return limits;
}
