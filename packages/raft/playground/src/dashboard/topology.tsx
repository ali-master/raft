import { useRef, useEffect } from "react";
import type { DashboardNode } from "./model";
import type { ObservatoryEvent } from "./journal";
import { quorumFor, positions, connectionPath } from "./model";

interface Props {
  nodes: DashboardNode[];
  blocked: string[];
  packets: ObservatoryEvent[];
  selected: string;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
  connected: boolean;
}

function Packet({
  path,
  color,
  radius,
}: {
  path: string;
  color: string;
  radius: number;
}) {
  const element = useRef<SVGCircleElement>(null);
  useEffect(() => {
    // SVG timelines start at document load; each live packet needs its own start.
    element.current
      ?.querySelectorAll<SVGAnimationElement>("animateMotion, animate")
      .forEach((animation) => animation.beginElement());
  }, []);
  return (
    <circle
      ref={element}
      className="network-packet"
      r={radius}
      fill={color}
      color={color}
      aria-hidden="true"
    >
      <animateMotion dur=".8s" begin="indefinite" path={path} fill="freeze" />
      <animate
        attributeName="opacity"
        begin="indefinite"
        values="0;.8;.8;0"
        dur=".8s"
        fill="freeze"
      />
    </circle>
  );
}

export function Topology({
  nodes,
  blocked,
  packets,
  selected,
  onSelect,
  reducedMotion,
  connected,
}: Props) {
  const dense = nodes.length > 8;
  const coords = positions(nodes);
  const quorum = quorumFor(nodes, blocked);
  const term = Math.max(0, ...nodes.map((node) => node.term));
  const links = nodes.flatMap((node, index) =>
    nodes.slice(index + 1).map((other) => ({
      from: node,
      to: other,
      path: connectionPath(coords.get(node.id)!, coords.get(other.id)!),
      blocked:
        blocked.includes(`${node.id}->${other.id}`) ||
        blocked.includes(`${other.id}->${node.id}`),
    })),
  );
  const caption = !connected
    ? "AWAITING CONNECTION"
    : !nodes.length
      ? "FORMING THE CLUSTER"
      : blocked.length
        ? "NETWORK PARTITIONED"
        : quorum.healthy
          ? "QUORUM CONNECTED"
          : "AWAITING QUORUM";

  return (
    <div className="topology-viewport">
      <svg
        className={`topology-svg ${dense ? "topology-dense" : ""}`}
        viewBox="0 0 800 540"
        role="group"
        aria-label="Live Raft cluster topology. Select a node to inspect it."
      >
        <defs>
          <radialGradient id="core-glow">
            <stop stopColor="#dbe6f2" stopOpacity=".055" />
            <stop offset="1" stopColor="#10141c" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="leader-face" cx="33%" cy="18%" r="90%">
            <stop stopColor="#f9dfca" />
            <stop offset=".4" stopColor="#c49575" />
            <stop offset="1" stopColor="#3d302a" />
          </radialGradient>
          <radialGradient id="follower-face" cx="30%" cy="15%" r="95%">
            <stop stopColor="#dae6f9" />
            <stop offset=".36" stopColor="#8b9dbb" />
            <stop offset="1" stopColor="#242e40" />
          </radialGradient>
          <radialGradient id="candidate-face" cx="30%" cy="15%" r="95%">
            <stop stopColor="#f0e0ff" />
            <stop offset=".36" stopColor="#b698cb" />
            <stop offset="1" stopColor="#372c45" />
          </radialGradient>
          <linearGradient id="core-face" x1="0" x2="1" y1="0" y2="1">
            <stop stopColor="#1c222c" />
            <stop offset="1" stopColor="#10141b" />
          </linearGradient>
          <pattern
            id="grid-dots"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="12" cy="12" r=".65" fill="#99afce" opacity=".12" />
          </pattern>
        </defs>
        <rect width="800" height="540" fill="url(#grid-dots)" />
        <circle cx="400" cy="265" r="255" fill="url(#core-glow)" />
        <ellipse
          className="orbit-guide"
          cx="400"
          cy="265"
          rx="300"
          ry="240"
          strokeDasharray="2 9"
        />
        <ellipse className="orbit-guide" cx="400" cy="265" rx="215" ry="178" />
        <circle
          className="orbit-guide"
          cx="400"
          cy="265"
          r="112"
          strokeDasharray="1 6"
        />
        <path
          d="M400 9V29 M400 505V525 M50 265H70 M730 265H750"
          stroke="#a9c6eb25"
        />
        <text
          x={dense ? 25 : 72}
          y="271"
          fill="#657182"
          fontSize="8"
          fontFamily="monospace"
        >
          270°
        </text>
        <text
          x={dense ? 750 : 708}
          y="271"
          fill="#657182"
          fontSize="8"
          fontFamily="monospace"
        >
          90°
        </text>
        {links.map((link) => (
          <path
            key={`${link.from.id}-${link.to.id}`}
            d={link.path}
            className={`network-link ${link.from.role === "leader" || link.to.role === "leader" ? "from-leader" : ""} ${link.blocked ? "blocked" : ""} ${!link.from.running || !link.to.running ? "offline" : ""}`}
          />
        ))}
        <g aria-hidden="true">
          <circle
            cx="400"
            cy="265"
            r="82"
            fill="#0c1016"
            stroke="#a9c6eb0c"
            strokeWidth="14"
          />
          <circle
            cx="400"
            cy="265"
            r="75"
            fill="url(#core-face)"
            stroke="#a9c6eb25"
          />
          <circle cx="400" cy="265" r="69" fill="none" stroke="#ffffff05" />
          <text x="400" y="236" textAnchor="middle" className="central-caption">
            CURRENT TERM
          </text>
          <text x="400" y="283" textAnchor="middle" className="central-term">
            {nodes.length ? String(term).padStart(2, "0") : "—"}
          </text>
          <text
            x="400"
            y="308"
            textAnchor="middle"
            className="central-state"
            fill={quorum.healthy ? "#9ed9ba" : "#f2b58d"}
          >
            {quorum.healthy ? "IN AGREEMENT" : "CONVERGING"}
          </text>
        </g>
        {connected &&
          !reducedMotion &&
          packets.map((event) => {
            const from = coords.get(event.nodeId);
            const to = coords.get(String(event.data.target));
            if (!from || !to) return null;
            const blockedPacket = event.data.phase === "blocked";
            const target = blockedPacket
              ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
              : to;
            const color = blockedPacket
              ? "#f28588"
              : String(event.data.kind).includes("vote")
                ? "#d4b4f6"
                : event.data.kind === "heartbeat"
                  ? "#a9c6eb"
                  : "#f2b58d";
            return (
              <Packet
                key={event.id}
                path={connectionPath(from, target)}
                color={color}
                radius={event.data.kind === "heartbeat" ? 1.8 : 3}
              />
            );
          })}
        {nodes.map((node) => {
          const { x, y } = coords.get(node.id)!;
          const color = !node.running
            ? "#78818e"
            : node.role === "leader"
              ? "#f2b58d"
              : node.role === "candidate"
                ? "#d4b4f6"
                : "#a9c6eb";
          return (
            <g
              key={node.id}
              transform={`translate(${x} ${y}) scale(${dense ? 0.6 : 1})`}
              className={`node-shell ${selected === node.id ? "selected" : ""} ${!node.running ? "offline" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${node.id}, ${node.running ? node.role : "stopped"}, term ${node.term}, applied ${node.lastApplied}`}
              aria-pressed={selected === node.id}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(node.id);
                }
              }}
            >
              <title>{`${node.id} · ${node.role} · commit #${node.commitIndex}`}</title>
              {node.role === "leader" && node.running && (
                <circle
                  className="leader-aura"
                  r="53"
                  fill="none"
                  stroke={color}
                  strokeWidth=".8"
                />
              )}
              <circle
                className="selection-ring"
                r="46"
                fill="none"
                stroke={color}
                strokeDasharray="2 5"
              />
              <circle r="38" fill="#0c1016" stroke={`${color}30`} />
              <circle
                r="31"
                className="node-face"
                fill={`url(#${node.role}-face)`}
                stroke={`${color}88`}
                strokeWidth=".6"
              />
              <path
                d="M -22 -17 Q 0 -34 22 -17"
                stroke="#ffffff44"
                strokeWidth=".7"
                fill="none"
              />
              <circle r="25" fill="none" stroke="#ffffff0d" strokeWidth=".6" />
              <text
                textAnchor="middle"
                y="7"
                fontSize="20"
                fontWeight="500"
                fontFamily="var(--font-mono)"
                fill={node.role === "leader" ? "#302219" : "#111927"}
              >
                {node.id
                  .replace(/^node-/, "")
                  .slice(-3)
                  .padStart(2, "0")}
              </text>
              <circle cx="25" cy="-27" r="5" fill="#10141b" stroke="#252c37" />
              <circle
                cx="25"
                cy="-27"
                r="2"
                fill={node.running ? "#9ed9ba" : "#f28588"}
              />
              <text textAnchor="middle" y="61" className="node-label">
                {node.id}
              </text>
              {!dense && (
                <text
                  textAnchor="middle"
                  y="77"
                  className="node-role"
                  fill={color}
                >
                  {node.running ? node.role : "OFFLINE"}
                </text>
              )}
            </g>
          );
        })}
        <text
          x="400"
          y="523"
          textAnchor="middle"
          fontSize="8"
          letterSpacing="2.5"
          fill="#7f8b9c"
        >
          {caption}
        </text>
      </svg>
    </div>
  );
}
