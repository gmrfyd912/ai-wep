import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
  type TextInputInstance,
  type TextInputProps,
  type ViewInstance,
  type ViewStyle,
} from "react-native";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, space } from "@/theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** Screen 이 입력칸(Field)에게 주는 기능: 누른 칸을 화면 위쪽으로 올리기, 다음 칸으로 넘어가기 */
type FormNav = {
  reveal: (input: TextInputInstance | null) => void;
  register: (input: RefObject<TextInputInstance | null>) => () => void;
  focusNext: (input: TextInputInstance | null) => boolean;
};
const FormNavContext = createContext<FormNav | null>(null);

const LABEL_SPACE = 40; // 칸 위의 이름표까지 보이도록 남기는 높이

/** 화면 기본 틀: 어두운 배경 + 스크롤.
 * 입력칸을 누르면 그 칸(이름표 포함)을 화면 맨 위쪽으로 올려서, 그 아래 칸들도 자판 위에 이어서 보이게 한다.
 * 자판 높이만큼 아래 여백을 두어 마지막 칸·버튼까지 올라올 수 있게 한다.
 * 자판 위치 값에 기대지 않고 스크롤 안에서의 칸 위치만 써서 안드로이드(화면 끝까지 그리기)·아이폰 모두 같게 동작한다. */
export function Screen({
  children,
  scroll = true,
  safeTop = false,
  scrollRef,
}: {
  children: ReactNode;
  scroll?: boolean;
  safeTop?: boolean;
  scrollRef?: RefObject<ScrollViewInstance | null>;
}) {
  const edges = safeTop ? (["top", "left", "right"] as const) : (["left", "right"] as const);
  const innerRef = useRef<ScrollViewInstance | null>(null);
  const ref = scrollRef ?? innerRef;
  const contentRef = useRef<ViewInstance | null>(null);
  const inputs = useRef(new Set<RefObject<TextInputInstance | null>>());
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  /** 스크롤 내용 안에서 칸의 위쪽 위치 */
  const topOf = useCallback(
    (input: TextInputInstance) =>
      new Promise<number | null>((resolve) => {
        const content = contentRef.current;
        if (!content) return resolve(null);
        input.measureLayout(
          content,
          (_x, y) => resolve(y),
          () => resolve(null),
        );
      }),
    [],
  );

  const reveal = useCallback(
    (input: TextInputInstance | null) => {
      if (!input) return;
      // 자판이 올라오고 여백이 생긴 뒤에도 한 번 더 맞춘다
      for (const delay of [60, 350]) {
        setTimeout(async () => {
          const y = await topOf(input);
          if (y != null) ref.current?.scrollTo({ y: Math.max(0, y - LABEL_SPACE), animated: true });
        }, delay);
      }
    },
    [ref, topOf],
  );

  const register = useCallback((input: RefObject<TextInputInstance | null>) => {
    inputs.current.add(input);
    return () => {
      inputs.current.delete(input);
    };
  }, []);

  /** 지금 칸 바로 아래에 있는 칸으로 넘어간다. 없으면 false */
  const focusNext = useCallback(
    (current: TextInputInstance | null) => {
      if (!current) return false;
      const list = [...inputs.current].map((r) => r.current).filter((x): x is TextInputInstance => !!x && x !== current);
      (async () => {
        const cy = await topOf(current);
        if (cy == null) return;
        let best: { y: number; input: TextInputInstance } | null = null;
        for (const input of list) {
          const y = await topOf(input);
          if (y != null && y > cy + 1 && (!best || y < best.y)) best = { y, input };
        }
        if (best) best.input.focus();
        else Keyboard.dismiss();
      })();
      return list.length > 0;
    },
    [topOf],
  );

  useEffect(() => {
    if (!scroll) return;
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      reveal(TextInput.State.currentlyFocusedInput() as unknown as TextInputInstance | null);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scroll, reveal]);

  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <FormNavContext.Provider value={{ reveal, register, focusNext }}>
          <ScrollView
            ref={ref}
            contentContainerStyle={keyboardHeight ? { paddingBottom: keyboardHeight + space.xl * 2 } : null}
            keyboardShouldPersistTaps="handled"
          >
            {/* 칸 위치를 잴 기준 (스크롤 내용의 맨 위) */}
            <View ref={contentRef} style={styles.scrollContent}>
              {children}
            </View>
          </ScrollView>
        </FormNavContext.Provider>
      ) : (
        <View style={[styles.scrollContent, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: colors.muted }]}>{children}</Text>;
}

