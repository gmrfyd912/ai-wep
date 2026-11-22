import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Body, Chips, Label, Screen } from "@/components/ui";
import { useSession } from "@/state/session";
import { TeacherBoard } from "@/screens/TeacherBoard";

/** 교사 보드: 맡은 반(담임·부담임)을 위에서 바꿔 가며 본다 */
export default function TeacherHome() {
  const { t } = useTranslation();
  const { user } = useSession();
  const courses = user?.courses ?? [];
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");

  if (!courses.length) {
    return (
      <Screen>
        <Body muted>{t("board_noCourses")}</Body>
      </Screen>
    );
  }
  return (
    <Screen>
      <Label>{t("teacher_myCourses")}</Label>
      {courses.length > 1 ? (
        <Chips options={courses.map((c) => ({ value: c.id, label: c.name }))} value={courseId} onChange={setCourseId} />
      ) : null}
      <TeacherBoard key={courseId} courseId={courseId} />
    </Screen>
  );
}
