import { useTranslation } from "react-i18next";

import { Chips } from "@/components/ui";
import { COURSES } from "@/mock/data";

/** 갤러리·랭킹 공통 과정 필터. "all" 또는 과정 id */
export function CourseFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const options = [
    { value: "all", label: t("common_all") },
    ...COURSES.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })),
  ];
  return <Chips options={options} value={value} onChange={onChange} />;
}
