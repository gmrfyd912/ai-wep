# AI W.E.P 비드 분석 엔진 (server/)

용접 시편 사진 한 장에서 비드 폭·직진도·결함을 mm 단위로 계산합니다. 2단계에서는 앱과 연결하지 않고 엔진만 단독으로 정확도를 검증합니다.

## 처리 순서

1. **아루코 마커 검출**: 한 종류만 찾습니다. 기본은 기존 앱에서 쓰던 30mm 마커(`AIWEP_LEGACY`)입니다. 이 마커는 OpenCV 표준 사전에 없는 6x6 무늬라서 엔진에 직접 등록했습니다. 꼭짓점은 서브픽셀 정밀도로 찾습니다.
2. **정면 보정**: 마커 네 꼭짓점과 실제 한 변 길이로 호모그래피를 구해, 위에서 내려다본 이미지로 바꿉니다. 1px = 0.1mm.
3. **Roboflow 호출**: 모델 `ai_welding_inspection/4` 가 원본 사진에서 비드 윤곽과 결함을 찾습니다. 결과 좌표는 같은 호모그래피로 mm 좌표로 바꿉니다 (Roboflow 상자 크기로 mm를 환산하지 않습니다).
3-1. **가장자리 다시 찾기** (`engine/edges.py`, 평판만): Roboflow 윤곽은 계단 모양으로 거칠고 1~2mm 바깥으로 번지는 경우가 많아, 1mm마다 비드에 수직인 밝기 단면을 원본 사진에서 읽어 가장 뚜렷한 밝기 변화 위치를 새 가장자리로 삼습니다. 2026-11-23 시편 7개·사진 18장·실측 54곳 검증: 평균 오차 1.5mm → 1.1mm, ±1mm 이내 21 → 34곳. 목표 오차는 ±1mm (박사 결정, Roboflow 재학습은 나중에).
3-2. **자르기 재검출**: 사진 전체에서 비드를 하나도 못 찾으면, 마커 중심에서 마커 한 변 × 4 만큼(설정 `crop_half_markers`) 잘라 Roboflow에 한 번 더 보냅니다. 멀리서 찍어 비드가 작게 나온 사진용입니다. 2026-11-23 배관 30cm 사진 2장이 이 방법으로 검출됐습니다. 결과 JSON `detections.crop_retry`: 없음(null) = 안 함, `found` = 잘라서 찾음, `not_found` = 잘라도 못 찾음, `failed` = 다시 보내기 실패(원래 결과 유지).
   - 촬영 안내(평판·배관): **20~30cm 거리, 1배 카메라**(초광각 말고). 결함을 볼 때는 비드가 크게 나오는 20cm가 좋습니다. 너무 가까우면(10cm 안팎) 배관 좌우 끝(L·R)이 비스듬히 보여 폭이 작게 나옵니다. 배관 맞대기는 T 바로 위에서 1장.
4. **측정**
   - 비드 주축(PCA)에 수직으로 1mm 간격 폭 → 평균·최소(위치)·최대(위치)·표준편차·변동계수. 양 끝 10mm는 검사에서 뺍니다(폭·최소·최대·편차·직진도·결함 개수 모두). 폭 평균은 상·하위 10%를 뺀 절사평균입니다. 끝 구간 결함은 그림에 회색으로만 표시합니다.
   - 캘리퍼스 비교용 폭: 시작 10mm, 가운데, 끝 10mm 위치(각 ±1mm 평균). **시작 = 마커에 가까운 쪽 끝.**
   - 직진도: 폭 중심선과 최소제곱 기준선의 최대·평균·RMS 이탈(mm).
   - 결함: 종류(영어 코드), 신뢰도, 길이·폭(mm), 면적(mm²), 비드 시작점부터의 위치. 균열 등 선 모양 결함은 윤곽의 뼈대(skeleton) 길이로 실제 길이를 잽니다.
5. **결과**: JSON + 글자 없는 확인용 그림.
6. **윤곽 2차 검토** (`outline_review.py`, 서버): 측정에 쓴 비드 양쪽 가장자리(초록 선)만 그린 그림(`engine/review_image.py`)을 Claude 비전(기본 `claude-haiku-5-5`, 환경 변수 `OUTLINE_REVIEW_MODEL`로 변경)에 보내, 선이 비드 끝을 제대로 따라가는지 판단합니다. AI는 판단(`ok`/`check`)과 이유(`cuts_into_bead`, `includes_plate`, `shadow`, `glare`, `spatter`, `other`)·위치만 돌려주고 폭 값은 바꾸지 않습니다. 결과는 `result.outline_review`. 실패하면 `status: failed`로 남기고 결과는 그대로 저장합니다. 관리자 설정 `outline_review`: `off`(안 함) / `staff`(기본, 교사·행정·관리자에게만 보임) / `all`(교육생에게도 보임). 학습용 사진 받기에서 "윤곽 확인 필요만" 고르면 이런 사진만 받아 재학습 때 먼저 라벨링할 수 있습니다. 2026-11-24 시험: 숫자로 하는 자동 점검(밝기 경계와 AI 윤곽 비교)은 정상 윤곽(원래 1.5~3mm 계단)과 구별하지 못해 쓰지 않았습니다. 시험 도구: `python tools/outline_review_eval.py 그림폴더`.

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

## T4: 학습 보드 (board.py)

모든 사용자(교육생·교사·행정·관리자)가 보는 이론 학습 순위·통계. 지금 쓰는 교재만, 순위·통계는 교육생 것만 셉니다.

