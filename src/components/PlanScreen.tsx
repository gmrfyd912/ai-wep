import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, G, Line, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { CrewFigure } from "@/components/CrewFigure";
import { AppButton } from "@/components/ui";
import {
  CREW_KINDS,
  gameCrewHire,
  gameCrewTrainStart,
  gameCrewTrainSubmit,
  type CrewKind,
  type GameCrews,
  type GameExamQuestion,
  type GameExamResult,
  type GameLane,
  type GamePirate,
  type GameState,
  type RaidPlan,
} from "@/lib/api";
import { BUILDING_COLOR, WAR_COLOR } from "@/screens/GameMap";
import { colors, radius, space } from "@/theme";

const PIRATE_COLOR: Record<string, string> = { hq: "#3B2A2A", hut: "#7A5A3A" };
const SHORT: Record<string, string> = { battery: "B", missile: "M", asw: "A", radar: "R", hq: "☠", hut: "" };
const LANE_Y: Record<GameLane, number> = { north: 2, middle: 5, south: 8 };
const MAX_ORDER = 3;

export type QuizRender = (p: {
  questions: GameExamQuestion[];
  answers: Record<string, string | number>;
  setAnswer: (id: string, v: string | number) => void;
  result: { results: GameExamResult["results"] } | null;
}) => ReactNode;

/**
 * G2c-2 작전 짜기 (전체 화면). 해적 기지 지도를 눌러서 정한다:
 * ① 들어갈 바닷길(오른쪽 화살표) ② 상륙 부두(해안 앞 점선 칸) ③ 대원이 부술 목표 순서(건물, 최대 3)
 * 오른쪽 창: 출격할 전투함·태울 대원(배마다 자리 수)·대원 훈련(문제 → 훈련 점수 → 대원 뽑기)·출격.
 */
