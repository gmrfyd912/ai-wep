import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Ellipse, G, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { PanZoom } from "@/components/PanZoom";
import { StudyBuddy } from "@/components/StudyBuddy";
import { AppButton } from "@/components/ui";
import { gameScout, getSea, type GameScout, type GameSea, type SeaTier } from "@/lib/api";
import { BUILDING_COLOR, RES_COLOR } from "@/screens/GameMap";
import { colors, radius, space } from "@/theme";

/** 섬 색 = 내 조선소와 비교한 힘 (범례와 같음) */
export const TIER_COLOR: Record<SeaTier, string> = { easy: "#2E9D5B", even: "#E0B23A", hard: "#D0453A" };
const SHIELD = "#8A949E";
const SAME = "#57C4E5";      // 같은 과정 테두리
const ME = "#FFFFFF";
const PIRATE_BLD: Record<string, string> = { hq: "#3B2A2A", hut: "#7A5A3A" };
const ISLAND_R = 9;          // 섬 크기 (지도 단위)
const NAME_ZOOM = 2.4;       // 이만큼 확대하면 섬마다 이름이 보임

type Target = { kind: "pirate" | "user"; id: string };

/**
 * G2c-1 바다 지도 (전체 화면).
 * 과정마다 만이 있고, 교육생 조선소는 섬, 해적 기지는 해골 섬. 섬을 누르면 정찰 창이 오른쪽에 열린다.
 * 끌어서 옮기고 두 손가락(휠)으로 확대. 빈 바다를 톡 누르면 정찰 창이 닫힌다 (끌기는 안 닫힘).
 */
