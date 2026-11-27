import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { StudyBuddy } from "@/components/StudyBuddy";
import { AppButton, Body, Card } from "@/components/ui";
import {
  gameBuild,
  gameCollect,
  gameMove,
  gameShipNext,
  gameShipStart,
  gameSpeedup,
  gameTutorial,
  gameUpgrade,
  getGame,
  NetworkError,
  type GameBuilding,
  type GameBuildingType,
  type GameCost,
  type GameShipKind,
  type GameState,
  type GameTip,
} from "@/lib/api";
import { BUILDING_COLOR, GameMap, RES_COLOR } from "@/screens/GameMap";
import { colors, radius, space } from "@/theme";

type Mode = "home" | "build" | "place" | "ship" | "earn";
const TYPES: GameBuildingType[] = ["hq", "yard", "rodstore", "cutting", "welding", "academy", "dock"];
const STAGES = 5;

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
      const msg = t(key);
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
  const [data, setData] = useState<GameState | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("home");
  const [selected, setSelected] = useState<string | null>(null);
  const [placeType, setPlaceType] = useState<GameBuildingType | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [pick, setPick] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(false);
  const [tipAt, setTipAt] = useState(0);
  const [rewards, setRewards] = useState<GameState["rewards"]>(null);
  const [, setTick] = useState(0);
  const fetchedAt = useRef(Date.now());
  const reloading = useRef(false);

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
        data.buildings.some((b) => b.left !== undefined && b.left - gone <= 0) || (data.ship && !data.ship.ready && data.ship.left - gone <= 0);
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

  const fitW = Math.floor(Math.min(width / (data.grid + 2.6), height / (data.grid / 2 + 3.6)));
  const W = Math.max(18, Math.floor(fitW * (zoom ? 1.7 : 1)));
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
    return { w, h, skipId: moveId ?? undefined, hint: !moveId && tutStep === "yard" ? tut.spot : null, pick, color: BUILDING_COLOR[placeType] };
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
    });

  // 웰디가 하는 말 (처음 따라 하기 중이면 그 단계, 아니면 오늘의 할 일)
  const tipText = (x: GameTip) => {
    const p: Record<string, string | number> = { ...x };
    if (typeof x.type === "string") p.name = name(x.type);
    if (typeof x.kind === "string") p.ship = t(`gm_ship_${x.kind}`);
    if (typeof x.stage === "number") p.stage = t(`gm_stage_${x.stage}`);
    return t(`gm_tip_${x.id}`, p);
  };
  const buddyLine = tutStep ? t(`gm_tut_${tutStep}`, { steel: data.earn.daily_done_steel }) : tip ? tipText(tip) : "";

  const tipAction = (x: GameTip | undefined): { label: string; onPress: () => void } | null => {
    if (!x) return null;
    switch (x.id) {
      case "daily":
      case "study":
        return { label: t("gm_goDaily"), onPress: () => router.push("/daily") };
      case "ship_ready":
        return { label: data.ship && data.ship.stage >= STAGES - 1 ? t("gm_shipDeliver") : t("gm_shipNext"), onPress: shipNext };
      case "collect":
        return { label: t("gm_collectAll"), onPress: doCollect };
      case "units":
        return data.book_id ? { label: t("gm_openBook"), onPress: () => router.push(`/book?id=${data.book_id}&page=${x.pdf_page}`) } : null;
      case "built":
      case "idle": {
        const b = data.buildings.find((k) => k.type === x.type);
        return b
          ? { label: t("gm_seeBuilding", { name: name(String(x.type)) }), onPress: () => { setSelected(b.id); setMode("home"); } }
          : { label: t("gm_build"), onPress: () => setMode("build") };
      }
      case "ship_idle":
        return { label: t("gm_ships"), onPress: () => setMode("ship") };
      case "pass": {
        const b = data.buildings.find((k) => k.busy_until);
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
        return hq ? { label: t("gm_seeBuilding", { name: name("hq") }), onPress: () => { setSelected(hq.id); setMode("home"); } } : null;
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
      {/* 지도: 화면 꽉 차게 (크게 보기면 위아래·옆으로 밀어서 봄) */}
      <ScrollView style={StyleSheet.absoluteFill} contentContainerStyle={styles.mapOuter} showsVerticalScrollIndicator={false} bounces={false}>
        <ScrollView horizontal contentContainerStyle={styles.mapOuter} showsHorizontalScrollIndicator={false} bounces={false}>
          <View style={{ minWidth: width, minHeight: height, alignItems: "center", justifyContent: "center" }}>
            <GameMap
              grid={data.grid}
              W={W}
              buildings={data.buildings}
              selected={selected}
              labels={labels}
              place={placeSpec}
              ship={data.ship ? { kind: data.ship.kind, stage: data.ship.stage } : null}
              onSelect={(id) => {
                setSelected(id);
                if (id) setMode("home");
              }}
              onPlace={(x, y) => setPick({ x, y })}
              now={{ left: (b) => (leftOf(b) !== null ? clock(leftOf(b)!) : null), done: t("gm_doneChip") }}
            />
          </View>
        </ScrollView>
      </ScrollView>

      {/* 왼쪽 위: 자원 현황 (작게) */}
      <View style={[styles.hudTL, { top: 8 + insets.top, left: 8 + insets.left }]} pointerEvents="box-none">
        <View style={styles.resRow}>
          <Pressable onPress={() => router.back()} style={styles.roundSm} hitSlop={8} accessibilityLabel={t("common_back")}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </Pressable>
          <ResChip color={RES_COLOR.steel} label={t("gm_steel")} value={res.steel} cap={data.caps.steel} />
          <ResChip color={RES_COLOR.rods} label={t("gm_rods")} value={res.rods} cap={data.caps.rods} />
          <ResChip color={RES_COLOR.tech} label={t("gm_tech")} value={res.tech} />
          <ResChip color={RES_COLOR.passes} label={t("gm_passes")} value={res.passes} />
          <ResChip color={RES_COLOR.fame} label={t("gm_fame")} value={res.fame} />
        </View>
        <View style={styles.resRow}>
          <Text style={[styles.badge, { backgroundColor: data.run_today ? "#2E9D5BE6" : "#0B2033CC" }]}>
            {data.run_today ? t("gm_runOnShort") : t("gm_runOffShort")}
          </Text>
          <Text style={styles.badge}>{t("gm_builders", { busy: data.builders.busy, total: data.builders.total })}</Text>
          <Text style={styles.badge}>{t("gm_unitsDone", { done: data.units.done, total: data.units.total })}</Text>
        </View>
      </View>

      {/* 오른쪽 위: 크게/작게, 자원 얻는 법 */}
      {!panelOpen ? (
        <View style={[styles.hudTR, { top: 8 + insets.top, right: 8 + insets.right }]}>
          <Pressable onPress={() => setZoom((z) => !z)} style={styles.roundSm} hitSlop={6} accessibilityLabel={zoom ? t("gm_zoomOut") : t("gm_zoomIn")}>
            <Ionicons name={zoom ? "remove" : "add"} size={20} color="#fff" />
          </Pressable>
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
          <View style={styles.buddyRow}>
            <View style={{ flex: 1 }}>
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
          <Fab icon="boat" label={t("gm_ships")} onPress={() => setMode("ship")} badge={data.ship?.ready ? "!" : undefined} />
          <Fab icon="cube" label={t("gm_collectShort")} onPress={doCollect} badge={pendingN > 0 ? `${pendingN}` : undefined} />
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
            {mode === "place" && placeType ? (
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
                onShips={() => setMode("ship")}
                onBook={() => data.book_id && data.units.next && router.push(`/book?id=${data.book_id}&page=${data.units.next.pdf_page}`)}
                onClose={() => setSelected(null)}
              />
            ) : mode === "build" ? (
              <Card style={{ gap: space.sm }}>
                <PanelHead title={t("gm_build")} onClose={() => setMode("home")} />
                {data.catalog.length === 0 ? <Body muted>{t("gm_buildAllDone")}</Body> : null}
                {data.catalog.map((c) => (
                  <View key={c.type} style={styles.item}>
                    <View style={[styles.swatch, { backgroundColor: BUILDING_COLOR[c.type] }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.text}>{name(c.type)}</Text>
                      <Text style={styles.small}>{t(`gm_desc_${c.type}`)}</Text>
                      <Text style={styles.small}>
                        {costLine(t, c.cost)} · {clock(c.seconds)}
                        {c.locked ? ` · ${t("gm_needHq", { n: c.unlock })}` : ""}
                      </Text>
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
                {data.builders.busy >= data.builders.total ? <Text style={styles.small}>{t("gm_err_builders")}</Text> : null}
              </Card>
            ) : mode === "ship" ? (
              <ShipPanel data={data} busy={busy} canPay={canPay} gone={gone()} onClose={() => setMode("home")} onStart={(k) => run(() => gameShipStart(k))}
                onNext={shipNext} onSpeed={(using) => run(() => gameSpeedup("ship", using))} />
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

function ResChip({ color, label, value, cap }: { color: string; label: string; value: number; cap?: number }) {
  const full = cap !== undefined && value >= cap;
  return (
    <View style={styles.res} accessibilityLabel={`${label} ${value}`}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.resValue, full && { color: "#FFD166" }]}>{value}</Text>
      {cap !== undefined ? <Text style={styles.resSub}>/{cap}</Text> : null}
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

function PanelHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={styles.rowBetween}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Pressable onPress={onClose} hitSlop={10}>
        <Ionicons name="close" size={20} color={colors.muted} />
      </Pressable>
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
  onBook,
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
  onBook: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = t(`gm_b_${b.type}`);
  const lines: string[] = [];
  if (b.rate) lines.push(t("gm_rate", { n: b.rate, res: t(b.type === "cutting" ? "gm_steel" : "gm_rods") }));
  if (b.cap) lines.push(t("gm_cap", { n: b.cap, res: t(b.type === "yard" ? "gm_steel" : "gm_rods") }));
  if (b.pending > 0) lines.push(t("gm_pendingLine", { n: b.pending }));
  const speedTech = left !== null ? Math.ceil(left / (data.speed_rule.tech_minutes * 60)) : 0;
  const nx = b.next;
  const block = b.block;
  const workers = data.builders.busy >= data.builders.total;
  return (
    <Card style={{ gap: space.sm }}>
      <PanelHead title={b.level === 0 ? t("gm_building", { name }) : `${name} · ${t("gm_level", { n: b.level })}`} onClose={onClose} />
      <Text style={styles.small}>{t(`gm_desc_${b.type}`)}</Text>
      {lines.map((l) => (
        <Text key={l} style={styles.text}>
          {l}
        </Text>
      ))}
      {left !== null ? (
        <>
          <Text style={styles.text}>{t("gm_leftLine", { time: clock(left) })}</Text>
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
          <Text style={styles.small}>{t("gm_speedRule", { m: data.speed_rule.tech_minutes, h: data.speed_rule.pass_hours })}</Text>
        </>
      ) : null}
      {b.type === "dock" ? <AppButton label={t("gm_ships")} icon="boat-outline" onPress={onShips} /> : null}
      {(b.type === "cutting" || b.type === "welding") && b.pending > 0 ? <AppButton label={t("gm_collectAll")} icon="cube-outline" onPress={onCollect} disabled={busy} /> : null}
      {b.type === "academy" ? <Text style={styles.small}>{t("gm_academyLater")}</Text> : null}
      {nx && left === null ? (
        <View style={styles.next}>
          <Text style={styles.text}>{t("gm_nextLevel", { n: nx.level })}</Text>
          <Text style={styles.small}>
            {costLine(t, nx.cost)} · {clock(nx.seconds)}
          </Text>
          {block === "units" ? (
            <>
              <Text style={styles.warn}>{t("gm_blockUnits", { need: nx.units_need ?? 0, done: data.units.done })}</Text>
              {data.units.next ? (
                <Text style={styles.small}>
                  {t("gm_unitNext", {
                    title: data.units.next.title,
                    seen: data.units.next.seen,
                    pages: data.units.next.pages,
                    correct: data.units.next.correct,
                    needCorrect: data.units.rule.correct,
                    pct: data.units.rule.pages_pct,
                  })}
                </Text>
              ) : null}
              <AppButton label={t("gm_openBook")} icon="book-outline" variant="secondary" onPress={onBook} />
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
  onClose,
  onStart,
  onNext,
  onSpeed,
}: {
  data: GameState;
  busy: boolean;
  canPay: (c: GameCost) => boolean;
  gone: number;
  onClose: () => void;
  onStart: (k: GameShipKind) => void;
  onNext: () => void;
  onSpeed: (using: "tech" | "pass") => void;
}) {
  const { t } = useTranslation();
  const s = data.ship;
  if (s) {
    const left = Math.max(0, s.left - gone);
    const ready = s.ready || left <= 0;
    const tech = Math.ceil(left / (data.speed_rule.tech_minutes * 60));
    return (
      <Card style={{ gap: space.sm }}>
        <PanelHead title={t("gm_shipBuilding", { ship: t(`gm_ship_${s.kind}`) })} onClose={onClose} />
        <View style={styles.steps}>
          {Array.from({ length: STAGES }, (_, i) => (
            <View key={i} style={[styles.stepBar, { backgroundColor: i < s.stage || (i === s.stage && ready) ? colors.primary : i === s.stage ? "#FFD166" : colors.border }]} />
          ))}
        </View>
        <Text style={styles.small}>{Array.from({ length: STAGES }, (_, i) => t(`gm_stage_${i}`)).join(" → ")}</Text>
        <Text style={styles.text}>
          {t("gm_stageNow", { stage: t(`gm_stage_${s.stage}`) })} · {ready ? t("gm_stageReady") : t("gm_leftLine", { time: clock(left) })}
        </Text>
        {ready ? (
          <AppButton label={s.stage >= STAGES - 1 ? t("gm_shipDeliver") : t("gm_shipNext")} icon="arrow-forward-circle-outline" disabled={busy} onPress={onNext} />
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
      </Card>
    );
  }
  return (
    <Card style={{ gap: space.sm }}>
      <PanelHead title={t("gm_ships")} onClose={onClose} />
      <Text style={styles.small}>{t("gm_shipIntro")}</Text>
      {data.ships.map((x) => {
        const lock = x.lock === "dock" ? t("gm_shipLockDock", { n: x.dock }) : x.lock === "units" ? t("gm_shipLockUnits", { n: x.units }) : "";
        const ok = !x.lock && canPay(x.cost);
        return (
          <View key={x.kind} style={styles.item}>
            <Ionicons name="boat" size={22} color={x.lock ? colors.faint : colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.text}>
                {t(`gm_ship_${x.kind}`)} · {t("gm_fame")} +{x.fame}
              </Text>
              <Text style={styles.small}>
                {costLine(t, x.cost)} · {clock(x.seconds)}
              </Text>
              <Text style={styles.small}>
                {t("gm_shipPay", { steel: x.pay.steel, rods: x.pay.rods, tech: x.pay.tech })}
                {x.first_bonus ? ` · ${t("gm_shipFirstBonus", { n: x.first_bonus })}` : ""}
              </Text>
              {lock ? <Text style={styles.warn}>{lock}</Text> : null}
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

function EarnPanel({ data, onClose }: { data: GameState; onClose: () => void }) {
  const { t } = useTranslation();
  const e = data.earn;
  const rows: [string, string][] = [
    [t("gm_earn_dailyDone"), `${t("gm_steel")} +${e.daily_done_steel} · ${t("gm_earn_factory")}`],
    [t("gm_earn_dailyOk"), `${t("gm_rods")} +${e.daily_ok_rods} (${t("gm_earn_short")} +${e.daily_ok_rods_short})`],
    [t("gm_earn_redo"), `${t("gm_tech")} +${e.redo_tech}`],
    [t("gm_earn_live"), `${t("gm_rods")} +${e.live_ok_rods}`],
    [t("gm_earn_tutor"), `${t("gm_tech")} +${e.tutor_ok_tech}`],
    [t("gm_earn_unit", { pct: data.units.rule.pages_pct, n: data.units.rule.correct }), `${t("gm_tech")} +${e.unit_done_tech} · ${t("gm_earn_unlock")}`],
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

const HUD = "#0B2033D9";
const FAB_ROW = 5 * 64 + 8;   // 아래 오른쪽 메뉴 단추 5개 자리
const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#1F6FA8" },
  center: { alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  mapOuter: { flexGrow: 1 },
  hudTL: { position: "absolute", gap: 4 },
  hudTR: { position: "absolute", flexDirection: "row", gap: 6 },
  hudBL: { position: "absolute", gap: 4, maxWidth: 560 },
  hudBR: { position: "absolute", flexDirection: "row", gap: 6, alignItems: "flex-end" },
  resRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center" },
  res: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: HUD, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 8 },
  resValue: { color: "#fff", fontSize: 13, fontWeight: "700" },
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
  smallBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  next: { gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm },
  earnRow: { flexDirection: "row", gap: space.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  partyBg: { backgroundColor: "#000000AA", alignItems: "center", justifyContent: "center" },
  partyCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, gap: space.sm, width: 420, maxWidth: "90%", borderWidth: 2, borderColor: "#FFD166", alignItems: "stretch" },
  partyTitle: { color: "#FFD166", fontSize: 22, fontWeight: "800", textAlign: "center" },
  partyShip: { color: colors.text, fontSize: 15, textAlign: "center" },
  partyItems: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  partyItem: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 10 },
  partyItemText: { color: colors.text, fontSize: 14, fontWeight: "700" },
});
