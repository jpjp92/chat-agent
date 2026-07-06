# Weather: Test Prompt Guide

`weather` intent와 `weatherTool`(KMA + OpenWeather 하이브리드) 레퍼런스. 특정 지역의 현재 날씨·기온·강수·단기예보를 실시간 조회해 **결정론적 카드**로 렌더한다.

> 기술 상세(검토·검증·강수 파싱·라우터 실험): [`../logs/2026/07/DEV_260705.md`](../logs/2026/07/DEV_260705.md) · 구현: [`../logs/2026/07/DEV_260706.md`](../logs/2026/07/DEV_260706.md)
> 설계/계획: [`../plans/PLAN_WEATHER_TOOL_260706.md`](../plans/PLAN_WEATHER_TOOL_260706.md)
> ⚠️ `KMA_API_KEY`(기상청 **API Hub** `apihub.kma.go.kr` authKey, 20,000회/일)·`OPENWEATHER_API_KEY`(geocoding + 해외/폴백) 필요.

---

## 왜 전용 API인가 (grounding 우회)

"날씨"를 general+`search:true`로 흘리면 Google Search grounding 왕복 + LLM이 grounding 텍스트에서 숫자를 뽑아 마크다운 표를 생성한다 → **느림(15s+)·부정확(할루시네이션·stale)·비구조(카드 아님)**. 전용 툴이 KMA/OWM를 서버에서 직접 호출하면 **~1s 결정론 카드**.

```
날씨 질의 → router(weather, search:false) → generator/langchain-path(weatherTool)
  → server/lib/weather (geocoding 1회 → dfsXyConv 격자 → KMA 2콜 or OWM)
  → ```json:weather 블록 → route.ts on_tool_end 스트리밍 → fast-pass(LLM 우회)
  → ChatMessage 파서 → WeatherRenderer 카드
```

한국(geocoding country=KR) → **KMA**(실황 `getUltraSrtNcst` + 단기 `getVilageFcst` 병렬, 육상예보 생략), 실패 시 **OpenWeather 폴백**. 해외 → OpenWeather(current + 5day forecast). 출력은 **언어 중립 구조**(condition/note 코드 + 숫자) — i18n(라벨·상태·요일)은 `WeatherRenderer`가 `language` prop으로 매핑(OWM `lang` 파라미터 불필요).

**격자는 하드코딩 표가 아니라 `dfsXyConv(lat,lon)` LCC 공식**(오프라인, 전국 커버) — geocoding이 준 lat/lon을 KMA 격자 nx/ny로 변환. 서울 60,127·부산 98,76 등 검증 완료.

---

## Tool Schema — `weatherTool`

| 인자 | 값 | 설명 |
|---|---|---|
| `cities` | `string[]` (선택) | 조회 지역명 배열. 한 곳이면 `["서울"]`, 여러 곳이면 `["전주","부산"]`. 미언급 시 생략(기본 서울). 최대 4개. |

반환: 도시별 `` ```json:weather `` 블록(멀티 도시는 이어붙임) + 지시문(그대로 출력·수치 변형 금지). 도시별 try/catch로 부분 실패 격리(`{error:true, code}` → 에러카드).

**WeatherData 구조**(언어 중립): `source`(KMA|OpenWeather) · `current`(temp·feelsLike·humidity·windSpeed·clouds·`condition` 코드·`precip{state:now|expected|none, mm, pop}`) · `daily[]`(date·condition·min/maxTemp·pop·rainMm·snowMm) · `notes[]` 코드.

**강수 표시**: `현재>0 ? now : 예보(daily[0])>0 ? expected : none`. KMA `RN1`은 비 안 오면 0이라 예보 fallback 필수. PCP 범위문자열(`30~50mm`)은 `numericValue`가 중앙값 파싱(폭우 강수량 소실 방지).

---

## 테스트 프롬프트

### 1. 단일 도시
```
서울 날씨
오늘 날씨 어때?
```
→ `intent=weather`, KMA 카드(현재 온도·상태·강수 히어로·습도/풍속/구름·단기예보 스트립).

### 2. 멀티 도시
```
전주, 서울 날씨 알려줘
```
→ `cities=["전주","서울"]`, 카드 **2개** 생성(각 도시별 json:weather 블록).

### 3. 해외 (OpenWeather)
```
도쿄 날씨
weather in Madrid
```
→ geocoding country≠KR → OpenWeather, 5일 예보 카드.

### 4. 멀티턴 후속 — 코멘트/해석 (카드 재생성 X)
```
(카드 표시 후) 전주가 서울보다 기온이 높네?
우산 챙겨야 할까?   /   습도가 높은 편이야?
```
→ 라우터가 직전 assistant의 `json:weather`로 카드 표시 판정 → **general**(히스토리 카드 데이터로 답, 재조회·검색 안 함). 카드 다시 안 뜸.

### 5. 멀티턴 후속 — 새 조회 (카드 재생성 O)
```
(카드 표시 후) 부산은?   /   내일은?   /   제주도 날씨도
이번 주말 날씨 어때?
```
→ 새 도시/시점 신호 → **weather** 재조회, 새 카드.

---

## Tips

- **KMA vs OWM 예보일**: KMA 단기는 실제 +3일, OWM은 5일 → 렌더러가 가변 처리(`forecastNote` "KMA +N일").
- **결측 필드**: KMA는 `feelsLike`=기온 동일·`pressure`/`visibility`/`windGust`=null → 카드 조건부 렌더.
- **소스 불일치**: KMA(관측)와 OWM(모델)이 국지 강수에서 갈릴 수 있음. KMA primary 유지.
- **라우터 폴백**: LLM 실패(무료티어 503/timeout) 시 `classifyIntentByRules`의 weather 규칙이 결정론 분류(grounding 표로 새는 것 방지).
- **팔레트**: 웜 앰버(레퍼런스 `news` 정렬) — 웜 차콜/크림 + 앰버/테라코타 액센트. 하늘 그라디언트는 날씨 의미라 유지.
- **범위 밖(백로그)**: 6~10일 중기예보·과거 기록은 미지원 — 처리 방안은 [`../TODO.md`](../TODO.md) §P3 ⓪-a.
