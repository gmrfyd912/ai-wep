import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Chips, Label, PreviewNotice, Screen } from "@/components/ui";
import { courseById, TEACHER_COURSE_IDS } from "@/mock/data";
import { TeacherBoard } from "@/screens/TeacherBoard";

export default function TeacherHome() {
  const { t } = useTranslation();
  const [courseId, setCourseId] = useState(TEACHER_COURSE_IDS[0]);

  return (
    <Screen>
      <Label>{t("teacher_myCourses")}</Label>
      {/* 맡은 반이 둘 이상일 때만 반 전환 칩을 보여준다 */}
      {TEACHER_COURSE_IDS.length > 1 ? (
        <Chips
          options={TEACHER_COURSE_IDS.map((id) => ({ value: id, label: courseById(id)?.name ?? id }))}
          value={courseId}
          onChange={setCourseId}
        />
      ) : null}
      <TeacherBoard courseId={courseId} />
      <PreviewNotice />
    </Screen>
  );
}
