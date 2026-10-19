import { useState, useRef, useEffect } from "react";
import type { DashboardState } from "./server";
import type { ObservatoryEvent } from "./journal";
import { isHeartbeat } from "./model";

export function useObservatory() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [events, setEvents] = useState<ObservatoryEvent[]>([]);
  const [packets, setPackets] = useState<ObservatoryEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [omitted, setOmitted] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const session = useRef("");
  const lastId = useRef(0);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motion.matches);
    updateMotion();
    motion.addEventListener("change", updateMotion);
    const source = new EventSource("/api/events");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("state", (message: MessageEvent<string>) => {
      const next: DashboardState = JSON.parse(message.data);
      if (session.current !== next.sessionId) {
        session.current = next.sessionId;
        lastId.current = 0;
        setEvents([]);
        setPackets([]);
        setOmitted(0);
      }
      setState(next);
      setConnected(true);
      setPackets((previous) =>
        previous.filter((event) => event.time > next.time - 900),
      );
    });
    source.addEventListener("events", (message: MessageEvent<string>) => {
      const batch: { events: ObservatoryEvent[]; omitted: number } = JSON.parse(
        message.data,
      );
      const incoming = batch.events.filter(
        (event) => event.id > lastId.current,
      );
      if (!incoming.length) return;
      lastId.current = incoming.at(-1)!.id;
      setOmitted((count) => count + batch.omitted);
      setEvents((previous) => {
        const all = [...incoming.slice().reverse(), ...previous];
        // Keep meaningful transitions visible even during dense heartbeat traffic.
        return [
          ...all.filter((event) => !isHeartbeat(event)).slice(0, 600),
          ...all.filter(isHeartbeat).slice(0, 200),
        ].sort((a, b) => b.id - a.id);
      });
      const time = incoming.at(-1)!.time;
      setPackets((previous) =>
        [
          ...previous,
          ...incoming.filter(
            (event) =>
              event.type === "rpc" &&
              ["sent", "blocked"].includes(String(event.data.phase)),
          ),
        ]
          .filter((event) => event.time > time - 900)
          .slice(-80),
      );
    });
    return () => {
      source.close();
      motion.removeEventListener("change", updateMotion);
    };
  }, []);

  return { state, events, packets, connected, omitted, reducedMotion };
}
