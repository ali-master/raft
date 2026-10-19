import type { DashboardState } from "./server";
import type { ObservatoryEvent } from "./journal";

export type DashboardNode = DashboardState["nodes"][number];
export type EventFamily = "consensus" | "replication" | "network" | "system";

export function eventFamily(event: ObservatoryEvent): EventFamily {
  if (
    event.type === "rpc" ||
    event.type.includes("heartbeat") ||
    event.type.includes("peer_")
  )
    return "network";
  if (/vote|election|leader|state_change/.test(event.type)) return "consensus";
  if (/log_|snapshot|configuration/.test(event.type)) return "replication";
  return "system";
}

export function isHeartbeat(event: ObservatoryEvent) {
  return (
    event.type === "heartbeat_received" ||
    (event.type === "rpc" && event.data.kind === "heartbeat")
  );
}

export function describeEvent(event: ObservatoryEvent) {
  const d = event.data;
  if (typeof d.message === "string") return d.message;
  switch (event.type) {
    case "rpc":
      return `${String(d.kind).replaceAll("_", " ")} → ${d.target} · ${d.phase}`;
    case "leader_elected":
      return `Elected leader for term ${d.term}`;
    case "state_change":
      return `Became ${String(d.state).toLowerCase()} · term ${d.term}`;
    case "log_replicated":
      return `Entry #${d.index} appended · awaiting commit`;
    case "log_applied":
      return `Entry #${d.index} committed & applied`;
    case "snapshot_created":
      return `Snapshot sealed through #${d.lastIncludedIndex}`;
    case "vote_granted":
      return `Vote received from ${d.voter} · term ${d.term}`;
    case "vote_denied":
      return `Vote declined by ${d.voter}`;
    case "node_started":
      return "Node joined the running cluster";
    case "node_stopped":
      return "Node stopped · voting membership retained";
    case "peer_discovered":
      return `Discovered ${d.peerId}`;
    case "peer_lost":
      return `Lost contact with ${d.peerId}`;
    default:
      return event.type.replaceAll("_", " ");
  }
}

export function quorumFor(nodes: DashboardNode[], blocked: string[]) {
  const leader = nodes
    .filter((node) => node.running && node.role === "leader")
    .sort((a, b) => b.term - a.term)[0];
  const reference = leader ?? nodes[0];
  const peers = reference?.configuration.newPeers ?? [];
  const weight = (id: string) =>
    reference?.weighted
      ? (nodes.find((node) => node.id === id)?.weight ?? 1)
      : 1;
  const reachable = (id: string) =>
    nodes.some((node) => node.id === id && node.running) &&
    !!leader &&
    !blocked.includes(`${leader.id}->${id}`) &&
    !blocked.includes(`${id}->${leader.id}`);
  const total = peers.reduce((sum, id) => sum + weight(id), 0);
  const available = peers
    .filter(reachable)
    .reduce((sum, id) => sum + weight(id), 0);
  const oldPeers = reference?.configuration.oldPeers;
  const oldMajority =
    !oldPeers ||
    oldPeers.filter(reachable).reduce((sum, id) => sum + weight(id), 0) >
      oldPeers.reduce((sum, id) => sum + weight(id), 0) / 2;
  return {
    leader,
    total,
    available,
    required: Math.floor(total / 2) + 1,
    healthy: !!leader && available > total / 2 && oldMajority,
  };
}

export function positions(nodes: DashboardNode[]) {
  const dense = nodes.length > 8;
  return new Map(
    nodes.map((node, i) => {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / nodes.length;
      return [
        node.id,
        {
          x: 400 + Math.cos(angle) * (dense ? 300 : 215),
          y: 265 + Math.sin(angle) * (dense ? 205 : 178),
        },
      ];
    }),
  );
}

export function connectionPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  return `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2 + (to.y - from.y) * 0.12} ${(from.y + to.y) / 2 - (to.x - from.x) * 0.12} ${to.x} ${to.y}`;
}