export function PlanScreen({
  stage,
  pirate,
  data,
  busy,
  error,
  lang,
  onClose,
  onLaunch,
  onCrews,
  errorText,
  renderQuiz,
}: {
  stage: number;
  pirate: GamePirate;
  data: GameState;
  busy: boolean;
  error: string;
  lang: string;
  onClose: () => void;
  onLaunch: (plan: RaidPlan) => void;
  onCrews: (c: GameCrews) => void;
  errorText: (e: unknown) => string;
  renderQuiz: QuizRender;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const st = pirate.stages[stage - 1];
  const map = pirate.map;
  const crews = pirate.crews;
  const ships = data.fleet?.ships ?? [];
  const ready = ships.filter((f) => !f.damage && f.repair_left === undefined);
  const [lane, setLane] = useState<GameLane>("middle");
  const [landing, setLanding] = useState<number | null>(null);
  const [order, setOrder] = useState<number[]>([]);
  const [pick, setPick] = useState<string[] | null>(null);
  const [send, setSend] = useState<Record<CrewKind, number>>({ welder: 0, fitter: 0, forklift: 0, transporter: 0 });
  const [view, setView] = useState<"plan" | "train">("plan");
  const chosen = (pick ?? ready.map((f) => f.id)).filter((id) => ready.some((f) => f.id === id));
  const room = chosen.reduce((a, id) => a + (crews.capacity[ships.find((f) => f.id === id)?.kind ?? ""] ?? 0), 0);
  const sent = CREW_KINDS.reduce((a, k) => a + Math.min(send[k], crews.have[k]), 0);

  const sheetW = Math.min(360, Math.max(280, width * 0.4));
  const areaW = width - sheetW - 24 - insets.left - insets.right;
  const cell = Math.floor(Math.min(areaW / map.w, (height - 70 - insets.top - insets.bottom) / map.h));
  const W = cell * map.w, H = cell * map.h;
  const C = (o: { x: number; y: number; w: number; h: number }): [number, number] => [(o.x + o.w / 2) * cell, (o.y + o.h / 2) * cell];
  const targets = useMemo(() => st.base.filter((o) => o.type !== "wall" && o.type !== "mine"), [st.base]);
  const toggle = (id: number) =>
    setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : o.length >= MAX_ORDER ? o : [...o, id]));
  const step = landing === null ? 2 : order.length === 0 ? 3 : 4;
  const tName = (type: string) => (type === "hq" ? t("gm_bt_hq") : type === "hut" ? t("gm_pl_hut") : t(`gm_b_${type}`));

  const launch = () => {
    if (landing === null) return;
    const c: Partial<Record<CrewKind, number>> = {};
    for (const k of CREW_KINDS) if (send[k] > 0) c[k] = Math.min(send[k], crews.have[k]);
    onLaunch({ stage, ships: chosen, lane, target: "defense", landing, order, crews: c });
  };
  const dock = landing === null ? null : { x: (map.land + 0.45) * cell, y: (landing + 0.5) * cell };

  return (
    <View style={[StyleSheet.absoluteFill, styles.bg]}>
      <View style={[styles.top, { paddingTop: 6 + insets.top, paddingLeft: 8 + insets.left, paddingRight: sheetW + 20 + insets.right }]}>
        <Pressable onPress={onClose} style={styles.round} hitSlop={8} accessibilityLabel={t("common_back")}>
          <Ionicons name="arrow-back" size={18} color="#fff" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{t("gm_pl_title", { n: stage })}</Text>
        <Text style={styles.hint} numberOfLines={2}>
          {t(`gm_pl_step${step}`)}
        </Text>
      </View>
      <View style={[styles.body, { paddingLeft: 8 + insets.left }]}>
        <Svg width={W} height={H}>
          <Rect x={0} y={0} width={map.land * cell} height={H} fill="#C9B98F" />
          <Rect x={map.land * cell} y={0} width={(map.w - map.land) * cell} height={H} fill="#1F6FA8" />
          {Array.from({ length: map.w + 1 }, (_, k) => (
            <Line key={`gx${k}`} x1={k * cell} y1={0} x2={k * cell} y2={H} stroke="#00000014" strokeWidth={1} />
          ))}
          {Array.from({ length: map.h + 1 }, (_, k) => (
            <Line key={`gy${k}`} x1={0} y1={k * cell} x2={W} y2={k * cell} stroke="#00000014" strokeWidth={1} />
          ))}
          {/* 들어갈 길 → 상륙 부두 */}
          {dock ? (
            <Line x1={W - cell * 0.5} y1={LANE_Y[lane] * cell} x2={dock.x} y2={dock.y} stroke="#FFD166" strokeWidth={3} strokeDasharray="8 6" />
          ) : null}
          {/* 상륙 부두 고르는 칸 (해안 바로 앞 바다) */}
          {Array.from({ length: map.h }, (_, y) => {
            const on = landing === y;
            const blocked = st.base.some((o) => o.type === "wall" && o.x === map.land && o.y === y);
            return (
              <G key={`pier${y}`} onPress={() => setLanding(y)}>
                <Rect x={map.land * cell + 2} y={y * cell + 2} width={cell - 4} height={cell - 4} rx={4}
                  fill={on ? "#FFD16699" : "#FFFFFF14"} stroke={on ? "#FFD166" : "#FFFFFF77"} strokeWidth={on ? 2.5 : 1} strokeDasharray={on ? undefined : "4 3"} />
                {on ? <SvgText x={(map.land + 0.5) * cell} y={(y + 0.68) * cell} fontSize={cell * 0.5} fill="#fff" textAnchor="middle">⚓</SvgText> : null}
                {blocked && !on ? <SvgText x={(map.land + 0.5) * cell} y={(y + 0.7) * cell} fontSize={cell * 0.45} fill="#fff" textAnchor="middle">▦</SvgText> : null}
              </G>
            );
          })}
          {st.base.map((o) => {
            const [cx, cy] = C(o);
            if (o.type === "mine") return <Circle key={o.id} cx={cx} cy={cy} r={cell * 0.2} fill={BUILDING_COLOR.mine} stroke="#3A0D0A" />;
            if (o.type === "wall" && o.x === map.land) return null;   // 부두 칸 위 장벽은 ▦ 로
            const color = PIRATE_COLOR[o.type] ?? BUILDING_COLOR[o.type] ?? "#999";
            const n = order.indexOf(o.id);
            const tap = o.type !== "wall";
            return (
              <G key={o.id} onPress={tap ? () => toggle(o.id) : undefined}>
                <Rect x={o.x * cell + 2} y={o.y * cell + 2} width={o.w * cell - 4} height={o.h * cell - 4} rx={3} fill={color}
                  stroke={n >= 0 ? "#FFD166" : "#0006"} strokeWidth={n >= 0 ? 3 : 1} />
                {SHORT[o.type] ? (
                  <SvgText x={cx} y={cy + cell * 0.15} fontSize={cell * (o.type === "hq" ? 0.7 : 0.42)} fill="#fff" textAnchor="middle" fontWeight="bold">
                    {SHORT[o.type]}
                  </SvgText>
                ) : null}
                {n >= 0 ? (
                  <G>
                    <Circle cx={o.x * cell + 6} cy={o.y * cell + 6} r={cell * 0.26} fill="#FFD166" stroke="#0B2033" strokeWidth={1.5} />
                    <SvgText x={o.x * cell + 6} y={o.y * cell + 6 + cell * 0.11} fontSize={cell * 0.32} fill="#0B2033" textAnchor="middle" fontWeight="bold">
                      {n + 1}
                    </SvgText>
                  </G>
                ) : null}
              </G>
            );
          })}
          {/* 들어갈 바닷길 화살표 */}
          {(Object.keys(LANE_Y) as GameLane[]).map((l) => {
            const y = LANE_Y[l] * cell, x = W - cell * 0.15, on = lane === l;
            return (
              <G key={l} onPress={() => setLane(l)}>
                <Rect x={W - cell * 1.1} y={y - cell * 0.55} width={cell * 1.1} height={cell * 1.1} fill="transparent" />
                <Polygon points={`${x - cell * 0.85},${y} ${x},${y - cell * 0.4} ${x},${y + cell * 0.4}`} fill={on ? "#FFD166" : "#FFFFFF55"} stroke="#0B2033" strokeWidth={1} />
              </G>
            );
          })}
          {/* 고른 전투함 (출발 자리) */}
          {chosen.slice(0, 6).map((id, i) => {
            const off = (i - (Math.min(chosen.length, 6) - 1) / 2) * 0.8;
            const px = (map.w - 1.4) * cell, py = (LANE_Y[lane] + off) * cell, r = cell * 0.3;
            return <Polygon key={id} points={`${px - r},${py} ${px + r * 0.8},${py - r * 0.55} ${px + r * 0.8},${py + r * 0.55}`} fill={WAR_COLOR} stroke="#fff" strokeWidth={1} opacity={0.8} />;
          })}
        </Svg>
        <View style={styles.legend}>
          <Text style={styles.legText}>▶ {t("gm_pl_legLane")}</Text>
          <Text style={styles.legText}>⚓ {t("gm_pl_legPier")}</Text>
          <Text style={styles.legText}>①②③ {t("gm_pl_legOrder")}</Text>
          <Text style={styles.legText}>☠ {t("gm_bt_hq")}  B {t("gm_b_battery")}  M {t("gm_b_missile")}</Text>
        </View>
      </View>

      <View style={[styles.sheet, { width: sheetW, top: 8 + insets.top, bottom: 8 + insets.bottom, right: 8 + insets.right }]}>
        <ScrollView contentContainerStyle={{ gap: space.sm, padding: space.sm }}>
          {view === "train" ? (
            <CrewTrain crews={crews} lang={lang} onCrews={onCrews} onBack={() => setView("plan")} errorText={errorText} renderQuiz={renderQuiz} />
          ) : (
            <>
              <Row ok label={t("gm_pl_lane")} value={t(`gm_bt_lane_${lane}`)} />
              <Row ok={landing !== null} label={t("gm_pl_pier")} value={landing === null ? t("gm_pl_tapPier") : t("gm_pl_pierAt", { n: landing + 1 })} />
              <View style={styles.rowBetween}>
                <Row ok={order.length > 0} label={t("gm_pl_order", { n: order.length, max: MAX_ORDER })}
                  value={order.length ? order.map((id) => tName(st.base[id].type)).join(" → ") : t("gm_pl_tapOrder")} />
                {order.length ? (
                  <Pressable onPress={() => setOrder([])} hitSlop={8}>
                    <Text style={styles.link}>{t("gm_pl_clear")}</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.small}>{t("gm_pl_orderNote")}</Text>
              <Text style={styles.label}>{t("gm_bt_ships", { n: chosen.length })}</Text>
              {ships.length === 0 ? <Text style={styles.warn}>{t("gm_bt_noFleet")}</Text> : null}
              <View style={styles.chips}>
                {ships.map((f) => {
                  const ok = ready.some((r) => r.id === f.id);
                  const on = chosen.includes(f.id);
                  return (
                    <Pressable key={f.id} disabled={!ok} onPress={() => setPick(on ? chosen.filter((id) => id !== f.id) : [...chosen, f.id])}
                      style={[styles.chip, on && styles.chipOn, !ok && { opacity: 0.4 }]}>
                      <Text style={styles.chipText}>
                        {t("gm_fleetShip", { ship: t(`gm_ship_${f.kind}`), no: f.no })} · 👷{crews.capacity[f.kind] ?? 0}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.label}>{t("gm_pl_crews", { n: sent, room })}</Text>
                <Text style={styles.small}>{t("gm_pl_have", { n: crews.total, cap: crews.cap })}</Text>
              </View>
              {CREW_KINDS.map((k) => (
                <View key={k} style={styles.crewRow}>
                  <CrewFigure kind={k} size={26} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.textB}>
                      {t(`gm_crew_${k}`)} <Text style={styles.small}>×{crews.have[k]}</Text>
                    </Text>
                    <Text style={styles.small} numberOfLines={1}>{t(`gm_crew_${k}_role`)}</Text>
                  </View>
                  <Pressable disabled={send[k] <= 0} onPress={() => setSend((s) => ({ ...s, [k]: s[k] - 1 }))} style={[styles.pm, send[k] <= 0 && styles.dim]}>
                    <Ionicons name="remove" size={16} color="#fff" />
                  </Pressable>
                  <Text style={styles.count}>{Math.min(send[k], crews.have[k])}</Text>
                  <Pressable disabled={send[k] >= crews.have[k] || sent >= room} onPress={() => setSend((s) => ({ ...s, [k]: s[k] + 1 }))}
                    style={[styles.pm, (send[k] >= crews.have[k] || sent >= room) && styles.dim]}>
                    <Ionicons name="add" size={16} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {room === 0 && chosen.length ? <Text style={styles.warnSm}>{t("gm_pl_noRoom")}</Text> : null}
              <AppButton label={t("gm_pl_train", { pts: crews.pts })} icon="school-outline" variant="secondary" onPress={() => setView("train")} />
              {error ? <Text style={styles.warn}>{error}</Text> : null}
              <AppButton label={t("gm_bt_attack")} icon="flag-outline" disabled={busy || landing === null || chosen.length === 0} onPress={launch} />
              {landing === null ? <Text style={styles.small}>{t("gm_pl_needPier")}</Text> : null}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function Row({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", flex: 1 }}>
      <Ionicons name={ok ? "checkmark-circle" : "ellipse-outline"} size={16} color={ok ? "#7FD18F" : "#FFFFFF88"} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.small}>{value}</Text>
      </View>
    </View>
  );
}

/** 대원 훈련: 문제 3개 → 맞힌 수 = 훈련 점수 → 점수로 대원 뽑기 */
function CrewTrain({
  crews,
  lang,
  onCrews,
  onBack,
  errorText,
  renderQuiz,
}: {
  crews: GameCrews;
  lang: string;
  onCrews: (c: GameCrews) => void;
  onBack: () => void;
  errorText: (e: unknown) => string;
  renderQuiz: QuizRender;
}) {
  const { t } = useTranslation();
  const [quiz, setQuiz] = useState<{ id: string; questions: GameExamQuestion[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [result, setResult] = useState<{ right: number; total: number; results: GameExamResult["results"] } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    setAnswers({});
    try {
      setQuiz(await gameCrewTrainStart(lang));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!quiz) return;
    setBusy(true);
    try {
      const r = await gameCrewTrainSubmit(quiz.id, answers);
      setResult(r);
      onCrews(r.crews);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const hire = async (k: CrewKind) => {
    setBusy(true);
    setErr("");
    try {
      onCrews((await gameCrewHire(k, 1)).crews);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const full = crews.total >= crews.cap;
  return (
    <>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{t("gm_ct_title")}</Text>
        <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t("common_back")}>
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      </View>
      <Text style={styles.small}>{t("gm_ct_rule", { n: crews.quiz })}</Text>
      <View style={styles.rowBetween}>
        <Text style={styles.textB}>{t("gm_ct_pts", { n: crews.pts })}</Text>
        <Text style={styles.small}>{t("gm_pl_have", { n: crews.total, cap: crews.cap })}</Text>
      </View>
      {CREW_KINDS.map((k) => (
        <View key={k} style={styles.crewRow}>
          <CrewFigure kind={k} size={26} />
          <View style={{ flex: 1 }}>
            <Text style={styles.textB}>
              {t(`gm_crew_${k}`)} <Text style={styles.small}>×{crews.have[k]}</Text>
            </Text>
            <Text style={styles.small} numberOfLines={2}>{t(`gm_crew_${k}_role`)}</Text>
          </View>
          <Pressable disabled={busy || full || crews.pts < crews.specs[k].cost} onPress={() => hire(k)}
            style={[styles.hire, (busy || full || crews.pts < crews.specs[k].cost) && styles.dim]}>
            <Text style={styles.chipText}>+1 · {t("gm_ct_cost", { n: crews.specs[k].cost })}</Text>
          </Pressable>
        </View>
      ))}
      {full ? <Text style={styles.warnSm}>{t("gm_err_crew_full", { cap: crews.cap })}</Text> : null}
      {err ? <Text style={styles.warn}>{err}</Text> : null}
      {!quiz || result ? (
        <AppButton label={t(result ? "gm_ct_again" : "gm_ct_start")} icon="school-outline" disabled={busy} onPress={start} />
      ) : null}
      {busy && !quiz ? <ActivityIndicator color={colors.primary} /> : null}
      {quiz ? renderQuiz({ questions: quiz.questions, answers, setAnswer: (id, v) => setAnswers((a) => ({ ...a, [id]: v })), result }) : null}
      {quiz && !result ? (
        <AppButton
          label={t("gm_examSubmit", { done: quiz.questions.filter((q) => String(answers[q.id] ?? "").trim() !== "").length, total: quiz.questions.length })}
          icon="checkmark-done-outline"
          disabled={busy || quiz.questions.some((q) => String(answers[q.id] ?? "").trim() === "")}
          onPress={submit}
        />
      ) : null}
      {result ? <Text style={[styles.textB, { color: "#7FD18F" }]}>{t("gm_ct_got", { n: result.right, total: result.total })}</Text> : null}
    </>
  );
}

const HUD = "#0B2033D9";
const styles = StyleSheet.create({
  bg: { backgroundColor: "#0B1A2A", zIndex: 55 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 6 },
  round: { width: 34, height: 34, borderRadius: 17, backgroundColor: HUD, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFD166", fontSize: 16, fontWeight: "800", flexShrink: 0 },
  hint: { color: "#fff", fontSize: 13, backgroundColor: "#FFFFFF1A", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden", flexShrink: 1 },
  body: { flex: 1, alignItems: "flex-start" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
  legText: { color: "#FFFFFFCC", fontSize: 11 },
  sheet: { position: "absolute", backgroundColor: "#0F2236F2", borderRadius: radius.md, borderWidth: 1, borderColor: "#FFFFFF22" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { color: "#fff", fontSize: 17, fontWeight: "700", flex: 1 },
  label: { color: "#fff", fontSize: 14, fontWeight: "600" },
  textB: { color: "#fff", fontSize: 14, fontWeight: "700" },
  small: { color: "#FFFFFFBB", fontSize: 12 },
  warn: { color: colors.warning, fontSize: 13 },
  warnSm: { color: "#FFD166", fontSize: 12 },
  link: { color: "#57C4E5", fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: "#FFFFFF44", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { borderColor: "#FFD166", borderWidth: 2 },
  chipText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  crewRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pm: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#FFFFFF22", alignItems: "center", justifyContent: "center" },
  dim: { opacity: 0.35 },
  count: { color: "#fff", fontSize: 15, fontWeight: "700", minWidth: 20, textAlign: "center" },
  hire: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
});

