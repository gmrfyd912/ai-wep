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
  type GamePirate,
  type GameTyphoon,
  type GameTyphoonResult,
} from "@/lib/api";
import { BattleReplay } from "@/components/BattleReplay";
import { PanZoom } from "@/components/PanZoom";
import { giftLine } from "@/components/LiveOxPopup";
import { BUILDING_COLOR, GameMap, mapSize, RES_COLOR, WAR_COLOR } from "@/screens/GameMap";
import { colors, radius, space } from "@/theme";

type Mode = "home" | "build" | "place" | "ship" | "earn" | "exam" | "supply" | "arms" | "battle" | "typhoon";
type ResKey = "steel" | "rods" | "tech" | "passes" | "fame";
const TYPES: GameBuildingType[] = ["hq", "yard", "rodstore", "cutting", "welding", "academy", "dock", "pier", "battery", "missile", "mine", "asw", "radar", "wall"];
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
  const [battle, setBattle] = useState<GameBattle | null>(null);
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
  const [, setTick] = useState(0);
  const fetchedAt = useRef(Date.now());
  const reloading = useRef(false);
  // 지도를 끄는 중이거나 막 끝낸 직후의 '톡'은 건물 고르기·자리 고르기로 보지 않음
  const moving = useRef({ on: false, at: 0 });
  const tapOk = () => !moving.current.on && Date.now() - moving.current.at > 250;

  const apply = useCallback((d: GameState) => {
    fetchedAt.current = Date.now();
    setData(d);
    setError("");
  }, []);

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
  const res = data.resources;
  const tut = data.tutorial;
  const tutStep = !tut.done && tut.step !== null ? tut.steps[tut.step].id : null;
  const tips = data.tips;
  const tip = tips[tipAt % tips.length];

  const canPay = (c: GameCost) => res.steel >= c.steel && res.rods >= c.rods;
  const startPlace = (type: GameBuildingType) => {
    setPlaceType(type);
    setMoveId(null);
    setPick(null);
    setSelected(null);
    setMode("place");
  };
  const startMove = (b: GameBuilding) => {
    setMoveId(b.id);
    setPlaceType(b.type);
    setPick(null);
    setMode("place");
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
  const attack = async (plan: { stage: number; ships: string[]; lane: GameLane; target: "defense" | "hq" }) => {
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
  const replay = async (id: string) => {
    try {
      setBattle((await getBattle(id)).battle);
    } catch (e) {
      setExamErr(gameError(t, e));
    }
  };
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
  const panelOpen = mode !== "home" || !!sel;
  const sheetW = Math.min(380, Math.max(280, width * 0.42));
  const pendingN = data.pending.steel + data.pending.rods;

  return (
    <View style={styles.full}>
      <StatusBar hidden />
      {/* 지도: 한 손가락으로 끌어 옮기고, 두 손가락으로 확대·축소 (메뉴·창에 가려진 곳도 끌어서 봄) */}
      <PanZoom width={width} height={height} contentW={mapDim.width} contentH={mapDim.height} zoom={zoom} minZoom={0.7} maxZoom={3} onZoom={setZoom}
        onMove={(on) => { moving.current = { on, at: Date.now() }; }}>
            <GameMap
              grid={data.grid}
              sea={sea}
              reclaiming={rc?.left !== undefined}
              fleet={(data.fleet?.ships ?? []).map((f) => f.kind)}
              W={W}
              buildings={data.buildings}
              selected={selected}
              labels={labels}
              place={placeSpec}
              ship={data.ship ? { kind: data.ship.kind, stage: data.ship.stage, war: data.ship.war } : null}
              onSelect={(id) => {
                if (!tapOk()) return;
                setSelected(id);
                if (id) setMode("home");
              }}
              onPlace={(x, y) => {
                if (!tapOk()) return;
                // 방파 장벽: 칸을 누를 때마다 바로 한 칸씩 (작업 반장 없이)
                if (placeType === "wall" && !moveId) run(() => gameBuild("wall", x, y));
                else setPick({ x, y });
              }}
              now={{ left: (b) => (leftOf(b) !== null ? clock(leftOf(b)!) : null), done: t("gm_doneChip") }}
            />
      </PanZoom>

      {/* 왼쪽 위: 자원 현황 (작게) */}
      <View style={[styles.hudTL, { top: 8 + insets.top, left: 8 + insets.left }]} pointerEvents="box-none">
        <View style={styles.resRow}>
          <Pressable onPress={() => router.back()} style={styles.roundSm} hitSlop={8} accessibilityLabel={t("common_back")}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </Pressable>
          {(["steel", "rods", "tech", "passes", "fame"] as ResKey[]).map((k) => (
            <ResChip
              key={k}
              color={RES_COLOR[k]}
              label={t(`gm_${k}`)}
              value={res[k]}
              cap={k === "steel" || k === "rods" ? data.caps[k] : undefined}
              on={info === k}
              onPress={() => setInfo((cur) => (cur === k ? null : k))}
            />
          ))}
        </View>
        <View style={styles.resRow}>
          <Text style={[styles.badge, { backgroundColor: data.run_today ? "#2E9D5BE6" : "#0B2033CC" }]}>
            {data.run_today ? t("gm_runOnShort") : t("gm_runOffShort")}
          </Text>
          <Text style={styles.badge}>{t("gm_builders", { busy: data.builders.busy, total: data.builders.total })}</Text>
        </View>
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

      {/* 오른쪽 위: 크게/작게, 자원 얻는 법 */}
      {!panelOpen ? (
        <View style={[styles.hudTR, { top: 8 + insets.top, right: 8 + insets.right }]}>
          <Pressable onPress={() => setMode("earn")} style={styles.roundSm} hitSlop={6} accessibilityLabel={t("gm_earnTitle")}>
            <Ionicons name="help" size={18} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      {/* 가운데 위: 알림 (몇 초 뒤 사라짐) */}
      {msg || rewards ? (
        <View style={[styles.toastWrap, { top: 8 + insets.top, right: panelOpen ? sheetW + 16 : 96 }]} pointerEvents="box-none">
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

      {/* 아래 왼쪽: 웰디 안내 + 처음 따라 하기 (작게, 항상 다음 할 일) */}
      {mode !== "place" ? (
        <View style={[styles.hudBL, { bottom: 8 + insets.bottom, left: 8 + insets.left, right: panelOpen ? sheetW + 16 : 8 + insets.right + FAB_ROW }]}>
          {tutStep ? (
            <View style={styles.tutRow}>
              <Text style={styles.tutTitle}>{t("gm_tutTitle", { n: (tut.step ?? 0) + 1, total: tut.steps.length })}</Text>
              <View style={styles.steps}>
                {tut.steps.map((s, i) => (
                  <View key={s.id} style={[styles.stepDot, { backgroundColor: s.ok ? colors.primary : i === tut.step ? "#FFD166" : "#FFFFFF33" }]} />
                ))}
              </View>
              <Text style={styles.tutNow} numberOfLines={1}>
                {t(`gm_tutShort_${tutStep}`)}
              </Text>
              <Pressable onPress={() => run(() => gameTutorial(true))} hitSlop={10}>
                <Text style={styles.link}>{t("gm_tutSkip")}</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={[styles.buddyRow, width - (panelOpen ? sheetW : FAB_ROW) < 470 && styles.buddyCol]}>
            <View style={{ flex: 1, alignSelf: "stretch" }}>
              <StudyBuddy
                compact
                text={buddyLine}
                size={46}
                onPress={tutStep || tips.length < 2 ? undefined : () => setTipAt((n) => n + 1)}
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
          </View>
          {!tutStep && tips.length > 1 ? <Text style={styles.hint}>{t("gm_tipNext")}</Text> : null}
        </View>
      ) : null}

      {/* 아래 오른쪽: 메뉴 단추 */}
      {!panelOpen ? (
        <View style={[styles.hudBR, { bottom: 8 + insets.bottom, right: 8 + insets.right }]}>
          <Fab icon="hammer" label={t("gm_build")} onPress={() => setMode("build")} />
          <Fab icon="boat" label={t("gm_ships")} onPress={() => { setShipTab(data.ship?.war ? "war" : "merchant"); setMode("ship"); }} badge={data.ship?.ready ? "!" : undefined} />
          <Fab icon="cube" label={t("gm_collectShort")} onPress={doCollect} badge={pendingN > 0 ? `${pendingN}` : undefined} />
          <Fab icon="cart" label={t("gm_supplyShort")} onPress={() => openSupply()} />
          <Fab icon="flag" label={t("gm_bt_short")} onPress={openBattle} />
          <Fab icon="create" label={t("gm_dailyShort")} onPress={() => router.push("/daily")} badge={!data.run_today ? "!" : undefined} />
          <Fab
            icon="book"
            label={t("gm_bookShort")}
            onPress={() => (data.book_id ? router.push(`/book?id=${data.book_id}&page=${data.units.next?.pdf_page ?? 1}`) : null)}
          />
        </View>
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
                      <Text style={styles.text}>{t("gm_defCount", { n: c.have ?? 0, max: c.max ?? 0 })}</Text>
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
                onClose={() => setSelected(null)}
              />
            ) : mode === "build" ? (
              <Card style={{ gap: space.sm }}>
                <PanelHead title={t("gm_build")} onClose={() => setMode("home")} />
                {rc ? (
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
                {data.catalog.filter((c) => !c.defense).length === 0 ? <Body muted>{t("gm_buildAllDone")}</Body> : null}
                {data.catalog.filter((c) => !c.defense).map((c) => (
                  <View key={c.type} style={[styles.item, c.locked && { opacity: 0.6 }]}>
                    <View style={[styles.swatch, { backgroundColor: BUILDING_COLOR[c.type] }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <InfoTitle title={name(c.type)} value={c.locked ? `🔒 ${t("gm_needHq", { n: c.unlock })}` : undefined} valueWarn info={t(`gm_desc_${c.type}`)} />
                      <CostIcons cost={c.cost} seconds={c.seconds} res={data.resources} />
                    </View>
                    <Pressable
                      style={[styles.smallBtn, (c.locked || !canPay(c.cost) || data.builders.busy >= data.builders.total) && { opacity: 0.4 }]}
                      disabled={c.locked || !canPay(c.cost) || data.builders.busy >= data.builders.total}
                      onPress={() => startPlace(c.type)}
                    >
                      <Text style={styles.smallBtnText}>{t("gm_pick")}</Text>
                    </Pressable>
                  </View>
                ))}
                <View style={{ marginTop: space.xs }}>
                  <InfoTitle big title={t("gm_defTitle")} info={t("gm_defIntro")} />
                </View>
                {data.catalog.filter((c) => c.defense).map((c) => {
                  const noWorker = !c.instant && data.builders.busy >= data.builders.total;
                  const off = c.locked || c.full || !canPay(c.cost) || noWorker;
                  return (
                    <View key={c.type} style={[styles.item, c.locked && { opacity: 0.6 }]}>
                      <View style={[styles.swatch, { backgroundColor: BUILDING_COLOR[c.type] }]} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <InfoTitle
                          title={name(c.type)}
                          value={c.locked ? `🔒 ${t("gm_needHq", { n: c.unlock })}` : t("gm_defCount", { n: c.have ?? 0, max: c.max ?? 0 })}
                          valueWarn={c.locked}
                          info={`${t(`gm_desc_${c.type}`)}${c.full ? `\n${c.more_at ? t("gm_defFull", { n: c.more_at }) : t("gm_defFullMax")}` : ""}`}
                        />
                        <CostIcons
                          zone={t(c.sea ? "gm_zoneSea" : c.coast ? "gm_zoneCoast" : "gm_zoneLand")}
                          cost={c.cost}
                          seconds={c.seconds}
                          instant={c.instant}
                          res={data.resources}
                        />
                        {c.full && c.more_at ? <Text style={styles.warnSm}>{t("gm_moreAtShort", { n: c.more_at })}</Text> : null}
                      </View>
                      <Pressable style={[styles.smallBtn, off && { opacity: 0.4 }]} disabled={off} onPress={() => startPlace(c.type)}>
                        <Text style={styles.smallBtnText}>{t("gm_pick")}</Text>
                      </Pressable>
                    </View>
                  );
                })}
                {data.builders.busy >= data.builders.total ? <Text style={styles.small}>{t("gm_err_builders")}</Text> : null}
              </Card>
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
              <BattlePanel data={data} pirate={pirate} busy={busy} error={examErr} onClose={() => setMode("home")}
                onAttack={attack} onReplay={replay} onTyphoon={openTyphoon} onFleet={openWar} />
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
      {battle ? <BattleReplay battle={battle} onClose={() => setBattle(null)} /> : null}
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

function ResChip({ color, label, value, cap, on, onPress }: { color: string; label: string; value: number; cap?: number; on?: boolean; onPress: () => void }) {
  const full = cap !== undefined && value >= cap;
  return (
    <Pressable onPress={onPress} hitSlop={4} style={({ pressed }) => [styles.res, on && styles.resOn, pressed && { opacity: 0.7 }]} accessibilityLabel={`${label} ${value}`}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.resLabel}>{label}</Text>
      <Text style={[styles.resValue, full && { color: "#FFD166" }]}>{value}</Text>
      {cap !== undefined ? <Text style={styles.resSub}>/{cap}</Text> : null}
    </Pressable>
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
  data,
  pirate,
  busy,
  error,
  onClose,
  onAttack,
  onReplay,
  onTyphoon,
  onFleet,
}: {
  data: GameState;
  pirate: GamePirate | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onAttack: (plan: { stage: number; ships: string[]; lane: GameLane; target: "defense" | "hq" }) => void;
  onReplay: (id: string) => void;
  onTyphoon: () => void;
  onFleet: () => void;
}) {
  const { t } = useTranslation();
  const ships = data.fleet?.ships ?? [];
  const ready = ships.filter((f) => !f.damage && f.repair_left === undefined);
  const [stage, setStage] = useState<number | null>(null);
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
const FAB_ROW = 7 * 64 + 8;   // 아래 오른쪽 메뉴 단추 7개 자리
const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#1F6FA8" },
  center: { alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  hudTL: { position: "absolute", gap: 4 },
  hudTR: { position: "absolute", flexDirection: "row", gap: 6 },
  hudBL: { position: "absolute", gap: 4, maxWidth: 560 },
  hudBR: { position: "absolute", flexDirection: "row", gap: 6, alignItems: "flex-end" },
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
