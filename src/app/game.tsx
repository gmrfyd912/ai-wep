import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { StudyBuddy } from "@/components/StudyBuddy";
import { AppButton, Body, Card, Screen } from "@/components/ui";
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
  }
  return t("gm_err_other");
}

/** G1 웰디의 조선소: 내 조선소 (공부로 받은 자원으로 짓고 올리고 배를 만든다) */
export default function GameScreen() {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
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
        if (d.delivered_now) setMsg(t("gm_delivered", { ship: t(`gm_ship_${d.delivered_now.kind}`), fame: d.delivered_now.fame }));
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
      <Screen>
        {error ? (
          <>
            <Body>{error}</Body>
            <AppButton label={t("gm_retry")} icon="refresh-outline" onPress={load} />
          </>
        ) : (
          <View style={{ paddingVertical: 40, gap: space.md, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
            <Body muted>{t("gm_loading")}</Body>
          </View>
        )}
      </Screen>
    );
  }

  const W = Math.max(22, Math.floor(((width - 2 * space.lg) / (data.grid + 2.6)) * (zoom ? 1.8 : 1)));
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
      if (c) setMsg(c.steel + c.rods > 0 ? t("gm_collected", { steel: c.steel, rods: c.rods }) : t("gm_collectedNone"));
    });

  const shipNext = () =>
    run(gameShipNext, (d) => {
      if (d.delivered_now) setMsg(t("gm_delivered", { ship: t(`gm_ship_${d.delivered_now.kind}`), fame: d.delivered_now.fame }));
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
        return { label: t("gm_shipNext"), onPress: shipNext };
      case "collect":
        return { label: t("gm_collectAll"), onPress: doCollect };
      case "units":
        return data.book_id ? { label: t("gm_openBook"), onPress: () => router.push(`/book?id=${data.book_id}&page=${x.pdf_page}`) } : null;
      case "idle": {
        const b = data.buildings.find((k) => k.type === x.type);
        return b
          ? { label: t("gm_seeBuilding", { name: name(String(x.type)) }), onPress: () => { setSelected(b.id); setMode("home"); } }
          : { label: t("gm_build"), onPress: () => setMode("build") };
      }
      case "ship_idle":
        return { label: t("gm_ships"), onPress: () => setMode("ship") };
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
        return { label: t("gm_ships"), onPress: () => setMode("ship") };
      case "hq": {
        const hq = data.buildings.find((b) => b.type === "hq");
        return hq ? { label: t("gm_seeBuilding", { name: name("hq") }), onPress: () => setSelected(hq.id) } : null;
      }
      default:
        return null;
    }
  };
  const action = tutStep ? tutAction() : tipAction(tip);

  return (
    <Screen>
      {/* 자원 */}
      <View style={styles.resRow}>
        <ResChip color={RES_COLOR.steel} label={t("gm_steel")} value={`${res.steel}`} sub={`/ ${data.caps.steel}`} />
        <ResChip color={RES_COLOR.rods} label={t("gm_rods")} value={`${res.rods}`} sub={`/ ${data.caps.rods}`} />
        <ResChip color={RES_COLOR.tech} label={t("gm_tech")} value={`${res.tech}`} />
        <ResChip color={RES_COLOR.passes} label={t("gm_passes")} value={`${res.passes}`} />
        <ResChip color={RES_COLOR.fame} label={t("gm_fame")} value={`${res.fame}`} />
      </View>
      <View style={styles.rowWrap}>
        <Text style={[styles.badge, { backgroundColor: data.run_today ? colors.success : colors.cardAlt }]}>
          {data.run_today ? t("gm_runOn") : t("gm_runOff")}
        </Text>
        <Text style={[styles.badge, { backgroundColor: colors.cardAlt }]}>
          {t("gm_builders", { busy: data.builders.busy, total: data.builders.total })}
        </Text>
        <Text style={[styles.badge, { backgroundColor: colors.cardAlt }]}>
          {t("gm_unitsDone", { done: data.units.done, total: data.units.total })}
        </Text>
      </View>

      {rewards ? (
        <Card style={{ gap: space.xs, borderColor: colors.success, borderWidth: 1 }}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{t("gm_rewardsTitle")}</Text>
            <Pressable onPress={() => setRewards(null)} hitSlop={10}>
              <Ionicons name="close" size={18} color={colors.muted} />
            </Pressable>
          </View>
          <Text style={styles.text}>{rewardLine(t, rewards)}</Text>
          <Text style={styles.small}>{whyLine(t, rewards.why)}</Text>
        </Card>
      ) : null}

      {msg ? (
        <Pressable onPress={() => setMsg("")}>
          <Text style={styles.msg}>{msg}</Text>
        </Pressable>
      ) : null}

      {/* 처음 따라 하기 */}
      {tutStep ? (
        <Card style={{ gap: space.sm }}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{t("gm_tutTitle", { n: (tut.step ?? 0) + 1, total: tut.steps.length })}</Text>
            <Pressable onPress={() => run(() => gameTutorial(true))} hitSlop={10}>
              <Text style={styles.link}>{t("gm_tutSkip")}</Text>
            </Pressable>
          </View>
          <View style={styles.steps}>
            {tut.steps.map((s, i) => (
              <View key={s.id} style={[styles.stepBar, { backgroundColor: s.ok ? colors.primary : i === tut.step ? "#FFD166" : colors.border }]} />
            ))}
          </View>
          <Text style={styles.small}>{tut.steps.map((s, i) => `${i + 1} ${t(`gm_tutShort_${s.id}`)}${s.ok ? " ✓" : ""}`).join(" · ")}</Text>
        </Card>
      ) : null}

      {/* 웰디 */}
      <Card style={{ gap: space.sm }}>
        <StudyBuddy text={buddyLine} size={78} onPress={tutStep || tips.length < 2 ? undefined : () => setTipAt((n) => n + 1)} hint={tutStep || tips.length < 2 ? undefined : t("gm_tipNext")} />
        {action ? <AppButton label={action.label} onPress={action.onPress} disabled={busy} /> : null}
      </Card>

      {/* 지도 */}
      <View style={styles.rowBetween}>
        <Text style={styles.small}>{mode === "place" ? t("gm_placeHint") : t("gm_mapHint")}</Text>
        <Pressable onPress={() => setZoom((z) => !z)} style={styles.zoomBtn} hitSlop={6}>
          <Ionicons name={zoom ? "contract-outline" : "expand-outline"} size={16} color={colors.text} />
          <Text style={styles.small}>{zoom ? t("gm_zoomOut") : t("gm_zoomIn")}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal style={styles.mapBox} contentContainerStyle={{ alignItems: "flex-start" }} showsHorizontalScrollIndicator={zoom}>
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
      </ScrollView>
      <View style={styles.legend}>
        <LegendDot color="#73C985" label={t("gm_legendFree")} />
        <LegendDot color="#0B2033" label={t("gm_legendTimer")} />
        <LegendDot color="#2E9D5B" label={t("gm_legendDone")} />
        <LegendDot color={RES_COLOR.steel} round label={t("gm_legendCoin")} />
      </View>

      {/* 아래 칸 */}
      {mode === "place" && placeType ? (
        <Card style={{ gap: space.sm }}>
          <Text style={styles.cardTitle}>{moveId ? t("gm_moveTitle", { name: name(placeType) }) : t("gm_placeTitle", { name: name(placeType) })}</Text>
          <Text style={styles.small}>{pick ? t("gm_placePicked") : t("gm_placeHint")}</Text>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <AppButton label={t("common_cancel")} variant="secondary" onPress={() => setMode(moveId ? "home" : "build")} />
            </View>
            <View style={{ flex: 2 }}>
              <AppButton label={moveId ? t("gm_moveHere") : t("gm_buildHere")} disabled={!pick || busy} onPress={confirmPlace} />
            </View>
          </View>
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
        <EarnPanel data={data} onClose={() => setMode("home")} />
      ) : (
        <View style={styles.grid}>
          <Tile icon="hammer-outline" label={t("gm_build")} onPress={() => setMode("build")} />
          <Tile icon="boat-outline" label={t("gm_ships")} onPress={() => setMode("ship")} badge={data.ship?.ready ? "!" : undefined} />
          <Tile
            icon="cube-outline"
            label={t("gm_collectAll")}
            sub={data.pending.steel + data.pending.rods > 0 ? `+${data.pending.steel} / +${data.pending.rods}` : undefined}
            onPress={doCollect}
          />
          <Tile icon="school-outline" label={t("gm_earnTitle")} onPress={() => setMode("earn")} />
          <Tile icon="create-outline" label={t("gm_goDaily")} onPress={() => router.push("/daily")} />
          <Tile icon="book-outline" label={t("gm_openBook")} onPress={() => (data.book_id ? router.push(`/book?id=${data.book_id}&page=${data.units.next?.pdf_page ?? 1}`) : null)} />
        </View>
      )}
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      <Text style={styles.foot}>{t("gm_footnote")}</Text>
    </Screen>
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

function ResChip({ color, label, value, sub }: { color: string; label: string; value: string; sub?: string }) {
  return (
    <View style={styles.res}>
      <View style={styles.rowStart}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.resLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.resValue}>{value}</Text>
      {sub ? <Text style={styles.resSub}>{sub}</Text> : null}
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

function Tile({ icon, label, sub, onPress, badge }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; sub?: string; onPress: () => void; badge?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text style={styles.tileText}>{label}</Text>
      {sub ? <Text style={styles.small}>{sub}</Text> : null}
      {badge ? <Text style={styles.tileBadge}>{badge}</Text> : null}
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

const styles = StyleSheet.create({
  resRow: { flexDirection: "row", gap: 6 },
  res: { flex: 1, backgroundColor: colors.card, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 6, borderWidth: 1, borderColor: colors.border },
  resLabel: { color: colors.muted, fontSize: 11, flexShrink: 1 },
  resValue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  resSub: { color: colors.faint, fontSize: 10 },
  dot: { width: 8, height: 8, borderRadius: 2 },
  rowStart: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  row2: { flexDirection: "row", gap: space.sm },
  badge: { color: colors.text, fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: "hidden" },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  text: { color: colors.text, fontSize: 14 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  warn: { color: colors.warning, fontSize: 13 },
  link: { color: colors.primary, fontSize: 13 },
  msg: { color: colors.text, backgroundColor: colors.primaryDim, borderRadius: radius.sm, padding: space.sm, fontSize: 14, overflow: "hidden" },
  steps: { flexDirection: "row", gap: 4 },
  stepBar: { flex: 1, height: 6, borderRadius: 3 },
  mapBox: { backgroundColor: "#1F6FA8", borderRadius: radius.md },
  zoomBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.cardAlt, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  legendDot: { width: 10, height: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: {
    width: "31.5%",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.md,
    alignItems: "center",
    gap: 4,
  },
  tileText: { color: colors.text, fontSize: 13, textAlign: "center" },
  tileBadge: { position: "absolute", top: 6, right: 8, color: "#fff", backgroundColor: colors.danger, borderRadius: 8, paddingHorizontal: 5, fontSize: 11, overflow: "hidden" },
  item: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  swatch: { width: 18, height: 18, borderRadius: 4 },
  smallBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  next: { gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm },
  earnRow: { flexDirection: "row", gap: space.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  foot: { color: colors.faint, fontSize: 11, textAlign: "center", marginTop: space.sm },
});
