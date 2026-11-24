import { useEffect, useState } from "react";
import type { AgentEvent } from "../api";
export function useRunEvents(
  id: string | undefined,
  active: boolean,
  onStep: (event: AgentEvent) => void,
  onComplete: () => void,
) {
  const [connection, setConnection] = useState("Status polling");
  useEffect(() => {
    if (!id || !active) return;
    if (typeof EventSource === "undefined") {
      setConnection("Status polling");
      return;
    }
    let current = true;
    const source = new EventSource(`/api/analyst/runs/${id}/events`);
    source.onopen = () => {
      if (current) setConnection("Live event stream");
    };
    source.addEventListener("step", (event) => {
      if (!current) return;
      try {
        const parsed = JSON.parse((event as MessageEvent).data);
        if (typeof parsed.id === "number" && typeof parsed.step === "string")
          onStep(parsed);
      } catch {
        setConnection("Invalid event; status polling");
      }
    });
    source.addEventListener("complete", () => {
      if (current) {
        source.close();
        setConnection("Stream complete");
        onComplete();
      }
    });
    source.onerror = () => {
      if (current) setConnection("Reconnecting stream · status polling");
    };
    return () => {
      current = false;
      source.close();
    };
  }, [id, active, onStep, onComplete]);
  return connection;
}
