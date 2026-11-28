import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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
  gameMoraleStart,
  type GamePirate,
  type GameRaidMap,
  type GameState,
  type LiveLoads,
  type RaidBlock,
} from "@/lib/api";
import { BUILDING_COLOR, WAR_COLOR } from "@/screens/GameMap";
import { colors, radius, space } from "@/theme";

const BUDDY = require("../../assets/buddy/m0.png");
const GUIDE_KEY = "aiwep_live_guide_v1";
const GUIDE_STEPS = ["gm_lg_1", "gm_lg_2", "gm_lg_3"] as const;

/** 처음 출동할 때 웰디가 3장으로 알려 주는 출동 방법 (다 보면 기억, 출동 준비 화면에서 다시 볼 수 있음) */
function LiveGuide({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const last = i === GUIDE_STEPS.length - 1;
  return (
    <View style={[StyleSheet.absoluteFill, styles.guideBg]}>
      <View style={styles.guideBox}>
        <Image source={BUDDY} style={styles.guideBuddy} resizeMode="contain" />
        <View style={{ flex: 1, gap: space.sm }}>
          <Text style={styles.guideStep}>{t("gm_lg_title")} {i + 1}/{GUIDE_STEPS.length}</Text>
          <Text style={styles.guideText}>{t(GUIDE_STEPS[i])}</Text>
          <View style={{ flexDirection: "row", gap: space.sm, justifyContent: "flex-end" }}>
            {i > 0 ? <AppButton label={t("gm_lg_prev")} variant="secondary" onPress={() => setI(i - 1)} /> : null}
            <AppButton label={last ? t("gm_lg_ok") : t("gm_lg_next")} onPress={() => (last ? onDone() : setI(i + 1))} />
          </View>
        </View>
      </View>
    </View>
  );
}

const PIRATE_COLOR: Record<string, string> = { hq: "#3B2A2A", hut: "#7A5A3A" };
const SHORT: Record<string, string> = { battery: "B", missile: "M", asw: "A", radar: "R", hq: "☠", hut: "" };
const SHORT_USER: Record<string, string> = { battery: "B", missile: "M", asw: "A", radar: "R", hq: "⚑" };

export type QuizRender = (p: {
  questions: GameExamQuestion[];
  answers: Record<string, string | number>;
  setAnswer: (id: string, v: string | number) => void;
  result: { results: GameExamResult["results"] } | null;
}) => ReactNode;

/** 작전 짜기 상대: 해적 기지 단계 또는 친구 조선소 */
export type PlanTarget = {
  kind: "pirate" | "user";
  title: string;
  base: { id: number; type: string; level: number; x: number; y: number; w: number; h: number }[];
  map: GameRaidMap;
  stage?: number;
  loot?: { steel: number; rods: number };
  lootHalf?: boolean;
  block?: string | null;
  morale?: number;
  /** 상대 방어 대원 수 */
  guards?: Partial<Record<CrewKind, number>>;
};
export type PlanLaunch = {
  ships: string[];
  morale_id?: string; answers?: Record<string, string | number>;
  /** 시간차 출동 전투: 배마다 태운 대원 */
  loads: LiveLoads;
};

/** 대원을 배에 자동으로 나눠 태움: 자리 많은 배(상륙함)부터, 장비(2자리)를 먼저 */
export function autoLoad(
  ships: { id: string; room: number }[],
  crews: Partial<Record<CrewKind, number>>,
  seat: (k: CrewKind) => number,
): LiveLoads {
  const order = [...ships].sort((a, b) => b.room - a.room);
  const left = Object.fromEntries(order.map((s) => [s.id, s.room])) as Record<string, number>;
  const out: LiveLoads = {};
  const kinds = [...CREW_KINDS].sort((a, b) => seat(b) - seat(a));
  for (const k of kinds) {
    for (let n = 0; n < (crews[k] ?? 0); n++) {
      const s = order.find((x) => left[x.id] >= seat(k));
      if (!s) break;
      left[s.id] -= seat(k);
      out[s.id] = { ...out[s.id], [k]: (out[s.id]?.[k] ?? 0) + 1 };
    }
  }
  return out;
}

/**
 * 출동 준비 (전체 화면). 왼쪽: 상대 지도 미리 보기(해안선 표시). 오른쪽 창: 출격할 전투함·태울 대원(배마다 자리 수)·
 * 대원 훈련(문제 → 훈련 점수 → 대원 뽑기)·시작. 전투가 시작되면 바다를 눌러 배를 한 척씩 보낸다 (BattleReplay).
 * 친구 조선소는 시작 전에 3문제(사기)를 푼다.
 */
export function PlanScreen({
  target,
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
  target: PlanTarget;
  pirate: GamePirate;
  data: GameState;
  busy: boolean;
  error: string;
  lang: string;
  onClose: () => void;
  onLaunch: (plan: PlanLaunch) => void;
  onCrews: (c: GameCrews) => void;
  errorText: (e: unknown) => string;
  renderQuiz: QuizRender;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const st = target;
  const map = target.map;
  const user = target.kind === "user";
  const short = user ? SHORT_USER : SHORT;
  const crews = pirate.crews;
  const ships = data.fleet?.ships ?? [];
  const ready = ships.filter((f) => !f.damage && f.repair_left === undefined);
  const [pick, setPick] = useState<string[] | null>(null);
  const [send, setSend] = useState<Record<CrewKind, number>>(() => Object.fromEntries(CREW_KINDS.map((k) => [k, 0])) as Record<CrewKind, number>);
  const [view, setView] = useState<"plan" | "train" | "morale">("plan");
  const chosen = (pick ?? ready.map((f) => f.id)).filter((id) => ready.some((f) => f.id === id));
  const room = chosen.reduce((a, id) => a + (crews.capacity[ships.find((f) => f.id === id)?.kind ?? ""] ?? 0), 0);
  // 지금 싸울 수 있는 대원 (다친 대원 빼고), 장비 대원은 배에서 2자리
  const free = (k: CrewKind) => Math.max(0, (crews.have[k] ?? 0) - (crews.hurt?.[k] ?? 0));
  const seat = (k: CrewKind) => crews.specs[k]?.seats ?? 1;
  const sent = CREW_KINDS.reduce((a, k) => a + Math.min(send[k], free(k)) * seat(k), 0);
  // 처음엔 가진 대원을 배 자리만큼 미리 태워 둠 (상륙함이 빈 채로 가지 않게). 사람이 +/−를 누르면 그 뒤로는 그대로
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    const fill = Object.fromEntries(CREW_KINDS.map((k) => [k, 0])) as Record<CrewKind, number>;
    let left = room;
    for (const k of [...CREW_KINDS].sort((a, b) => seat(b) - seat(a))) {
      const n = Math.min(free(k), Math.floor(left / seat(k)));
      fill[k] = n;
      left -= n * seat(k);
    }
    setSend(fill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, crews, touched]);
  const shown = CREW_KINDS.filter((k) => (crews.have[k] ?? 0) > 0 || (crews.trainhall ?? 0) >= (crews.specs[k]?.unlock ?? 1));
  const guardText = Object.entries(target.guards ?? {}).filter(([, n]) => n).map(([k, n]) => `${t(`gm_crew_${k}`)} ${n}`).join(" · ");

  const sheetW = Math.min(360, Math.max(280, width * 0.4));
  const areaW = width - sheetW - 24 - insets.left - insets.right;
  const cell = Math.floor(Math.min(areaW / map.w, (height - 70 - insets.top - insets.bottom) / map.h));
  const W = cell * map.w, H = cell * map.h;
  const C = (o: { x: number; y: number; w: number; h: number }): [number, number] => [(o.x + o.w / 2) * cell, (o.y + o.h / 2) * cell];
  const loads = useMemo(() => {
    const c: Partial<Record<CrewKind, number>> = {};
    for (const k of CREW_KINDS) if (send[k] > 0) c[k] = Math.min(send[k], free(k));
    return autoLoad(chosen.map((id) => ({ id, room: crews.capacity[ships.find((f) => f.id === id)?.kind ?? ""] ?? 0 })), c, seat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, chosen.join(","), crews]);

  const launch = (morale?: { id: string; answers: Record<string, string | number> }) =>
    onLaunch({ ships: chosen, loads, morale_id: morale?.id, answers: morale?.answers });
  // 처음 출동이면 웰디 안내 3장을 먼저 (본 뒤에 하려던 것을 이어서)
  const [guide, setGuide] = useState<null | (() => void)>(null);
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem(GUIDE_KEY).then((v) => setSeen(v === "1")).catch(() => undefined);
  }, []);
  const withGuide = (go: () => void) => () => (seen ? go() : setGuide(() => go));
  const guideDone = () => {
    const go = guide;
    setGuide(null);
    setSeen(true);
    AsyncStorage.setItem(GUIDE_KEY, "1").catch(() => undefined);
    go?.();
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.bg]}>
      <View style={[styles.top, { paddingTop: 6 + insets.top, paddingLeft: 8 + insets.left, paddingRight: sheetW + 20 + insets.right }]}>
        <Pressable onPress={onClose} style={styles.round} hitSlop={8} accessibilityLabel={t("common_back")}>
          <Ionicons name="arrow-back" size={18} color="#fff" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{target.title}</Text>
        <Text style={styles.hint} numberOfLines={2}>
          {t(user ? "gm_lv_prepHintUser" : "gm_lv_prepHint")}
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
          {/* 해안선: 전투 중 이 앞바다를 눌러 배를 보냄 */}
          <Line x1={map.land * cell + 2} y1={0} x2={map.land * cell + 2} y2={H} stroke="#FFD166" strokeWidth={3} strokeDasharray="8 6" />
          {st.base.map((o) => {
            const [cx, cy] = C(o);
            if (o.type === "mine") return <Circle key={o.id} cx={cx} cy={cy} r={cell * 0.2} fill={BUILDING_COLOR.mine} stroke="#3A0D0A" />;
            const color = (user ? undefined : PIRATE_COLOR[o.type]) ?? BUILDING_COLOR[o.type] ?? "#999";
            return (
              <G key={o.id}>
                <Rect x={o.x * cell + 2} y={o.y * cell + 2} width={o.w * cell - 4} height={o.h * cell - 4} rx={3} fill={color}
                  stroke="#0006" strokeWidth={1} />
                {short[o.type] ? (
                  <SvgText x={cx} y={cy + cell * 0.15} fontSize={cell * (o.type === "hq" ? 0.7 : 0.42)} fill="#fff" textAnchor="middle" fontWeight="bold">
                    {short[o.type]}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
          {/* 고른 전투함 (출발 자리) */}
          {chosen.slice(0, 6).map((id, i) => {
            const off = (i - (Math.min(chosen.length, 6) - 1) / 2) * 0.8;
            const px = (map.w - 1.4) * cell, py = (map.h / 2 + off) * cell, r = cell * 0.3;
            return <Polygon key={id} points={`${px - r},${py} ${px + r * 0.8},${py - r * 0.55} ${px + r * 0.8},${py + r * 0.55}`} fill={WAR_COLOR} stroke="#fff" strokeWidth={1} opacity={0.8} />;
          })}
        </Svg>
        <View style={styles.legend}>
          <Text style={styles.legText}>┆ {t("gm_lv_legCoast")}</Text>
          <Text style={styles.legText}>{user ? `⚑ ${t("gm_b_hq")}` : `☠ ${t("gm_bt_hq")}`}  B {t("gm_b_battery")}  M {t("gm_b_missile")}</Text>
        </View>
      </View>

      <View style={[styles.sheet, { width: sheetW, top: 8 + insets.top, bottom: 8 + insets.bottom, right: 8 + insets.right }]}>
        <ScrollView contentContainerStyle={{ gap: space.sm, padding: space.sm }}>
          {view === "train" ? (
            <CrewTrain crews={crews} lang={lang} onCrews={onCrews} onBack={() => setView("plan")} errorText={errorText} renderQuiz={renderQuiz} />
          ) : view === "morale" ? (
            <MoraleQuiz lang={lang} busy={busy} error={error} onBack={() => setView("plan")} errorText={errorText} renderQuiz={renderQuiz}
              onGo={(id, answers) => launch({ id, answers })} />
          ) : (
            <>
              <Text style={styles.small}>{t("gm_lv_rule")}</Text>
              <Pressable onPress={() => setGuide(() => () => undefined)} hitSlop={6}>
                <Text style={styles.link}>{t("gm_lg_again")}</Text>
              </Pressable>
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
                <Text style={styles.small}>{t("gm_ct_rally", { u: crews.rally?.used ?? 0, c: crews.rally?.cap ?? 0 }).split(" (")[0]}</Text>
              </View>
              {shown.map((k) => {
                const full = send[k] >= free(k) || sent + seat(k) > room;
                return (
                  <View key={k} style={styles.crewRow}>
                    <CrewFigure kind={k} size={26} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.textB}>
                        {t(`gm_crew_${k}`)} <Text style={styles.small}>×{free(k)}</Text>
                        {crews.hurt?.[k] ? <Text style={styles.warnSm}> {t("gm_ct_hurtN", { n: crews.hurt[k] })}</Text> : null}
                      </Text>
                      <Text style={styles.small} numberOfLines={1}>
                        {seat(k) > 1 ? `${t("gm_ct_seats", { n: seat(k) })} · ` : ""}{t(`gm_crew_${k}_role`)}
                      </Text>
                    </View>
                    <Pressable disabled={send[k] <= 0} onPress={() => { setTouched(true); setSend((s) => ({ ...s, [k]: s[k] - 1 })); }} style={[styles.pm, send[k] <= 0 && styles.dim]}>
                      <Ionicons name="remove" size={16} color="#fff" />
                    </Pressable>
                    <Text style={styles.count}>{Math.min(send[k], free(k))}</Text>
                    <Pressable disabled={full} onPress={() => { setTouched(true); setSend((s) => ({ ...s, [k]: s[k] + 1 })); }} style={[styles.pm, full && styles.dim]}>
                      <Ionicons name="add" size={16} color="#fff" />
                    </Pressable>
                  </View>
                );
              })}
              {Object.keys(loads).length ? (
                <Text style={styles.small}>
                  {chosen.filter((id) => loads[id]).map((id) => {
                    const f = ships.find((x) => x.id === id)!;
                    const list = CREW_KINDS.filter((k) => loads[id]?.[k]).map((k) => `${t(`gm_crew_${k}`)} ${loads[id]![k]}`).join(", ");
                    return `${t("gm_fleetShip", { ship: t(`gm_ship_${f.kind}`), no: f.no })}: ${list}`;
                  }).join("\n")}
                </Text>
              ) : null}
              {guardText ? <Text style={styles.small}>{t("gm_ct_enemyGuards", { list: guardText })}</Text> : null}
              {room === 0 && chosen.length ? <Text style={styles.warnSm}>{t("gm_pl_noRoom")}</Text> : null}
              <AppButton label={t("gm_pl_train", { pts: crews.pts })} icon="school-outline" variant="secondary" onPress={() => setView("train")} />
              {user && target.loot ? (
                <Text style={styles.small}>
                  {t("gm_rd_loot", { steel: target.loot.steel, rods: target.loot.rods })}
                  {target.lootHalf ? ` ${t("gm_sc_lootHalf")}` : ""}
                </Text>
              ) : null}
              {user && target.block ? <Text style={styles.warn}>{t(`gm_rd_block_${target.block as RaidBlock}`)}</Text> : null}
              {error ? <Text style={styles.warn}>{error}</Text> : null}
              {user ? (
                <AppButton label={t("gm_rd_toMorale", { n: target.morale ?? 3 })} icon="school-outline"
                  disabled={busy || chosen.length === 0 || !!target.block} onPress={withGuide(() => setView("morale"))} />
              ) : (
                <AppButton label={t("gm_lv_start")} icon="flag-outline" disabled={busy || chosen.length === 0} onPress={withGuide(() => launch())} />
              )}
            </>
          )}
        </ScrollView>
      </View>
      {guide ? <LiveGuide onDone={guideDone} /> : null}
    </View>
  );
}

/** 친구 조선소 출동 전 3문제: 맞힌 만큼 사기(0.8~1.2배) → [출동!] 하면 서버가 채점하고 바로 전투 */
function MoraleQuiz({
  lang,
  busy,
  error,
  onBack,
  onGo,
  errorText,
  renderQuiz,
}: {
  lang: string;
  busy: boolean;
  error: string;
  onBack: () => void;
  onGo: (id: string, answers: Record<string, string | number>) => void;
  errorText: (e: unknown) => string;
  renderQuiz: QuizRender;
}) {
  const { t } = useTranslation();
  const [quiz, setQuiz] = useState<{ id: string; questions: GameExamQuestion[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    gameMoraleStart(lang)
      .then((q) => live && setQuiz(q))
      .catch((e) => live && setErr(errorText(e)));
    return () => {
      live = false;
    };
  }, [lang, errorText]);
  const done = quiz ? quiz.questions.filter((q) => String(answers[q.id] ?? "").trim() !== "").length : 0;
  return (
    <>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{t("gm_rd_moraleTitle")}</Text>
        <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t("common_back")}>
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      </View>
      <Text style={styles.small}>{t("gm_rd_moraleRule")}</Text>
      {err ? <Text style={styles.warn}>{err}</Text> : null}
      {!quiz && !err ? <ActivityIndicator color={colors.primary} /> : null}
      {quiz ? renderQuiz({ questions: quiz.questions, answers, setAnswer: (id, v) => setAnswers((a) => ({ ...a, [id]: v })), result: null }) : null}
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      {quiz ? (
        <AppButton label={t("gm_rd_go", { done, total: quiz.questions.length })} icon="flag-outline"
          disabled={busy || done < quiz.questions.length} onPress={() => onGo(quiz.id, answers)} />
      ) : null}
    </>
  );
}

/** 대원 훈련: 문제 3개 → 맞힌 수 = 훈련 점수 → 점수로 대원 뽑기 */
export function CrewTrain({
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
  // 뽑을 수 없을 때는 단추를 막지 않고, 누르면 그 줄 아래에 이유를 보여 줌 (박사 요청 2026-11-28)
  const hall = crews.trainhall ?? 0;
  const [why, setWhy] = useState<{ k: CrewKind; text: string } | null>(null);
  const whyNot = (k: CrewKind): string | null => {
    const sp = crews.specs[k];
    const r = crews.rally;
    if (hall < sp.unlock) return t("gm_ct_locked", { n: sp.unlock });
    if (!r || r.cap < 1) return t("gm_err_need_rally");
    if (r.used + sp.seats > r.cap) return t("gm_ct_whyFull", { u: r.used, c: r.cap, s: sp.seats });
    if (crews.pts < sp.cost) return t("gm_err_crew_pts", { have: crews.pts, need: sp.cost });
    return null;
  };
  const hire = async (k: CrewKind) => {
    const no = whyNot(k);
    setWhy(no ? { k, text: no } : null);
    if (no) return;
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
  return (
    <>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{t("gm_ct_title")}</Text>
        <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t("common_back")}>
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      </View>
      <Text style={styles.small}>{t("gm_ct_rule", { n: crews.quiz })}</Text>
      {/* 훈련 점수: 크게·노란색, 지금 몇 명 뽑을 수 있는지 바로 보이게 (박사 요청 2026-11-28) */}
      <View style={styles.ptsBox}>
        <Text style={styles.ptsBig}>{t("gm_ct_ptsBig", { n: crews.pts })}</Text>
        <Text style={styles.ptsSub}>{t("gm_ct_ptsCan", { n: Math.floor(crews.pts / (crews.specs.welder?.cost || 1)) })}</Text>
        <Text style={styles.small}>
          {t("gm_ct_rally", { u: crews.rally?.used ?? 0, c: crews.rally?.cap ?? 0 })}
        </Text>
      </View>
      {result ? <Text style={[styles.textB, { color: "#FFD166" }]}>{t("gm_ct_got", { n: result.right, total: result.total })}</Text> : null}
      {!quiz || result ? (
        <AppButton label={t(result ? "gm_ct_again" : "gm_ct_start")} icon="school-outline" disabled={busy || hall < 1} onPress={start} />
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
      <Text style={styles.textB}>{t("gm_ct_listTitle")}</Text>
      {hall < 1 ? <Text style={styles.warnSm}>{t("gm_ct_needHall")}</Text> : null}
      {CREW_KINDS.map((k) => {
        const sp = crews.specs[k];
        const locked = hall < sp.unlock;
        const noHome = (crews.rally?.cap ?? 0) < 1;
        const off = !!whyNot(k);
        return (
          <View key={k}>
          <View style={[styles.crewRow, locked && { opacity: 0.55 }]}>
            <CrewFigure kind={k} size={26} />
            <View style={{ flex: 1 }}>
              <Text style={styles.textB}>
                {t(`gm_crew_${k}`)} <Text style={styles.small}>{t("gm_ct_have", { n: crews.have[k] ?? 0 })}{crews.hurt?.[k] ? ` · ${t("gm_ct_hurtN", { n: crews.hurt[k] })}` : ""}</Text>
              </Text>
              <Text style={styles.small} numberOfLines={2}>
                {locked
                  ? t("gm_ct_locked", { n: sp.unlock })
                  : noHome
                    ? t("gm_ct_need_rally")
                    : `${t(sp.seats > 1 ? "gm_ct_seat2" : "gm_ct_seat1")} · ${t(`gm_crew_${k}_role`)}`}
              </Text>
            </View>
            <Pressable disabled={busy} onPress={() => hire(k)} style={[styles.hire, off && styles.dim]}>
              <Text style={styles.chipText}>{t("gm_ct_hireBtn", { n: sp.cost })}</Text>
            </Pressable>
          </View>
          {why?.k === k ? <Text style={styles.warnSm}>{why.text}</Text> : null}
          </View>
        );
      })}
      {err ? <Text style={styles.warn}>{err}</Text> : null}
    </>
  );
}

const HUD = "#0B2033D9";
const styles = StyleSheet.create({
  ptsBox: { backgroundColor: "#FFD16622", borderColor: "#FFD166", borderWidth: 1.5, borderRadius: radius.md, padding: space.sm, gap: 2, alignItems: "center" },
  ptsBig: { color: "#FFD166", fontSize: 26, fontWeight: "900" },
  ptsSub: { color: "#fff", fontSize: 14, fontWeight: "700" },
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
  guideBg: { backgroundColor: "#000000AA", alignItems: "center", justifyContent: "center", padding: space.lg },
  guideBox: { flexDirection: "row", gap: space.md, backgroundColor: "#0B2033", borderRadius: radius.lg, borderWidth: 1,
    borderColor: "#FFD166", padding: space.md, maxWidth: 520, width: "100%", alignItems: "center" },
  guideBuddy: { width: 70, height: 106 },
  guideStep: { color: "#FFD166", fontWeight: "bold", fontSize: 13 },
  guideText: { color: "#fff", fontSize: 15, lineHeight: 22 },
  crewRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pm: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#FFFFFF22", alignItems: "center", justifyContent: "center" },
  dim: { opacity: 0.35 },
  count: { color: "#fff", fontSize: 15, fontWeight: "700", minWidth: 20, textAlign: "center" },
  hire: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
});

