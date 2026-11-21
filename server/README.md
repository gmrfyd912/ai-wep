# AI W.E.P 비드 분석 엔진 (server/)

용접 시편 사진 한 장에서 비드 폭·직진도·결함을 mm 단위로 계산합니다. 2단계에서는 앱과 연결하지 않고 엔진만 단독으로 정확도를 검증합니다.

## 처리 순서

1. **아루코 마커 검출**: 한 종류만 찾습니다. 기본은 기존 앱에서 쓰던 30mm 마커(`AIWEP_LEGACY`)입니다. 이 마커는 OpenCV 표준 사전에 없는 6x6 무늬라서 엔진에 직접 등록했습니다. 꼭짓점은 서브픽셀 정밀도로 찾습니다.
2. **정면 보정**: 마커 네 꼭짓점과 실제 한 변 길이로 호모그래피를 구해, 위에서 내려다본 이미지로 바꿉니다. 1px = 0.1mm.
3. **Roboflow 호출**: 모델 `ai_welding_inspection/4` 가 원본 사진에서 비드 윤곽과 결함을 찾습니다. 결과 좌표는 같은 호모그래피로 mm 좌표로 바꿉니다 (Roboflow 상자 크기로 mm를 환산하지 않습니다).
4. **측정**
   - 비드 주축(PCA)에 수직으로 1mm 간격 폭 → 평균·최소(위치)·최대(위치)·표준편차·변동계수. 양 끝 10mm는 검사에서 뺍니다(폭·최소·최대·편차·직진도·결함 개수 모두). 폭 평균은 상·하위 10%를 뺀 절사평균입니다. 끝 구간 결함은 그림에 회색으로만 표시합니다.
   - 캘리퍼스 비교용 폭: 시작 10mm, 가운데, 끝 10mm 위치(각 ±1mm 평균). **시작 = 마커에 가까운 쪽 끝.**
   - 직진도: 폭 중심선과 최소제곱 기준선의 최대·평균·RMS 이탈(mm).
   - 결함: 종류(영어 코드), 신뢰도, 길이·폭(mm), 면적(mm²), 비드 시작점부터의 위치. 균열 등 선 모양 결함은 윤곽의 뼈대(skeleton) 길이로 실제 길이를 잽니다.
5. **결과**: JSON + 글자 없는 확인용 그림.

## 확인용 그림 색

| 색 | 뜻 |
|---|---|
| 초록 선 | 비드 윤곽 (초록 점 = 시작점) |
| 노랑 선 | 폭 중심선 |
| 파랑 선 | 직진도 기준선 (검사 구간 중심점들에 가장 잘 맞는 직선) |
| 흰 점 + 흰 짧은 선 | 직진도가 가장 많이 벗어난 곳 |
| 어두운 띠 | 검사 제외 구간 (양 끝 10mm) |
| 빨강 짧은 선 / 자홍 짧은 선 | 최소 폭 / 최대 폭 위치 |
| 주황 / 빨강 윤곽 | 결함 / 균열 |
| 흰 사각형 | 마커 |
| 왼쪽 아래 흰 막대 | 10mm 축척 |

## 실행

```bash
cd server
pip install -r requirements.txt
# 키는 환경 변수로만 (코드·GitHub에 넣지 않음)
export ROBOFLOW_API_KEY=...        # Windows PowerShell: $env:ROBOFLOW_API_KEY="..."
python -m engine.cli 사진1.jpg 사진2.jpg --out out --marker-size 30.0
```

`--marker-size` 에는 인쇄한 마커의 검은 사각형 한 변을 캘리퍼스로 잰 값(mm)을 넣습니다. 환경 변수 `AIWEP_MARKER_SIZE_MM`, `AIWEP_MARKER_DICT`, `AIWEP_MARKER_ID` 로도 바꿀 수 있습니다.

## 마커 인쇄

```bash
python tools/make_marker_pdf.py --dict AIWEP_LEGACY --id 0 --size 30 --out marker.pdf
```

A4에 '실제 크기(100%)'로 인쇄하고 100mm 눈금선으로 인쇄 크기를 확인합니다.

## 검증

- 합성 사진 기하 검증: `python -m tests.synthetic_check` (정답을 아는 가상 시편을 여러 각도·회전으로 촬영한 것처럼 만들어 비교. 윤곽 잡음 없이 최대 오차 0.12mm).
- 실측 비교: `python tools/validate.py 사진폴더 실측.csv --out validation` → `comparison.csv` 와 확인용 그림. CSV 형식은 파일 첫 부분 설명 참고.

## 결과 JSON 상태 코드

`ok`, `marker_not_found`, `no_bead`, `bead_too_short`, `roboflow_failed`, `image_read_failed`. 경고: `bead_box_only`(비드 윤곽 없이 상자만 옴), `multiple_beads`, `rectify_too_large`.

## 3단계: 분석 서버 (app.py)

앱이 사진을 보내면 엔진으로 분석하고 Supabase에 저장합니다.

