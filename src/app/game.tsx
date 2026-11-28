import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { StudyBuddy } from "@/components/StudyBuddy";
import { AppButton, Body, Card } from "@/components/ui";
import {
  gameBuild,
  gameWallsBuild,
  gameCollect,
  gameExamStart,
  gamePirateAttack,
  gameRepair,
  gameTyphoonStart,
  gameTyphoonSubmit,
  getBattle,
  getPirate,
  gameGiftsSeen,
  gameSupplyStart,
  gameSupplySubmit,
  gameExamSubmit,
  gameMove,
  gameReclaim,
  gameShipNext,
  gameShipStart,
  gameSpeedup,
  gameTutorial,
  gameUpgrade,
  gameWallsUpgrade,
  gameWarshipFit,
  gameWarshipHull,
  gameWeaponResearch,
  gameWeaponUpgrade,
  getGame,
  NetworkError,
  type GameBuilding,
  type GameBuildingType,
  type GameCost,
  type GameExam,
  type GameExamResult,
  type GameExamQuestion,
  type GameSupply,
  type GameSupplyResult,
  type GameShipKind,
  type GameWarKind,
  type GameState,
  type GameTip,
  type GameWeaponKind,
  type GameBattle,
  type GameLane,
  type RaidPlan,
  type GamePirate,
  type GameDefenseLog,
  type GameDefenseRow,
  type GameRaidTarget,
  getDefense,
  getRaidTarget,
  gameDefenseSeen,
  gameRaidAttack,
  type GameTyphoon,
  type GameTyphoonResult,
} from "@/lib/api";
import { BattleReplay } from "@/components/BattleReplay";
import { PanZoom } from "@/components/PanZoom";
import { SeaMap } from "@/components/SeaMap";
import { CrewTrain, PlanScreen, type PlanLaunch } from "@/components/PlanScreen";
import { DefenseLog } from "@/components/DefenseLog";
import { giftLine } from "@/components/LiveOxPopup";
import { autoSpot, BUILDING_COLOR, canPlace, cellAt, cellBox, centerOf, GameMap, mapSize, RES_COLOR, WAR_COLOR, type PlaceRule } from "@/screens/GameMap";
import { colors, radius, space } from "@/theme";

type Mode = "home" | "build" | "place" | "ship" | "earn" | "exam" | "supply" | "arms" | "battle" | "typhoon";
// 지도 빈 곳을 눌러도 닫지 않는 창: 문제 푸는 창(적던 답 보호)과 놓기 모드
const STAY_OPEN_MODES: Mode[] = ["exam", "supply", "typhoon", "place"];
type ResKey = "steel" | "rods" | "tech" | "passes" | "fame";
const TYPES: GameBuildingType[] = ["hq", "yard", "rodstore", "cutting", "welding", "academy", "dock", "pier", "battery", "missile", "mine", "asw", "radar", "wall", "trainhall", "dorm", "garage"];
const STAGES = 5;
const WAR_KINDS = ["patrol", "frigate", "destroyer", "submarine", "landing"];
/** 공정 이름 (전투함은 마지막 공정이 '인도' 대신 '취역') */
const stageKey = (i: number, war?: boolean) => (war && i === STAGES - 1 ? "gm_stage_4w" : `gm_stage_${i}`);