| 주소 | 하는 일 |
|---|---|
| `GET /study-board?course=all\|과정id&period=day\|week\|month\|all&sort=solved\|score\|rate&lang=ko` | 문제 풀이 순위·나·많이 물어본 질문·많이 틀린 문제·장별 정답률 |
| `GET /study-board/user/{id}?period=week` | 순위에서 사람을 누르면 그 사람의 장별 정답률 |

- 문제 풀이: 매일 문제(`daily_answers`) + 웰디 대화 중 문제(`tutor_answers`) 합산. 문제 하나 10점 만점, 같은 문제는 기간 안 처음 푼 것만, 채점 대기는 채점 뒤에. 정답률 순은 10문제 이상만.
- 많이 물어본 질문: `tutor_messages.topic` (AI 가 붙인 짧은 한국어 주제)로 묶음. 주제가 없는 질문은 보드를 열 때 뒤에서 40개씩 붙임(기본 `claude-haiku-5-5`). 이름은 안 보냄.
- 많이 틀린 문제: 5명 이상 푼 문제, 틀린 비율 순, 가장 많이 고른 오답. 이름은 안 보냄.
- 2차: 이번 주 성장왕(`growth`, 이번 주 vs 지난주 정답률, 두 주 모두 5문제 이상, 상위 3명), 과정 대항전(`courses`, 1인 평균·참여율), 교사·행정·관리자 전용(`staff`: 기간 안 안 푼 학생, 반별 약한 장 2개, 웰디·문제 신고 최근 10개).
- 계산 결과는 1분 동안 같이 씀. Supabase 준비: `supabase/step12-board.sql`.
- 흐름 시험: `python -m tests.board_check`
- 돌발 OX도 문제 풀이에 들어감(`live_ox_answers`, 맞으면 10점, `rows[].live`). 교사 칸 `staff.live_missed`: 기간 안 돌발 OX를 놓친 교육생.
- `GET /study-board/last-week`: 월요일 이론 탭 인사말용 지난주(월~일) 결산. 교육생은 내 푼 수·정답률·지지난주 대비·순위·약한 장·돌발 OX 수, 교사·관리자는 맡은 반 참여율·평균 정답률, 모두에게 가장 많이 푼 교육생. 인사말 문장은 앱이 8개 언어로 만듦(AI 안 씀).

## T5: 수업 중 돌발 OX (live.py)

교사가 반을 골라 OX 문제를 보내면 그 반 교육생 휴대폰(앱이 켜져 있을 때, 어느 화면이든)에 문제가 화면 가득 뜹니다. Expo Go 는 푸시가 안 되므로 앱이 3초마다 `GET /live/now` 로 묻습니다. 지금 내는 문제는 서버 메모리(uvicorn 1개)에만 두고, 로그인 확인도 60초 기억하므로 묻기만 할 때는 데이터베이스를 건드리지 않습니다(문제가 없으면 로그인 확인도 안 함).

| 주소 | 하는 일 |
|---|---|
| `GET /live/now?lang=` | 교육생: 내 반 돌발 OX (열림·끝난 뒤 15분) |
| `POST /live/answer` | 교육생 답 (시간 안에는 바꿀 수 있음, 끝난 뒤 1.5초 봐줌) |
| `GET /live/setup` | 교사·관리자: 보낼 수 있는 반, 장별 OX 수 |
| `POST /live/pick` | 문제 은행에서 OX 하나 (이 반에 30일 안 낸 문제 우선, `make=true` 면 장에 OX 가 없을 때 AI 로 새로 만들어 은행에 넣음) |
| `GET /live/bank?unit_key=` | OX 목록 (직접 고르기) |
| `POST /live/start` | 보내기: 은행 문제 또는 직접 친 문장(`status='live'`로 저장, 매일 문제·문제 은행 목록에는 안 나옴). 10·20·30·60초 |
| `GET /live/status/{id}` | 실시간: 답한 수·O/X 수·안 답한 이름, 끝난 뒤 정답률·틀린 이름 |
| `POST /live/end/{id}` | 지금 끝내기 |
| `POST /live/explain/{id}` | 웰디가 설명하기: 끝난 문제를 AI(기본 `claude-haiku-5-5`)가 쉬운 말 3~4문장으로 → 교육생 화면에 다시 뜸(교육생 언어로 번역) |
| `GET /live/history?course_id=` | 그날 이 반에 낸 돌발 OX·정답률 |

- 흐름: 보내기 → 준비(최근 30분 안에 앱을 연 교육생 언어로 번역, 최대 8초) → 열림 → 끝(정답·해설·반 정답률). 다른 문제를 보내면 앞 문제는 끝남.
- 나중에 음성(헤이 웰디)·수업 듣기 웰디에 쓰도록 나눠 둠: `make_ox(글, 제목)`(교재 범위든 수업 받아 적은 글이든 → OX) → `save_question` → `start_quiz(반, 교사, 문제, 초)`.
- 서버를 다시 켜면 열려 있던 문제는 사라짐(끝난 결과는 저장돼 있음). Supabase 준비: `supabase/step13-live-ox.sql`.
- 다시 풀기: 최근 3일 안에 낸 돌발 OX 중 반 정답률 60% 미만(3명 이상 답함)인 문제는, 그 반 교육생이 다음에 매일 문제를 열 때 맨 앞에 "⚡ 수업 중 돌발 OX 다시 풀기"로 더해짐(하루 최대 2개, 그 문제를 맞힌 사람·최근 30일 안에 매일 문제로 받은 사람은 빼고). 매일 문제 개수와 따로 세고 연속 일수 기준에도 안 들어감(`daily_sets.review_ids`, `supabase/step14-live-review.sql`, 실행 전에는 그냥 안 더함).
- 흐름 시험: `python -m tests.live_check`
