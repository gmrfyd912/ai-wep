"""아루코 마커 검출 (한 종류만)."""
import cv2
import numpy as np


class MarkerNotFound(Exception):
    pass


# 기존 앱(ai-welding-platform)에서 쓰던 30mm 마커. OpenCV 표준 사전에 없는 6x6 무늬라서
# 직접 등록한다 (기존 앱이 표준 사전 12종을 시도해도 못 찾던 원인으로 보임).
LEGACY_BITS = np.array([
    [0, 1, 1, 0, 1, 1],
    [0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 1],
    [1, 0, 1, 0, 1, 1],
    [1, 1, 0, 1, 0, 0],
    [0, 0, 1, 1, 0, 1],
], np.uint8)


def _dictionary(name):
    if name.upper() == "AIWEP_LEGACY":
        byte_list = cv2.aruco.Dictionary.getByteListFromBits(LEGACY_BITS)
        return cv2.aruco.Dictionary(byte_list, 6, 4)
    attr = "DICT_" + name.upper()
    if not hasattr(cv2.aruco, attr):
        raise ValueError(f"알 수 없는 아루코 사전: {name}")
    return cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, attr))


def detect_marker(gray, cfg):
    """마커 네 꼭짓점(px, 서브픽셀) 반환. 순서: 좌상, 우상, 우하, 좌하 (마커 기준)."""
    params = cv2.aruco.DetectorParameters()
    params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    params.cornerRefinementWinSize = 5
    params.cornerRefinementMaxIterations = 50
    params.cornerRefinementMinAccuracy = 0.01
    detector = cv2.aruco.ArucoDetector(_dictionary(cfg.marker_dict), params)
    corners, ids, _ = detector.detectMarkers(gray)
    if ids is None:
        raise MarkerNotFound("마커를 찾지 못했습니다.")
    found = [c.reshape(4, 2) for c, i in zip(corners, ids.flatten()) if int(i) == cfg.marker_id]
    if not found:
        raise MarkerNotFound(f"마커 {cfg.marker_id}번을 찾지 못했습니다 (찾은 번호: {sorted(set(ids.flatten().tolist()))}).")
    if len(found) > 1:
        raise MarkerNotFound("같은 번호 마커가 두 개 이상 보입니다.")
    return found[0].astype(np.float64)


def marker_quality(corners):
    """마커 네 변 길이(px)와 정면 정도를 나타내는 간단한 지표."""
    sides = [float(np.linalg.norm(corners[(i + 1) % 4] - corners[i])) for i in range(4)]
    return {"side_px": [round(s, 2) for s in sides],
            "side_ratio": round(max(sides) / min(sides), 4)}
