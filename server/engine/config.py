"""분석 엔진 설정. 값은 환경 변수로 덮어쓸 수 있다 (키는 절대 코드에 넣지 않는다)."""
import os
from dataclasses import dataclass, field


def _env(name, default, cast=str):
    v = os.environ.get(name)
    return cast(v) if v not in (None, "") else default


@dataclass
class Config:
    # 아루코 마커: 한 종류로 고정 (사전 이름은 cv2.aruco.DICT_* 에서 DICT_ 뒤 부분)
    marker_dict: str = field(default_factory=lambda: _env("AIWEP_MARKER_DICT", "4X4_50"))
    marker_id: int = field(default_factory=lambda: _env("AIWEP_MARKER_ID", 0, int))
    # 마커 검은 사각형 한 변의 실제 길이(mm). 인쇄 후 캘리퍼스로 잰 값을 넣는다.
    marker_size_mm: float = field(default_factory=lambda: _env("AIWEP_MARKER_SIZE_MM", 40.0, float))
    # 정면 보정 해상도: 1 px = 0.1 mm
    px_per_mm: float = 10.0
    # Roboflow
    roboflow_model: str = field(default_factory=lambda: _env("AIWEP_ROBOFLOW_MODEL", "ai_welding_inspection/4"))
    roboflow_url: str = "https://detect.roboflow.com"
    roboflow_confidence: int = 40  # %
    roboflow_overlap: int = 30  # %
    roboflow_max_side: int = 2048  # 업로드 시 긴 변 최대 px
    # 비드로 볼 클래스 이름(소문자 비교, 부분 일치)
    bead_class_keywords: tuple = ("bead", "weld")
    # 무시할 클래스 (모델이 찾는 기준 마커 등)
    ignore_class_keywords: tuple = ("marker",)
    # 길이(선) 형태로 크기를 재는 결함 클래스 키워드
    linear_defect_keywords: tuple = ("crack", "undercut", "overlap")
    # 폭 측정 간격(mm)과 통계에서 제외할 양 끝 길이(mm, 시작·끝 크레이터 부분)
    width_step_mm: float = 1.0
    end_trim_mm: float = 5.0
    # 보정 이미지에서 관심 영역 바깥 여백(mm)
    crop_margin_mm: float = 10.0


def roboflow_key():
    key = os.environ.get("ROBOFLOW_API_KEY")
    if not key:
        raise RuntimeError("환경 변수 ROBOFLOW_API_KEY 가 없습니다.")
    return key