/** 남은 초 → "1:05:03" / "4:09" */
export function clock(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

function gameError(t: TFunction, e: unknown) {
  if (e instanceof NetworkError) {
    const code = e.detail?.code;
    if (code) {
      const key = `gm_err_${code}`;
      const msg = t(key, e.detail as Record<string, unknown>);
      if (msg !== key) return msg;
    }
    if (!e.status) return t("gm_err_network");
    if (e.status === 404) return t("gm_err_old_server");
  }
  return t("gm_err_other");
}

/** G1 웰디의 조선소: 내 조선소 (공부로 받은 자원으로 짓고 올리고 배를 만든다) */
export default function GameScreen() {
  const { t, i18n } = useTranslation();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [party, setParty] = useState<GameState["delivered_now"] | null>(null);
  const [info, setInfo] = useState<ResKey | null>(null);
  const [exam, setExam] = useState<GameExam | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [examRes, setExamRes] = useState<GameExamResult | null>(null);
  const [examErr, setExamErr] = useState("");
  const [supply, setSupply] = useState<GameSupply | null>(null);
  const [supplyRes, setSupplyRes] = useState<GameSupplyResult | null>(null);
  const [supplyUnit, setSupplyUnit] = useState("");
  const [pirate, setPirate] = useState<GamePirate | null>(null);
  const [trainOpen, setTrainOpen] = useState(false);   // 기술교육원: 대원 훈련 창
  const [seaOpen, setSeaOpen] = useState(false);       // G2c-1 바다 지도 (전체 화면)
  const [battleStage, setBattleStage] = useState<number | null>(null);   // 바다 지도에서 고른 해적 단계
  const [planStage, setPlanStage] = useState<number | null>(null);       // G2c-2 작전 짜기 (전체 화면)
  const [battle, setBattle] = useState<GameBattle | null>(null);
  const [battleDef, setBattleDef] = useState(false);                     // 다시 보기가 내 조선소 방어 전투인지
  // G2c-3 친구 조선소 공격·방어 기록
  const [raidId, setRaidId] = useState<string | null>(null);
  const [raid, setRaid] = useState<{ target: GameRaidTarget; revenge?: string } | null>(null);
  const [defense, setDefense] = useState<GameDefenseLog | null>(null);
  const [defOpen, setDefOpen] = useState(false);
  const [defNotice, setDefNotice] = useState(false);
  const [typhoon, setTyphoon] = useState<GameTyphoon | null>(null);
  const [typhoonRes, setTyphoonRes] = useState<GameTyphoonResult | null>(null);
  const [data, setData] = useState<GameState | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("home");
  const [selected, setSelected] = useState<string | null>(null);
  const [placeType, setPlaceType] = useState<GameBuildingType | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [pick, setPick] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [shipTab, setShipTab] = useState<"merchant" | "war">("merchant");
  const [tipAt, setTipAt] = useState(0);
  const [rewards, setRewards] = useState<GameState["rewards"]>(null);
  const [names, setNames] = useState(false);          // 모든 건물 이름표 보기 (기본: 고른 건물만)
  const [detail, setDetail] = useState(false);        // 고른 건물 자세한 창 (기본: 아래 단추 줄만)
  const [trayOpen, setTrayOpen] = useState(true);     // 아래 왼쪽 서랍
  const [weldyBig, setWeldyBig] = useState(false);    // 웰디 말풍선 크게
  const [focus, setFocus] = useState<{ x: number; y: number; n: number } | null>(null);
  const [, setTick] = useState(0);
  const fetchedAt = useRef(Date.now());
  const grabOff = useRef({ x: 0, y: 0 });   // 놓을 건물을 끌 때 잡은 곳과 건물 귀퉁이 거리
  const reloading = useRef(false);
  // 지도를 끄는 중이거나 막 끝낸 직후의 '톡'은 건물 고르기·자리 고르기로 보지 않음
  const moving = useRef({ on: false, at: 0 });
  const tapOk = () => !moving.current.on && Date.now() - moving.current.at > 250;
  // 방파 장벽: 누른 칸은 화면에 바로 놓고, 손을 멈추면(0.8초) 모아서 한 번에 서버로 (칸마다 기다리지 않게)
  const [wallQ, setWallQ] = useState<{ x: number; y: number }[]>([]);
  const wallQRef = useRef<{ x: number; y: number }[]>([]);
  const wallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wallSending = useRef(false);
  const flushRef = useRef<() => void>(() => {});

  const apply = useCallback((d: GameState) => {
    fetchedAt.current = Date.now();
    setData(d);
    setError("");
  }, []);

  const flushWalls = useCallback(async () => {
    if (wallTimer.current) {
      clearTimeout(wallTimer.current);
      wallTimer.current = null;
    }
    const spots = wallQRef.current;
    if (!spots.length) return;
    if (wallSending.current) {
      wallTimer.current = setTimeout(() => flushRef.current(), 300);
      return;
    }
    wallSending.current = true;
    try {
      const d = await gameWallsBuild(spots.map((p) => [p.x, p.y]));
      apply(d);
      if (d.skipped) setMsg(t("gm_wallSkipped", { n: d.skipped }));
    } catch (e) {
      setMsg(gameError(t, e));
    } finally {
      const sent = new Set(spots.map((p) => `${p.x},${p.y}`));
      wallQRef.current = wallQRef.current.filter((p) => !sent.has(`${p.x},${p.y}`));
      setWallQ(wallQRef.current);
      wallSending.current = false;
      if (wallQRef.current.length && !wallTimer.current) wallTimer.current = setTimeout(() => flushRef.current(), 300);
    }
  }, [apply, t]);
  flushRef.current = flushWalls;
  // 장벽 놓기를 끝내면 남은 칸 바로 보내기
  useEffect(() => {
    if (mode !== "place") flushRef.current();
  }, [mode]);

  const load = useCallback(() => {
    getGame(i18n.language)
      .then((d) => {
        apply(d);
        if (d.rewards) setRewards(d.rewards);
      })
      .catch((e) => setError(gameError(t, e)))
      .finally(() => {
        reloading.current = false;
      });
  }, [i18n.language, t, apply]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // 게임 화면은 가로로 (나가면 다시 세로)
  useFocusEffect(
    useCallback(() => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => null);
      return () => {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => null);
      };
    }, []),
  );

  // 알림은 5초 뒤 저절로 사라짐
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(""), 5000);
    return () => clearTimeout(id);
  }, [msg]);
  useEffect(() => {
    if (!rewards) return;
    const id = setTimeout(() => setRewards(null), 7000);
    return () => clearTimeout(id);
  }, [rewards]);

  // 1초마다 남은 시간 다시 그림, 끝난 공사가 있으면 서버에서 다시 받기
  useEffect(() => {
    const id = setInterval(() => {
      setTick((n) => n + 1);
      if (!data || reloading.current) return;
      const gone = (Date.now() - fetchedAt.current) / 1000;
      const due =
        data.buildings.some((b) => b.left !== undefined && b.left - gone <= 0) ||
        (data.ship && !data.ship.ready && (data.ship.stage_left ?? data.ship.left) - gone <= 0) ||
        (data.reclaim?.left !== undefined && data.reclaim.left - gone <= 0);
      if (due) {
        reloading.current = true;
        load();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [data, load]);

  const run = async (fn: () => Promise<GameState>, after?: (d: GameState) => void) => {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const d = await fn();
      apply(d);
      after?.(d);
    } catch (e) {
      setMsg(gameError(t, e));
    } finally {
      setBusy(false);
    }
  };

  const gone = () => (Date.now() - fetchedAt.current) / 1000;
  const leftOf = (b: GameBuilding) => (b.left !== undefined ? Math.max(0, b.left - gone()) : null);
  const labels = useMemo(() => Object.fromEntries(TYPES.map((k) => [k, t(`gm_short_${k}`)])), [t]);
  const name = (k: string) => t(`gm_b_${k}`);

  // 바다 지도 오류 문구 (훅이라 아래 "불러오는 중" return 보다 먼저)
  const seaError = useCallback((e: unknown) => gameError(t, e), [t]);
  // G2c-3 방어 기록 (훅이라 아래 "불러오는 중" return 보다 먼저)
  const loadDefense = useCallback(async (notice: boolean) => {
    try {
      const d = await getDefense();
      setDefense(d);
      if (notice && d.unseen) setDefNotice(true);
    } catch {
      /* 방어 기록은 없어도 게임은 됨 */
    }
  }, []);
  // 다음에 앱을 열면 웰디가 공격받은 일을 알려 줌
  useEffect(() => {
    loadDefense(true);
  }, [loadDefense]);

  if (!data) {
    return (
      <View style={[styles.full, styles.center]}>
        <StatusBar hidden />
        <Pressable onPress={() => router.back()} style={[styles.round, { position: "absolute", top: 12 + insets.top, left: 12 + insets.left }]} hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        {error ? (
          <View style={{ gap: space.md, alignItems: "center", maxWidth: 420, padding: space.lg }}>
            <Body>{error}</Body>
            <AppButton label={t("gm_retry")} icon="refresh-outline" onPress={load} />
          </View>
        ) : (
          <View style={{ gap: space.md, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
            <Body muted>{t("gm_loading")}</Body>
          </View>
        )}
      </View>
    );
  }

  const sea = data.sea ?? 2;
  const fitW = Math.floor(Math.min(width / (data.grid + sea + 0.6), height / (data.grid / 2 + 3.6)));
  const W = Math.max(8, fitW * zoom);
  const mapDim = mapSize(data.grid, W, sea);
  const sel = data.buildings.find((b) => b.id === selected) ?? null;
  const wallCat = data.catalog.find((k) => k.type === "wall");
  // 아직 서버로 안 보낸 장벽 칸만큼 미리 빼서 보여 줌
  const res = wallQ.length && wallCat
    ? { ...data.resources, steel: data.resources.steel - wallCat.cost.steel * wallQ.length, rods: data.resources.rods - wallCat.cost.rods * wallQ.length }
    : data.resources;
  const mapBuildings: GameBuilding[] = wallQ.length
    ? [...data.buildings, ...wallQ.map((p) => ({ id: `q${p.x}_${p.y}`, type: "wall" as const, level: 1, x: p.x, y: p.y, w: 1, h: 1, fixed: false,
        busy_until: null, pending: 0, just_done: false, block: null, sea: true, instant: true }))]
    : data.buildings;
  const queueWall = (x: number, y: number) => {
    const q = wallQRef.current;
    if (q.some((p) => p.x === x && p.y === y)) return;
    if (wallCat && (wallCat.have ?? 0) + q.length >= (wallCat.max ?? 0)) {
      setMsg(t("gm_err_def_full", { n: wallCat.max ?? 0 }));
      return;
    }
    if (wallCat && (res.steel < wallCat.cost.steel || res.rods < wallCat.cost.rods)) {
      setMsg(t("gm_err_money"));
      return;
    }
    wallQRef.current = [...q, { x, y }];
    setWallQ(wallQRef.current);
    if (wallTimer.current) clearTimeout(wallTimer.current);
    wallTimer.current = setTimeout(() => flushRef.current(), 800);
  };
  const tut = data.tutorial;
  const tutStep = !tut.done && tut.step !== null ? tut.steps[tut.step].id : null;
  const tips = data.tips;
  const tip = tips[tipAt % tips.length];

  const canPay = (c: GameCost) => res.steel >= c.steel && res.rods >= c.rods;
  const ruleOf = (type: GameBuildingType, mv: GameBuilding | null): PlaceRule => {
    const cat = data.catalog.find((c) => c.type === type);
    return { w: mv?.w ?? cat?.w ?? 2, h: mv?.h ?? cat?.h ?? 2, coast: !!(mv?.coast ?? cat?.coast), sea: !!(mv?.sea ?? cat?.sea), skipId: mv?.id };
  };
  // 짓기: 빈 적당한 자리(본관 가까이)에 먼저 놓아 두고, 끌거나 다른 초록 칸을 눌러 옮김 (박사 요청 2026-11-28)
  const startPlace = (type: GameBuildingType) => {
    setPlaceType(type);
    setMoveId(null);
    const tutPick = tutStep === "yard" && tut.spot ? tut.spot : null;
    setPick(type === "wall" ? null : tutPick ?? autoSpot(data.buildings, ruleOf(type, null), data.grid, sea));
    setSelected(null);
    setMode("place");
  };
  const startMove = (b: GameBuilding) => {
    setMoveId(b.id);
    setPlaceType(b.type);
    setPick({ x: b.x, y: b.y });
    setMode("place");
  };
  // 놓을 건물 미리보기를 손가락으로 끌기: 잡은 곳과 건물 귀퉁이 거리만큼 띄워서 따라감, 놓을 수 있는 칸에만
  const onGrab = (phase: "start" | "move" | "end", px: number, py: number) => {
    if (!pick || !placeType) return;
    const c = cellAt(px, py, data.grid, W);
    if (phase === "start") {
      grabOff.current = { x: c.x - pick.x, y: c.y - pick.y };
      return;
    }
    const fx = c.x - grabOff.current.x, fy = c.y - grabOff.current.y;
    const rule = ruleOf(placeType, moveId ? data.buildings.find((b) => b.id === moveId) ?? null : null);
    // 손가락 아래 칸이 막혔으면 가까운(2칸 안) 놓을 수 있는 칸으로
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = Math.round(fx) + dx, y = Math.round(fy) + dy;
        const d = (x - fx) ** 2 + (y - fy) ** 2;
        if ((!best || d < best.d) && canPlace(data.buildings, rule, data.grid, sea, x, y)) best = { x, y, d };
      }
    if (best && (best.x !== pick.x || best.y !== pick.y)) setPick({ x: best.x, y: best.y });
  };
  const placeSpec = (() => {
    if (mode !== "place" || !placeType) return null;
    const mv = moveId ? data.buildings.find((b) => b.id === moveId) : null;
    const cat = data.catalog.find((c) => c.type === placeType);
    const w = mv?.w ?? cat?.w ?? 2;
    const h = mv?.h ?? cat?.h ?? 2;
    const coast = !!(mv?.coast ?? cat?.coast);
    const sea = !!(mv?.sea ?? cat?.sea);
    return { w, h, coast, sea, skipId: moveId ?? undefined, hint: !moveId && tutStep === "yard" ? tut.spot : null, pick, color: BUILDING_COLOR[placeType] };
  })();

  const confirmPlace = () => {
    if (!pick || !placeType) return;
    if (moveId) run(() => gameMove(moveId, pick.x, pick.y), () => {
      setMode("home");
      setSelected(moveId);
    });
    else run(() => gameBuild(placeType, pick.x, pick.y), () => setMode("home"));
  };

  const doCollect = () =>
    run(gameCollect, (d) => {
      const c = d.collected;
      if (!c) return;
      if (d.collect_gift) setMsg(t("gm_collectGift", { steel: c.steel, rods: c.rods }));
      else if (c.steel + c.rods > 0) setMsg(t("gm_collected", { steel: c.steel, rods: c.rods }));
      else setMsg(d.run_today ? t("gm_collectedNoneRun") : t("gm_collectedNoneOff"));
    });

  const shipNext = () =>
    run(gameShipNext, (d) => {
      if (d.delivered_now) setParty(d.delivered_now);
      const c = d.commissioned_now;
      if (c) setMsg(t("gm_commissioned", { ship: t(`gm_ship_${c.kind}`), no: c.no, n: c.count, cap: c.cap }));
    });
  const openWar = () => {
    setSelected(null);
    setShipTab("war");
    setMode("ship");
  };
  const rc = data.reclaim;

  // 본관 승급 시험
  const hqB = data.buildings.find((b) => b.type === "hq") ?? null;
  const openExam = async () => {
    setSelected(null);
    setMode("exam");
    setExam(null);
    setExamRes(null);
    setAnswers({});
    setExamErr("");
    setBusy(true);
    try {
      setExam(await gameExamStart(i18n.language));
    } catch (e) {
      setExamErr(gameError(t, e));
    } finally {
      setBusy(false);
    }
  };
  const submitExam = async () => {
    if (!exam || busy) return;
    setBusy(true);
    setExamErr("");
    try {
      const r = await gameExamSubmit(exam.id, answers);
      setExamRes(r);
      apply(r.state);
    } catch (e) {
      setExamErr(gameError(t, e));
    } finally {
      setBusy(false);
    }
  };
  const closeExam = () => {
    setMode("home");
    setExam(null);
    setExamRes(null);
  };

  // 자재 조달: 문제 풀어 강판·용접봉 벌기
  const openSupply = async (unit = "") => {
    setSupplyUnit(unit);
    setSelected(null);
    setInfo(null);
    setMode("supply");
    setSupply(null);
    setSupplyRes(null);
    setAnswers({});
    setExamErr("");
    setBusy(true);
    try {
      setSupply(await gameSupplyStart(i18n.language, unit));
    } catch (e) {
      setExamErr(gameError(t, e));
    } finally {
      setBusy(false);
    }
  };
  const submitSupply = async () => {
    if (!supply || busy) return;
    setBusy(true);
    setExamErr("");
    try {
      const r = await gameSupplySubmit(supply.id, answers);
      setSupplyRes(r);
      apply(r.state);
    } catch (e) {
      setExamErr(gameError(t, e));
    } finally {
      setBusy(false);
    }
  };

  // 해적 연습 전투 (G2b-2)
  const openBattle = async () => {
    setSelected(null);
    setInfo(null);
    setMode("battle");
    setExamErr("");
    try {
      setPirate(await getPirate());
    } catch (e) {
      setExamErr(gameError(t, e));
    }
  };
  // 기술교육원: 대원 훈련 (문제로 훈련 점수 → 바로 대원 고용)
  const openTrain = async () => {
    setSelected(null);
    setExamErr("");
    setTrainOpen(true);
    try {
      setPirate(await getPirate());
    } catch (e) {
      setExamErr(gameError(t, e));
    }
  };
  // G2c-2 작전 짜기: 해적 기지 지도를 눌러 바닷길·상륙 부두·목표 순서를 정하고 대원을 태워 출격
  const openPlan = async (stage: number) => {
    setSeaOpen(false);
    setSelected(null);
    setInfo(null);
    setMode("home");
    setExamErr("");
    setPlanStage(stage);
    try {
      setPirate(await getPirate());
    } catch (e) {
      setExamErr(gameError(t, e));
    }
  };
  const attack = async (plan: RaidPlan) => {
    if (busy) return;
    setBusy(true);
    setExamErr("");
    try {
      const r = await gamePirateAttack(plan);
      apply(r.state);
      setBattle(r.battle);
      setPirate(await getPirate());
    } catch (e) {
      setExamErr(gameError(t, e));
    } finally {
      setBusy(false);
    }
  };
  const replay = async (id: string, def = false) => {
    try {
      const b = (await getBattle(id)).battle;
      setBattleDef(def);
      setBattle(b);
    } catch (e) {
      setExamErr(gameError(t, e));
      setMsg(gameError(t, e));
    }
  };
  // 작전 짜기(해적) → 출격
  const planAttack = (p: PlanLaunch) => {
    if (!planStage) return;
    attack({ stage: planStage, ships: p.ships, lane: p.lane, target: "defense", landing: p.landing, order: p.order, crews: p.crews });
  };
  // G2c-3 친구 조선소: 작전 짜기 열기 (정찰 창·방어 기록의 복수하기)
  const openRaid = async (id: string, revenge?: string) => {
    setSeaOpen(false);
    setDefOpen(false);
    setSelected(null);
    setInfo(null);
    setMode("home");
    setExamErr("");
    setRaid(null);
    setRaidId(id);
    try {
      const [tg, pr] = await Promise.all([getRaidTarget(id), getPirate()]);
      setPirate(pr);
      setRaid({ target: tg, revenge });
    } catch (e) {
      setExamErr(gameError(t, e));
    }
  };
  const closeRaid = () => {
    setRaid(null);
    setRaidId(null);
  };
  const raidAttack = async (p: PlanLaunch) => {
    if (busy || !raid || !p.morale_id) return;
    setBusy(true);
    setExamErr("");
    try {
      const r = await gameRaidAttack({ target: raid.target.id, ships: p.ships, lane: p.lane, landing: p.landing, order: p.order,
        crews: p.crews, morale_id: p.morale_id, answers: p.answers ?? {}, revenge: raid.revenge ?? null });
      apply(r.state);
      setBattleDef(false);
      setBattle(r.battle);
      closeRaid();
      getPirate().then(setPirate).catch(() => undefined);
    } catch (e) {
      setExamErr(gameError(t, e));
    } finally {
      setBusy(false);
    }
  };
  const openDefense = async () => {
    setDefNotice(false);
    setDefOpen(true);
    await loadDefense(false);
    gameDefenseSeen().catch(() => undefined);
  };
  const closeNotice = () => {
    setDefNotice(false);
    setDefense((d) => (d ? { ...d, unseen: 0, log: d.log.map((r) => ({ ...r, seen: true })) } : d));
    gameDefenseSeen().catch(() => undefined);
  };
  const revenge = (row: GameDefenseRow) => openRaid(row.by_id, row.id);
  const openTyphoon = async () => {
    setMode("typhoon");
    setTyphoon(null);
    setTyphoonRes(null);
    setAnswers({});
    setExamErr("");
    setBusy(true);
    try {
      setTyphoon(await gameTyphoonStart(i18n.language));
    } catch (e) {
      setExamErr(gameError(t, e));
    } finally {
      setBusy(false);
    }
  };
  const submitTyphoon = async () => {
    if (!typhoon || busy) return;
    setBusy(true);
    setExamErr("");
    try {
      const r = await gameTyphoonSubmit(typhoon.id, answers);
      setTyphoonRes(r);
      apply(r.state);
    } catch (e) {
      setExamErr(gameError(t, e));
    } finally {
      setBusy(false);
    }
  };

  // 자원 칩을 누르면: 무엇인지·어떻게 얻는지·어디에 쓰는지 (+ 쓸 곳으로 가기)
  const busyB = data.buildings.find((b) => b.busy_until) ?? null;
  const shipBusy = data.ship && !data.ship.ready ? data.ship : null;
  const infoAction = (k: ResKey): { label: string; onPress: () => void } | null => {
    if (k === "tech" || k === "passes") {
      if (busyB) return { label: t("gm_infoUseOn", { name: name(busyB.type) }), onPress: () => { setInfo(null); setMode("home"); setSelected(busyB.id); } };
      if (shipBusy) return { label: t("gm_infoUseOn", { name: t(`gm_ship_${shipBusy.kind}`) }), onPress: () => { setInfo(null); setSelected(null); setMode("ship"); } };
      if (rc?.left !== undefined) return { label: t("gm_infoUseOn", { name: t("gm_reclaim") }), onPress: () => { setInfo(null); setSelected(null); setMode("build"); } };
      return null;
    }
    if (k === "steel" || k === "rods") return { label: t("gm_supplyGo"), onPress: () => openSupply() };
    return null;
  };

  // 웰디가 하는 말 (처음 따라 하기 중이면 그 단계, 아니면 오늘의 할 일)
  const tipText = (x: GameTip) => {
    const p: Record<string, string | number> = { ...x };
    if (typeof x.type === "string") p.name = name(x.type);
    if (typeof x.kind === "string") p.ship = t(`gm_ship_${x.kind}`);
    if (typeof x.stage === "number") p.stage = t(stageKey(x.stage, typeof x.kind === "string" && WAR_KINDS.includes(x.kind)));
    return t(`gm_tip_${x.id === "ship_ready" ? "ship_done" : x.id}`, p);
  };
  const buddyLine = tutStep ? t(`gm_tut_${tutStep}`, { steel: data.earn.daily_done_steel }) : tip ? tipText(tip) : "";

  const tipAction = (x: GameTip | undefined): { label: string; onPress: () => void } | null => {
    if (!x) return null;
    switch (x.id) {
      case "daily":
      case "study":
        return { label: t("gm_goDaily"), onPress: () => router.push("/daily") };
      case "ship_ready":
        return { label: t(data.ship?.war ? "gm_warCommission" : "gm_shipDeliver"), onPress: shipNext };
      case "collect":
        return { label: t("gm_collectAll"), onPress: doCollect };
      case "exam":
        return { label: t("gm_examStart"), onPress: openExam };
      case "supply":
        return { label: t("gm_supplyGo"), onPress: () => openSupply() };
      case "defense":
        return { label: t("gm_build"), onPress: () => { setSelected(null); setMode("build"); } };
      case "pirate":
        return { label: t("gm_bt_go"), onPress: openBattle };
      case "repair":
        return { label: t("gm_fleetSee"), onPress: openWar };
      case "weak": {
        const b = data.buildings.find((k) => k.id === x.bid);
        return b?.defense?.unit ? { label: t("gm_defStudy"), onPress: () => openSupply(b.defense!.unit!.key) } : null;
      }
      case "full": {
        const store = Number(x.steel) >= Number(x.rods) ? "yard" : "rodstore";
        const b = data.buildings.find((k) => k.type === store);
        return b
          ? { label: t("gm_seeBuilding", { name: name(store) }), onPress: () => { setSelected(b.id); setMode("home"); } }
          : { label: t("gm_build"), onPress: () => setMode("build") };
      }
      case "built":
      case "idle": {
        const b = data.buildings.find((k) => k.type === x.type);
        return b
          ? { label: t("gm_seeBuilding", { name: name(String(x.type)) }), onPress: () => { setSelected(b.id); setMode("home"); } }
          : { label: t("gm_build"), onPress: () => setMode("build") };
      }
      case "ship_idle":
        return { label: t("gm_ships"), onPress: () => { setShipTab("merchant"); setMode("ship"); } };
      case "pier":
        return { label: t("gm_buildPier"), onPress: () => startPlace("pier") };
      case "warship":
        return { label: t("gm_warTab"), onPress: openWar };
      case "reclaim":
        return { label: t("gm_reclaim"), onPress: () => { setSelected(null); setMode("build"); } };
      case "pass": {
        const b = data.buildings.find((k) => k.busy_until);
        if (!b && rc?.left !== undefined) return { label: t("gm_reclaim"), onPress: () => { setSelected(null); setMode("build"); } };
        return b ? { label: t("gm_seeBuilding", { name: name(b.type) }), onPress: () => { setSelected(b.id); setMode("home"); } } : null;
      }
      default:
        return null;
    }
  };
  const tutAction = (): { label: string; onPress: () => void } | null => {
    switch (tutStep) {
      case "daily":
        return { label: t("gm_goDaily"), onPress: () => router.push("/daily") };
      case "yard":
        return { label: t("gm_tutBuildYard"), onPress: () => startPlace("yard") };
      case "collect":
        return { label: t("gm_collectAll"), onPress: doCollect };
      case "ship":
        return data.ship
          ? { label: t("gm_ships"), onPress: () => setMode("ship") }
          : { label: t("gm_shipStartBarge"), onPress: () => setMode("ship") };
      case "hq": {
        const hq = data.buildings.find((b) => b.type === "hq");
        if (!hq) return null;
        if (hq.block === "exam") return { label: t("gm_examStart"), onPress: openExam };
        return { label: t("gm_seeBuilding", { name: name("hq") }), onPress: () => { setSelected(hq.id); setMode("home"); } };
      }
      default:
        return null;
    }
  };
  const action = tutStep ? tutAction() : tipAction(tip);
  const barOn = !!sel && mode === "home" && !detail;
  const panelOpen = mode !== "home" || (!!sel && detail);
  const idleBuilder = data.builders.busy < data.builders.total && !tutStep;
  // 건물 고르기 (짓기 목록에서 고르면 화면도 그 건물로 옮김)
  const pickBuilding = (b: GameBuilding, move = true) => {
    setSelected(b.id);
    setDetail(false);
    setMode("home");
    if (move) setFocus({ ...centerOf(b, data.grid, W), n: Date.now() });
  };
  const openCrew = () => {
    const hall = data.buildings.find((b) => b.type === "trainhall" && b.level > 0);
    if (hall) openTrain();
    else setMsg(t("gm_crewNeedHall"));
  };
  // 지도 빈 곳(바다·빈 땅)을 '톡' 눌렀을 때: 열린 오른쪽 창을 닫음 (끌기는 tapOk가 걸러서 안 닫힘)
  // 문제 푸는 창(승급 시험·자재 조달·태풍 훈련)은 적던 답이 사라지지 않게 X로만 닫음
  const tapEmpty = () => {
    setSelected(null);
    setDetail(false);
    if (!STAY_OPEN_MODES.includes(mode)) setMode("home");
  };
  const sheetW = Math.min(380, Math.max(280, width * 0.42));
  const pendingN = data.pending.steel + data.pending.rods;

  return (
    <View style={styles.full}>
      <StatusBar hidden />
      {/* 지도: 한 손가락으로 끌어 옮기고, 두 손가락으로 확대·축소 (메뉴·창에 가려진 곳도 끌어서 봄) */}
      <PanZoom width={width} height={height} contentW={mapDim.width} contentH={mapDim.height} zoom={zoom} minZoom={0.7} maxZoom={3} onZoom={setZoom}
        onMove={(on) => { moving.current = { on, at: Date.now() }; }}
        onTapEmpty={() => tapOk() && tapEmpty()}
        grab={placeSpec && pick && placeType !== "wall" ? cellBox(pick.x, pick.y, placeSpec.w, placeSpec.h, data.grid, W) : null}
        onGrab={onGrab}
        focus={focus}>
            <GameMap
              grid={data.grid}
              sea={sea}
              reclaiming={rc?.left !== undefined}
              fleet={(data.fleet?.ships ?? []).map((f) => f.kind)}
              W={W}
              buildings={mapBuildings}
              selected={selected}
              labels={labels}
              names={names || mode === "place"}
              onCollect={doCollect}
              place={placeSpec}
              ship={data.ship ? { kind: data.ship.kind, stage: data.ship.stage, war: data.ship.war } : null}
              onSelect={(id) => {
                if (!tapOk()) return;
                if (!id) return tapEmpty();
                setSelected(id);
                setDetail(false);
                setMode("home");
              }}
              onPlace={(x, y) => {
                if (!tapOk()) return;
                // 방파 장벽: 칸을 누를 때마다 바로 한 칸씩 (작업 반장 없이)
                if (placeType === "wall" && !moveId) queueWall(x, y);
                else setPick({ x, y });
              }}
              now={{ left: (b) => (leftOf(b) !== null ? clock(leftOf(b)!) : null), done: t("gm_doneChip") }}
            />
      </PanZoom>

      {/* 왼쪽 위: 나가기 · 본관 레벨 · 도움말 */}
      <View style={[styles.hudTL, { top: 8 + insets.top, left: 8 + insets.left }]} pointerEvents="box-none">
        <View style={styles.resRow}>
          <Pressable onPress={() => router.back()} style={styles.roundSm} hitSlop={8} accessibilityLabel={t("common_back")}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </Pressable>
          <Pressable onPress={() => hqB && pickBuilding(hqB)} style={styles.lvBadge} accessibilityLabel={name("hq")}>
            <Text style={styles.lvNum}>{hqB?.level ?? 1}</Text>
          </Pressable>
          <View>
            <Text style={styles.lvName}>{t("gm_hudHq", { n: hqB?.level ?? 1 })}</Text>
            <Text style={[styles.lvSub, { color: data.run_today ? "#7FD18F" : "#FFB066" }]}>{data.run_today ? t("gm_runOnShort") : t("gm_runOffShort")}</Text>
          </View>
        </View>
        {/* 왼쪽 세로 작은 단추: 오늘 문제 · 교재 · 이름 보기 · 도움말 */}
        {!panelOpen ? (
          <View style={styles.sideCol}>
            <SideBtn icon="create" label={t("gm_dailyShort")} badge={!data.run_today ? "!" : undefined} onPress={() => router.push("/daily")} />
            <SideBtn
              icon="book"
              label={t("gm_bookShort")}
              onPress={() => (data.book_id ? router.push(`/book?id=${data.book_id}&page=${data.units.next?.pdf_page ?? 1}`) : null)}
            />
            <SideBtn icon={names ? "pricetags" : "pricetags-outline"} label={t("gm_names")} on={names} onPress={() => setNames((v) => !v)} />
            <SideBtn icon="help" label={t("gm_helpShort")} onPress={() => setMode("earn")} />
          </View>
        ) : null}
      </View>

      {/* 오른쪽 위: 자원 (세로로, 창고가 얼마나 찼는지 막대) */}
      {!panelOpen ? (
        <View style={[styles.hudTR, { top: 8 + insets.top, right: 8 + insets.right }]} pointerEvents="box-none">
          {(["steel", "rods", "tech", "passes", "fame"] as ResKey[]).map((k) => (
            <ResBar
              key={k}
              color={RES_COLOR[k]}
              label={t(`gm_${k}`)}
              value={res[k]}
              cap={k === "steel" || k === "rods" ? data.caps[k] : undefined}
              on={info === k}
              onPress={() => setInfo((cur) => (cur === k ? null : k))}
            />
          ))}
          {info ? (
            <View style={styles.infoCard}>
              <View style={styles.rowBetween}>
                <View style={styles.rowStart}>
                  <View style={[styles.dot, { backgroundColor: RES_COLOR[info], width: 10, height: 10 }]} />
                  <Text style={styles.infoTitle}>
                    {t(`gm_${info}`)} {res[info]}
                  </Text>
                </View>
                <Pressable onPress={() => setInfo(null)} hitSlop={10}>
                  <Ionicons name="close" size={18} color="#fff" />
                </Pressable>
              </View>
              <Text style={styles.infoText}>{t(`gm_info_${info}`, { m: data.speed_rule.tech_minutes, h: data.speed_rule.pass_hours })}</Text>
              {(info === "steel" || info === "rods") && res[info] >= data.caps[info] ? (
                <Text style={[styles.infoSmall, { color: "#FFD166" }]}>{t("gm_infoFull", { cap: data.caps[info] })}</Text>
              ) : null}
              {(info === "steel" || info === "rods") && (data.waiting?.[info] ?? 0) > 0 ? (
                <Text style={styles.infoSmall}>{t("gm_infoWaiting", { n: data.waiting![info] })}</Text>
              ) : null}
              {(info === "tech" || info === "passes") && !busyB && !shipBusy ? <Text style={styles.infoSmall}>{t("gm_infoNothingBusy")}</Text> : null}
              {infoAction(info) ? (
                <Pressable onPress={infoAction(info)!.onPress} style={styles.infoBtn}>
                  <Text style={styles.actText}>{infoAction(info)!.label}</Text>
                  <Ionicons name="chevron-forward" size={14} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 가운데 위: 알림 (몇 초 뒤 사라짐) */}
      {msg || rewards ? (
        <View style={[styles.toastWrap, { top: 8 + insets.top, left: 200, right: panelOpen ? sheetW + 16 : 150 }]} pointerEvents="box-none">
          {rewards ? (
            <Pressable onPress={() => setRewards(null)} style={[styles.toast, { borderColor: colors.success }]}>
              <Text style={styles.toastTitle}>{t("gm_rewardsTitle")}</Text>
              <Text style={styles.toastText}>{rewardLine(t, rewards)}</Text>
              <Text style={styles.toastSmall}>{whyLine(t, rewards.why)}</Text>
            </Pressable>
          ) : null}
          {msg ? (
            <Pressable onPress={() => setMsg("")} style={styles.toast}>
              <Text style={styles.toastText}>{msg}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* 아래 왼쪽: 큰 [바다 지도] + 접는 서랍(배 건조·자재 조달·대원) */}
      {!panelOpen && !barOn ? (
        <View style={[styles.hudBL, { bottom: 8 + insets.bottom, left: 8 + insets.left }]} pointerEvents="box-none">
          <BigBtn icon="map" label={t("gm_sea_short")} color="#1E88E5" shadow="#0D47A1" onPress={() => { setSelected(null); setInfo(null); setSeaOpen(true); }} />
          <View style={styles.tray}>
            {trayOpen ? (
              <>
                <Fab icon="boat" label={t("gm_ships")} onPress={() => { setShipTab(data.ship?.war ? "war" : "merchant"); setMode("ship"); }} badge={data.ship?.ready ? "!" : undefined} />
                <Fab icon="cart" label={t("gm_supplyShort")} onPress={() => openSupply()} />
                <Fab icon="people" label={t("gm_crewShort")} onPress={openCrew} />
              </>
            ) : null}
            <Pressable onPress={() => setTrayOpen((v) => !v)} style={styles.trayArrow} hitSlop={6} accessibilityLabel={t("gm_trayToggle")}>
              <Ionicons name={trayOpen ? "chevron-back" : "chevron-forward"} size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* 아래 가운데: 웰디 (작게, 할 말이 있을 때만 짧은 말풍선 · 누르면 크게) */}
      {mode !== "place" && !panelOpen && !barOn ? (
        <View style={[styles.weldy, { bottom: 8 + insets.bottom, left: 8 + insets.left + BL_W, right: 8 + insets.right + BR_W }]} pointerEvents="box-none">
          {tutStep ? (
            <View style={styles.tutRow}>
              <Text style={styles.tutTitle}>{t("gm_tutTitle", { n: (tut.step ?? 0) + 1, total: tut.steps.length })}</Text>
              <View style={styles.steps}>
                {tut.steps.map((s, i) => (
                  <View key={s.id} style={[styles.stepDot, { backgroundColor: s.ok ? colors.primary : i === tut.step ? "#FFD166" : "#FFFFFF33" }]} />
                ))}
              </View>
              <Pressable onPress={() => run(() => gameTutorial(true))} hitSlop={10}>
                <Text style={styles.link}>{t("gm_tutSkip")}</Text>
              </Pressable>
            </View>
          ) : null}
          {weldyBig || tutStep ? (
            <View style={styles.buddyRow}>
              <View style={{ flex: 1, alignSelf: "stretch" }}>
                <StudyBuddy
                  compact
                  text={buddyLine}
                  size={42}
                  onPress={tutStep ? undefined : tips.length < 2 ? () => setWeldyBig(false) : () => setTipAt((n) => n + 1)}
                />
              </View>
              {action ? (
                <Pressable onPress={action.onPress} disabled={busy} style={({ pressed }) => [styles.actBtn, (pressed || busy) && { opacity: 0.6 }]}>
                  <Text style={styles.actText} numberOfLines={2}>
                    {action.label}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#fff" />
                </Pressable>
              ) : null}
              {!tutStep ? (
                <Pressable onPress={() => setWeldyBig(false)} hitSlop={10} style={styles.roundSm} accessibilityLabel={t("common_close")}>
                  <Ionicons name="chevron-down" size={18} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Pressable onPress={() => setWeldyBig(true)} style={styles.weldySmall} accessibilityLabel={t("gm_weldyOpen")}>
              <StudyBuddy compact text={buddyLine} size={36} lines={1} onPress={() => setWeldyBig(true)} />
            </Pressable>
          )}
          {weldyBig && !tutStep && tips.length > 1 ? <Text style={styles.hint}>{t("gm_tipNext")}</Text> : null}
        </View>
      ) : null}

      {/* 아래 오른쪽: 큰 [짓기] + 작업 반장 (쉬는 반장이 있으면 깜빡) */}
      {!panelOpen && !barOn ? (
        <View style={[styles.hudBR, { bottom: 8 + insets.bottom, right: 8 + insets.right }]} pointerEvents="box-none">
          <Text style={[styles.builderChip, idleBuilder && { borderColor: "#FFD166" }]}>
            {t("gm_builders", { busy: data.builders.busy, total: data.builders.total })}
          </Text>
          <BigBtn icon="hammer" label={t("gm_build")} color={colors.primary} shadow="#B85A00" pulse={idleBuilder} onPress={() => setMode("build")} />
        </View>
      ) : null}

      {/* 건물을 누르면: 아래 가운데에 그 건물에서 할 수 있는 단추 */}
      {barOn && sel ? (
        <ActionBar
          b={sel}
          data={data}
          left={leftOf(sel)}
          busy={busy}
          canPay={canPay}
          bottom={8 + insets.bottom}
          onInfo={() => setDetail(true)}
          onUpgrade={() => run(() => gameUpgrade(sel.id))}
          onExam={openExam}
          onCollect={doCollect}
          onMove={() => startMove(sel)}
          onShips={() => { setShipTab(data.ship?.war ? "war" : "merchant"); setMode("ship"); }}
          onFleet={openWar}
          onArms={() => { setSelected(null); setMode("arms"); }}
          onTrain={openTrain}
          onStudy={(unit) => openSupply(unit)}
        />
      ) : null}

      {/* 오른쪽 패널: 건물·짓기·배·자원 얻는 법·자리 고르기 */}
      {panelOpen ? (
        <View style={[styles.sheet, { width: sheetW, top: 8 + insets.top, bottom: 8 + insets.bottom, right: 8 + insets.right }]}>
          <ScrollView contentContainerStyle={{ gap: space.sm, padding: space.sm }}>
            {mode === "place" && placeType === "wall" && !moveId ? (
              <Card style={{ gap: space.sm }}>
                <Text style={styles.cardTitle}>{t("gm_placeTitle", { name: name("wall") })}</Text>
                <Text style={styles.small}>{t("gm_wallHint")}</Text>
                {(() => {
                  const c = data.catalog.find((k) => k.type === "wall");
                  return c ? (
                    <View style={{ gap: 4 }}>
                      <Text style={styles.text}>{t("gm_defCount", { n: (c.have ?? 0) + wallQ.length, max: c.max ?? 0 })}</Text>
                      <CostIcons cost={c.cost} instant res={data.resources} />
                    </View>
                  ) : null;
                })()}
                <LegendDot color="#73C985" label={t("gm_legendFree")} />
                <AppButton label={t("gm_wallDone")} icon="checkmark" onPress={() => setMode("build")} />
              </Card>
            ) : mode === "place" && placeType ? (
              <Card style={{ gap: space.sm }}>
                <Text style={styles.cardTitle}>{moveId ? t("gm_moveTitle", { name: name(placeType) }) : t("gm_placeTitle", { name: name(placeType) })}</Text>
                <Text style={styles.small}>{pick ? t("gm_placePicked") : t("gm_placeHint")}</Text>
                <LegendDot color="#73C985" label={t("gm_legendFree")} />
                <AppButton label={moveId ? t("gm_moveHere") : t("gm_buildHere")} disabled={!pick || busy} onPress={confirmPlace} />
                <AppButton label={t("common_cancel")} variant="secondary" onPress={() => setMode(moveId ? "home" : "build")} />
              </Card>
            ) : sel && mode === "home" ? (
              <BuildingPanel
                b={sel}
                data={data}
                left={leftOf(sel)}
                busy={busy}
                canPay={canPay}
                onUpgrade={() => run(() => gameUpgrade(sel.id))}
                onSpeed={(using) => run(() => gameSpeedup(sel.id, using))}
                onCollect={doCollect}
                onMove={() => startMove(sel)}
                onShips={() => { setShipTab(data.ship?.war ? "war" : "merchant"); setMode("ship"); }}
                onFleet={openWar}
                onExam={openExam}
                onStudy={(unit) => openSupply(unit)}
                onBook={(page) => data.book_id && router.push(`/book?id=${data.book_id}&page=${page}`)}
                onArms={() => { setSelected(null); setMode("arms"); }}
                onWalls={() => run(gameWallsUpgrade)}
                onTrain={openTrain}
                onClose={() => setDetail(false)}
              />
            ) : mode === "build" ? (
              <BuildList
                data={data}
                canPay={canPay}
                leftOf={leftOf}
                onNew={startPlace}
                onPick={(b) => pickBuilding(b)}
                onExam={openExam}
                onClose={() => setMode("home")}
                top={rc ? (
                  <ReclaimCard
                    rc={rc}
                    data={data}
                    left={rc.left !== undefined ? Math.max(0, rc.left - gone()) : null}
                    busy={busy}
                    canPay={canPay}
                    onStart={() => run(gameReclaim, () => setMsg(t("gm_reclaimStarted")))}
                    onSpeed={(using) => run(() => gameSpeedup("reclaim", using))}
                  />
                ) : null}
              />
            ) : mode === "exam" ? (
              <ExamPanel
                exam={exam}
                answers={answers}
                setAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
                result={examRes}
                error={examErr}
                busy={busy}
                spec={hqB?.next?.exam ?? null}
                onSubmit={submitExam}
                onRetry={openExam}
                onUpgrade={() => hqB && run(() => gameUpgrade(hqB.id), () => closeExam())}
                canUpgrade={!!hqB && !!hqB.next && canPay(hqB.next.cost) && data.builders.busy < data.builders.total}
                upgradeNote={!hqB?.next ? "" : data.builders.busy >= data.builders.total ? t("gm_err_builders") : !canPay(hqB.next.cost) ? `${t("gm_err_money")} (${costLine(t, hqB.next.cost)})` : costLine(t, hqB.next.cost)}
                onClose={closeExam}
              />
            ) : mode === "supply" ? (
              <SupplyPanel
                supply={supply}
                answers={answers}
                setAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
                result={supplyRes}
                error={examErr}
                busy={busy}
                onSubmit={submitSupply}
                onAgain={() => openSupply(supplyUnit)}
                onClose={() => { setMode("home"); setSupply(null); setSupplyRes(null); }}
              />
            ) : mode === "ship" ? (
              <ShipPanel data={data} busy={busy} canPay={canPay} gone={gone()} tab={shipTab} setTab={setShipTab} onClose={() => setMode("home")}
                onRepair={(id) => run(() => gameRepair(id))} onRepairSpeed={(id, using) => run(() => gameSpeedup(`repair:${id}`, using))}
                onHull={(id) => run(() => gameWarshipHull(id))} onFit={(id, w) => run(() => gameWarshipFit(id, w))} onArms={() => setMode("arms")}
                onStart={(k) => run(() => gameShipStart(k))} onBuildPier={() => startPlace("pier")}
                onNext={shipNext} onSpeed={(using) => run(() => gameSpeedup("ship", using))} />
            ) : mode === "battle" ? (
              <BattlePanel key={battleStage ?? 0} initialStage={battleStage} data={data} pirate={pirate} busy={busy} error={examErr} onClose={() => setMode("home")}
                onAttack={attack} onReplay={replay} onTyphoon={openTyphoon} onFleet={openWar} onPlan={openPlan} />
            ) : mode === "typhoon" ? (
              <Card style={{ gap: space.sm }}>
                <PanelHead title={t("gm_ty_title")} onClose={() => { setMode("battle"); openBattle(); }} />
                <Text style={styles.small}>{t("gm_ty_rule", { wall: pirate?.typhoon.wall_part ?? 60, quiz: 100 - (pirate?.typhoon.wall_part ?? 60) })}</Text>
                {examErr ? <Text style={styles.warn}>{examErr}</Text> : null}
                {!typhoon && !examErr ? <ActivityIndicator color={colors.primary} /> : null}
                {typhoon ? <QuizList questions={typhoon.questions} answers={answers} setAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} result={typhoonRes} /> : null}
                {typhoon && !typhoonRes ? (
                  <AppButton
                    label={t("gm_examSubmit", { done: typhoon.questions.filter((q) => String(answers[q.id] ?? "").trim() !== "").length, total: typhoon.total })}
                    icon="checkmark-done-outline"
                    disabled={busy || typhoon.questions.some((q) => String(answers[q.id] ?? "").trim() === "")}
                    onPress={submitTyphoon}
                  />
                ) : null}
                {typhoonRes ? (
                  <View style={[styles.examResult, { borderColor: typhoonRes.pct >= 80 ? colors.success : colors.warning }]}>
                    <Text style={[styles.cardTitle, { color: typhoonRes.pct >= 80 ? colors.success : colors.warning }]}>{t("gm_ty_result", { pct: typhoonRes.pct })}</Text>
                    <Text style={styles.small}>{t("gm_ty_parts", { wall: typhoonRes.wall_pct, quiz: typhoonRes.quiz_pct, right: typhoonRes.right, total: typhoonRes.total })}</Text>
                    <Text style={styles.text}>
                      {t("gm_steel")} +{typhoonRes.got.steel} · {t("gm_rods")} +{typhoonRes.got.rods}
                      {typhoonRes.got.tech ? ` · ${t("gm_tech")} +${typhoonRes.got.tech}` : ""}
                    </Text>
                    <StudyBuddy compact size={40} text={t(typhoonRes.wall_pct < (pirate?.typhoon.wall_part ?? 60) ? "gm_ty_moreWalls" : "gm_ty_good")} />
                  </View>
                ) : null}
              </Card>
            ) : mode === "arms" ? (
              <ArmsPanel data={data} busy={busy} onClose={() => setMode("home")} onFleet={openWar}
                onResearch={(k) => run(() => gameWeaponResearch(k))} onUpgrade={(k) => run(() => gameWeaponUpgrade(k))} />
            ) : mode === "earn" ? (
              <>
                <EarnPanel data={data} onClose={() => setMode("home")} />
                <Card style={{ gap: space.xs }}>
                  <LegendDot color="#73C985" label={t("gm_legendFree")} />
                  <LegendDot color="#0B2033" label={t("gm_legendTimer")} />
                  <LegendDot color="#2E9D5B" label={t("gm_legendDone")} />
                  <LegendDot color={RES_COLOR.steel} round label={t("gm_legendCoin")} />
                  <Text style={styles.small}>{t("gm_footnote")}</Text>
                </Card>
              </>
            ) : null}
          </ScrollView>
        </View>
      ) : null}

      {busy ? (
        <View style={[styles.busy, { top: 8 + insets.top }]} pointerEvents="none">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}

      {party ? <LaunchParty info={party} onClose={() => setParty(null)} /> : null}
      {seaOpen ? (
        <SeaMap
          onClose={() => setSeaOpen(false)}
          onPlan={openPlan}
          onRaid={(id) => openRaid(id)}
          onDefense={openDefense}
          defenseNew={defense?.unseen ?? 0}
          onPractice={() => { setSeaOpen(false); setBattleStage(null); openBattle(); }}
          errorText={seaError}
        />
      ) : null}
      {trainOpen ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: "#0B1A2AF2", zIndex: 55 }]}>
          <ScrollView style={{ width: "100%" }} contentContainerStyle={{ alignItems: "center", padding: space.md }}>
            <View style={styles.trainCard}>
              {pirate ? (
                <CrewTrain crews={pirate.crews} lang={i18n.language} onCrews={(c) => setPirate((p) => (p ? { ...p, crews: c } : p))}
                  onBack={() => setTrainOpen(false)} errorText={seaError}
                  renderQuiz={(q) => <QuizList questions={q.questions} answers={q.answers} setAnswer={q.setAnswer} result={q.result} />} />
              ) : examErr ? (
                <>
                  <Text style={styles.warn}>{examErr}</Text>
                  <AppButton label={t("common_back")} onPress={() => setTrainOpen(false)} />
                </>
              ) : (
                <ActivityIndicator color="#fff" />
              )}
            </View>
          </ScrollView>
        </View>
      ) : null}
      {planStage && pirate ? (
        <PlanScreen
          target={{ kind: "pirate", title: t("gm_pl_title", { n: planStage }), base: pirate.stages[planStage - 1].base, map: pirate.map, stage: planStage }}
          pirate={pirate}
          data={data}
          busy={busy}
          error={examErr}
          lang={i18n.language}
          onClose={() => setPlanStage(null)}
          onLaunch={planAttack}
          onCrews={(c) => setPirate((p) => (p ? { ...p, crews: c } : p))}
          errorText={seaError}
          renderQuiz={(q) => <QuizList questions={q.questions} answers={q.answers} setAnswer={q.setAnswer} result={q.result} />}
        />
      ) : null}
      {planStage && !pirate ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: "#0B1A2A" }]}>
          {examErr ? <Text style={styles.warn}>{examErr}</Text> : <ActivityIndicator color="#fff" />}
          {examErr ? <AppButton label={t("common_back")} onPress={() => setPlanStage(null)} /> : null}
        </View>
      ) : null}
      {raid && pirate ? (
        <PlanScreen
          target={{
            kind: "user", title: t(raid.revenge ? "gm_rd_revengeTitle" : "gm_rd_planTitle", { name: raid.target.name }), base: raid.target.base,
            map: raid.target.map, loot: raid.target.loot, lootHalf: raid.target.loot_half, block: raid.target.block, morale: raid.target.morale,
          }}
          pirate={pirate}
          data={data}
          busy={busy}
          error={examErr}
          lang={i18n.language}
          onClose={closeRaid}
          onLaunch={raidAttack}
          onCrews={(c) => setPirate((p) => (p ? { ...p, crews: c } : p))}
          errorText={seaError}
          renderQuiz={(q) => <QuizList questions={q.questions} answers={q.answers} setAnswer={q.setAnswer} result={q.result} />}
        />
      ) : null}
      {raidId && !raid ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: "#0B1A2A" }]}>
          {examErr ? <Text style={styles.warn}>{examErr}</Text> : <ActivityIndicator color="#fff" />}
          {examErr ? <AppButton label={t("common_back")} onPress={closeRaid} /> : null}
        </View>
      ) : null}
      {defOpen && defense ? (
        <DefenseLog data={defense} onClose={() => setDefOpen(false)} onReplay={(id) => replay(id, true)} onRevenge={revenge} />
      ) : null}
      {defNotice && defense && !party && !battle ? (
        <View style={[StyleSheet.absoluteFill, styles.partyBg]}>
          <View style={[styles.partyCard, { borderColor: "#57C4E5" }]}>
            <View style={[styles.rowStart, { justifyContent: "center" }]}>
              <Ionicons name="shield-half" size={26} color="#57C4E5" />
              <Text style={styles.partyTitle}>{t("gm_df_noticeTitle")}</Text>
            </View>
            {defense.log.filter((r) => !r.seen).slice(0, 3).map((r) => (
              <StudyBuddy key={r.id} compact size={40}
                text={t(r.stars <= 1 ? "gm_df_noticeHeld" : "gm_df_noticeBroken", { name: r.by, steel: r.lost.steel ?? 0, rods: r.lost.rods ?? 0 })} />
            ))}
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <AppButton label={t("gm_df_open")} icon="shield-half-outline" variant="secondary" onPress={openDefense} />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton label={t("gm_partyOk")} icon="checkmark" onPress={closeNotice} />
              </View>
            </View>
          </View>
        </View>
      ) : null}
      {battle ? <BattleReplay battle={battle} defense={battleDef} onClose={() => setBattle(null)} /> : null}
      {!party && data.gifts?.length ? (
        <View style={[StyleSheet.absoluteFill, styles.partyBg]}>
          <View style={[styles.partyCard, { borderColor: "#E05A9B" }]}>
            <View style={[styles.rowStart, { justifyContent: "center" }]}>
              <Ionicons name="gift" size={26} color="#E05A9B" />
              <Text style={styles.partyTitle}>{t("gm_giftTitle")}</Text>
            </View>
            <StudyBuddy compact size={52} text={t("gm_giftBuddy")} />
            {data.gifts.map((g) => (
              <View key={g.id} style={{ gap: 2, alignItems: "center" }}>
                <Text style={styles.partyItemText}>{giftLine(t, g)}</Text>
                {g.memo ? <Text style={styles.small}>{t("gm_giftMemo", { memo: g.memo })}</Text> : null}
              </View>
            ))}
            <AppButton label={t("gm_giftOk")} icon="checkmark" disabled={busy} onPress={() => run(() => gameGiftsSeen(data.gifts!.map((g) => g.id)))} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** 짓기 목록 한 줄 */
type BuildRow = {
  key: string;
  type: GameBuildingType;
  title: string;
  /** 무엇이 좋아지는지 · 왜 못 하는지 (한 줄) */
  note: string;
  warn?: boolean;
  level?: number;
  cost?: GameCost;
  seconds?: number;
  instant?: boolean;
  off: boolean;
  onPress: () => void;
};

/**
 * [짓기] 목록: 추천(지금 바로 할 수 있고 효과가 큰 것 3개) → 다른 건물 → 방어 시설 → 아직 못 짓는 것(조건).
 * 맨 아래에 작업 반장이 무엇을 하는지.
 */
function BuildList({
  data,
  canPay,
  leftOf,
  top,
  onNew,
  onPick,
  onExam,
  onClose,
}: {
  data: GameState;
  canPay: (c: GameCost) => boolean;
  leftOf: (b: GameBuilding) => number | null;
  top?: React.ReactNode;
  onNew: (type: GameBuildingType) => void;
  onPick: (b: GameBuilding) => void;
  onExam: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = (k: string) => t(`gm_b_${k}`);
  const free = data.builders.busy < data.builders.total;
  const hq = data.buildings.find((b) => b.type === "hq");
  const hqLv = hq?.level ?? 1;
  const opensNext = data.catalog.filter((c) => c.unlock === hqLv + 1).map((c) => name(c.type));
  const rows: (BuildRow & { score: number; def: boolean; locked: boolean })[] = [];
  // 새로 지을 수 있는 건물·방어 시설
  for (const c of data.catalog) {
    if (c.locked) {
      rows.push({ key: `n-${c.type}`, type: c.type, title: name(c.type), note: t("gm_bl_lockedAt", { n: c.unlock }), warn: true, off: true, onPress: () => null, score: 0, def: !!c.defense, locked: true });
      continue;
    }
    if (c.full) continue;
    const noWorker = !c.instant && !free;
    const pay = canPay(c.cost);
    const note = !pay ? t("gm_bl_noMoney") : noWorker ? t("gm_err_builders") : c.defense ? t("gm_bl_newDef", { n: c.have ?? 0, max: c.max ?? 0 }) : t("gm_bl_new");
    rows.push({
      key: `n-${c.type}`, type: c.type, title: name(c.type), note, warn: !pay || noWorker, cost: c.cost, seconds: c.seconds, instant: c.instant,
      off: !pay || noWorker, onPress: () => onNew(c.type), score: c.defense ? 60 : 80, def: !!c.defense, locked: false,
    });
  }
  // 올릴 수 있는 건물 (방파 장벽은 많아서 한 줄로: 장벽을 누르면 '모두 올리기')
  const seenWall = { v: false };
  for (const b of data.buildings) {
    if (!b.next || b.level < 1 || leftOf(b) !== null) continue;
    if (b.type === "wall") {
      if (seenWall.v) continue;
      seenWall.v = true;
    }
    const isHq = b.type === "hq";
    const pay = canPay(b.next.cost);
    const noWorker = !b.instant && !free;
    const note =
      b.block === "hq_level" ? t("gm_blockHq")
      : b.block === "exam" ? t("gm_bl_exam")
      : !pay ? t("gm_bl_noMoney")
      : noWorker ? t("gm_err_builders")
      : isHq && opensNext.length ? t("gm_bl_opens", { list: opensNext.slice(0, 3).join(", ") })
      : t("gm_bl_up", { a: b.level, b: b.next.level });
    const off = b.block === "hq_level" || !pay || noWorker;
    rows.push({
      key: `u-${b.id}`, type: b.type, title: `${name(b.type)} → ${t("gm_level", { n: b.next.level })}`, note,
      warn: off || b.block === "exam", level: b.level, cost: b.next.cost, seconds: b.next.seconds, instant: b.instant,
      off: off && b.block !== "exam",
      onPress: () => (b.block === "exam" && !off ? onExam() : onPick(b)),
      // 추천 순서: 본관 > 새 건물 > 생산·창고 > 그 밖 (레벨 낮을수록 먼저)
      score: (isHq ? 100 : ["cutting", "welding", "yard", "rodstore"].includes(b.type) ? 50 : 40) - b.level,
      def: !!b.defense, locked: false,
    });
  }
  const can = rows.filter((r) => !r.off && !r.locked).sort((a, b) => b.score - a.score);
  const rec = can.slice(0, 3);
  const recKeys = new Set(rec.map((r) => r.key));
  const other = rows.filter((r) => !recKeys.has(r.key) && !r.locked && !r.def);
  const defs = rows.filter((r) => !recKeys.has(r.key) && !r.locked && r.def);
  const locked = rows.filter((r) => r.locked);
  const working = data.buildings.filter((b) => leftOf(b) !== null && b.busy_until);
  const Row = ({ r }: { r: BuildRow }) => (
    <Pressable onPress={r.onPress} disabled={r.off} style={({ pressed }) => [styles.blRow, r.off && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}>
      <View style={[styles.blIcon, { backgroundColor: BUILDING_COLOR[r.type] }]}>
        {r.level ? <Text style={styles.blLv}>{r.level}</Text> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.textB} numberOfLines={1}>
          {r.title}
        </Text>
        <Text style={[styles.small, { color: r.warn ? colors.warning : "#7FD18F" }]} numberOfLines={2}>
          {r.note}
        </Text>
        {r.cost ? <CostIcons cost={r.cost} seconds={r.seconds} instant={r.instant} res={data.resources} /> : null}
      </View>
      {r.cost ? <Ionicons name="chevron-forward" size={16} color={colors.muted} /> : <Ionicons name="lock-closed" size={16} color={colors.muted} />}
    </Pressable>
  );
  return (
    <Card style={{ gap: space.sm }}>
      <PanelHead title={t("gm_bl_title")} onClose={onClose} />
      {top}
      {rec.length ? (
        <>
          <Text style={styles.blSec}>{t("gm_bl_rec")}</Text>
          {rec.map((r) => <Row key={r.key} r={r} />)}
        </>
      ) : null}
      {other.length ? (
        <>
          <Text style={styles.blSec}>{t("gm_bl_other")}</Text>
          {other.map((r) => <Row key={r.key} r={r} />)}
        </>
      ) : null}
      {defs.length ? (
        <>
          <View style={{ marginTop: space.xs }}>
            <InfoTitle big title={t("gm_defTitle")} info={t("gm_defIntro")} />
          </View>
          {defs.map((r) => <Row key={r.key} r={r} />)}
        </>
      ) : null}
      {locked.length ? (
        <>
          <Text style={styles.blSec}>{t("gm_bl_locked")}</Text>
          {locked.map((r) => <Row key={r.key} r={r} />)}
        </>
      ) : null}
      {/* 작업 반장: 누가 쉬고 누가 무엇을 짓는지 */}
      <View style={styles.blWorkers}>
        {Array.from({ length: data.builders.total }).map((_, i) => {
          const w = working[i];
          const lf = w ? leftOf(w) : null;
          return (
            <View key={i} style={[styles.blWorker, !w && { borderColor: "#FFD166" }]}>
              <Text style={styles.small} numberOfLines={1}>
                {w ? t("gm_bl_working", { n: i + 1, name: name(w.type), time: clock(lf ?? 0) }) : t("gm_bl_idle", { n: i + 1 })}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/** 건물을 눌렀을 때 아래 가운데 단추 줄: 정보 · 올리기 · 그 건물 전용 · 옮기기 */
function ActionBar({
  b,
  data,
  left,
  busy,
  canPay,
  bottom,
  onInfo,
  onUpgrade,
  onExam,
  onCollect,
  onMove,
  onShips,
  onFleet,
  onArms,
  onTrain,
  onStudy,
}: {
  b: GameBuilding;
  data: GameState;
  left: number | null;
  busy: boolean;
  canPay: (c: GameCost) => boolean;
  bottom: number;
  onInfo: () => void;
  onUpgrade: () => void;
  onExam: () => void;
  onCollect: () => void;
  onMove: () => void;
  onShips: () => void;
  onFleet: () => void;
  onArms: () => void;
  onTrain: () => void;
  onStudy: (unit: string) => void;
}) {
  const { t } = useTranslation();
  const btns: { key: string; icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; sub?: string; off?: boolean; hot?: boolean; onPress: () => void }[] = [];
  btns.push({ key: "info", icon: "information-circle", label: t("gm_ab_info"), onPress: onInfo });
  const nx = b.next;
  const workers = !b.instant && data.builders.busy >= data.builders.total;
  if (left !== null) btns.push({ key: "speed", icon: "flash", label: t("gm_ab_speed"), sub: clock(left), onPress: onInfo });
  else if (nx && b.block === "exam") btns.push({ key: "exam", icon: "school", label: t("gm_ab_exam"), hot: true, onPress: onExam });
  else if (nx && b.type !== "wall")
    btns.push({
      key: "up", icon: "arrow-up-circle", label: t("gm_ab_up"),
      sub: b.block === "hq_level" ? t("gm_ab_needHq") : workers ? t("gm_ab_noWorker") : costLine(t, nx.cost),
      off: busy || !!b.block || workers || !canPay(nx.cost), hot: true, onPress: onUpgrade,
    });
  if ((b.type === "cutting" || b.type === "welding") && b.pending > 0) btns.push({ key: "collect", icon: "cube", label: t("gm_collectShort"), sub: `+${b.pending}`, hot: true, onPress: onCollect });
  if (b.type === "dock") btns.push({ key: "ships", icon: "boat", label: t("gm_ships"), onPress: onShips });
  if (b.type === "pier" && b.level > 0) btns.push({ key: "fleet", icon: "boat", label: t("gm_ab_fleet"), onPress: onFleet });
  if (b.type === "academy" && b.level > 0) btns.push({ key: "arms", icon: "flask", label: t("gm_ab_arms"), onPress: onArms });
  if (b.type === "trainhall" && b.level > 0) btns.push({ key: "train", icon: "people", label: t("gm_ab_train"), onPress: onTrain });
  if (b.type === "wall") btns.push({ key: "walls", icon: "layers", label: t("gm_ab_walls"), onPress: onInfo });
  if (b.defense?.unit) btns.push({ key: "study", icon: "create", label: t("gm_ab_study"), onPress: () => onStudy(b.defense!.unit!.key) });
  if (!b.fixed && left === null) btns.push({ key: "move", icon: "move", label: t("gm_move"), onPress: onMove });
  return (
    <View style={[styles.abWrap, { bottom }]} pointerEvents="box-none">
      <Text style={styles.abTitle}>{b.level === 0 ? t("gm_building", { name: t(`gm_b_${b.type}`) }) : `${t(`gm_b_${b.type}`)} · ${t("gm_level", { n: b.level })}`}</Text>
      <View style={styles.abRow}>
        {btns.map((x) => (
          <Pressable key={x.key} onPress={x.onPress} disabled={x.off} style={({ pressed }) => [styles.abBtn, x.hot && !x.off && styles.abHot, x.off && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}>
            <Ionicons name={x.icon} size={22} color="#fff" />
            <Text style={styles.abText} numberOfLines={1}>
              {x.label}
            </Text>
            {x.sub ? (
              <Text style={styles.abSub} numberOfLines={1}>
                {x.sub}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** 오른쪽 위 자원 막대 (창고가 있는 자원은 얼마나 찼는지 색 막대) */
function ResBar({ color, label, value, cap, on, onPress }: { color: string; label: string; value: number; cap?: number; on?: boolean; onPress: () => void }) {
  const pct = cap ? Math.min(1, value / Math.max(1, cap)) : 0;
  return (
    <Pressable onPress={onPress} style={[styles.resBar, on && styles.resOn, !cap && { width: 130 }]} accessibilityLabel={label}>
      {cap ? <View style={[styles.resFill, { width: `${pct * 100}%`, backgroundColor: color + (pct >= 1 ? "" : "AA") }]} /> : null}
      <View style={[styles.dot, { backgroundColor: color, width: 10, height: 10 }]} />
      <Text style={styles.resLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ flex: 1 }} />
      <Text style={[styles.resValue, !!cap && value >= cap && { color: "#FFD166" }]}>{value}</Text>
      {cap ? <Text style={styles.resSub}>/{cap}</Text> : null}
    </Pressable>
  );
}

/** 왼쪽 세로 작은 단추 */
function SideBtn({ icon, label, onPress, badge, on }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; badge?: string; on?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.side, on && { borderColor: "#FFD166" }]} accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color="#fff" />
      <Text style={styles.fabText} numberOfLines={1}>
        {label}
      </Text>
      {badge ? <Text style={styles.fabBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

/** 모서리의 큰 단추 ([바다 지도]·[짓기]). pulse 면 살짝 커졌다 작아짐 (쉬는 작업 반장이 있을 때) */
function BigBtn({ icon, label, color, shadow, onPress, pulse }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; color: string; shadow: string; onPress: () => void; pulse?: boolean }) {
  const k = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) {
      k.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(k, { toValue: 1.08, duration: 600, useNativeDriver: true }),
        Animated.timing(k, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.delay(900),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, k]);
  return (
    <Animated.View style={{ transform: [{ scale: k }] }}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.big, { backgroundColor: color, borderBottomColor: shadow }, pressed && { opacity: 0.8 }]} accessibilityLabel={label}>
        <Ionicons name={icon} size={34} color="#fff" />
        <Text style={styles.bigText} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** 진수식 축하 화면: 색종이 + 웰디 + 받은 것 */
function LaunchParty({ info, onClose }: { info: NonNullable<GameState["delivered_now"]>; onClose: () => void }) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const fall = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0.6)).current;
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        x: Math.random() * width,
        d: 0.5 + Math.random() * 0.9,
        s: 6 + Math.random() * 8,
        r: Math.random() * 360,
        c: ["#FF8A1F", "#FFD166", "#4FC3F7", "#E05297", "#7FD18F", "#FFFFFF"][i % 6],
      })),
    [width],
  );
  useEffect(() => {
    Animated.loop(Animated.timing(fall, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  }, [fall, pop]);
  const ship = t(`gm_ship_${info.kind}`);
  const g = info.got;
  const items: [string, string, number][] = [
    [RES_COLOR.fame, t("gm_fame"), g.fame],
    [RES_COLOR.steel, t("gm_steel"), g.steel],
    [RES_COLOR.rods, t("gm_rods"), g.rods],
    [RES_COLOR.tech, t("gm_tech"), g.tech],
  ];
  if (g.passes) items.push([RES_COLOR.passes, t("gm_passes"), g.passes]);
  return (
    <View style={[StyleSheet.absoluteFill, styles.partyBg]}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: p.x,
            top: -20,
            width: p.s,
            height: p.s * 0.5,
            backgroundColor: p.c,
            transform: [
              { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [-40 * p.d, (height + 60) * p.d] }) },
              { rotate: `${p.r}deg` },
            ],
          }}
        />
      ))}
      <Animated.View style={[styles.partyCard, { transform: [{ scale: pop }] }]}>
        <Text style={styles.partyTitle}>{t("gm_partyTitle")}</Text>
        <Text style={styles.partyShip}>
          {t("gm_partyShip", { ship, n: info.count })}
        </Text>
        <StudyBuddy compact size={52} text={info.first ? t("gm_partyFirst", { ship }) : t("gm_partyAgain", { ship })} />
        <View style={styles.partyItems}>
          {items.map(([c, l, n]) => (
            <View key={l} style={styles.partyItem}>
              <View style={[styles.dot, { backgroundColor: c, width: 10, height: 10 }]} />
              <Text style={styles.partyItemText}>
                {l} +{n}
              </Text>
            </View>
          ))}
        </View>
        {info.first && g.passes ? <Text style={styles.small}>{t("gm_partyFirstPass")}</Text> : null}
        <AppButton label={t("gm_partyOk")} icon="checkmark" onPress={onClose} />
      </Animated.View>
    </View>
  );
}

function rewardLine(t: TFunction, r: NonNullable<GameState["rewards"]>) {
  const parts: string[] = [];
  if (r.steel) parts.push(`${t("gm_steel")} +${r.steel}`);
  if (r.rods) parts.push(`${t("gm_rods")} +${r.rods}`);
  if (r.tech) parts.push(`${t("gm_tech")} +${r.tech}`);
  if (r.passes) parts.push(`${t("gm_passes")} +${r.passes}`);
  return parts.join(" · ");
}

function whyLine(t: TFunction, why: Record<string, number>) {
  return Object.entries(why)
    .map(([k, n]) => {
      const key = k.startsWith("pass_") ? "gm_why_pass" : `gm_why_${k}`;
      const s = t(key, { n });
      return s === key ? "" : s;
    })
    .filter(Boolean)
    .join(" · ");
}

function costLine(t: TFunction, c: GameCost) {
  const parts = [];
  if (c.steel) parts.push(`${t("gm_steel")} ${c.steel}`);
  if (c.rods) parts.push(`${t("gm_rods")} ${c.rods}`);
  return parts.join(" + ") || t("gm_free");
}

type IonName = React.ComponentProps<typeof Ionicons>["name"];

/** 필요 자원·시간을 작은 아이콘 한 줄로 (모자라는 자원은 빨간 글씨). plus면 받는 보상(초록 +) */
function CostIcons({
  cost,
  tech,
  fame,
  passes,
  seconds,
  instant,
  zone,
  res,
  plus,
  lead,
}: {
  cost?: { steel?: number; rods?: number } | null;
  tech?: number;
  fame?: number;
  passes?: number;
  seconds?: number;
  instant?: boolean;
  zone?: string;
  res?: GameState["resources"];
  plus?: boolean;
  /** 맨 앞 작은 글씨 (예: "받는 것") */
  lead?: string;
}) {
  const { t } = useTranslation();
  const items: { k: string; color?: string; icon?: IonName; text: string; label: string; low?: boolean }[] = [];
  const sign = plus ? "+" : "";
  if (zone) items.push({ k: "z", icon: "location-outline", text: zone, label: zone });
  if (cost?.steel) items.push({ k: "s", color: RES_COLOR.steel, text: `${sign}${cost.steel}`, label: t("gm_steel"), low: !plus && !!res && res.steel < cost.steel });
  if (cost?.rods) items.push({ k: "r", color: RES_COLOR.rods, text: `${sign}${cost.rods}`, label: t("gm_rods"), low: !plus && !!res && res.rods < cost.rods });
  if (tech) items.push({ k: "t", color: RES_COLOR.tech, text: `${sign}${tech}`, label: t("gm_tech"), low: !plus && !!res && res.tech < tech });
  if (passes) items.push({ k: "p", color: RES_COLOR.passes, text: `${sign}${passes}`, label: t("gm_passes") });
  if (fame) items.push({ k: "f", color: RES_COLOR.fame, text: `${sign}${fame}`, label: t("gm_fame") });
  if (instant) items.push({ k: "i", icon: "flash-outline", text: t("gm_instant"), label: t("gm_instant") });
  else if (seconds) items.push({ k: "c", icon: "time-outline", text: clock(seconds), label: clock(seconds) });
  if (!items.length || (items.length === 1 && zone)) items.push({ k: "0", icon: "gift-outline", text: t("gm_free"), label: t("gm_free") });
  return (
    <View style={styles.costRow}>
      {lead ? <Text style={styles.small}>{lead}</Text> : null}
      {items.map((it) => (
        <View key={it.k} style={styles.costItem} accessibilityLabel={`${it.label} ${it.text}`}>
          {it.color ? <View style={[styles.dot, { backgroundColor: it.color }]} /> : <Ionicons name={it.icon!} size={12} color={colors.muted} />}
          <Text style={[styles.costText, plus && it.color && { color: "#7FD18F" }, it.low && { color: "#FF8A80" }]}>{it.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** ⓘ 단추: 누르면 긴 설명이 펼쳐져요 (평소엔 숨김) */
function InfoBtn({ open, onPress }: { open: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={t("gm_infoA11y")}>
      <Ionicons name={open ? "information-circle" : "information-circle-outline"} size={18} color={open ? colors.primary : colors.muted} />
    </Pressable>
  );
}

/** 이름 + 핵심 값 + ⓘ. 설명은 ⓘ를 눌렀을 때만 보여요 */
function InfoTitle({ title, value, valueWarn, info, big, color }: { title: string; value?: string; valueWarn?: boolean; info?: string; big?: boolean; color?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 4, flexShrink: 1 }}>
      <View style={[styles.rowStart, { flexWrap: "wrap" }]}>
        <Text style={[big ? styles.cardTitle : styles.textB, color ? { color } : null]}>{title}</Text>
        {info ? <InfoBtn open={open} onPress={() => setOpen((o) => !o)} /> : null}
        {value ? <Text style={[styles.valueTag, valueWarn && { color: colors.warning }]}>{value}</Text> : null}
      </View>
      {open && info ? <Text style={styles.infoBox}>{info}</Text> : null}
    </View>
  );
}

function LegendDot({ color, label, round }: { color: string; label: string; round?: boolean }) {
  return (
    <View style={styles.rowStart}>
      <View style={[styles.legendDot, { backgroundColor: color, borderRadius: round ? 6 : 2 }]} />
      <Text style={styles.small}>{label}</Text>
    </View>
  );
}

function Fab({ icon, label, onPress, badge }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; badge?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.fab, pressed && { opacity: 0.7 }]} accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color="#fff" />
      <Text style={styles.fabText} numberOfLines={1}>
        {label}
      </Text>
      {badge ? <Text style={styles.fabBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function PanelHead({ title, info, onClose }: { title: string; info?: string; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.rowBetween}>
        <View style={[styles.rowStart, { flexShrink: 1 }]}>
          <Text style={styles.cardTitle}>{title}</Text>
          {info ? <InfoBtn open={open} onPress={() => setOpen((o) => !o)} /> : null}
        </View>
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>
      {open && info ? <Text style={styles.infoBox}>{info}</Text> : null}
    </View>
  );
}

function BuildingPanel({
  b,
  data,
  left,
  busy,
  canPay,
  onUpgrade,
  onSpeed,
  onCollect,
  onMove,
  onShips,
  onFleet,
  onExam,
  onStudy,
  onBook,
  onArms,
  onWalls,
  onTrain,
  onClose,
}: {
  b: GameBuilding;
  data: GameState;
  left: number | null;
  busy: boolean;
  canPay: (c: GameCost) => boolean;
  onUpgrade: () => void;
  onSpeed: (using: "tech" | "pass") => void;
  onCollect: () => void;
  onMove: () => void;
  onShips: () => void;
  onFleet: () => void;
  onExam: () => void;
  onStudy: (unit: string) => void;
  onBook: (page: number) => void;
  onArms: () => void;
  onWalls: () => void;
  onTrain: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = t(`gm_b_${b.type}`);
  const df = b.defense;
  const walls = b.type === "wall" ? data.buildings.filter((x) => x.type === "wall") : [];
  const wallLow = walls.length ? Math.min(...walls.map((x) => x.level)) : 0;
  const wallTodo = walls.filter((x) => x.level === wallLow);
  const wallNext = wallTodo[0]?.next;
  const wallCost = wallNext ? { steel: wallNext.cost.steel * wallTodo.length, rods: wallNext.cost.rods * wallTodo.length } : null;
  const lines: string[] = [];
  if (b.rate) lines.push(t("gm_rate", { n: b.rate, res: t(b.type === "cutting" ? "gm_steel" : "gm_rods") }));
  if (b.cap) lines.push(t("gm_cap", { n: b.cap, res: t(b.type === "yard" ? "gm_steel" : "gm_rods") }));
  if (b.pending > 0) lines.push(t("gm_pendingLine", { n: b.pending }));
  if (b.room && b.level > 0) lines.push(t(`gm_roomLine_${b.type}`, { n: b.room, step: b.room_step ?? 0 }));
  if (b.type === "pier" && b.level > 0) lines.push(t("gm_fleetLine", { n: data.fleet?.ships.length ?? 0, cap: data.fleet?.cap ?? 0 }));
  if (b.type === "pier" && b.next && b.level > 0) lines.push(t("gm_pierNext", { n: b.next.level + 1 }));
  const speedTech = left !== null ? Math.ceil(left / (data.speed_rule.tech_minutes * 60)) : 0;
  const nx = b.next;
  const block = b.block;
  const workers = !b.instant && data.builders.busy >= data.builders.total;
  return (
    <Card style={{ gap: space.sm }}>
      <PanelHead title={b.level === 0 ? t("gm_building", { name }) : `${name} · ${t("gm_level", { n: b.level })}`} info={t(`gm_desc_${b.type}`)} onClose={onClose} />
      {lines.map((l) => (
        <Text key={l} style={styles.text}>
          {l}
        </Text>
      ))}
      {left !== null ? (
        <>
          <InfoTitle title={t("gm_leftLine", { time: clock(left) })} info={t("gm_speedRule", { m: data.speed_rule.tech_minutes, h: data.speed_rule.pass_hours })} />
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <AppButton
                label={t("gm_speedTech", { n: speedTech })}
                variant="secondary"
                disabled={busy || data.resources.tech < speedTech}
                onPress={() => onSpeed("tech")}
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton label={t("gm_speedPass")} variant="secondary" disabled={busy || data.resources.passes < 1} onPress={() => onSpeed("pass")} />
            </View>
          </View>
        </>
      ) : null}
      {b.type === "dock" ? <AppButton label={t("gm_ships")} icon="boat-outline" onPress={onShips} /> : null}
      {b.type === "pier" && b.level > 0 ? <AppButton label={t("gm_fleetSee")} icon="boat-outline" onPress={onFleet} /> : null}
      {(b.type === "cutting" || b.type === "welding") && b.pending > 0 ? <AppButton label={t("gm_collectAll")} icon="cube-outline" onPress={onCollect} disabled={busy} /> : null}
      {b.type === "academy" ? <AppButton label={t("gm_armsTitle")} icon="flask-outline" onPress={onArms} /> : null}
      {b.type === "trainhall" && b.level > 0 ? <AppButton label={t("gm_ct_title")} icon="people-outline" onPress={onTrain} /> : null}
      {df ? (
        <View style={styles.next}>
          <Text style={styles.text}>
            {df.dmg > 0 ? t("gm_defPower", { dmg: df.dmg, range: df.range }) : df.buff ? t("gm_defBuff", { n: df.buff, range: df.range }) : t("gm_defHp", { hp: df.hp })}
          </Text>
          {df.unit ? (
            <>
              <Text style={styles.small}>{t("gm_defUnit", { no: df.unit.no, title: df.unit.title })}</Text>
              <InfoTitle
                title={df.rate === null ? t("gm_defRateFew", { n: df.n }) : t("gm_defRate", { rate: df.rate, mult: df.mult.toFixed(2) })}
                color={df.mult < 1 ? "#FF8A80" : df.mult > 1 ? "#7FD18F" : undefined}
                info={t("gm_defRule")}
              />
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <AppButton label={t("gm_defStudy")} icon="create-outline" onPress={() => onStudy(df.unit!.key)} disabled={busy} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppButton label={t("gm_defBook")} icon="book-outline" variant="secondary" onPress={() => onBook(df.unit!.pdf_page)} />
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.small}>{t("gm_defNoBook")}</Text>
          )}
          {df.boost ? <Text style={styles.small}>{t("gm_defBoost")}</Text> : null}
        </View>
      ) : null}
      {b.type === "wall" && walls.length > 1 && wallNext && wallCost ? (
        <View style={styles.next}>
          <Text style={styles.text}>{t("gm_wallsAll", { n: wallTodo.length, from: wallLow, to: wallLow + 1 })}</Text>
          <CostIcons cost={wallCost} instant res={data.resources} />
          {wallTodo[0].block === "hq_level" ? <Text style={styles.warn}>{t("gm_blockHq")}</Text> : (
            <AppButton label={canPay(wallCost) ? t("gm_wallsAllBtn") : t("gm_err_money")} icon="layers-outline" disabled={busy || !canPay(wallCost)} onPress={onWalls} />
          )}
        </View>
      ) : null}
      {nx && left === null ? (
        <View style={styles.next}>
          <Text style={styles.text}>{t("gm_nextLevel", { n: nx.level })}</Text>
          <CostIcons cost={nx.cost} seconds={nx.seconds} instant={b.instant} res={data.resources} />
          {block === "exam" && nx.exam ? (
            <>
              <Text style={styles.warn}>{t("gm_examNeed", { rule: examRule(t, nx.exam) })}</Text>
              <AppButton label={t("gm_examStart")} icon="school-outline" onPress={onExam} disabled={busy} />
            </>
          ) : block === "hq_level" ? (
            <Text style={styles.warn}>{t("gm_blockHq")}</Text>
          ) : null}
          {!block ? (
            <AppButton
              label={workers ? t("gm_err_builders") : canPay(nx.cost) ? t("gm_upgrade") : t("gm_err_money")}
              icon="arrow-up-circle-outline"
              disabled={busy || workers || !canPay(nx.cost)}
              onPress={onUpgrade}
            />
          ) : null}
        </View>
      ) : !nx ? (
        <Text style={styles.small}>{t("gm_maxLevel")}</Text>
      ) : null}
      {!b.fixed && left === null ? <AppButton label={t("gm_move")} icon="move-outline" variant="secondary" onPress={onMove} /> : null}
    </Card>
  );
}

function ShipPanel({
  data,
  busy,
  canPay,
  gone,
  tab,
  setTab,
  onClose,
  onStart,
  onBuildPier,
  onNext,
  onSpeed,
  onHull,
  onFit,
  onArms,
  onRepair,
  onRepairSpeed,
}: {
  data: GameState;
  busy: boolean;
  canPay: (c: GameCost) => boolean;
  gone: number;
  onHull: (id: string) => void;
  onFit: (id: string, weapons: GameWeaponKind[]) => void;
  onArms: () => void;
  tab: "merchant" | "war";
  onRepair: (id: string) => void;
  onRepairSpeed: (id: string, using: "tech" | "pass") => void;
  setTab: (t: "merchant" | "war") => void;
  onClose: () => void;
  onStart: (k: GameShipKind | GameWarKind) => void;
  onBuildPier: () => void;
  onNext: () => void;
  onSpeed: (using: "tech" | "pass") => void;
}) {
  const { t } = useTranslation();
  const s = data.ship;
  const fleet = data.fleet;
  const fleetBox = fleet ? (
    <View style={styles.next}>
      <InfoTitle title={t("gm_fleetTitle", { n: fleet.ships.length, cap: fleet.cap })} info={fleet.ships.length ? t("gm_slotHint") : undefined} />
      {fleet.cap === 0 ? <Text style={styles.small}>{t("gm_fleetNoPier")}</Text> : null}
      {fleet.ships.length === 0 && fleet.cap > 0 ? <Text style={styles.small}>{t("gm_fleetEmpty")}</Text> : null}
      {fleet.ships.map((f) => {
        const arms = f.weapons ?? ["gun"];
        const have = (data.weapons?.list ?? []).filter((w) => w.level > 0).map((w) => w.kind);
        const cycle = (i: number) => {
          // 칸을 누를 때마다 연구한 무기를 차례로 바꿔 끼움
          const cur = arms[i];
          const nxt = have[(have.indexOf(cur as GameWeaponKind) + 1) % have.length];
          const list = [...arms];
          if (i >= list.length) list.push(have[0]);
          else list[i] = nxt;
          onFit(f.id, list as GameWeaponKind[]);
        };
        const hn = f.hull_next;
        const hullCost = hn ? { steel: hn.cost.steel, rods: hn.cost.rods } : null;
        const canHull = !!hn && !hn.block && !!hullCost && canPay(hullCost) && data.resources.tech >= (hn?.cost.tech ?? 0);
        return (
          <View key={f.id} style={styles.shipCard}>
            <View style={styles.rowStart}>
              <Ionicons name="boat" size={16} color={WAR_COLOR} />
              <Text style={styles.text}>{t("gm_fleetShip", { ship: t(`gm_ship_${f.kind}`), no: f.no })}</Text>
            </View>
            <Text style={styles.small}>{t("gm_shipStats2", { hull: f.hull ?? 1, hp: f.max_hp ?? f.hp, attack: f.attack ?? f.power })}</Text>
            <View style={styles.chips}>
              {Array.from({ length: f.slots }, (_, i) => (
                <Pressable key={i} disabled={busy || have.length === 0} onPress={() => cycle(i)} style={[styles.chip, !arms[i] && { borderStyle: "dashed" }]}>
                  <Text style={styles.chipText}>{arms[i] ? t(`gm_w_${arms[i]}`) : t("gm_slotEmpty")}</Text>
                </Pressable>
              ))}
            </View>
            {f.repair_left !== undefined ? (
              <View style={{ gap: 4 }}>
                <Text style={styles.warn}>{t("gm_repairing", { time: clock(Math.max(0, f.repair_left - gone)) })}</Text>
                <View style={styles.row2}>
                  <Pressable disabled={busy || data.resources.tech < (f.repair_speed?.tech ?? 0)} onPress={() => onRepairSpeed(f.id, "tech")} style={styles.chip}>
                    <Text style={styles.chipText}>{t("gm_speedTech", { n: f.repair_speed?.tech ?? 0 })}</Text>
                  </Pressable>
                  <Pressable disabled={busy || data.resources.passes < 1} onPress={() => onRepairSpeed(f.id, "pass")} style={styles.chip}>
                    <Text style={styles.chipText}>{t("gm_speedPass")}</Text>
                  </Pressable>
                </View>
              </View>
            ) : f.repair ? (
              <View style={{ gap: 4 }}>
                <Text style={styles.warn}>{t("gm_damaged", { n: f.damage ?? 0, max: f.max_hp ?? f.hp })}</Text>
                <Pressable disabled={busy || data.resources.rods < f.repair.rods} onPress={() => onRepair(f.id)} style={[styles.linkRow, data.resources.rods < f.repair.rods && { opacity: 0.5 }]}>
                  <Ionicons name="construct-outline" size={14} color={colors.primary} />
                  <Text style={styles.linkText}>{t("gm_repairShort")}</Text>
                  <CostIcons cost={{ rods: f.repair.rods }} seconds={f.repair.seconds} res={data.resources} />
                </Pressable>
              </View>
            ) : null}
            {hn ? (
              <Pressable disabled={busy || !canHull} onPress={() => onHull(f.id)} style={[styles.linkRow, !canHull && { opacity: 0.5 }]}>
                <Ionicons name="arrow-up-circle-outline" size={14} color={colors.primary} />
                <Text style={styles.linkText}>
                  {hn.block === "hq_level" ? t("gm_hullHq") : hn.block === "max" ? t("gm_maxLevel") : t("gm_hullUpShort", { n: hn.level })}
                </Text>
                {!hn.block ? <CostIcons cost={hullCost} tech={hn.cost.tech} res={data.resources} /> : null}
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {fleet.ships.length ? <AppButton label={t("gm_armsTitle")} icon="flask-outline" variant="secondary" onPress={onArms} /> : null}
    </View>
  ) : null;
  if (s) {
    const left = Math.max(0, s.left - gone);
    const ready = s.ready || left <= 0;
    const tech = Math.ceil(left / (data.speed_rule.tech_minutes * 60));
    return (
      <Card style={{ gap: space.sm }}>
        <PanelHead title={t(s.war ? "gm_warBuilding" : "gm_shipBuilding", { ship: t(`gm_ship_${s.kind}`) })} onClose={onClose} />
        <View style={styles.steps}>
          {Array.from({ length: STAGES }, (_, i) => (
            <View key={i} style={[styles.stepBar, { backgroundColor: i < s.stage || (i === s.stage && ready) ? colors.primary : i === s.stage ? "#FFD166" : colors.border }]} />
          ))}
        </View>
        <Text style={styles.small}>{Array.from({ length: STAGES }, (_, i) => t(stageKey(i, s.war))).join(" → ")}</Text>
        {ready ? (
          <Text style={styles.text}>{t(s.war ? "gm_warAllDone" : "gm_shipAllDone")}</Text>
        ) : (
          <>
            <Text style={styles.text}>
              {t("gm_stageNow", { stage: t(stageKey(s.stage, s.war)) })} · {t("gm_shipTotalLeft", { time: clock(left) })}
            </Text>
            <Text style={styles.small}>{t("gm_stageAuto")}</Text>
          </>
        )}
        {ready ? (
          <AppButton
            label={t(s.war ? "gm_warCommission" : "gm_shipDeliver")}
            icon="arrow-forward-circle-outline"
            disabled={busy}
            onPress={onNext}
          />
        ) : (
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <AppButton label={t("gm_speedTech", { n: tech })} variant="secondary" disabled={busy || data.resources.tech < tech} onPress={() => onSpeed("tech")} />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton label={t("gm_speedPass")} variant="secondary" disabled={busy || data.resources.passes < 1} onPress={() => onSpeed("pass")} />
            </View>
          </View>
        )}
        {s.war ? fleetBox : null}
      </Card>
    );
  }
  const tabs = (
    <View style={styles.row2}>
      {(["merchant", "war"] as const).map((k) => (
        <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabOn]}>
          <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{t(k === "war" ? "gm_warTab" : "gm_merchantTab")}</Text>
        </Pressable>
      ))}
    </View>
  );
  if (tab === "war") {
    const lockText = (x: NonNullable<GameState["warships"]>[number]) =>
      x.lock === "soon" ? t("gm_warLockSoon") : x.lock === "hq" ? t("gm_needHq", { n: x.hq }) : x.lock === "dock" ? t("gm_shipLockDock", { n: x.dock })
        : x.lock === "pier" ? t("gm_warLockPier") : x.lock === "fleet_full" ? t("gm_warLockFull") : "";
    return (
      <Card style={{ gap: space.sm }}>
        <PanelHead title={t("gm_ships")} info={t("gm_warIntro")} onClose={onClose} />
        {tabs}
        {fleetBox}
        {fleet?.cap === 0 ? <AppButton label={t("gm_buildPier")} icon="hammer-outline" onPress={onBuildPier} /> : null}
        {(data.warships ?? []).map((x) => {
          const lock = lockText(x);
          const ok = !x.lock && canPay(x.cost);
          return (
            <View key={x.kind} style={[styles.item, x.lock === "soon" && { opacity: 0.55 }]}>
              <Ionicons name="boat" size={22} color={x.lock ? colors.faint : WAR_COLOR} />
              <View style={{ flex: 1, gap: 2 }}>
                <InfoTitle title={t(`gm_ship_${x.kind}`)} value={lock ? `🔒 ${lock}` : undefined} valueWarn info={t(`gm_warRole_${x.kind}`)} />
                <Text style={styles.small}>{t("gm_warStats", { hp: x.hp, power: x.power, slots: x.slots })}</Text>
                <CostIcons cost={x.cost} seconds={x.seconds} res={data.resources} />
              </View>
              <Pressable style={[styles.smallBtn, !ok && { opacity: 0.4 }]} disabled={!ok || busy} onPress={() => onStart(x.kind)}>
                <Text style={styles.smallBtnText}>{t("gm_shipStart")}</Text>
              </Pressable>
            </View>
          );
        })}
      </Card>
    );
  }
  return (
    <Card style={{ gap: space.sm }}>
      <PanelHead title={t("gm_ships")} info={t("gm_shipIntroAuto")} onClose={onClose} />
      {tabs}
      {data.ships.map((x) => {
        const lock = x.lock === "dock" ? t("gm_shipLockDock", { n: x.dock }) : x.lock === "units" ? t("gm_shipLockUnits", { n: x.units }) : "";
        const ok = !x.lock && canPay(x.cost);
        return (
          <View key={x.kind} style={styles.item}>
            <Ionicons name="boat" size={22} color={x.lock ? colors.faint : colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <InfoTitle
                title={t(`gm_ship_${x.kind}`)}
                value={lock ? `🔒 ${lock}` : undefined}
                valueWarn
                info={`${t("gm_shipPay", { steel: x.pay.steel, rods: x.pay.rods, tech: x.pay.tech })}${x.first_bonus ? `\n${t("gm_shipFirstBonus", { n: x.first_bonus })}` : ""}`}
              />
              <CostIcons cost={x.cost} seconds={x.seconds} res={data.resources} />
              <CostIcons lead={t("gm_getShort")} plus cost={x.pay} tech={x.pay.tech} fame={x.fame} />
            </View>
            <Pressable style={[styles.smallBtn, !ok && { opacity: 0.4 }]} disabled={!ok || busy} onPress={() => onStart(x.kind)}>
              <Text style={styles.smallBtnText}>{t("gm_shipStart")}</Text>
            </Pressable>
          </View>
        );
      })}
      {data.delivered.length ? <Text style={styles.small}>{t("gm_deliveredCount", { n: data.delivered.length })}</Text> : null}
    </Card>
  );
}

/** 해적 연습 전투: 단계 고르기 → 출격할 전투함·들어갈 길·먼저 칠 목표 → 출격 (자동 전투, 다시 보기) + 태풍 대비 훈련 */
function BattlePanel({
  initialStage,
  data,
  pirate,
  busy,
  error,
  onClose,
  onAttack,
  onReplay,
  onTyphoon,
  onFleet,
  onPlan,
}: {
  /** 바다 지도에서 고른 해적 단계 (없으면 아직 별 3개가 아닌 첫 단계) */
  initialStage?: number | null;
  data: GameState;
  pirate: GamePirate | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onAttack: (plan: { stage: number; ships: string[]; lane: GameLane; target: "defense" | "hq" }) => void;
  onReplay: (id: string) => void;
  onTyphoon: () => void;
  onFleet: () => void;
  onPlan: (stage: number) => void;
}) {
  const { t } = useTranslation();
  const ships = data.fleet?.ships ?? [];
  const ready = ships.filter((f) => !f.damage && f.repair_left === undefined);
  const [stage, setStage] = useState<number | null>(initialStage ?? null);
  const [pick, setPick] = useState<string[] | null>(null);
  const [lane, setLane] = useState<GameLane>("middle");
  const [target, setTarget] = useState<"defense" | "hq">("defense");
  const open = pirate?.stages.filter((x) => x.open) ?? [];
  const cur = stage ?? (open.find((x) => x.stars < 3) ?? open[open.length - 1])?.no ?? 1;
  const chosen = (pick ?? ready.map((f) => f.id)).filter((id) => ready.some((f) => f.id === id));
  const ty = pirate?.typhoon;
  return (
    <Card style={{ gap: space.sm }}>
      <PanelHead title={t("gm_bt_panel")} info={t("gm_bt_intro")} onClose={onClose} />
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      {!pirate && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {pirate ? (
        <>
          <View style={styles.chips}>
            {pirate.stages.map((x) => (
              <Pressable key={x.no} disabled={!x.open} onPress={() => setStage(x.no)} style={[styles.stageChip, cur === x.no && styles.stageOn, !x.open && { opacity: 0.4 }]}>
                <Text style={styles.chipText}>{x.open ? t("gm_bt_stage", { n: x.no }) : `🔒 ${x.no}`}</Text>
                <Text style={styles.starText}>{[0, 1, 2].map((k) => (k < x.stars ? "★" : "☆")).join("")}</Text>
              </Pressable>
            ))}
          </View>
          {(() => {
            const x = pirate.stages[cur - 1];
            const parts = Object.entries(x.counts).filter(([k]) => k !== "hut").map(([k, v]) => `${t(`gm_b_${k}`)} ${v}`);
            return (
              <View style={styles.next}>
                <InfoTitle title={t("gm_bt_stageTitle", { n: x.no, lv: x.power })} info={t("gm_bt_starRule")} />
                <Text style={styles.small}>{parts.join(" · ")}</Text>
                <CostIcons lead={t("gm_bt_reward")} plus cost={x.reward} tech={x.reward.tech} fame={x.reward.fame} />
              </View>
            );
          })()}
          <Text style={styles.text}>{t("gm_bt_ships", { n: chosen.length })}</Text>
          {ships.length === 0 ? <Text style={styles.warn}>{t("gm_bt_noFleet")}</Text> : null}
          <View style={styles.chips}>
            {ships.map((f) => {
              const ok = ready.some((r) => r.id === f.id);
              const on = chosen.includes(f.id);
              return (
                <Pressable
                  key={f.id}
                  disabled={!ok}
                  onPress={() => setPick(on ? chosen.filter((id) => id !== f.id) : [...chosen, f.id])}
                  style={[styles.chip, on && styles.stageOn, !ok && { opacity: 0.4 }]}
                >
                  <Text style={styles.chipText}>
                    {t("gm_fleetShip", { ship: t(`gm_ship_${f.kind}`), no: f.no })}
                    {ok ? ` · ${f.attack ?? f.power}` : ` · ${t("gm_bt_hurt")}`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {ships.length > ready.length ? (
            <Pressable onPress={onFleet} style={styles.linkRow}>
              <Ionicons name="construct-outline" size={14} color={colors.primary} />
              <Text style={styles.linkText}>{t("gm_bt_repairGo")}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.text}>{t("gm_bt_laneTitle")}</Text>
          <View style={styles.row2}>
            {(["north", "middle", "south"] as GameLane[]).map((k) => (
              <Pressable key={k} onPress={() => setLane(k)} style={[styles.tab, lane === k && styles.tabOn]}>
                <Text style={[styles.tabText, lane === k && styles.tabTextOn]}>{t(`gm_bt_lane_${k}`)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.text}>{t("gm_bt_tgtTitle")}</Text>
          <View style={styles.row2}>
            {(["defense", "hq"] as const).map((k) => (
              <Pressable key={k} onPress={() => setTarget(k)} style={[styles.tab, target === k && styles.tabOn]}>
                <Text style={[styles.tabText, target === k && styles.tabTextOn]}>{t(k === "hq" ? "gm_bt_tgtHq" : "gm_bt_tgtDef")}</Text>
              </Pressable>
            ))}
          </View>
          <AppButton label={t("gm_bt_attack")} icon="flag-outline" disabled={busy || chosen.length === 0} onPress={() => onAttack({ stage: cur, ships: chosen, lane, target })} />
          {/* G2c-2: 지도를 눌러 작전을 짜고 대원을 상륙시키기 */}
          <AppButton label={t("gm_pl_open")} icon="navigate-outline" variant="secondary" onPress={() => onPlan(cur)} />
          {pirate.history.length ? (
            <View style={styles.next}>
              <Text style={styles.text}>{t("gm_bt_history")}</Text>
              {pirate.history.map((h) => (
                <Pressable key={h.id} onPress={() => onReplay(h.id)} style={styles.linkRow}>
                  <Ionicons name="play-circle-outline" size={14} color={colors.primary} />
                  <Text style={styles.linkText}>
                    {t("gm_bt_stage", { n: h.stage })} {[0, 1, 2].map((k) => (k < h.stars ? "★" : "☆")).join("")} · {h.pct ?? 0}%
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {ty ? (
            <View style={styles.next}>
              <InfoTitle big title={t("gm_ty_title")} info={t("gm_ty_intro", { n: ty.quiz, steel: ty.steel, rods: ty.rods, tech: ty.tech })} />
              <CostIcons lead={t("gm_maxGet")} plus cost={ty} tech={ty.tech} />
              <Text style={styles.small}>{t("gm_ty_walls", { pct: ty.wall_pct, max: ty.wall_part })}</Text>
              {ty.done_today ? (
                <Text style={styles.text}>{t("gm_ty_done")}</Text>
              ) : (
                <AppButton label={t("gm_ty_start")} icon="thunderstorm-outline" disabled={busy} onPress={onTyphoon} />
              )}
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/** 무기 연구: 연구소 레벨에 따라 열리고 기술 포인트로 연구, 레벨 올리기 (본관 레벨까지) */
function ArmsPanel({
  data,
  busy,
  onClose,
  onFleet,
  onResearch,
  onUpgrade,
}: {
  data: GameState;
  busy: boolean;
  onClose: () => void;
  onFleet: () => void;
  onResearch: (k: GameWeaponKind) => void;
  onUpgrade: (k: GameWeaponKind) => void;
}) {
  const { t } = useTranslation();
  const w = data.weapons;
  const r = data.resources;
  return (
    <Card style={{ gap: space.sm }}>
      <PanelHead title={t("gm_armsTitle")} info={`${t("gm_armsIntro", { n: w?.academy ?? 0 })}\n${t("gm_armsFoot")}`} onClose={onClose} />
      {(w?.list ?? []).map((x) => {
        const nx = x.next;
        const canUp = !!nx && !nx.block && r.steel >= nx.cost.steel && r.rods >= nx.cost.rods && r.tech >= nx.cost.tech;
        const canRes = !x.level && !x.lock && r.tech >= x.tech;
        return (
          <View key={x.kind} style={styles.item}>
            <Ionicons name={x.level ? "flash" : "lock-closed-outline"} size={20} color={x.level ? "#FFD166" : colors.faint} />
            <View style={{ flex: 1, gap: 2 }}>
              <InfoTitle
                title={t(`gm_w_${x.kind}`)}
                value={x.level ? t("gm_level", { n: x.level }) : x.lock ? `🔒 ${t("gm_needAcademy", { n: x.academy })}` : undefined}
                valueWarn={!x.level && !!x.lock}
                info={t(`gm_wdesc_${x.kind}`)}
              />
              {x.power > 0 ? <Text style={styles.small}>{t("gm_wPower", { n: x.power })}{nx && !nx.block ? ` → ${nx.power}` : ""}</Text> : null}
              {!x.level ? (
                !x.lock ? <CostIcons tech={x.tech} res={r} /> : null
              ) : nx ? (
                nx.block ? (
                  <Text style={styles.warnSm}>{nx.block === "hq_level" ? t("gm_blockHq") : t("gm_maxLevel")}</Text>
                ) : (
                  <CostIcons cost={nx.cost} tech={nx.cost.tech} res={r} />
                )
              ) : null}
            </View>
            {!x.level ? (
              <Pressable style={[styles.smallBtn, !canRes && { opacity: 0.4 }]} disabled={!canRes || busy} onPress={() => onResearch(x.kind)}>
                <Text style={styles.smallBtnText}>{t("gm_research")}</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.smallBtn, !canUp && { opacity: 0.4 }]} disabled={!canUp || busy} onPress={() => onUpgrade(x.kind)}>
                <Text style={styles.smallBtnText}>{t("gm_upgradeShort")}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      <AppButton label={t("gm_fleetSee")} icon="boat-outline" variant="secondary" onPress={onFleet} />
    </Card>
  );
}

/** 간척(땅 넓히기): 지금 크기·다음 단계 조건·공사 중이면 남은 시간과 당기기 */
function ReclaimCard({
  rc,
  data,
  left,
  busy,
  canPay,
  onStart,
  onSpeed,
}: {
  rc: NonNullable<GameState["reclaim"]>;
  data: GameState;
  left: number | null;
  busy: boolean;
  canPay: (c: GameCost) => boolean;
  onStart: () => void;
  onSpeed: (using: "tech" | "pass") => void;
}) {
  const { t } = useTranslation();
  const nx = rc.next;
  const tech = left !== null ? Math.ceil(left / (data.speed_rule.tech_minutes * 60)) : 0;
  const why =
    rc.block === "hq_level" && nx ? t("gm_needHq", { n: nx.hq }) : rc.block === "soon" ? t("gm_reclaimSoon") : rc.block === "builders" ? t("gm_err_builders") : "";
  return (
    <View style={[styles.next, { borderTopWidth: 0, paddingTop: 0 }]}>
      <View style={styles.rowStart}>
        <View style={[styles.swatch, { backgroundColor: "#D9C08A" }]} />
        <InfoTitle title={t("gm_reclaim")} value={t("gm_reclaimSize", { g: rc.grid })} info={t("gm_reclaimDesc")} />
      </View>
      {left !== null && nx ? (
        <>
          <Text style={styles.text}>
            {t("gm_reclaimNow", { g: nx.grid })} · {t("gm_leftLine", { time: clock(left) })}
          </Text>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <AppButton label={t("gm_speedTech", { n: tech })} variant="secondary" disabled={busy || data.resources.tech < tech} onPress={() => onSpeed("tech")} />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton label={t("gm_speedPass")} variant="secondary" disabled={busy || data.resources.passes < 1} onPress={() => onSpeed("pass")} />
            </View>
          </View>
        </>
      ) : nx ? (
        <>
          <Text style={styles.small}>{t("gm_reclaimNext", { g: nx.grid, sea: nx.sea })}</Text>
          <CostIcons cost={nx.cost} seconds={nx.seconds} res={data.resources} />
          {why ? <Text style={styles.warnSm}>{why}</Text> : null}
          <AppButton
            label={!rc.block && !canPay(nx.cost) ? t("gm_err_money") : t("gm_reclaimStart", { g: nx.grid })}
            icon="expand-outline"
            disabled={busy || !!rc.block || !canPay(nx.cost)}
            onPress={onStart}
          />
        </>
      ) : (
        <Text style={styles.small}>{t("gm_reclaimMax")}</Text>
      )}
    </View>
  );
}

function EarnPanel({ data, onClose }: { data: GameState; onClose: () => void }) {
  const { t } = useTranslation();
  const e = data.earn;
  const rows: [string, string][] = [
    [t("gm_earn_supply"), `${t("gm_steel")} +${e.supply_steel} · ${t("gm_rods")} +${e.supply_rods}`],
    [t("gm_earn_dailyDone"), `${t("gm_steel")} +${e.daily_done_steel} · ${t("gm_earn_factory")}`],
    [t("gm_earn_dailyOk"), `${t("gm_rods")} +${e.daily_ok_rods} (${t("gm_earn_short")} +${e.daily_ok_rods_short})`],
    [t("gm_earn_redo"), `${t("gm_tech")} +${e.redo_tech}`],
    [t("gm_earn_live"), `${t("gm_rods")} +${e.live_ok_rods}`],
    [t("gm_earn_tutor"), `${t("gm_tech")} +${e.tutor_ok_tech}`],
    [t("gm_earn_unit", { pct: data.units.rule.pages_pct, n: data.units.rule.correct }), `${t("gm_tech")} +${e.unit_done_tech}`],
    [t("gm_earn_practice"), `${t("gm_steel")} +${e.practice_steel}`],
    [t("gm_earn_pass", { high: e.pass_high_score, jump: e.pass_jump }), t("gm_earn_passMax", { n: e.pass_day_max })],
  ];
  return (
    <Card style={{ gap: space.sm }}>
      <PanelHead title={t("gm_earnTitle")} onClose={onClose} />
      <Text style={styles.small}>{t("gm_earnIntro")}</Text>
      {rows.map(([a, b]) => (
        <View key={a} style={styles.earnRow}>
          <Text style={[styles.text, { flex: 1 }]}>{a}</Text>
          <Text style={[styles.small, { flex: 1, textAlign: "right" }]}>{b}</Text>
        </View>
      ))}
      <Text style={styles.small}>{t("gm_earnNote")}</Text>
    </Card>
  );
}

/** "OX 10 · 단답형 3 중 8개 맞히기" */
function examRule(t: TFunction, ex: { counts: Record<string, number>; total: number; pass: number }) {
  const parts = (["ox", "mc", "word", "short"] as const).filter((k) => ex.counts[k] > 0).map((k) => `${t(`gm_kind_${k}`)} ${ex.counts[k]}`);
  return t("gm_examRule", { list: parts.join(" · "), total: ex.total, pass: ex.pass });
}

function ExamPanel({
  exam,
  answers,
  setAnswer,
  result,
  error,
  busy,
  spec,
  onSubmit,
  onRetry,
  onUpgrade,
  canUpgrade,
  upgradeNote,
  onClose,
}: {
  exam: GameExam | null;
  answers: Record<string, string | number>;
  setAnswer: (id: string, v: string | number) => void;
  result: GameExamResult | null;
  error: string;
  busy: boolean;
  spec: { counts: Record<string, number>; total: number; pass: number } | null;
  onSubmit: () => void;
  onRetry: () => void;
  onUpgrade: () => void;
  canUpgrade: boolean;
  upgradeNote: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const done = exam ? exam.questions.filter((q) => String(answers[q.id] ?? "").trim() !== "").length : 0;
  return (
    <Card style={{ gap: space.sm }}>
      <PanelHead title={t("gm_examTitle", { n: exam?.target ?? result?.target ?? "" })} onClose={onClose} />
      {spec ? <Text style={styles.small}>{examRule(t, spec)}</Text> : null}
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      {!exam && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {exam && exam.short_of > 0 ? <Text style={styles.small}>{t("gm_examShortOf", { n: exam.total })}</Text> : null}
      {result ? (
        <Text style={[styles.text, { color: result.passed ? colors.success : colors.warning, fontWeight: "700" }]}>
          {result.passed ? t("gm_examPassed") : t("gm_examFailed")} {t("gm_examScore", { right: result.right, total: result.total, pass: result.pass })}
        </Text>
      ) : null}
      {exam ? <QuizList questions={exam.questions} answers={answers} setAnswer={setAnswer} result={result} /> : null}
      {exam && !result ? (
        <AppButton
          label={t("gm_examSubmit", { done, total: exam.total })}
          icon="checkmark-done-outline"
          disabled={busy || done < exam.total}
          onPress={onSubmit}
        />
      ) : null}
      {busy && exam && !result ? <Text style={styles.small}>{t("gm_examGrading")}</Text> : null}
      {result ? (
        <View style={[styles.examResult, { borderColor: result.passed ? colors.success : colors.warning }]}>
          <Text style={[styles.cardTitle, { color: result.passed ? colors.success : colors.warning }]}>
            {result.passed ? t("gm_examPassed") : t("gm_examFailed")}
          </Text>
          <Text style={styles.text}>{t("gm_examScore", { right: result.right, total: result.total, pass: result.pass })}</Text>
          {result.unsure ? <Text style={styles.small}>{t("gm_examUnsure", { n: result.unsure })}</Text> : null}
          {result.passed ? (
            <>
              <AppButton label={t("gm_examUpgrade", { n: result.target })} icon="arrow-up-circle-outline" disabled={busy || !canUpgrade} onPress={onUpgrade} />
              {upgradeNote ? <Text style={styles.small}>{upgradeNote}</Text> : null}
            </>
          ) : (
            <AppButton label={t("gm_examRetry")} icon="refresh-outline" disabled={busy} onPress={onRetry} />
          )}
        </View>
      ) : null}
    </Card>
  );
}

type QuizResult = { results: { id: string; correct: boolean | null; feedback: string; correct_choice: number | null; model_answer: string }[] };

/** 문제 목록 (승급 시험·자재 조달 같이 씀): OX 단추, 객관식 목록, 단답형·서술형 입력, 채점 뒤 ✅❌·정답 표시 */
function QuizList({
  questions,
  answers,
  setAnswer,
  result,
}: {
  questions: GameExamQuestion[];
  answers: Record<string, string | number>;
  setAnswer: (id: string, v: string | number) => void;
  result: QuizResult | null;
}) {
  const { t } = useTranslation();
  const res = result ? Object.fromEntries(result.results.map((r) => [r.id, r])) : {};
  return (
    <>
      {questions.map((q, i) => {
        const r = res[q.id];
        const text = q.tr?.question || q.question;
        const choices = q.tr?.choices?.length ? q.tr.choices : q.choices;
        const mine = answers[q.id];
        return (
          <View key={q.id} style={styles.examQ}>
            <Text style={styles.text}>
              {r ? (r.correct ? "✅ " : r.correct === null ? "⏳ " : "❌ ") : ""}
              {i + 1}. [{t(`gm_kind_${q.kind}`)}] {text}
            </Text>
            {q.kind === "ox" ? (
              <View style={styles.row2}>
                {["O", "X"].map((lab, k) => (
                  <Pressable
                    key={lab}
                    disabled={!!result}
                    onPress={() => setAnswer(q.id, k)}
                    style={[styles.choice, { flex: 1, alignItems: "center" }, mine === k && styles.choiceOn, r && r.correct_choice === k && styles.choiceRight]}
                  >
                    <Text style={styles.choiceBig}>{lab}</Text>
                  </Pressable>
                ))}
              </View>
            ) : q.kind === "mc" ? (
              choices.map((c, k) => (
                <Pressable
                  key={k}
                  disabled={!!result}
                  onPress={() => setAnswer(q.id, k)}
                  style={[styles.choice, mine === k && styles.choiceOn, r && r.correct_choice === k && styles.choiceRight]}
                >
                  <Text style={styles.text}>
                    {k + 1}. {c}
                  </Text>
                </Pressable>
              ))
            ) : (
              <TextInput
                editable={!result}
                value={String(mine ?? "")}
                onChangeText={(v) => setAnswer(q.id, v)}
                multiline={q.kind === "short"}
                placeholder={t(q.kind === "short" ? "gm_examTypeLong" : "gm_examTypeWord")}
                placeholderTextColor={colors.faint}
                style={[styles.input, q.kind === "short" && { minHeight: 70, textAlignVertical: "top" }]}
              />
            )}
            {r && (q.kind === "word" || q.kind === "short") && r.model_answer ? (
              <Text style={styles.small}>{t("gm_examModel", { a: r.model_answer })}</Text>
            ) : null}
            {r?.feedback ? <Text style={styles.small}>{r.feedback}</Text> : null}
          </View>
        );
      })}
    </>
  );
}

function SupplyPanel({
  supply,
  answers,
  setAnswer,
  result,
  error,
  busy,
  onSubmit,
  onAgain,
  onClose,
}: {
  supply: GameSupply | null;
  answers: Record<string, string | number>;
  setAnswer: (id: string, v: string | number) => void;
  result: GameSupplyResult | null;
  error: string;
  busy: boolean;
  onSubmit: () => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const done = supply ? supply.questions.filter((q) => String(answers[q.id] ?? "").trim() !== "").length : 0;
  const left = supply && supply.day_max ? supply.day_max - supply.done_today - (result ? 1 : 0) : null;
  return (
    <Card style={{ gap: space.sm }}>
      <PanelHead title={t("gm_supplyTitle")} onClose={onClose} />
      <Text style={styles.small}>
        {supply ? t("gm_supplyRule", { steel: supply.steel, rods: supply.rods }) : ""}
        {left !== null ? ` ${t("gm_supplyLeft", { n: Math.max(0, left) })}` : ""}
      </Text>
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      {!supply && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {supply && supply.short_of > 0 ? <Text style={styles.small}>{t("gm_examShortOf", { n: supply.total })}</Text> : null}
      {supply?.swapped ? <Text style={styles.small}>{t("gm_supplySwapped")}</Text> : null}
      {supply ? <QuizList questions={supply.questions} answers={answers} setAnswer={setAnswer} result={result} /> : null}
      {supply && !result ? (
        <AppButton label={t("gm_examSubmit", { done, total: supply.total })} icon="checkmark-done-outline" disabled={busy || done < supply.total} onPress={onSubmit} />
      ) : null}
      {busy && supply && !result ? <Text style={styles.small}>{t("gm_examGrading")}</Text> : null}
      {result ? (
        <View style={[styles.examResult, { borderColor: result.right > 0 ? colors.success : colors.warning }]}>
          <Text style={[styles.cardTitle, { color: result.right > 0 ? colors.success : colors.warning }]}>
            {t("gm_supplyScore", { right: result.right, total: result.total })}
          </Text>
          <View style={styles.rowStart}>
            <View style={[styles.dot, { backgroundColor: RES_COLOR.steel }]} />
            <Text style={styles.text}>{t("gm_steel")} +{result.got.steel}</Text>
            <View style={[styles.dot, { backgroundColor: RES_COLOR.rods, marginLeft: 10 }]} />
            <Text style={styles.text}>{t("gm_rods")} +{result.got.rods}</Text>
          </View>
          {result.full ? <Text style={[styles.small, { color: "#FFD166" }]}>{t("gm_supplyFull")}</Text> : null}
          {result.unsure ? <Text style={styles.small}>{t("gm_examUnsure", { n: result.unsure })}</Text> : null}
          {left === null || left > 0 ? (
            <AppButton label={t("gm_supplyAgain")} icon="refresh-outline" disabled={busy} onPress={onAgain} />
          ) : (
            <Text style={styles.small}>{t("gm_supplyDone")}</Text>
          )}
        </View>
      ) : null}
    </Card>
  );
}

const HUD = "#0B2033D9";
const BL_W = 96 + 8 + 3 * 62 + 34 + 16;   // 아래 왼쪽 [바다 지도] + 서랍 자리
const BR_W = 96 + 16;                      // 아래 오른쪽 [짓기] 자리
const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#1F6FA8" },
  center: { alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  trainCard: { backgroundColor: "#0F2236", borderRadius: radius.md, borderWidth: 1, borderColor: "#FFFFFF22", padding: space.sm, gap: space.sm, width: 520, maxWidth: "100%" },
  hudTL: { position: "absolute", gap: 4 },
  hudTR: { position: "absolute", gap: 4, alignItems: "flex-end" },
  hudBL: { position: "absolute", flexDirection: "row", gap: 8, alignItems: "flex-end" },
  hudBR: { position: "absolute", gap: 6, alignItems: "flex-end" },
  lvBadge: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#2F5F9E", borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  lvNum: { color: "#fff", fontSize: 20, fontWeight: "800" },
  lvName: { color: "#fff", fontSize: 13, fontWeight: "700", textShadowColor: "#000", textShadowRadius: 3 },
  lvSub: { fontSize: 11, fontWeight: "700", textShadowColor: "#000", textShadowRadius: 3 },
  sideCol: { gap: 6, marginTop: 4 },
  side: { width: 52, height: 52, borderRadius: 12, backgroundColor: HUD, alignItems: "center", justifyContent: "center", gap: 1, borderWidth: 1, borderColor: "#FFFFFF22" },
  resBar: { width: 190, height: 28, borderRadius: 14, backgroundColor: HUD, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, overflow: "hidden" },
  resFill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.55 },
  tray: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: HUD, borderRadius: 16, padding: 4 },
  trayArrow: { width: 26, height: 58, alignItems: "center", justifyContent: "center" },
  weldy: { position: "absolute", gap: 4, alignItems: "stretch" },
  weldySmall: { maxWidth: "100%", alignSelf: "flex-start" },
  builderChip: { color: "#fff", fontSize: 12, fontWeight: "700", backgroundColor: HUD, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden", borderWidth: 1, borderColor: "transparent" },
  big: { width: 96, height: 96, borderRadius: 20, alignItems: "center", justifyContent: "center", gap: 2, borderBottomWidth: 5 },
  bigText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  abWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", gap: 6 },
  abTitle: { color: "#fff", fontSize: 14, fontWeight: "800", backgroundColor: HUD, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, overflow: "hidden" },
  abRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center", paddingHorizontal: 8 },
  abBtn: { width: 84, height: 72, borderRadius: 16, backgroundColor: "#0B2033EE", alignItems: "center", justifyContent: "center", gap: 1, borderWidth: 1, borderColor: "#FFFFFF33" },
  abHot: { backgroundColor: "#E07B1FEE", borderColor: "#FFD166" },
  abText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  abSub: { color: "#FFE7C2", fontSize: 10 },
  blSec: { color: "#C9D6EE", fontSize: 12, fontWeight: "700", textAlign: "center", backgroundColor: "#26324A", borderRadius: 8, paddingVertical: 4, overflow: "hidden", marginTop: 4 },
  blRow: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: "#1C2A42", borderRadius: 12, padding: 8 },
  blIcon: { width: 38, height: 38, borderRadius: 8, justifyContent: "flex-end" },
  blLv: { position: "absolute", left: -4, bottom: -4, color: "#fff", backgroundColor: "#111", borderRadius: 6, paddingHorizontal: 4, fontSize: 11, overflow: "hidden" },
  blWorkers: { flexDirection: "row", gap: 6, marginTop: 4 },
  blWorker: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 6 },
  resRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center" },
  res: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: HUD, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 8 },
  resValue: { color: "#fff", fontSize: 13, fontWeight: "700" },
  resLabel: { color: "#FFFFFFCC", fontSize: 11 },
  resOn: { borderWidth: 1, borderColor: "#FFD166" },
  infoCard: { backgroundColor: "#0B2033F2", borderRadius: radius.md, padding: 10, gap: 6, maxWidth: 360, borderWidth: 1, borderColor: "#FFFFFF33" },
  infoTitle: { color: "#fff", fontSize: 14, fontWeight: "700" },
  infoText: { color: "#fff", fontSize: 12, lineHeight: 17 },
  infoSmall: { color: "#FFFFFFAA", fontSize: 11 },
  infoBtn: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  examResult: { borderWidth: 1.5, borderRadius: radius.md, padding: space.sm, gap: space.sm },
  examQ: { gap: 6, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  choice: { backgroundColor: colors.cardAlt, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  choiceRight: { borderColor: colors.success },
  choiceBig: { color: colors.text, fontSize: 18, fontWeight: "800" },
  input: { backgroundColor: colors.cardAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, color: colors.text, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  resSub: { color: "#FFFFFF88", fontSize: 10 },
  dot: { width: 8, height: 8, borderRadius: 2 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: HUD, alignItems: "center", justifyContent: "center" },
  roundSm: { width: 32, height: 32, borderRadius: 16, backgroundColor: HUD, alignItems: "center", justifyContent: "center" },
  rowStart: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  row2: { flexDirection: "row", gap: space.sm },
  badge: { color: "#fff", fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden", backgroundColor: "#0B2033CC" },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  text: { color: colors.text, fontSize: 14 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  hint: { color: "#FFFFFFAA", fontSize: 11, marginLeft: 52 },
  warn: { color: colors.warning, fontSize: 13 },
  warnSm: { color: colors.warning, fontSize: 12 },
  textB: { color: colors.text, fontSize: 14, fontWeight: "700" },
  valueTag: { color: colors.muted, fontSize: 12, fontWeight: "600", backgroundColor: "#ffffff12", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: "hidden" },
  infoBox: { color: colors.muted, fontSize: 12, lineHeight: 17, backgroundColor: "#ffffff0d", borderRadius: 8, padding: 8 },
  costRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  costItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  costText: { color: colors.text, fontSize: 12, fontVariant: ["tabular-nums"] },
  link: { color: "#FFB066", fontSize: 12 },
  toastWrap: { position: "absolute", left: 300, gap: 6, alignItems: "flex-end" },
  toast: { backgroundColor: "#0B2033F2", borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.primary, maxWidth: 420 },
  toastTitle: { color: colors.success, fontSize: 12, fontWeight: "700" },
  toastText: { color: "#fff", fontSize: 13, lineHeight: 18 },
  toastSmall: { color: "#FFFFFFAA", fontSize: 11 },
  tutRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HUD, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10, alignSelf: "flex-start" },
  tutTitle: { color: "#fff", fontSize: 12, fontWeight: "700" },
  tutNow: { color: "#FFD166", fontSize: 12, flexShrink: 1 },
  steps: { flexDirection: "row", gap: 3 },
  stepDot: { width: 14, height: 5, borderRadius: 3 },
  stepBar: { flex: 1, height: 6, borderRadius: 3 },
  buddyRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  /** 화면이 좁으면 '할 일' 단추를 말풍선 아래로 (말풍선이 너무 좁아지지 않게) */
  buddyCol: { flexDirection: "column", alignItems: "flex-start" },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, maxWidth: 170 },
  actText: { color: "#fff", fontWeight: "700", fontSize: 13, flexShrink: 1 },
  fab: { width: 58, height: 58, borderRadius: 14, backgroundColor: HUD, alignItems: "center", justifyContent: "center", gap: 2, borderWidth: 1, borderColor: "#FFFFFF22" },
  fabText: { color: "#fff", fontSize: 10 },
  fabBadge: { position: "absolute", top: -6, right: -6, color: "#fff", backgroundColor: colors.danger, borderRadius: 9, paddingHorizontal: 5, minWidth: 18, textAlign: "center", fontSize: 11, overflow: "hidden" },
  sheet: { position: "absolute", backgroundColor: "#0E1624EE", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  busy: { position: "absolute", alignSelf: "center" },
  legendDot: { width: 10, height: 10 },
  item: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  swatch: { width: 18, height: 18, borderRadius: 4 },
  tab: { flex: 1, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  tabTextOn: { color: "#fff" },
  smallBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  next: { gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm },
  earnRow: { flexDirection: "row", gap: space.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  stageChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 8, alignItems: "center", backgroundColor: colors.cardAlt },
  stageOn: { borderColor: "#FFD166", borderWidth: 2 },
  starText: { color: "#FFD166", fontSize: 11 },
  shipCard: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.primary, borderRadius: 12, paddingVertical: 3, paddingHorizontal: 10, backgroundColor: colors.cardAlt },
  chipText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2 },
  linkText: { color: colors.primary, fontSize: 12 },
  partyBg: { backgroundColor: "#000000AA", alignItems: "center", justifyContent: "center" },
  partyCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, gap: space.sm, width: 420, maxWidth: "90%", borderWidth: 2, borderColor: "#FFD166", alignItems: "stretch" },
  partyTitle: { color: "#FFD166", fontSize: 22, fontWeight: "800", textAlign: "center" },
  partyShip: { color: colors.text, fontSize: 15, textAlign: "center" },
  partyItems: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  partyItem: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 10 },
  partyItemText: { color: colors.text, fontSize: 14, fontWeight: "700" },
});