export function Card({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, style, pressed && { opacity: 0.7 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function AppButton({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "danger";
  icon?: IconName;
  disabled?: boolean;
}) {
  const bg =
    variant === "primary" ? colors.primary : variant === "danger" ? colors.danger : colors.cardAlt;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={colors.text} /> : null}
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, onFocus, onSubmitEditing, returnKeyType, ...props }: TextInputProps & { label: string }) {
  const nav = useContext(FormNavContext);
  const inputRef = useRef<TextInputInstance | null>(null);
  const register = nav?.register;
  const editable = props.editable !== false;
  useEffect(() => (editable ? register?.(inputRef) : undefined), [register, editable]);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        style={styles.input}
        // 자판의 "다음" 키를 누르면 아래 칸으로 넘어간다 (화면이 따로 정한 동작이 있으면 그걸 따름)
        returnKeyType={returnKeyType ?? (onSubmitEditing ? "done" : "next")}
        submitBehavior={onSubmitEditing ? "blurAndSubmit" : "submit"}
        onSubmitEditing={(e) => {
          if (onSubmitEditing) onSubmitEditing(e);
          else nav?.focusNext(inputRef.current);
        }}
        onFocus={(e) => {
          nav?.reveal(inputRef.current); // 누른 칸을 화면 위쪽으로 올림
          onFocus?.(e);
        }}
        {...props}
      />
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

/** 가로로 나열되는 선택 칩 */
export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | T[];
  onChange: (v: T) => void;
}) {
  const selected = Array.isArray(value) ? value : [value];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** "n단계에서 연결됩니다" 안내 */
export function ComingSoon({ step }: { step: number }) {
  const { t } = useTranslation();
  return (
    <View style={styles.comingSoon}>
      <Ionicons name="construct-outline" size={14} color={colors.warning} />
      <Text style={styles.comingSoonText}>{t("common_comingSoon", { step })}</Text>
    </View>
  );
}

export function PreviewNotice() {
  const { t } = useTranslation();
  return <Text style={styles.previewNotice}>{t("common_previewNotice")}</Text>;
}

/** 목록 한 줄 (아이콘 + 제목 + 설명 + 화살표) */
export function ListRow({
  icon,
  title,
  desc,
  onPress,
  danger,
}: {
  icon: IconName;
  title: string;
  desc?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <Card onPress={onPress} style={styles.listRow}>
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.listTitle, danger && { color: colors.danger }]}>{title}</Text>
        {desc ? <Text style={styles.listDesc}>{desc}</Text> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.faint} /> : null}
    </Card>
  );
}

/** 헤더 오른쪽 설정(톱니바퀴) 버튼 */
export function SettingsButton() {
  return (
    <Pressable onPress={() => router.push("/settings")} hitSlop={12} style={{ paddingHorizontal: space.md }}>
      <Ionicons name="settings-outline" size={22} color={colors.text} />
    </Pressable>
  );
}

/** 회색 이미지 자리 */
export function ImagePlaceholder({ label, height = 160 }: { label?: string; height?: number }) {
  return (
    <View style={[styles.imagePh, { height }]}>
      <Ionicons name="image-outline" size={28} color={colors.faint} />
      {label ? <Text style={styles.listDesc}>{label}</Text> : null}
    </View>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const { t } = useTranslation();
  const c = score >= 85 ? colors.success : score >= 70 ? colors.warning : colors.danger;
  return (
    <View style={[styles.scoreBadge, { borderColor: c }]}>
      <Text style={[styles.scoreText, { color: c }]}>{t("common_points", { score })}</Text>
    </View>
  );
}

export const headerOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: "700" as const },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 },
  title: { fontSize: 26, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 15, color: colors.muted },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: colors.text, marginTop: space.sm },
  body: { fontSize: 15, color: colors.text, lineHeight: 22 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingVertical: 14,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  label: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
  },
  chipRow: { gap: space.sm, paddingVertical: space.xs },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.primaryDim, borderColor: colors.primary },
  chipText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  chipTextOn: { color: colors.primary },
  comingSoon: { flexDirection: "row", alignItems: "center", gap: 6 },
  comingSoonText: { color: colors.warning, fontSize: 13 },
  previewNotice: { color: colors.faint, fontSize: 12, textAlign: "center" },
  listRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  listTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  listDesc: { color: colors.muted, fontSize: 13, marginTop: 2 },
  imagePh: {
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
  },
  scoreBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  scoreText: { fontSize: 13, fontWeight: "700" },
});
