import Svg, { Circle, G, Line, Rect } from "react-native-svg";

import type { CrewKind } from "@/lib/api";

/** 대원 색 (안전모·차체). 다시 보기 범례와 같음 */
export const CREW_COLOR: Record<CrewKind, string> = {
  welder: "#2F6FD0", fitter: "#2E9D5B", forklift: "#F2C230", transporter: "#E07B39", piper: "#8E5BC9", safety: "#F4F4F4", crane: "#D8A21E",
};

/**
 * 대원 한 명을 그린다 (Svg 안에서 쓰는 G). x, y = 발 가운데, s = 크기(px).
 * 용접사·취부사 = 안전모 쓴 사람, 지게차·트랜스포터 = 작은 차. cheer = 양팔을 들고 환호 (차는 깜빡이 + 깃발).
 */
export function CrewGlyph({ kind, x, y, s, cheer = false, hop = 0, dim = false, ring }: {
  kind: CrewKind; x: number; y: number; s: number; cheer?: boolean; hop?: number; dim?: boolean; /** 방어 대원 표시 (발밑 고리 색) */ ring?: string;
}) {
  const body = <CrewBody kind={kind} x={x} y={y} s={s} cheer={cheer} hop={hop} dim={dim} />;
  if (!ring) return body;
  return (
    <G>
      <Circle cx={x} cy={y - s * 0.05} r={s * 0.36} fill="none" stroke={ring} strokeWidth={2} opacity={dim ? 0.35 : 1} />
      {body}
    </G>
  );
}

