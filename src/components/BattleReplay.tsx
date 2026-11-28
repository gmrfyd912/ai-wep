import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, G, Line, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { useTranslation } from "react-i18next";

import { StudyBuddy } from "@/components/StudyBuddy";
import { AppButton } from "@/components/ui";
import { CrewGlyph, CREW_COLOR } from "@/components/CrewFigure";
import { CREW_KINDS, type GameBattle } from "@/lib/api";
import { BUILDING_COLOR, RES_COLOR, WAR_COLOR } from "@/screens/GameMap";
import { colors, radius, space } from "@/theme";

const PIRATE_COLOR: Record<string, string> = { hq: "#3B2A2A", hut: "#7A5A3A" };
const SHORT: Record<string, string> = { battery: "B", missile: "M", asw: "A", radar: "R", hq: "☠", hut: "" };
const SHORT_USER: Record<string, string> = { battery: "B", missile: "M", asw: "A", radar: "R", hq: "⚑" };

/**
 * 해적 연습 전투 다시 보기 (위에서 내려다본 그림).
 * 서버가 계산한 기록(frames)을 0.5초씩 넘기며 보여 준다. 끝나면 별·부순 비율·받은 것·웰디 한 줄 평.
 */
export function BattleReplay({ battle, onClose, defense = false }: { battle: GameBattle; onClose: () => void; /** 내 조선소가 공격받은 전투 */ defense?: boolean }) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const [i, setI] = useState(0);
  const [play, setPlay] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [done, setDone] = useState(false);
  const [cheer, setCheer] = useState(0);   // 이긴 상륙 전투: 끝나고 대원 환호 (0 = 안 함, 1~ = 환호 중 장면 번호)
  const n = battle.frames.length;
  const landedAny = battle.frames.some((f) => f.c?.length);
  const pvp = battle.kind === "raid";
  const willCheer = !!battle.raid && battle.stars > 0 && landedAny && !defense;
  const short = pvp ? SHORT_USER : SHORT;

  useEffect(() => {
    if (!play || done) return;
    const id = setInterval(() => {
      setI((k) => {
        if (k + 1 >= n) {
          setDone(true);
          return n - 1;
        }
        return k + 1;
      });
    }, (battle.tick_sec * 1000) / speed);
    return () => clearInterval(id);
  }, [play, speed, done, n, battle.tick_sec]);

  // 끝나면 대원 환호 2.4초 (깡충깡충) → 결과 카드
  useEffect(() => {
    if (!done || !willCheer) return;
    setCheer(1);
    const id = setInterval(() => setCheer((k) => (k >= 12 ? k : k + 1)), 200);
    return () => clearInterval(id);
  }, [done, willCheer]);
  const showCard = done && (!willCheer || cheer >= 12);

  const fr = battle.frames[Math.min(i, n - 1)];
  const { w: MW, h: MH, land } = battle.map;
  const cell = Math.floor(Math.min((width * 0.92) / MW, (height - 120) / MH));
  const W = cell * MW, H = cell * MH;
  const C = (o: { x: number; y: number; w: number; h: number }): [number, number] => [(o.x + o.w / 2) * cell, (o.y + o.h / 2) * cell];
  const booms = useMemo(() => battle.events.filter((e) => e.boom !== undefined), [battle.events]);

  const restart = () => {
    setI(0);
    setCheer(0);
    setDone(false);
    setPlay(true);
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.bg]}>
      <View style={styles.top}>
        <Text style={styles.title} numberOfLines={1}>
          {pvp
            ? defense
              ? t("gm_rd_defTitle", { name: battle.attacker?.name ?? "" })
              : t("gm_rd_title", { name: battle.defender?.name ?? "" })
            : t("gm_bt_title", { n: battle.stage })}
        </Text>
        <Text style={styles.small}>
          {t(`gm_bt_lane_${battle.lane}`)} ·{" "}
          {battle.raid ? t("gm_pl_pierAt", { n: (battle.landing ?? 0) + 1 }) : t(battle.target === "hq" ? "gm_bt_tgtHq" : "gm_bt_tgtDef")}
        </Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setPlay((p) => !p)} style={styles.ctl} disabled={done}>
          <Ionicons name={play ? "pause" : "play"} size={18} color="#fff" />
        </Pressable>
        <Pressable onPress={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))} style={styles.ctl}>
          <Text style={styles.ctlText}>{speed}×</Text>
        </Pressable>
        <Pressable onPress={() => { setI(n - 1); setDone(true); }} style={styles.ctl}>
          <Text style={styles.ctlText}>{t("gm_bt_skip")}</Text>
        </Pressable>
        <Pressable onPress={onClose} style={styles.ctl} hitSlop={8}>
          <Ionicons name="close" size={18} color="#fff" />
        </Pressable>
      </View>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${((i + 1) / n) * 100}%` }]} />
      </View>
      <Svg width={W} height={H}>
        <Rect x={0} y={0} width={land * cell} height={H} fill="#C9B98F" />
        <Rect x={land * cell} y={0} width={(MW - land) * cell} height={H} fill="#1F6FA8" />
        {Array.from({ length: MW + 1 }, (_, k) => (
          <Line key={`gx${k}`} x1={k * cell} y1={0} x2={k * cell} y2={H} stroke="#00000014" strokeWidth={1} />
        ))}
        {Array.from({ length: MH + 1 }, (_, k) => (
          <Line key={`gy${k}`} x1={0} y1={k * cell} x2={W} y2={k * cell} stroke="#00000014" strokeWidth={1} />
        ))}
        {battle.base.map((o) => {
          const hp = fr.b[o.id];
          const alive = hp > 0;
          const [cx, cy] = C(o);
          if (o.type === "mine") {
            return alive ? <Circle key={o.id} cx={cx} cy={cy} r={cell * 0.2} fill={BUILDING_COLOR.mine} stroke="#3A0D0A" /> : null;
          }
          const color = (pvp ? undefined : PIRATE_COLOR[o.type]) ?? BUILDING_COLOR[o.type] ?? "#999";
          return (
            <G key={o.id} opacity={alive ? 1 : 0.35}>
              <Rect x={o.x * cell + 2} y={o.y * cell + 2} width={o.w * cell - 4} height={o.h * cell - 4} rx={3} fill={color} stroke="#0006" />
              {short[o.type] ? (
                <SvgText x={cx} y={cy + cell * 0.15} fontSize={cell * (o.type === "hq" ? 0.7 : 0.42)} fill="#fff" textAnchor="middle" fontWeight="bold">
                  {short[o.type]}
                </SvgText>
              ) : null}
              {!alive ? (
                <G>
                  <Line x1={o.x * cell + 4} y1={o.y * cell + 4} x2={(o.x + o.w) * cell - 4} y2={(o.y + o.h) * cell - 4} stroke="#000" strokeWidth={2} />
                  <Line x1={(o.x + o.w) * cell - 4} y1={o.y * cell + 4} x2={o.x * cell + 4} y2={(o.y + o.h) * cell - 4} stroke="#000" strokeWidth={2} />
                </G>
              ) : o.type !== "wall" ? (
                <G>
                  <Rect x={o.x * cell + 3} y={o.y * cell - 5} width={o.w * cell - 6} height={4} fill="#0008" />
                  <Rect x={o.x * cell + 3} y={o.y * cell - 5} width={(o.w * cell - 6) * Math.max(0, hp / o.max)} height={4} fill="#E05A5A" />
                </G>
              ) : null}
            </G>
          );
        })}
        {booms.filter((e) => e.t <= i && i - e.t < 3).map((e) => {
          const o = battle.base[e.boom!];
          const [cx, cy] = C(o);
          return <Circle key={`b${e.boom}`} cx={cx} cy={cy} r={cell * (0.4 + (i - e.t) * 0.2)} fill="#FF8A1F" opacity={0.7 - (i - e.t) * 0.2} />;
        })}
        {(cheer ? [] : fr.f).map(([who, a, b], k) => {
          if (who === "c") {
            const m = fr.c?.[a];
            if (!m) return null;
            const [tx, ty] = C(battle.base[b]);
            return <Line key={`f${k}`} x1={m[0] * cell} y1={m[1] * cell} x2={tx} y2={ty} stroke="#9EE6FF" strokeWidth={1.5} />;
          }
          if (who === "cg" || who === "gc") {
            const m = who === "cg" ? fr.c?.[a] : fr.d?.[a];
            const g = who === "cg" ? fr.d?.[b] : fr.c?.[b];
            if (!m || !g) return null;
            return <Line key={`f${k}`} x1={m[0] * cell} y1={m[1] * cell} x2={g[0] * cell} y2={g[1] * cell} stroke={who === "cg" ? "#9EE6FF" : "#FF5252"} strokeWidth={1.5} strokeDasharray={who === "gc" ? "3 3" : undefined} />;
          }
          if (who === "dc") {
            const m = fr.c?.[b];
            if (!m) return null;
            const [sx, sy] = C(battle.base[a]);
            return <Line key={`f${k}`} x1={sx} y1={sy} x2={m[0] * cell} y2={m[1] * cell} stroke="#FF5252" strokeWidth={1.5} strokeDasharray="3 3" />;
          }
          if (who === "s") {
            const s = fr.s[a];
            const [tx, ty] = C(battle.base[b]);
            return <Line key={`f${k}`} x1={s[0] * cell} y1={s[1] * cell} x2={tx} y2={ty} stroke="#FFD166" strokeWidth={2} />;
          }
          const [sx, sy] = C(battle.base[a]);
          const s = fr.s[b];
          return <Line key={`f${k}`} x1={sx} y1={sy} x2={s[0] * cell} y2={s[1] * cell} stroke="#FF5252" strokeWidth={2} strokeDasharray="4 3" />;
        })}
        {fr.s.map(([x, y, hp, out], k) => {
          const sh = battle.ships[k];
          const px = x * cell, py = y * cell, r = cell * (sh.kind === "landing" ? 0.48 : sh.kind === "frigate" ? 0.42 : 0.34);
          // 상륙함은 앞이 뭉툭한 넓은 배 모양, 나머지는 뾰족한 배 모양
          const hull = sh.kind === "landing"
            ? `${px - r},${py - r * 0.35} ${px - r * 0.75},${py - r * 0.6} ${px + r * 0.8},${py - r * 0.6} ${px + r * 0.8},${py + r * 0.6} ${px - r * 0.75},${py + r * 0.6} ${px - r},${py + r * 0.35}`
            : `${px - r},${py} ${px + r * 0.8},${py - r * 0.55} ${px + r * 0.8},${py + r * 0.55}`;
          return (
            <G key={`s${k}`} opacity={out ? 0.35 : 1}>
              <Polygon points={hull} fill={WAR_COLOR} stroke="#fff" strokeWidth={1.2} />
              <Rect x={px - r} y={py - r - 6} width={r * 2} height={4} fill="#0008" />
              <Rect x={px - r} y={py - r - 6} width={r * 2 * Math.max(0, hp / sh.max_hp)} height={4} fill="#7FD18F" />
            </G>
          );
        })}
        {/* 상륙 대원 (쓰러지면 흐리게, 이기면 양팔 들고 환호) */}
        {(fr.c ?? []).map(([x, y, hp, ki], k) => {
          const kind = CREW_KINDS[ki];
          const down = hp <= 0;
          const hop = cheer && !down ? ((cheer + k) % 2) * cell * 0.18 : 0;
          // 같은 길로 가서 겹치지 않게 조금씩 비켜 그림
          const dx = ((k % 3) - 1) * cell * 0.28, dy = ((Math.floor(k / 3) % 3) - 1) * cell * 0.22;
          return <CrewGlyph key={`c${k}`} kind={kind} x={x * cell + dx} y={y * cell + cell * 0.35 + dy} s={cell * 0.8} cheer={cheer > 0 && !down} hop={hop} dim={down} />;
        })}
        {/* 방어 대원 (빨간 고리, 쓰러지면 흐리게) */}
        {(fr.d ?? []).map(([x, y, hp, ki], k) => {
          const down = hp <= 0;
          const dx = ((k % 3) - 1) * cell * 0.24, dy = ((Math.floor(k / 3) % 3) - 1) * cell * 0.2;
          return <CrewGlyph key={`d${k}`} kind={CREW_KINDS[ki]} x={x * cell + dx} y={y * cell + cell * 0.35 + dy} s={cell * 0.8} dim={down} ring="#FF5252" />;
        })}
      </Svg>
      {cheer > 0 && !showCard ? <Text style={styles.cheer}>{t("gm_pl_cheer")}</Text> : null}
      <View style={styles.legend}>
        <Leg color={WAR_COLOR} label={t(defense ? "gm_rd_legEnemyShip" : "gm_bt_legShip")} />
        <Leg color={BUILDING_COLOR.battery} label={`B ${t("gm_b_battery")}`} />
        <Leg color={BUILDING_COLOR.missile} label={`M ${t("gm_b_missile")}`} />
        <Leg color={BUILDING_COLOR.mine} label={t("gm_b_mine")} />
        <Leg color={BUILDING_COLOR.wall} label={t("gm_b_wall")} />
        {pvp ? <Leg color={BUILDING_COLOR.hq} label={`⚑ ${t("gm_b_hq")}`} /> : <Leg color={PIRATE_COLOR.hq} label={`☠ ${t("gm_bt_hq")}`} />}
        <Leg color="#FFD166" label={t(defense ? "gm_rd_legEnemyShots" : "gm_bt_legMine")} />
        <Leg color="#FF5252" label={t(defense ? "gm_rd_legMyShots" : pvp ? "gm_rd_legTheirShots" : "gm_bt_legTheirs")} />
        {battle.raid
          ? CREW_KINDS.filter((k) => battle.crew_sent?.[k] || battle.guard_sent?.[k]).map((k) => <Leg key={k} color={CREW_COLOR[k]} label={t(`gm_crew_${k}`)} />)
          : null}
        {battle.guards?.length ? <Leg color="#FF5252" label={t(defense ? "gm_rd_legMyGuards" : "gm_rd_legGuards")} ring /> : null}
      </View>

      {showCard ? (
        <View style={[StyleSheet.absoluteFill, styles.resBg]}>
          <ScrollView contentContainerStyle={styles.resWrap}>
            <View style={styles.card}>
              <Text style={styles.stars}>{[0, 1, 2].map((k) => (k < battle.stars ? "★" : "☆")).join(" ")}</Text>
              {defense ? (
                <>
                  <Text style={styles.resTitle}>{t(battle.stars <= 1 ? "gm_rd_defWin" : "gm_rd_defLose", { name: battle.attacker?.name ?? "", pct: battle.pct })}</Text>
                  <StudyBuddy compact size={48} text={t("gm_rd_defNote")} />
                  <View style={styles.items}>
                    {(["steel", "rods"] as const).map((k) =>
                      battle.lost?.[k] ? (
                        <View key={k} style={styles.item}>
                          <View style={[styles.dot, { backgroundColor: RES_COLOR[k] }]} />
                          <Text style={styles.itemText}>{t(`gm_${k}`)} −{battle.lost[k]}</Text>
                        </View>
                      ) : null,
                    )}
                    {(["rods", "fame"] as const).map((k) =>
                      battle.defend?.[k] ? (
                        <View key={`d${k}`} style={styles.item}>
                          <View style={[styles.dot, { backgroundColor: RES_COLOR[k] }]} />
                          <Text style={styles.itemText}>{t(`gm_${k}`)} +{battle.defend[k]}</Text>
                        </View>
                      ) : null,
                    )}
                  </View>
                </>
              ) : (
                <>
              <Text style={styles.resTitle}>{t(battle.stars ? "gm_bt_win" : "gm_bt_lose", { pct: battle.pct })}</Text>
              <StudyBuddy compact size={48} text={t(`gm_bt_note_${battle.note.id}`)} />
              {battle.morale ? (
                <Text style={styles.smallC}>{t("gm_rd_moraleGot", { right: battle.morale.right, total: battle.morale.total, mult: battle.morale.mult })}</Text>
              ) : null}
              {battle.got && (battle.first_stars || (pvp && Object.values(battle.got).some(Boolean))) ? (
                <View style={styles.items}>
                  {(["steel", "rods", "tech", "fame"] as const).map((k) =>
                    battle.got![k] ? (
                      <View key={k} style={styles.item}>
                        <View style={[styles.dot, { backgroundColor: RES_COLOR[k] }]} />
                        <Text style={styles.itemText}>
                          {t(`gm_${k}`)} +{battle.got![k]}
                        </Text>
                      </View>
                    ) : null,
                  )}
                </View>
              ) : (
                <Text style={styles.smallC}>{t(pvp ? "gm_rd_noLoot" : "gm_bt_noReward")}</Text>
              )}
                </>
              )}
              {(defense ? [] : battle.ships).map((s, k) => (
                <Text key={s.id} style={styles.smallC}>
                  {t(`gm_ship_${s.kind}`)} {k + 1}: {s.out ? t("gm_bt_shipOut") : t("gm_bt_shipHp", { hp: s.hp, max: s.max_hp })}
                </Text>
              ))}
              {!defense && battle.ships.some((s) => s.hp < s.max_hp) ? <Text style={styles.smallC}>{t("gm_bt_repairNote")}</Text> : null}
              {!defense && battle.raid && battle.crew_sent && Object.values(battle.crew_sent).some(Boolean) ? (
                <Text style={styles.smallC}>
                  {CREW_KINDS.filter((k) => battle.crew_sent![k])
                    .map((k) => t("gm_pl_crewBack", { name: t(`gm_crew_${k}`), back: battle.crew_sent![k] - (battle.crew_lost?.[k] ?? 0), sent: battle.crew_sent![k] }))
                    .join(" · ")}
                </Text>
              ) : null}
              {battle.guard_sent && Object.values(battle.guard_sent).some(Boolean) ? (
                <Text style={styles.smallC}>
                  {t(defense ? "gm_rd_myGuards" : "gm_rd_theirGuards", {
                    list: CREW_KINDS.filter((k) => battle.guard_sent![k])
                      .map((k) => `${t(`gm_crew_${k}`)} ${battle.guard_sent![k]}`)
                      .join(" · "),
                    down: Object.values(battle.guard_lost ?? {}).reduce((a, b) => a + (b || 0), 0),
                  })}
                  {defense && Object.values(battle.guard_lost ?? {}).some(Boolean) ? `\n${t("gm_rd_hurtBack", { m: battle.hurt_minutes ?? 60 })}` : ""}
                </Text>
              ) : null}
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <AppButton label={t("gm_bt_replay")} icon="refresh-outline" variant="secondary" onPress={restart} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppButton label={t("gm_partyOk")} icon="checkmark" onPress={onClose} />
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function Leg({ color, label, ring = false }: { color: string; label: string; /** 방어 대원: 빈 고리 */ ring?: boolean }) {
  return (
    <View style={styles.leg}>
      <View style={[styles.dot, ring ? { borderWidth: 2, borderColor: color, borderRadius: 5 } : { backgroundColor: color }]} />
      <Text style={styles.legText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { backgroundColor: "#0B1A2A", alignItems: "center", paddingTop: 8, zIndex: 60 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, width: "94%" },
  title: { color: "#FFD166", fontSize: 16, fontWeight: "800" },
  small: { color: "#FFFFFFAA", fontSize: 12 },
  ctl: { backgroundColor: "#FFFFFF22", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, minWidth: 34, alignItems: "center" },
  ctlText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  bar: { width: "94%", height: 4, backgroundColor: "#FFFFFF22", borderRadius: 2, marginVertical: 6 },
  barFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6, width: "94%", justifyContent: "center" },
  leg: { flexDirection: "row", alignItems: "center", gap: 4 },
  legText: { color: "#FFFFFFCC", fontSize: 11 },
  dot: { width: 10, height: 10, borderRadius: 3 },
  resBg: { backgroundColor: "#000000AA" },
  resWrap: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: space.md },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, gap: space.sm, width: 440, maxWidth: "94%", borderWidth: 2, borderColor: "#FFD166" },
  stars: { color: "#FFD166", fontSize: 30, textAlign: "center", letterSpacing: 4 },
  resTitle: { color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center" },
  items: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  item: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 10 },
  itemText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  smallC: { color: colors.muted, fontSize: 12, textAlign: "center" },
  cheer: { position: "absolute", top: "40%", color: "#FFD166", fontSize: 30, fontWeight: "900", textShadowColor: "#000", textShadowRadius: 6 },
});
