import { Screen } from "@/components/ui";
import { CourseCards } from "@/screens/CourseCards";

/** 시스템관리자가 보는 과정 보드 (행정 관리자 첫 화면과 같음) */
export default function BoardsScreen() {
  return (
    <Screen>
      <CourseCards />
    </Screen>
  );
}
