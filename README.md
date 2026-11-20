# AI W.E.P (AI Welding Education Platform)

기술교육원 용접 교육생과 교사를 위한 모바일 앱입니다.
아루코 마커와 함께 찍은 용접 사진을 분석해 비드 폭·직진도·결함을 mm 단위로 보여주고, AI 종합리포트를 제공합니다.

- 프레임워크: Expo SDK 58 (React Native, TypeScript, Expo Router)
- 패키지 이름: `com.aiwep.app`
- 화면 코드 위치: `src/app/`

## PC에서 실행하기

처음 한 번만:

```bash
git clone https://github.com/gmrfyd912/ai-wep.git
cd ai-wep
npm install
```

실행:

```bash
npx expo start
```

터미널에 QR 코드가 나오면 휴대폰의 Expo Go 앱(스토어 최신 버전)으로 스캔합니다.
PC와 휴대폰이 같은 와이파이에 있어야 합니다. 연결이 안 되면 `npx expo start --tunnel`을 사용합니다.

최신 코드 받기:

```bash
git pull
npm install
npx expo start
```

## 단계별 롤백 지점

각 단계가 정상 동작하면 그 상태를 `rollback/<단계>` 브랜치로 GitHub에 남깁니다.
이 브랜치는 수정하지 않고 보존만 합니다.

| 롤백 브랜치 | 내용 |
|---|---|
| `rollback/v0.0-init` | Expo SDK 58 빈 프로젝트, 첫 화면 "AI W.E.P" |

이전 단계로 되돌릴 때는 해당 롤백 브랜치의 상태로 main을 되돌립니다.

## 비밀 키 관리

API 키와 비밀번호는 `.env` 파일에만 넣고 절대 GitHub에 올리지 않습니다(`.gitignore`에 등록됨).