export function SeaMap({
  onClose,
  onPlan,
  onRaid,
  onDefense,
  defenseNew = 0,
  onPractice,
  errorText,
}: {
  onClose: () => void;
  /** 해적 섬 '작전 짜기' → 해적 연습 전투 창을 그 단계로 */
  onPlan: (stage: number) => void;
  /** 친구 섬 '작전 짜기' */
  onRaid: (id: string) => void;
  onDefense: () => void;
  defenseNew?: number;
  onPractice: () => void;
  errorText: (e: unknown) => string;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [sea, setSea] = useState<GameSea | null>(null);
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(1.3);
  const [zoomNonce, setZoomNonce] = useState(0);
  const zoomBy = (f: number) => {
    setZoom((z) => Math.min(4, Math.max(1, +(z * f).toFixed(2))));
    setZoomNonce((n) => n + 1);
  };
  const [target, setTarget] = useState<Target | null>(null);
  const [scout, setScout] = useState<GameScout | null>(null);
  const [scoutErr, setScoutErr] = useState("");
  const [legend, setLegend] = useState(false);
  const moving = useRef({ on: false, at: 0 });
  const tapOk = () => !moving.current.on && Date.now() - moving.current.at > 250;

  useEffect(() => {
    getSea()
      .then(setSea)
      .catch((e) => setErr(errorText(e)));
  }, [errorText]);

  const open = async (tg: Target) => {
    if (!tapOk()) return;
    setTarget(tg);
    setScout(null);
    setScoutErr("");
    try {
      const r = await gameScout(tg.kind, tg.id);
      setScout(r);
      setSea((s) => (s ? { ...s, scouts: r.scouts } : s));
    } catch (e) {
      setScoutErr(errorText(e));
    }
  };
  const closeCard = () => {
    setTarget(null);
    setScout(null);
    setScoutErr("");
  };

  const sheetW = Math.min(360, Math.max(270, width * 0.4));
  const fit = sea ? Math.min(width / sea.size.w, height / sea.size.h) : 1;
  const k = fit * zoom;
  const cw = (sea?.size.w ?? 1) * k;
  const ch = (sea?.size.h ?? 1) * k;
  const r = Math.max(7, ISLAND_R * k);
  const fs = Math.max(10, 11 * Math.min(k, 1.4));
  const tierName = (x: SeaTier) => t(`gm_sea_${x}`);

  return (
    <View style={[StyleSheet.absoluteFill, styles.bg]}>
      {sea ? (
        <PanZoom width={width} height={height} contentW={cw} contentH={ch} zoom={zoom} minZoom={1} maxZoom={4} onZoom={setZoom} zoomNonce={zoomNonce}
          onMove={(on) => { moving.current = { on, at: Date.now() }; }}
          onTapEmpty={() => tapOk() && closeCard()}>
          <Svg width={cw} height={ch}>
            <Rect x={0} y={0} width={cw} height={ch} fill="#1B5E8F" onPress={() => tapOk() && closeCard()} />
            {/* 물결 무늬 */}
            {Array.from({ length: 24 }).map((_, i) => (
              <Ellipse key={`w${i}`} cx={((i * 197) % sea.size.w) * k} cy={((i * 131) % sea.size.h) * k} rx={18 * k} ry={3 * k} fill="#2A6FA3" />
            ))}
            {/* 과정별 만 */}
            {sea.bays.map((b) => {
              const mine = b.id === sea.me.course;
              return (
                <G key={`bay${b.id}`}>
                  <Circle cx={b.x * k} cy={b.y * k} r={b.r * k} fill={mine ? "#2B7FBF55" : "#2B7FBF33"} stroke={mine ? SAME : "#9CC9E8"}
                    strokeWidth={mine ? 2 : 1} strokeDasharray={mine ? undefined : "6,5"} onPress={() => tapOk() && closeCard()} />
                  <SvgText x={b.lx * k} y={b.ly * k + fs / 2} fill="#fff" fontSize={fs + 2} fontWeight="700" textAnchor="middle">
                    {b.name || t("gm_sea_noCourse")}
                  </SvgText>
                </G>
              );
            })}
            {/* 해적 섬 */}
            {sea.pirates.map((p) => (
              <G key={`p${p.stage}`} onPress={() => open({ kind: "pirate", id: String(p.stage) })} opacity={p.open ? 1 : 0.5}>
                <Circle cx={p.x * k} cy={p.y * k} r={r * 2} fill="transparent" />
                <Ellipse cx={p.x * k} cy={p.y * k} rx={r * 1.4} ry={r} fill="#5A4632" stroke={TIER_COLOR[p.tier]} strokeWidth={2.5} />
                <SvgText x={p.x * k} y={p.y * k + r * 0.4} fill="#fff" fontSize={r * 1.1} textAnchor="middle">☠</SvgText>
                <SvgText x={p.x * k} y={p.y * k + r + fs + 1} fill="#fff" fontSize={fs} fontWeight="700" textAnchor="middle">
                  {`${p.open ? "" : "🔒"}${p.stage} ${[0, 1, 2].map((i) => (i < p.stars ? "★" : "☆")).join("")}`}
                </SvgText>
              </G>
            ))}
            {/* 교육생 조선소 섬 */}
            {sea.islands.map((s) => {
              const x = s.x * k, y = s.y * k;
              return (
                <G key={s.id} onPress={() => (s.me ? closeCard() : open({ kind: "user", id: s.id }))}>
                  <Circle cx={x} cy={y} r={r * 1.6} fill="transparent" />
                  {s.same && !s.me ? <Circle cx={x} cy={y} r={r + 3} fill="none" stroke={SAME} strokeWidth={2} /> : null}
                  <Circle cx={x} cy={y} r={r} fill="#D8C08A" stroke={s.me ? ME : s.shield ? SHIELD : TIER_COLOR[s.tier]} strokeWidth={s.me ? 3 : 2.5} />
                  <Rect x={x - r * 0.35} y={y - r * 0.55} width={r * 0.7} height={r * 0.7} fill={s.me ? "#2F5F9E" : s.shield ? SHIELD : TIER_COLOR[s.tier]} />
                  {s.shield ? <Circle cx={x} cy={y} r={r + 6} fill="#FFFFFF22" stroke="#FFFFFFAA" strokeWidth={1.5} strokeDasharray="3 3" /> : null}
                  {s.me || zoom >= NAME_ZOOM ? (
                    <SvgText x={x} y={y + r + fs} fill="#fff" fontSize={fs} fontWeight={s.me ? "700" : "400"} textAnchor="middle">
                      {s.me ? `★ ${t("gm_sea_me")}` : s.name}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
          </Svg>
        </PanZoom>
      ) : (
        <View style={styles.center}>{err ? <Text style={styles.warn}>{err}</Text> : <ActivityIndicator color="#fff" />}</View>
      )}

      {/* 왼쪽 위: 제목·정찰 횟수·범례 */}
      <View style={[styles.hud, { top: 8 + insets.top, left: 8 + insets.left }]} pointerEvents="box-none">
        <View style={styles.row}>
          <Pressable onPress={onClose} style={styles.round} hitSlop={8} accessibilityLabel={t("common_back")}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </Pressable>
          <Text style={styles.title}>{t("gm_sea_title")}</Text>
          {sea ? (
            <Text style={styles.badge}>
              {sea.scouts.max ? t("gm_sea_scouts", { used: sea.scouts.used, max: sea.scouts.max }) : t("gm_sea_scouts", { used: sea.scouts.used, max: "∞" })}
            </Text>
          ) : null}
          <Pressable onPress={() => setLegend((v) => !v)} hitSlop={8} accessibilityLabel={t("gm_infoA11y")}>
            <Ionicons name="information-circle-outline" size={20} color="#fff" />
          </Pressable>
        </View>
        {/* 범례 (항상 보임) */}
        <View style={styles.legend}>
          {(["easy", "even", "hard"] as SeaTier[]).map((x) => (
            <View key={x} style={styles.legItem}>
              <View style={[styles.dot, { backgroundColor: TIER_COLOR[x] }]} />
              <Text style={styles.legText}>{tierName(x)}</Text>
            </View>
          ))}
          <View style={styles.legItem}>
            <View style={[styles.dot, { borderWidth: 2, borderColor: ME, backgroundColor: "#2F5F9E" }]} />
            <Text style={styles.legText}>{t("gm_sea_me")}</Text>
          </View>
          <View style={styles.legItem}>
            <View style={[styles.dot, { borderWidth: 2, borderColor: SAME, backgroundColor: "transparent" }]} />
            <Text style={styles.legText}>{t("gm_sea_same")}</Text>
          </View>
          <View style={styles.legItem}>
            <View style={[styles.dot, { backgroundColor: SHIELD }]} />
            <Text style={styles.legText}>🛡 {t("gm_sea_shield")}</Text>
          </View>
          <View style={styles.legItem}>
            <Text style={styles.legText}>☠ {t("gm_sea_pirate")}</Text>
          </View>
        </View>
        {legend && sea ? <Text style={styles.infoBox}>{t("gm_sea_info", { max: sea.scouts.max || "∞" })}</Text> : null}
      </View>

      {/* 확대·축소 단추 (두 손가락이 어려운 PC 웹에서도) */}
      {!target ? (
        <View style={[styles.zoomCol, { bottom: 8 + insets.bottom, right: 8 + insets.right }]}>
          <Pressable onPress={() => zoomBy(1.4)} style={styles.round} accessibilityLabel="+">
            <Ionicons name="add" size={20} color="#fff" />
          </Pressable>
          <Pressable onPress={() => zoomBy(1 / 1.4)} style={styles.round} accessibilityLabel="-">
            <Ionicons name="remove" size={20} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      {/* 아래 왼쪽: 해적 연습 전투·태풍 훈련 (기존 창) */}
      {!target ? (
        <View style={[styles.hudBL, { bottom: 8 + insets.bottom, left: 8 + insets.left }]}>
          <View style={styles.row}>
            <Pressable onPress={onPractice} style={styles.pill}>
              <Ionicons name="flag" size={16} color="#fff" />
              <Text style={styles.pillText}>{t("gm_sea_practice")}</Text>
            </Pressable>
            <Pressable onPress={onDefense} style={styles.pill}>
              <Ionicons name="shield-half-outline" size={16} color="#fff" />
              <Text style={styles.pillText}>{t("gm_df_title")}{defenseNew ? ` (${defenseNew})` : ""}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* 오른쪽: 정찰 창 */}
      {target ? (
        <View style={[styles.sheet, { width: sheetW, top: 8 + insets.top, bottom: 8 + insets.bottom, right: 8 + insets.right }]}>
          <ScrollView contentContainerStyle={{ gap: space.sm, padding: space.sm }}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {scout?.kind === "user" ? t("gm_sc_user", { name: scout.name }) : target.kind === "pirate" ? t("gm_sc_pirate", { n: target.id }) : "…"}
              </Text>
              <Pressable onPress={closeCard} hitSlop={10} accessibilityLabel={t("common_close")}>
                <Ionicons name="close" size={20} color="#fff" />
              </Pressable>
            </View>
            {scoutErr ? <Text style={styles.warn}>{scoutErr}</Text> : null}
            {!scout && !scoutErr ? <ActivityIndicator color={colors.primary} /> : null}
            {scout ? <ScoutCard s={scout} sea={sea} onPlan={onPlan} onRaid={onRaid} onOther={closeCard} /> : null}
            {scoutErr ? <AppButton label={t("gm_sc_other")} icon="search-outline" variant="secondary" onPress={closeCard} /> : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** 정찰 결과: 본관·힘·배치 그림·방어 시설 수·가져올 것·(해적) 예상 별·웰디 한마디·단추 */
function ScoutCard({ s, sea, onPlan, onRaid, onOther }: {
  s: GameScout; sea: GameSea | null; onPlan: (stage: number) => void; onRaid: (id: string) => void; onOther: () => void;
}) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<"loot" | "expect" | null>(null);
  const tierC = s.tier ? TIER_COLOR[s.tier] : undefined;
  const counts = Object.entries(s.counts).map(([k, v]) => `${t(`gm_b_${k}`)} ${v}`);
  return (
    <>
      <View style={styles.row}>
        <Text style={styles.tag}>{t("gm_sc_hq", { n: s.hq })}</Text>
        <Text style={styles.tag}>{t("gm_sc_power", { n: s.score })}</Text>
        {s.tier ? <Text style={[styles.tag, { backgroundColor: tierC }]}>{t(`gm_sea_${s.tier}`)}</Text> : null}
        {s.same ? <Text style={[styles.tag, { borderWidth: 1, borderColor: SAME }]}>{t("gm_sc_same")}</Text> : null}
      </View>
      <MiniBase s={s} />
      {counts.length ? <Text style={styles.small}>{counts.join(" · ")}</Text> : null}
      <Text style={styles.small}>
        {t("gm_ct_enemyGuards", {
          list: Object.entries(s.guards ?? {}).filter(([, v]) => v).map(([k, v]) => `${t(`gm_crew_${k}`)} ${v}`).join(" · ") || t("gm_ct_none"),
        })}
      </Text>
      <View style={styles.row}>
        <Text style={styles.text}>{s.kind === "pirate" ? t("gm_sc_lootPirate") : t("gm_sc_loot")}</Text>
        {s.kind === "user" ? (
          <Pressable onPress={() => setInfo(info === "loot" ? null : "loot")} hitSlop={8}>
            <Ionicons name="information-circle-outline" size={16} color="#FFFFFFAA" />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.row}>
        {(["steel", "rods", "tech", "fame"] as const).map((key) =>
          s.loot[key] ? (
            <View key={key} style={styles.legItem}>
              <View style={[styles.dot, { backgroundColor: RES_COLOR[key] }]} />
              <Text style={styles.textB}>{s.loot[key]}</Text>
            </View>
          ) : null,
        )}
        {!Object.values(s.loot).some(Boolean) ? <Text style={styles.small}>0</Text> : null}
      </View>
      {info === "loot" ? <Text style={styles.infoBox}>{t("gm_sc_lootInfo", { pct: sea?.loot_pct ?? 20 })}</Text> : null}
      {s.loot_half ? <Text style={styles.warnSm}>{t("gm_sc_lootHalf")}</Text> : null}
      {s.kind === "pirate" ? (
        <>
          <Text style={styles.small}>
            {t("gm_sc_stars")} {[0, 1, 2].map((i) => (i < (s.stars ?? 0) ? "★" : "☆")).join("")}
          </Text>
          <View style={styles.row}>
            <Text style={styles.textB}>{t("gm_sc_expect", { n: s.expect ?? 0 })}</Text>
            <Pressable onPress={() => setInfo(info === "expect" ? null : "expect")} hitSlop={8}>
              <Ionicons name="information-circle-outline" size={16} color="#FFFFFFAA" />
            </Pressable>
          </View>
          {info === "expect" ? <Text style={styles.infoBox}>{t("gm_sc_expectInfo")}</Text> : null}
        </>
      ) : null}
      <StudyBuddy compact size={40} text={t(`gm_sc_tip_${s.tip}`)} />
      {s.kind === "pirate" ? (
        <AppButton label={t("gm_lv_prepare")} icon="navigate-outline" onPress={() => onPlan(s.stage ?? 1)} />
      ) : (
        <>
          <AppButton label={t("gm_lv_prepare")} icon="navigate-outline" disabled={!!s.block} onPress={() => onRaid(s.id)} />
          {s.block ? <Text style={styles.warnSm}>{t(`gm_rd_block_${s.block}`, s.block_info as Record<string, unknown>)}</Text> : null}
        </>
      )}
      <AppButton label={t("gm_sc_other")} icon="search-outline" variant="secondary" onPress={onOther} />
    </>
  );
}

/** 정찰한 조선소 배치를 위에서 본 작은 그림 (땅·바다·건물 색 = 지도 범례와 같음) */
function MiniBase({ s }: { s: GameScout }) {
  const pirate = s.kind === "pirate";
  const maxX = Math.max(s.grid.w, ...s.buildings.map((b) => b.x + b.w));
  const maxY = Math.max(s.grid.h, ...s.buildings.map((b) => b.y + b.h));
  const W = 240;
  const c = W / maxX;
  const H = c * maxY;
  const landW = pirate ? (s.grid.land ?? 6) : s.grid.w;
  const landH = pirate ? maxY : s.grid.h;
  return (
    <Svg width={W} height={H} style={{ alignSelf: "center" }}>
      <Rect x={0} y={0} width={W} height={H} fill="#2B7FBF" rx={4} />
      <Rect x={0} y={0} width={landW * c} height={landH * c} fill="#CDBB8F" rx={4} />
      {s.buildings.map((b, i) => {
        const col = pirate ? PIRATE_BLD[b.type] ?? BUILDING_COLOR[b.type] ?? "#999" : BUILDING_COLOR[b.type] ?? "#999";
        if (b.type === "mine") {
          return <Circle key={i} cx={(b.x + 0.5) * c} cy={(b.y + 0.5) * c} r={c * 0.3} fill={col} />;
        }
        if (b.type === "hq" && pirate) {
          return (
            <G key={i}>
              <Rect x={b.x * c} y={b.y * c} width={b.w * c} height={b.h * c} fill={col} />
              <Polygon points={`${(b.x + 1) * c},${(b.y + 0.2) * c} ${(b.x + 1.8) * c},${(b.y + 1) * c} ${(b.x + 1) * c},${(b.y + 1.8) * c} ${(b.x + 0.2) * c},${(b.y + 1) * c}`} fill="#B33B2E" />
            </G>
          );
        }
        return <Rect key={i} x={b.x * c + 0.5} y={b.y * c + 0.5} width={b.w * c - 1} height={b.h * c - 1} fill={col} opacity={b.level ? 1 : 0.5} />;
      })}
    </Svg>
  );
}

const HUD = "#0B2033D9";
const styles = StyleSheet.create({
  bg: { backgroundColor: "#1B5E8F" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hud: { position: "absolute", gap: 6, maxWidth: 560 },
  hudBL: { position: "absolute" },
  zoomCol: { position: "absolute", gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  round: { width: 34, height: 34, borderRadius: 17, backgroundColor: HUD, alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 16, fontWeight: "700", backgroundColor: HUD, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, overflow: "hidden" },
  badge: { color: "#fff", fontSize: 12, backgroundColor: HUD, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 8, backgroundColor: HUD, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, alignSelf: "flex-start" },
  legItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legText: { color: "#fff", fontSize: 11 },
  dot: { width: 11, height: 11, borderRadius: 6 },
  infoBox: { color: "#fff", fontSize: 12, lineHeight: 17, backgroundColor: "#0B2033F2", borderRadius: radius.sm, padding: 8, maxWidth: 420 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HUD, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  pillText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  sheet: { position: "absolute", backgroundColor: "#0F2236F2", borderRadius: radius.md, borderWidth: 1, borderColor: "#FFFFFF22" },
  cardTitle: { color: "#fff", fontSize: 17, fontWeight: "700", flex: 1 },
  tag: { color: "#fff", fontSize: 12, backgroundColor: "#FFFFFF1F", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden" },
  text: { color: "#fff", fontSize: 14 },
  textB: { color: "#fff", fontSize: 14, fontWeight: "700" },
  small: { color: "#FFFFFFBB", fontSize: 12 },
  warn: { color: colors.warning, fontSize: 13 },
  warnSm: { color: "#FFD166", fontSize: 12 },
});
