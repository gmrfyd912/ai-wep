import { Stack, useLocalSearchParams } from "expo-router";

import { Screen } from "@/components/ui";
import { TeacherBoard } from "@/screens/TeacherBoard";

/** 과정 보드에서 과정을 눌렀을 때 보는 그 과정의 교사 보드 (행정 관리자·시스템관리자) */
export default function CourseBoardDetail() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return (
    <Screen>
      <Stack.Screen options={{ title: name ?? "" }} />
      <TeacherBoard courseId={id} />
    </Screen>
  );
}