| 주소 | 하는 일 |
|---|---|
| `GET /health` | 서버 상태 확인 |
| `POST /analyze` | 사진(photo) + device_id + 공정·자세·재질 → 분석 결과 |
| `GET /submissions?device_id=` | 이 휴대폰의 분석 목록 |
| `GET /submissions/{id}?device_id=` | 분석 한 건 (사진·확인 그림 주소는 1시간 유효) |

- 환경 변수: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ROBOFLOW_API_KEY` (Render 설정 화면에만 입력)
- Supabase 준비: `supabase/step3.sql` 을 SQL Editor에서 실행
- 배포: 저장소 맨 위 `render.yaml` (Render Blueprint)
- 로컬 실행: `uvicorn app:app --reload` / 흐름 시험: `python -m tests.server_check`
- 로그인은 6단계. 그전까지 앱이 휴대폰마다 만든 임시 번호(device_id)로 구분합니다.

## 5단계: 점수·AI 예비판정·AI 종합리포트

| 주소 | 하는 일 |
|---|---|
| `POST /submissions/{id}/report` | `{device_id, lang}` → 점수 + AI 리포트. 같은 사진·같은 언어는 저장된 것을 돌려줌(비용 0) |

- 점수·판정: `scoring.py` (AI가 아니라 정해진 공식). 100점 = 폭 균일 40 + 직진도 30 + 결함 30. 균열 = 불합격(최대 59점), 스패터는 감점 없음. 선급 검사표를 받기 전 임시 기준.
- 기준값·하루 리포트 한도는 Supabase `app_settings` 표의 `criteria` 값이 있으면 그걸 씀(5분마다 다시 읽음). 6단계 시스템관리자 화면이 이 값을 고침.
- AI 리포트: `report.py`, 모델 Claude Haiku 5.5. 사진은 보내지 않고 숫자만 보냄. 기기 1대당 하루(한국 시간) 5건. `report_unlimited_devices`에 있는 기기(박사 시험용)는 한도 없음 — `supabase/step5b-limits.sql`로 설정.
- 환경 변수 추가: `ANTHROPIC_API_KEY` (필수), `ANTHROPIC_MODEL` (선택, 모델을 바꿀 때만)
- Supabase 준비: `supabase/step5.sql` 을 SQL Editor에서 실행
- 흐름 시험: `python -m tests.report_check` (Supabase·AI는 가짜, 돈 안 듦)

## 6-1단계: 로그인·가입·계정 (accounts.py)

6-1단계부터 분석·목록·리포트는 로그인한 계정으로만 씁니다. 앱은 `Authorization: Bearer <토큰>` 을 보냅니다.
토큰은 로그아웃·계정 삭제·비밀번호 변경(다른 휴대폰)·재설정 전까지 유효합니다. 서버에는 토큰의 SHA-256 값만 저장합니다.

| 주소 | 하는 일 |
|---|---|
| `GET /courses` | 가입 화면 과정 목록 (운영 중인 과정만) |
| `POST /auth/signup` | 이름·아이디·비밀번호·역할·과정·이메일(선택) → 토큰, 또는 승인 대기 |
| `POST /auth/login` | 아이디(대소문자 무시)·비밀번호 → 토큰 |
| `POST /auth/logout` | 이 휴대폰 로그아웃 |
| `GET /me`, `PATCH /me` | 내 정보 / 이메일 변경 |
| `POST /me/password` | 비밀번호 변경 (첫 로그인·초기화 직후에는 지금 비밀번호를 묻지 않음) |
| `POST /auth/find-id` | 이메일로 아이디 보내기 |
| `POST /auth/forgot`, `POST /auth/reset` | 이메일로 6자리 번호(15분) 보내기 → 새 비밀번호 |
| `GET /me/device-records`, `POST /me/claim-device` | 로그인 전 이 휴대폰 기록 수 / 내 계정으로 가져오기 |
| `POST /me/delete` | 계정 영구 삭제 (사진·기록·리포트 포함, 시스템관리자는 불가) |

- Supabase 준비: `supabase/step6-accounts.sql` 을 SQL Editor에서 실행. admin 계정은 비밀번호가 공개 저장소에 올라가지 않도록 파일에 넣지 않고 따로 실행합니다.
- 비밀번호 규칙: `app_settings` 의 `auth.password_min_length` (기본 0 = 규칙 없음, 6-4단계 관리자 화면에서 변경). 가입 승인: `signup.student_approval`, `signup.staff_approval` (기본 꺼짐).
- 메일(선택): Render 무료 서버는 메일 포트가 막혀 있어 Brevo 웹 API를 씁니다. 환경 변수 `BREVO_API_KEY`, `MAIL_FROM`. 없으면 이메일 찾기만 "준비 안 됨"으로 나오고 나머지는 정상 동작합니다.
- 리포트 하루 한도는 계정 기준. 시스템관리자 계정과 `report_unlimited_devices` 휴대폰은 한도 없음.
- 흐름 시험: `python -m tests.accounts_check` (Supabase·메일은 가짜)