function CrewBody({ kind, x, y, s, cheer, hop, dim }: {
  kind: CrewKind; x: number; y: number; s: number; cheer: boolean; hop: number; dim: boolean;
}) {
  const c = CREW_COLOR[kind];
  const yy = y - hop;
  if (kind === "crane") {
    return (
      <G opacity={dim ? 0.35 : 1}>
        <Rect x={x - s * 0.5} y={yy - s * 0.4} width={s * 0.8} height={s * 0.26} rx={s * 0.05} fill={c} stroke="#5A4500" strokeWidth={1} />
        <Line x1={x - s * 0.1} y1={yy - s * 0.4} x2={x + s * 0.5} y2={yy - s * 1.0} stroke="#5A4500" strokeWidth={s * 0.08} />
        <Line x1={x + s * 0.5} y1={yy - s * 1.0} x2={x + s * 0.5} y2={yy - s * 0.6} stroke="#333" strokeWidth={1} />
        <Rect x={x + s * 0.44} y={yy - s * 0.62} width={s * 0.12} height={s * 0.08} fill="#333" />
        {[-0.38, -0.12, 0.14].map((k) => (
          <Circle key={k} cx={x + s * k} cy={yy - s * 0.1} r={s * 0.09} fill="#222" />
        ))}
        {cheer ? <Rect x={x + s * 0.44} y={yy - s * 1.12} width={s * 0.14} height={s * 0.1} fill={hop ? "#FF5252" : "#FFD166"} /> : null}
      </G>
    );
  }
  if (kind === "forklift") {
    return (
      <G opacity={dim ? 0.35 : 1}>
        <Rect x={x - s * 0.45} y={yy - s * 0.55} width={s * 0.6} height={s * 0.4} rx={s * 0.06} fill={c} stroke="#5A4500" strokeWidth={1} />
        <Rect x={x - s * 0.35} y={yy - s * 0.85} width={s * 0.32} height={s * 0.3} fill="none" stroke="#333" strokeWidth={1.5} />
        <Line x1={x + s * 0.2} y1={yy - s * 0.9} x2={x + s * 0.2} y2={yy - s * 0.12} stroke="#333" strokeWidth={2} />
        <Line x1={x + s * 0.2} y1={yy - s * 0.14} x2={x + s * 0.5} y2={yy - s * 0.14} stroke="#333" strokeWidth={2} />
        <Circle cx={x - s * 0.3} cy={yy - s * 0.1} r={s * 0.11} fill="#222" />
        <Circle cx={x + s * 0.05} cy={yy - s * 0.1} r={s * 0.11} fill="#222" />
        {cheer ? <Rect x={x - s * 0.24} y={yy - s * 1.0} width={s * 0.1} height={s * 0.1} fill={hop ? "#FF5252" : "#FFD166"} /> : null}
      </G>
    );
  }
  if (kind === "transporter") {
    return (
      <G opacity={dim ? 0.35 : 1}>
        <Rect x={x - s * 0.6} y={yy - s * 0.42} width={s * 1.2} height={s * 0.26} rx={s * 0.05} fill={c} stroke="#6A3010" strokeWidth={1} />
        <Rect x={x + s * 0.32} y={yy - s * 0.66} width={s * 0.26} height={s * 0.26} fill={c} stroke="#6A3010" strokeWidth={1} />
        {[-0.45, -0.2, 0.05, 0.3].map((k) => (
          <Circle key={k} cx={x + s * k} cy={yy - s * 0.1} r={s * 0.09} fill="#222" />
        ))}
        {cheer ? (
          <G>
            <Line x1={x - s * 0.5} y1={yy - s * 0.42} x2={x - s * 0.5} y2={yy - s * 0.95} stroke="#333" strokeWidth={1.5} />
            <Rect x={x - s * 0.5} y={yy - s * 0.95} width={s * 0.3} height={s * 0.18} fill={hop ? "#FFD166" : "#FF5252"} />
          </G>
        ) : null}
      </G>
    );
  }
  // 사람 (용접사: 파란 안전모·용접 면, 취부사: 초록 안전모)
  const head = yy - s * 0.78;
  const shoulder = yy - s * 0.55;
  const arm = cheer
    ? [[x - s * 0.12, shoulder, x - s * 0.32, yy - s * 1.0], [x + s * 0.12, shoulder, x + s * 0.32, yy - s * 1.0]]
    : [[x - s * 0.12, shoulder, x - s * 0.24, yy - s * 0.3], [x + s * 0.12, shoulder, x + s * 0.24, yy - s * 0.3]];
  return (
    <G opacity={dim ? 0.35 : 1}>
      <Line x1={x - s * 0.08} y1={yy - s * 0.3} x2={x - s * 0.14} y2={yy} stroke="#1E2A44" strokeWidth={s * 0.1} strokeLinecap="round" />
      <Line x1={x + s * 0.08} y1={yy - s * 0.3} x2={x + s * 0.14} y2={yy} stroke="#1E2A44" strokeWidth={s * 0.1} strokeLinecap="round" />
      <Rect x={x - s * 0.14} y={shoulder - s * 0.04} width={s * 0.28} height={s * 0.32} rx={s * 0.06} fill={kind === "safety" ? "#7FD18F" : "#25407A"} />
      {kind === "safety" ? (
        <G>
          <Line x1={x} y1={shoulder + s * 0.02} x2={x} y2={shoulder + s * 0.2} stroke="#fff" strokeWidth={s * 0.05} />
          <Line x1={x - s * 0.08} y1={shoulder + s * 0.11} x2={x + s * 0.08} y2={shoulder + s * 0.11} stroke="#fff" strokeWidth={s * 0.05} />
        </G>
      ) : null}
      {arm.map(([x1, y1, x2, y2], i) => (
        <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#25407A" strokeWidth={s * 0.09} strokeLinecap="round" />
      ))}
      <Circle cx={x} cy={head} r={s * 0.13} fill="#F2C9A0" />
      {kind === "piper" && !cheer ? (
        <Line x1={x - s * 0.34} y1={yy - s * 0.32} x2={x + s * 0.34} y2={yy - s * 0.32} stroke="#9AA4AE" strokeWidth={s * 0.09} strokeLinecap="round" />
      ) : null}
      {kind === "welder" ? <Rect x={x - s * 0.1} y={head - s * 0.04} width={s * 0.2} height={s * 0.1} fill="#333" /> : null}
      <Rect x={x - s * 0.17} y={head - s * 0.19} width={s * 0.34} height={s * 0.1} rx={s * 0.05} fill={c} stroke={kind === "safety" ? "#999" : undefined} strokeWidth={kind === "safety" ? 0.8 : 0} />
    </G>
  );
}

/** 목록·단추 옆에 쓰는 대원 그림 하나 */
export function CrewFigure({ kind, size = 28, cheer = false }: { kind: CrewKind; size?: number; cheer?: boolean }) {
  return (
    <Svg width={size} height={size}>
      <CrewGlyph kind={kind} x={size / 2} y={size - 2} s={size * 0.95} cheer={cheer} />
    </Svg>
  );
}
