import { Stack, useLocalSearchParams } from "expo-router";

import { PreviewNotice, Screen } from "@/components/ui";
import { courseById } from "@/mock/data";
import { TeacherBoard } from "@/screens/TeacherBoard";

/** 행정 관리자가 과정 보드에서 과정을 눌렀을 때 보는 그 과정의 교사 보드 */
export default function CourseBoardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen>
      <Stack.Screen options={{ title: courseById(id)?.name ?? "" }} />
      <TeacherBoard courseId={id} />
      <PreviewNotice />
    </Screen>
  );
}
