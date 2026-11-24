import { useEffect, useState } from "react";

/** True once `busy` has lasted longer than `ms`: the page then says plainly that it is still working (large files take longer). */
export function useStillWorking(busy: boolean, ms = 6000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const timer = window.setTimeout(() => setSlow(true), ms);
    return () => window.clearTimeout(timer);
  }, [busy, ms]);
  return slow;
}
