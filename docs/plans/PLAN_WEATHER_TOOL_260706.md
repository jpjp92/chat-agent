# 기획: 날씨 전용 툴 (KMA + OpenWeather 하이브리드)

> 작성일: 2026-07-06
> 상태: **✅ 구현 완료 (2026-07-06, [DEV_260706](../logs/2026/07/DEV_260706.md))** — §5 체크리스트 참고
> 트리거: reference `news` 프로젝트의 KMA+OpenWeather 하이브리드 날씨 구현 검토
> 선행 검토·검증: [DEV_260705](../logs/2026/07/DEV_260705.md) (실험 결과·강수 파싱·언어 매핑)
> 프리뷰: [preview/weather-card-sample.html](../../preview/weather-card-sample.html) (카드 디자인, 라이트/다크 + 4개 언어)
> 검증 스크립트: `scripts/test-weather-hybrid.ts`

---

## 0. TL;DR

- **현재 문제**: 전용 날씨 툴 없음. "날씨"가 general+`search:true`로 흘러 **Google Search grounding + LLM 마크다운 표 생성**([prompt.ts:10-35](../../server/agent/prompt.ts#L10)) → 느림(15s+)·부정확(할루시네이션)·비구조(카드 아님).
- **해결**: 전용 툴로 KMA(한국 정밀) + OpenWeather(해외·폴백) 직접 호출 → **~1s 결정론적 카드**.
- **키 이미 보유** (`KMA_API_KEY`·`OPENWEATHER_API_KEY`), **실험 검증 완료** — 리스크 해소, 순수 배선 작업만 남음.
- 격자는 **하드코딩 X, `dfsXyConv` 공식** → 전국 커버. 강수는 **현재 우선 + 예보 fallback**. 4개 언어(ko/en/es/fr) 매핑.

---

## 1. 현재 구조 (왜 느리고 부정확한가)

"오늘 날씨 어때?" 흐름:
1. [intentRules.ts:108](../../server/agent/intentRules.ts#L108) `domain` 태깅 → [router.ts:106](../../server/agent/nodes/router.ts#L106) `search:true`
2. **Google Search grounding**(SDK 경로)
3. [prompt.ts:10-35](../../server/agent/prompt.ts#L10) 지시대로 LLM이 마크다운 이모지 표 **직접 생성**

문제:
- **느림** — grounding 왕복 + LLM 표 생성 15s+. `Vercel 60s 천장` 압박
- **부정확** — 숫자를 LLM이 grounding 텍스트에서 추출 → 할루시네이션·stale
- **비구조** — 카드 아닌 매번 재생성 마크다운 표

---

## 2. 목표 구조

```
weather intent (router 분리, search:false)
  → weatherTool
      ├ 한국 도시?  → KMA (dfsXyConv로 격자, 실황+단기예보 병렬)  ─실패→ OpenWeather 폴백
      └ 해외/기타   → OpenWeather (geocoding→current+forecast 병렬)
  → 통합 WeatherData (source:'KMA'|'OpenWeather')
  → WeatherRenderer 카드 (렌더러는 출처 무관)
```

레퍼런스 코어([reference/news/app/api/weather/route.ts](../../reference/news/app/api/weather/route.ts), 768줄)를 이식하되 아래 4가지를 우리 방식으로 개선.

---

## 3. 핵심 설계 결정 (실험 검증 완료)

### 3-1. 격자좌표: 하드코딩 → `dfsXyConv` 공식

- 레퍼런스는 24개 도시 `nx/ny`를 표에 하드코딩(24개 도시 제약).
- **`dfsXyConv(lat,lon)` LCC 공식**(~30줄, 오프라인) 채택 → 표 폐기 + **전국 커버**.
- 파이프라인: `도시명 → OpenWeather geocoding(lat/lon) → dfsXyConv → nx/ny → KMA`.
- **✅ 검증**: 공식 결과가 레퍼런스 하드코딩값과 정확 일치(서울 60,127·부산 98,76). ([DEV_260705 §4](../logs/2026/07/DEV_260705.md), `scripts/test-weather-hybrid.ts`)
- **육상예보(`getLandFcst`) 생략** — `shortRegId`/`stnId`는 공식 없음(코드표 파일만). notes는 규칙기반으로 충분 + KMA 호출 3→2종(33%↓).

### 3-2. 강수: 현재 우선 + 예보 fallback + PCP 파싱 강화

- KMA `RN1`(현재 1h 누적)은 지금 안 오면 대부분 0 → 비 예보 있어도 0 표시 오해.
- **표시 로직** (레퍼런스 `e8fe197` 채택): `현재>0 ? "Xmm 현재" : 예보(daily[0])>0 ? "Xmm 예상" : "0mm"`.
- **PCP 파싱 강화** — KMA PCP 범위 문자열(`30.0~50.0mm`·`1.0mm 미만`)이 naive `replace`로 `null`화(폭우 때 강수량 소실) → firstNumber 정규식 + `A~Bmm→(A+B)/2`·`미만→/2` ([reference route.ts numericValue](../../reference/news/app/api/weather/route.ts#L318), [DEV_260705 §7-2](../logs/2026/07/DEV_260705.md)).

### 3-3. 다국어 (ko/en/es/fr)

| 데이터 | 처리 | 비용 |
|---|---|---|
| UI 라벨(습도·풍속·강수확률…) | i18n 딕셔너리 4개 언어 | 정적 1회 |
| OpenWeather 상태문구 | API `lang=kr\|en\|es\|fr` 파라미터 | **공짜** |
| KMA 상태문구(맑음/비/소나기…) | `PTY/SKY 코드 → {ko,en,es,fr}` 맵 | 우리 매핑(PTY 8·SKY 3종, 부담 없음) |
| 요일 | `Intl.DateTimeFormat(locale,{weekday})` | 자동, 매핑 불필요 |
| 안내 카피(우산 챙기세요 등) | 규칙기반 `weatherNotes` 언어별 | 우리 작성 |

### 3-4. 캐싱 (쿼터·레이턴시 방어)

- KMA API Hub 쿼터: **20,000회/일**(00시 KST 리셋)·5GB. 2종/조회 → ~10,000 KR조회/일(넉넉).
- 레퍼런스 `revalidate:600`은 Fluid Compute 인스턴스별이라 불확실 → **Supabase TTL(`url_cache` 패턴) 도시별 10분 캐시** 권장.

---

## 4. 카드 디자인 (프리뷰 확정 방향)

[preview/weather-card-sample.html](../../preview/weather-card-sample.html) — 챗 말풍선용 **컴팩트 카드**:

- **시그니처**: ① 강수 히어로 블록(현재/예상 배지 색 구분) ② 컨디션 기반 하늘 그라디언트(수직 소멸, 경계 없음)
- **구성**: 위치+출처 배지 / 대형 온도+상태+체감 / 강수 히어로(예상mm·강수확률) / 스탯 3칩(습도·풍속·구름) / 예보 스트립(grid `1fr` 균등, KMA +3일·OWM 5일) / 푸터(업데이트·출처)
- **우리 idiom**: 바이올렛 액센트, Inter, 글래스, `rounded-26px`, 라이트/다크, `tabular-nums`, 절제된 1모션(비 시머, reduced-motion 존중)
- 출처 배지 파랑=KMA / 회색=OpenWeather (데이터 provenance 노출)

---

## 5. 구현 체크리스트 (공통 패턴: `tool → router.ts → generator.ts → langchain-path.ts → ChatMessage.tsx → Renderer.tsx`)

> **구현 완료 (2026-07-06)** — 아래 전부 배선·검증. `npx tsx scripts/test-weather-tool.ts`로 서울/전주/부산/Tokyo/없는도시 스모크 통과, `tsc --noEmit` 0.

- [x] `server/lib/weather/index.ts` — `buildWeatherData` 코어 (툴에서 분리, 렌더러와 타입 공유)
  - [x] `dfsXyConv` 공식 + OpenWeather geocoding **1회** 재사용 (격자 하드코딩 X, 전국 커버). geocoding country=KR → KMA
  - [x] KMA 실황(`getUltraSrtNcst`)+단기(`getVilageFcst`) 병렬, **육상예보 생략**(2콜)
  - [x] `numericValue` 강수 파싱 강화(범위/미만/없음) — 전주 실측 40.5mm 정상(범위문자열 소실 방지 검증)
  - [x] KMA 실패 try/catch → OpenWeather 폴백
  - [x] 출력 **언어 중립**(condition/note 코드 + 숫자) — i18n은 렌더러가 담당(OWM `lang` 파라미터 불필요)
- [x] `server/agent/weather-tool.ts` — `cities[]` 멀티 도시 병렬 → 도시별 `json:weather` 블록 이어붙임
- [x] `server/agent/state.ts` — `weather` intent 추가
- [x] `server/agent/nodes/router.ts` — `weather` intent 분류 + LLM 프롬프트 카테고리 + **후속 해석 가드**(해석형 질문 weather→general 결정론 다운그레이드, DEV_260705 §9)
- [x] `server/agent/nodes/generator.ts` + `langchain-path.ts` — `weather`를 LANGCHAIN/FAST_PASS 인텐트에 추가(grounding 우회, 2.5-flash) + weatherTool 바인딩 + fast-pass
- [x] `server/agent/graph.ts` — ToolNode에 weatherTool 등록
- [x] `app/api/chat/route.ts` — `on_tool_end`에 weatherTool 추가(멀티 블록 전역 매칭 스트리밍)
- [x] `server/agent/prompt.ts` — `weather` focus hint(툴 강제 호출·표 금지). WEATHER_FORMATTING은 general 폴백용으로 존치
- [x] `components/WeatherRenderer.tsx` — 프리뷰 카드 이식 (KMA 가변 예보일·`pressure`/`visibility`/`feelsLike` 결측 처리·에러카드)
- [x] `components/ChatMessage.tsx` — `weather` 블록 파서 + lazy import + 렌더 배선
- [x] i18n — UI 라벨·상태(condition)·강수문구 4개 언어 딕셔너리 + 요일 `Intl.DateTimeFormat` + 로컬 tz 시각 포맷
- [ ] (선택) 캐시 레이어 — Supabase TTL(url_cache 패턴) 도시별 10분. **미적용** — KMA `next:{revalidate:600}` + 쿼터 여유(2콜/조회)로 우선 보류
- [x] 키 종류 검증 완료 — `KMA_API_KEY`=API Hub authKey ([DEV_260705 §4](../logs/2026/07/DEV_260705.md))

---

## 6. 리스크 / 주의

- **KMA 예보 일수** — `getVilageFcst`는 실제 +3일까지. "5일"은 KMA일 때 3일만 채워짐(OWM은 5일). 렌더러가 가변 처리.
- **KMA 결측 필드** — `feelsLike`=temp 동일, `pressure`/`visibilityKm`/`windGust`=null. 카드에서 조건부 렌더.
- **소스 불일치** — KMA(관측)와 OWM(모델)이 국지 강수에서 갈릴 수 있음(실측: 서울 KMA 무강수 vs OWM 비). KMA primary 유지하되 `PTY>0 && RN1==0`은 "약한 비/곧 비" 문구.
- **격자 셀 오차** — 공식은 geocode 중심점이 떨어지는 셀 사용(하드코딩 대표셀과 ~1셀 차 가능). 무해.

---

## 7. 참조

- 검토·검증 로그: [DEV_260705](../logs/2026/07/DEV_260705.md)
- 검증 스크립트: `scripts/test-weather-hybrid.ts`
- 카드 프리뷰: [preview/weather-card-sample.html](../../preview/weather-card-sample.html)
- 레퍼런스 구현: [reference/news/app/api/weather/route.ts](../../reference/news/app/api/weather/route.ts)
- TODO 항목: [TODO.md §P3 ⓪](../TODO.md)
