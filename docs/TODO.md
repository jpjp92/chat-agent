# TODO

> 완료된 항목은 [DEV_HISTORY.md](DEV_HISTORY.md)에 기록됩니다.

---

## 🟡 P1 — 기능 개선

### 0. 이미지+검색 할루시네이션 — 가짜 출처 생성

> **구현 완료 (2026-06-20)** — 이미지 첨부 후 후속턴 "검색해서 확인" 요청이 실제 grounding 없이 가짜 출처(`[1]`·ScienceDaily URL 등)를 지어내던 버그 근본 수정. `generator.ts`에 `dropImageForSearch` 가드 신설(general·현재턴 이미지없음·history 이미지있음·명시적 검색요청 시 이미지 파트 제거 후 grounding 활성화) + `prompt.ts`에 `[CRITICAL — NEVER FABRICATE SOURCES]` 절대 규칙을 모든 포맷 지시보다 최상단 배치. 상세·재현테스트: [DEV_260620](./logs/2026/06/DEV_260620.md).

- [ ] **후처리 방어(보조, 선택)** — grounding 메타데이터 부재 시 응답 내 fabricated 인용/참고자료 블록 strip (기존 `[N]` strip 로직 확장). 근본 수정으로 대부분 해소돼 우선순위 낮음.

### 1. 멀티턴 경고·차단

20개 메시지 시 Toast 경고, 30개 시 전송 차단 + 인라인 배너.

- [ ] `Toast.tsx` — `'warn'` 타입 추가 (앰버 계열)
- [ ] `useChatStream.ts` — 경고(20)·차단(30) 로직 + `onLimitReached` 콜백
- [ ] `App.tsx` — `isLimitReached` state + `onLimitReached` 핸들러
- [ ] `ChatArea.tsx` — 차단 배너 + 새 채팅 버튼
- [ ] `generator.ts` — 멀티턴 길이 기준 도달 시 thought signatures 제거 또는 히스토리 슬라이딩 윈도우 검토 (3.5 Flash thought preservation 비용 방지)

### 2. ChartRenderer 차트 품질 개선

> 테스트 스크립트로 케이스 확인 후 작업

- [ ] 🔴 `prompt.ts` — **스케일 계열이 다른 값을 한 축에 넣지 말 것**(이중 축 또는 차트 분리). 실측 2026-08-17: BLEU `22.3` 과 BLEURT `0.105` 를 같은 막대 축에 올려 **BLEURT 가 보이지 않았다** — 값이 0 인 것과 구분되지 않으므로 **조용히 틀린 그림**이다. 같은 위험을 벤치마크 표에서도 봤다(`GDPval-AA` 만 Elo `1656`, 나머지는 백분율 — 표로 답할 땐 모델이 구분했지만 차트였다면 같은 결함)
- [ ] `prompt.ts` — `data_viz` intent에 차트 타입 선택 기준 명시 (시계열→bar/line, 비율→pie, 상관→scatter)
- [ ] `prompt.ts` — `chartType` 선택 가이드 주석 보강 + 레이블 10자 이내 지시
- [ ] `ChartRenderer.tsx` — x축 레이블 너무 길 때 `\n` 줄바꿈 추가 검토
- [ ] `ChartRenderer.tsx` — y축 단위 단축 `1M`/`1만` 티어 추가 (현재 `≥1000 → k`만 구현, line 214)
- [ ] `ChartRenderer.tsx` — `pie` 선택인데 항목 수 > 8이면 `bar`로 자동 보정

---

### 3. lint 잔여 에러 30건 정리 후 `verify` 에 편입

2026-08-17 에 `npm run lint` 를 복구했다(Next 16 이 `next lint` 를 제거해 깨져 있었다).
`no-explicit-any` 를 경고로 낮추고 실제 신호 34건 중 4건(`rules-of-hooks` 1 + `prefer-const` 3)을
처리했다. **`rules-of-hooks` 1건은 실제 버그였다** — 스트리밍 중 코드블록 Copy 상태가 초기화됐다.

- [ ] `react-hooks/set-state-in-effect` 15건 — 대개 무해하지만 렌더 루프 위험이 있는 자리 확인
- [ ] `react-hooks/purity` 12건 — 12건 중 11건이 `ConstellationRenderer.tsx` 한 파일에 몰려 있다
- [ ] `react-hooks/refs` 1 · `react-hooks/immutability` 1 · `ban-ts-comment` 1
- [ ] 위가 0이 되면 `verify` 를 `typecheck && lint && test` 로 확장

> ⚠️ 지금 `lint` 를 `verify` 에 넣으면 **항상 빨간 명령**이 된다. 그건 `next lint` 가 깨진 채
> 방치됐던 상태와 같은 실패라 일부러 분리해뒀다.

## 🟢 P2 — 성능

현재 Lighthouse: Performance 91 / Accessibility 63 / Best Practices 100 / SEO 91 (2026-06-02 재측정, 4/4과 동일)

### DB 쿼리 최적화 및 캐싱

> 쿼리 효율화(select 컬럼 축소·`hasMore` 패턴·`updated_at` trigger), 인덱스 3종 확인, 싱글톤 연결 확인 완료 (DEV_HISTORY 참조). 남은 항목:

- [ ] 요청량 증가 대비 Supabase connection pool 설정 점검 (현재 direct client, pgBouncer 전환 검토)

### LCP 개선 (~3,300ms — `isAuthLoading` 블로킹)

> `isAuthLoading` 전체 차단 제거 + 백그라운드 인증, 세션/메시지 스켈레톤 UI 완료 (DEV_HISTORY 참조). 남은 항목:

- [ ] `handleNewSession` Optimistic UI (tempId 패턴)

### 번들 최적화

- [ ] FontAwesome — npm 패키지 4종 제거 완료(DEV_260613), 현재 CDN(`fa-solid` 클래스) 단일 사용. 자체 호스팅 전환 검토 (CSP 전제조건, ~18KB + 100ms)
- [ ] KaTeX / Google Fonts 자체 호스팅 (CDN 의존성 제거 + CSP 전제조건)
- [ ] `fonts.gstatic.com` preconnect `crossorigin="anonymous"` 추가

> CSP 도입은 KaTeX·FontAwesome 자체 호스팅 + inline style 의존성 제거 완료 후 가능

---

## 🔵 P3 — 기능 확장

### 외부 API 신규 연동

공통 구현 패턴: `tools.ts` → `router.ts` → `generator.ts` → `prompt.ts` → `ChatMessage.tsx` → `Renderer.tsx`

**⓪ 날씨 전용 툴 — KMA + OpenWeather** — ✅ **구현 완료 (2026-07-06, [DEV_260706](logs/2026/07/DEV_260706.md))** · 📋 기획서 [PLAN_WEATHER_TOOL_260706](plans/PLAN_WEATHER_TOOL_260706.md)

> 검토 2026-07-05. **현재 문제**: 전용 툴 없이 "날씨"가 [intentRules.ts:108](../server/agent/intentRules.ts#L108) domain 태깅 → [router.ts:106](../server/agent/nodes/router.ts#L106) `search:true` → **Google Search grounding + LLM 마크다운 표 생성**([prompt.ts:10-35](../server/agent/prompt.ts#L10)). 느림(15s+ grounding 왕복)·부정확(숫자 할루시네이션)·비구조적(카드 아님). 전용 툴로 전환 시 **~1s 결정론적 카드**.
> **레퍼런스에 KMA+OpenWeather 하이브리드 완성** (2026-07-05 git pull, 커밋 `f1f2867`·`d462167`). `reference/news/app/api/weather/route.ts`(768줄) — [buildWeatherData](../reference/news/app/api/weather/route.ts#L722) 디스패처(한국 도시&KMA키 → KMA, 실패 try/catch → OpenWeather 폴백), **통합 `WeatherData` 타입**(`source:'KMA'|'OpenWeather'`, 렌더러는 출처 무관). KMA 3종 병렬: `getUltraSrtNcst`(초단기실황 T1H·REH·WSD·RN1·PTY) + `getVilageFcst`(단기예보 TMP·POP·PCP·SKY·TMN·TMX) + `getLandFcst`(육상예보 `wf` 텍스트). base_time 슬롯팅·KST(+9h)·PTY/SKY 라벨맵·`numericValue`("강수없음"→0)·KMA→OpenWeather 아이콘코드 변환 포함. 엔드포인트 = **API Hub `apihub.kma.go.kr` + `authKey`**(구 data.go.kr serviceKey 아님).
> 설계: **KMA 우선(한국 정확도) + OpenWeather 보완(해외·geocoding·KMA 폴백)** 하이브리드. 레퍼런스가 KMA까지 다 풀어서 **처음부터 통째 이식 현실적**(단계 분리 불필요).
> **격자좌표는 하드코딩 대신 공식으로** — 레퍼런스는 24개 도시 `nx/ny`를 [KMA_CITIES 표](../reference/news/app/api/weather/route.ts#L199)에 박았으나(24개 도시 제약), **`dfsXyConv(lat,lon)` LCC 공식(~30줄, 오프라인)** 채택 시 표 폐기 + 전국 커버. 파이프라인: 도시명 → OpenWeather geocoding(이미 있음, lat/lon) → `dfsXyConv` → nx/ny → KMA. **단 `shortRegId`(육상예보)·`stnId`는 공식 없음(코드표 파일만)** → **육상예보(`getLandFcst`) 생략 권장**(카드 본체 무관, notes는 규칙기반 `weatherNotes`로 충분 + KMA 호출 3→2종 33%↓).
> **KMA API Hub 쿼터**: 20,000회/일(00시 KST 리셋)·5GB. 조회당 2종(육상 생략) → ~10,000 KR조회/일로 넉넉. **캐싱이 쿼터 방어선** — 레퍼런스 `revalidate:600`(10분)은 Fluid Compute 인스턴스별이라 불확실 → [url_cache 패턴](#L161)(Supabase TTL) 차용 검토. geocoding(OpenWeather 60call/min)도 캐시로 흡수.
> **✅ 실험 검증 완료** (2026-07-05, `scripts/test-weather-hybrid.ts`, 실행 `npx tsx scripts/test-weather-hybrid.ts [도시]`): ① **`KMA_API_KEY`가 API Hub authKey 확인**(apihub 정상 응답 — 최대 리스크 해소) ② **`dfsXyConv` 공식이 레퍼런스 격자와 정확히 일치**(서울 60,127·부산 98,76 — 하드코딩표 폐기 확정) ③ 해외(Tokyo) KMA 스킵 정상 ④ 레이턴시 **전체 1초 이내**(geocode ~350ms + OWM ~400ms + KMA 2콜 병렬 ~580ms, 현 grounding 15s+ 대비 압도) ⑤ KMA vs OWM 기온차 0.9~1.9°. **주의**: 수원은 공식 61,120 vs 하드코딩 60,121(1셀 차) — geocode 중심점 vs KMA 대표셀 차이, 무해.

- [x] `server/lib/weather/index.ts` — `buildWeatherData` 코어(툴에서 분리, 렌더러와 타입 공유). geocoding 1회 → `dfsXyConv` 격자(하드코딩 X, 전국) → KMA 2콜(육상 생략)/OWM 폴백. `numericValue` 범위·미만 파싱(전주 실측 40.5mm 검증). 출력 **언어 중립**(condition/note 코드)
- [x] `server/agent/weather-tool.ts` — `cities[]` 멀티 도시 병렬 → 도시별 `json:weather` 블록
- [x] `components/WeatherRenderer.tsx` — 프리뷰 카드 이식. 강수 "현재 우선 + 예보 fallback"(state=now/expected/none). KMA 가변 예보일·결측 조건부. 에러카드. 모바일 380 / 웹 540 + 가운데 정렬. 예보 스트립 모바일 반응형 축소·최고/최저 한줄·셀 호버(오늘/타요일 차별). **팔레트=웜 앰버(레퍼런스 정렬)**: 웜 차콜/크림 표면 + 앰버/테라코타 액센트(DEV_260706 §6-2). 위치 아이콘 `fa-location-dot`
- [x] `router.ts` + `intentRules.ts` — `weather` intent 분리(grounding 우회) + **멀티턴 후속 가드**(직전 assistant의 json:weather로 카드표시 판정 → 코멘트/해석은 general+카드데이터로 답·`needsSearch=false` / 새 조회는 weather 재조회, 스팟 10/10) + **폴백 규칙·구제**(라우터 LLM 실패 시 `classifyIntentByRules`가 weather 분류, 카드 있을 땐 구제 억제로 코멘트 승격 방지, 스팟 14/14) + **계절/현상 강등**(장마·폭염·미세먼지·태풍 등은 카드 범위 밖 → general+search, 2겹 가드 스팟 8/8)
- [x] `prompt.ts` — `weather` focus hint(툴 강제 호출·표 금지). WEATHER_FORMATTING은 general 폴백 존치
- [x] `state.ts`·`generator.ts`·`langchain-path.ts`·`graph.ts`·`ChatMessage.tsx`·`app/api/chat/route.ts` 배선 (LANGCHAIN/FAST_PASS 인텐트, on_tool_end 멀티블록 스트리밍)
- [x] 다국어(ko/en/es/fr) — UI 라벨·상태·강수문구 딕셔너리 + 요일 `Intl` + 로컬 tz 시각. **렌더러 클라이언트 처리**(OWM lang 불필요)
- [x] 예외/에러 — per-fetch 타임아웃(OWM 8s·KMA 9s, 60s 캡 방어) + KMA 빈데이터→OWM 폴백 + 렌더러 결측 가드
- [ ] (선택) 캐시 레이어 — Supabase TTL 도시별 10분. **보류**(KMA `revalidate:600` + 쿼터 여유 2콜/조회)
- [x] **키 종류 검증 완료** (2026-07-05) — `.env` `KMA_API_KEY` = API Hub authKey 확인 (`scripts/test-weather-hybrid.ts`)

**⓪-a 예보 범위 밖 처리 — 중기예보(6~10일) · 과거 기록** (백로그, 2026-07-06 제기)

> **현재 커버리지**: KMA 실황+단기(오늘~+3일)·OWM 5일. **미지원**: ⓐ 6~10일(중기예보) ⓑ 과거/이전 기록("어제/지난주/작년 이맘때 날씨"). 사용자가 범위 밖을 물으면 현재는 라우터가 weather로 보내 **가진 범위(≤5일) 카드만** 나오거나, 시점 감지 실패 시 grounding 표로 샐 수 있음. 아래로 정리.

- [ ] **라우터: 시점 범위 감지** — 발화에서 목표 시점을 파싱해 3분기. 현 후속 가드(`router.ts`)의 시간 정규식 확장.
  - 단기(오늘~+5일: 오늘/내일/모레/이번주/주말) → **현 툴**(그대로)
  - 중기(+6~+10일: "다음주 중반", "10일 뒤", "다음주 목요일" 등 D+6 이상) → **ⓐ 경로**
  - 과거(어제/그저께/지난주/지난달/작년/특정 과거일자) → **ⓑ 경로**
  - 애매/범위초과(+11일 이상·먼 미래) → 안내("예보는 최대 10일까지" 등) + (선택) grounding 폴백
- [ ] **ⓐ 중기예보(6~10일)** — 후보 2개:
  - **KMA 중기예보**: `getMidLandFcst`(육상 3~10일 날씨/강수확률) + `getMidTa`(기온 3~10일). ⚠️ **중기예보구역코드 `regId` 필요**(육상생략 때 피한 그 코드표 문제 재등장 — `dfsXyConv` 같은 공식 없음). 격자→중기구역 매핑표를 별도 확보해야(광역시/도 단위라 표는 작음 ~40여 개). 실황·단기와 시점 이어붙여 카드에 "중기" 섹션 or 별도 카드.
  - **OWM One Call 3.0**: 8일 daily 한 콜. 단 **별도 구독 가입**(무료 1,000call/day 한도, 현 `OPENWEATHER_API_KEY`와 다른 상품일 수 있음 — 키 확인 필요). 국내외 통일 장점.
  - 결정 포인트: 국내 정확도(KMA regId) vs 배선 단순성(OWM One Call). 실험 후 택1.
- [ ] **ⓑ 과거/이전 기록** — 후보:
  - **KMA 지상관측(ASOS/AWS) 과거자료**(API Hub): 관측소 `stnId` 기반 일/시간별 실측. ⚠️ `stnId`도 코드표(공식 없음) — geocode→최근접 관측소 매핑 필요. "정확한 실측"이 강점(예보 아닌 관측).
  - **OWM History/Time Machine**: 대부분 **유료**(무료티어 미포함) → 비용 이슈로 후순위.
  - UX: 과거는 예보 카드와 성격이 달라 **별도 렌더**(단일 관측 요약 or 기간 미니 차트) 검토. `data_viz` 차트 재사용 가능.
- [ ] **임시 처리(구현 전 안전판)** — ⓐ/ⓑ 구현 전까지: 범위 밖 감지 시 **현재 카드 강행 대신** ① "현재 단기예보는 최대 N일까지 제공돼요" 안내 후 ② (과거/실시간성 질의면) grounding 폴백 or 학습지식 답. 즉, weather intent에서 **범위 초과 플래그**를 세워 툴 대신 general로 우회. 사용자에게 빈 카드/오해 없게.
- [ ] **캐싱·쿼터** — 중기예보는 하루 2회(06:00/18:00 발표)라 캐시 수명 길게(수 시간). 과거자료는 불변이라 영구 캐시 가능.

**① arXiv + PubMed 논문 검색** (★★★)
- [ ] `server/agent/paper-tool.ts` — arXiv Atom XML + PubMed esearch→esummary→efetch 파이프라인
- [ ] `components/PaperRenderer.tsx`
- [ ] `state.ts`, `router.ts`, `generator.ts`, `prompt.ts`, `ChatMessage.tsx` 공통 패턴 적용

**② 서울 문화행사** (★★) — 키: `CULTURE_API_KEY`
- [ ] `server/agent/culture-tool.ts` — 구 필터 + 오늘 이후 정렬 + 썸네일
- [ ] `components/CultureRenderer.tsx`
- [ ] `state.ts`, `router.ts`, `generator.ts`, `prompt.ts`, `ChatMessage.tsx` 공통 패턴 적용

**③ NEIS 학교기본정보** (★★) — 키: `EDU_KEY`
- [ ] `server/agent/school-tool.ts` — `SCHUL_NM`/`LCTN_SC_NM`/`SCHUL_KND_SC_NM` 파라미터
- [ ] `components/SchoolRenderer.tsx`
- [ ] `state.ts`, `router.ts`, `generator.ts`, `prompt.ts`, `ChatMessage.tsx` 공통 패턴 적용

> **④ 영화 상영정보 / 박스오피스 — 구현 완료** (`server/agent/movie-tool.ts`, `components/MovieRenderer.tsx`, `app/api/showtimes`, 멀티턴 후속질문 `lib/movieContext.ts`). 상세: DEV_260610~613.

> **⑤ 스포츠(월드컵) — 구현 완료** (`lib/sports/football-data.ts`, `server/agent/worldcup-tool.ts`, `sports` intent). football-data.org 연동으로 WC 순위/대진/득점왕, grounding 우회. 상세: DEV_260621. 제약: 무료 티어 과거시즌 미지원·rate limit 분당 6회.

**⑤-확장 — 다른 리그/대회 지원** (추후): 현 `SPORTS_API_KEY`(TIER_ONE)로 WC 외에도 호출 가능한 대회가 많음 — **CL(챔피언스리그)**, EPL(PL)·라리가(PD)·분데스리가(BL1)·세리에A(SA)·리그1(FL1)·유로(EC)·에레디비시(DED)·프리메이라리가(PPL)·브라질세리에A(BSA)·챔피언십(ELC)·코파리베르타도레스(CLI). reference `chat_w_AI/utils/query_analyzer.py`의 `LEAGUE_MAPPING`(epl→PL 등) + CL 멀티그룹 파서 패턴 그대로 이식 가능.
- [ ] `worldCupTool`을 범용 `sportsTool`로 일반화 — `competition` 인자(WC/CL/PL/PD…) 추가, 리그명 키워드→코드 매핑
- [ ] 단판 리그는 단일 테이블(`standings[0].table`), CL/WC는 멀티그룹 — 기존 분기 재사용
- [ ] 라우터 키워드 확장(프리미어리그/챔스/라리가 등), intent명 재고(sports 유지 가능)
- [ ] 캐시 키에 competition 포함, rate limit 분당 6회 → 대회 추가 시 캐시 TTL 재점검
- [ ] (선택) 전용 카드 UI(crest 로고/하이라이트)

> 주의사항: arXiv timeout → `AbortSignal.timeout(6000)` 필수 / PubMed `NCBI_KEY` 없으면 10 req/s / NEIS `schoolInfo[0].head[1].RESULT.CODE` 에러 체크 필수

### 국가법령정보 후속 확장

현행 법령 MVP 완료. 아래는 `law_search` 확장 또는 별도 intent.

- [ ] 판례/헌재결정례/행정심판례 검색 (`case_search` intent 분리 검토)
- [ ] 행정규칙·자치법규·고시 조회 지원
- [ ] 법령해석례·중앙부처 해석 조회
- [ ] 법령 연혁·신구법·3단 비교·변경이력 카드
- [ ] 법령용어/관련법령 지식베이스 검색 보강
- [ ] 별표·서식 목록 조회 및 원문 링크 카드

### 이미지 생성 (OpenAI Image2) — 키: `OPENAI_API_KEY`

> 1차 테스트 기준: `gpt-image-2-2026-04-21`, 기본 `low + 1536x1024`, 상세 계획: `plans/PLAN_OPENAI_IMAGE2_INFOGRAPHIC_TEST_260602.md`

**검증 선행**
- [ ] 기존 `scripts/image-gen-output/openai-image2-pipeline/report-*.json` 집계 스크립트 추가 — quality/layout별 latency, output image tokens, 실패 원인 요약
- [ ] `scripts/openai-image2-pipeline-test.mjs` — `--case-set korean` 추가
- [ ] 한국어 QA 테스트 — 짧은 3카드, 4카드, 긴 문장, comic UI panel, whiteboard, mixed 생물 도식, CS architecture
- [ ] layout smoke test — `pipeline`, `timeline`, `decision_tree`를 cards/diagram과 분리해 검증
- [ ] `medium normal` 최소 1장 테스트 — dense가 아닌 medium 비용/latency baseline 확인

**구현**
- [ ] `server/agent/state.ts` — `image_gen` intent 및 image job 상태 필드 설계
- [ ] `server/agent/nodes/router.ts` — 이미지 생성 감지 + intent/domain/layout/language 라우팅
- [ ] 신규 prompt builder — rule-based guardrail 먼저 적용, Gemini는 구조화 JSON만 담당
- [ ] 이미지 생성 API/worker — queue 기반 처리, user active job 1개, global concurrency 2
- [ ] 사용량 제한 — free 3 images/day, medium은 premium/regenerate 전용
- [ ] `components/ImageGenRenderer.tsx` — queued/running/succeeded/failed 상태 카드, 다운로드, 프롬프트 보기
- [ ] `components/ChatMessage.tsx` — `image-gen` 블록 파서 + lazy import 연결

---

## ⚪ 백로그

### 모바일 초기 세션 공백 (재현 빈도 낮음)
- [ ] `useChatSessions.ts` — `currentSessionId` 있지만 `sessions`에서 찾지 못할 때 자동 복구
- [ ] `ChatArea.tsx` — `Suspense fallback={null}` → 메시지 skeleton 표시 검토
- [ ] `ChatArea.tsx` — lazy chunk 로드 실패 재시도
- [ ] `useChatStream.ts` — 스트림 완료 후처리 미도달 시 제목 생성 누락 보정
- [ ] `useChatSessions.ts` — 응답은 있으나 제목이 기본값인 세션의 제목 재생성 fallback
- [ ] `ChatInput.tsx` — `onSend` 완료 전 입력값·첨부 상태 보존

### 프롬프트 언어 혼합 (한국어 메인, 실체감 낮음)
- [ ] `prompt.ts` — URL summary placeholder / YouTube fallback / `getPillWarnFallback` 언어별 분리
- [ ] `router.ts` — intent 수 주석과 `in Seoul` stale 설명 정리
- [ ] `generator.ts` — current time 주입 포맷 중립화 또는 언어별 locale 적용
- [x] `prompt.ts` — renderer schema 전역 주입을 intent별 주입으로 분리 (완료: `generator.ts` 의 `getRendererSections(state.intent, langName)`)

### 알약 식별 후속 (각인 DB 구조적 한계로 보류)
- [ ] `generator.ts` — non-exact 후보 안내 문구 정밀화
- [ ] `pill-logic.ts` — 추출 shape 기준 후보 정렬 보강 (타원형·장방형 상단 배치)
- [ ] `drug-info-tool.ts` — 약품명 기반 `mfds_pills` 로컬 1차 조회/fallback 구조
- [ ] `app/api/pill-search/route.ts` — `searchMfdsPills()` 우선 + `searchPill()` 폴백
- [ ] `mfds-logic.ts` — 무각인/복수 후보 랭킹에 크기·제형·양면 색상 활용
- [ ] `mfds_pills` — 약품명 검색 랭킹 설계 (mg 정규화, 오탐 방지)

### 동물병원 상세정보 선택형 보강 (복잡도 대비 사용 빈도 낮음)
- [ ] `VetRenderer.tsx` — 병원별 `상세 정보 찾기` 액션 UX
- [ ] `vet_search` 후속 — 선택 병원 1곳 웹검색으로 영업시간/홈페이지/연락처 보강
- [ ] 자동 보강 시 상위 1~3개 제한, 실패 시 기본 카드 유지

### 캐싱 (트래픽 증가 시 재검토)

> 참조: `url_cache` 테이블(14일 TTL, `fetch-url`)로 Supabase TTL 캐시 패턴이 이미 구축됨 — 아래 구현 시 레퍼런스로 차용.

- [ ] `sessions/route.ts` — Next.js `unstable_cache` / `revalidateTag` (유저별 캐시 키 + 메시지 전송 시 invalidate)
- [ ] 약국/병원/동물병원 툴 — 동일 지역 재검색 캐시 (`url_cache` 패턴 차용, Fluid Compute 메모리 비지속 대응)
- [ ] `drug-info-tool.ts` — 동일 약품명 Google Search 결과 캐싱

### URL fetch 견고화 (DEV_260707 후속)

> 배경: wikidocs 블로그 502 근본 원인은 `isSecurityBlock`의 `'cloudflare'` 오판이었고 수정 완료. 아래는 그 과정에서 드러난 구조적 취약점.

- [ ] **wikidocs 블로그 redundancy 부재** — 블로그형 페이지는 실질적으로 ScrapingBee 단일 의존(browserless는 본문 0·en-US 셸, scraperapi는 45s 타임아웃). ScrapingBee가 실제로 실패(크레딧 소진·bad window)하면 여전히 502 → **ScrapingBee 1회 재시도**(DEV_260606 "간격 재시도" 학습) 또는 wikidocs 블로그용 browserless 렌더 옵션(waitForSelector) 보강 검토.
- [ ] **`isSecurityBlock` substring 매칭의 콘텐츠 오판 소지** — 추출 본문에 특정 단어 포함만으로 CF 챌린지 판정 → 정상 기사가 그 단어를 언급하면 오판(이번 `cloudflare` 케이스). 챌린지 판정은 가능하면 HTTP status·응답 크기·`<title>` 등 **구조 신호 우선**으로 리팩토링 검토.

### 응답 산문 가독성 규칙 (DEV_260707 §6 후속, 보류)

- [ ] **`[PROSE READABILITY]` 프롬프트 규칙** — 일반 대화(표·카드 아님) 산문 응답의 문단 분할·공백 줄·"직답 먼저 후 부연" 가이드를 `prompt.ts` [FORMATTING & QUALITY]에 추가 검토. 선행: DEV_260707 §6 메타코멘트 오프너 억제만으로 가독성 개선 폭을 배포 후 관찰한 뒤 필요성 재평가.

### 핵심 UX
- [ ] **메시지 재생성** — 같은 프롬프트 재실행
- [ ] **메시지 편집** — 입력창 프리필은 구현됨(`editingMessageContent`/`editValue`, `ChatInput.tsx:100`); 남은 건 편집 시점 이후 히스토리 truncate 후 재실행
- [ ] **세션 문서 컨텍스트 영구 저장** — `lastActiveDoc` Supabase 저장

### 보안

> 인증 전환 완료(2026-07-14, [DEV_260714](logs/2026/07/DEV_260714.md)). DB 테이블은 RLS + Bearer 토큰 user-scoped 클라이언트로 전환됨 — **Storage만 아직 admin 클라이언트**.

- [x] **IDOR-1** `app/api/auth/route.ts` — **라우트 자체를 삭제**. 닉네임 upsert가 Supabase Auth로 대체되며 소멸.
- [x] **IDOR-2** `app/api/sessions/route.ts` — `user_id` 파라미터 폐기. RLS가 스코프를 강제하므로 라우트가 소유권을 검사할 필요가 없다(`lib/supabase/route.ts` `createRouteClient`).
- [x] **`scripts/` 정리 — 예외 26줄을 폴더 분리로 대체** (2026-08-18) — `tests/`(하니스 6종) · `docs/guide/db/`(SQL + 적재 + README) · `scripts/`는 통째로 gitignore. `.gitignore` 96 → 67줄. → [tests/README.md](../tests/README.md) · [db/README.md](guide/db/README.md)
  - **교훈**: 예외 목록이 길어지면 규칙이 아니라 **배치**가 틀린 것이다. 위치가 곧 정책이 되게 한다

- [x] **알약 식별 결함 5건 수정** (2026-08-18) — 각인 `OG37`(무코스타서방정150mg) 테스트에서 연달아 나왔다. → [DEV_HISTORY](DEV_HISTORY.md)
  - [x] `similar` 을 각인 기반인 것처럼 표시하던 문구 — **91% 경로의 S등급 결함**(각인 텍스트 보유 8.7%)
  - [x] 빈 각인이 다음 줄을 삼켜 `식별표시: - Color: 하양` 이 찍히던 파싱 버그(`\s` 가 개행을 먹음)
  - [x] `DB 등록 각인` 으로 칸 이름 명확화 + 빈 값 `정보 없음` — **"각인 없음"과 "정보 없음"은 다른 주장**이고 우리는 전자를 모른다(23,121행이 텍스트·이미지 둘 다 없음)
  - [x] 라우터 지름길이 후속 턴을 가로채 같은 답을 반복하던 문제 — `hasImage` → 신규 첨부 기준. **DEV_260808 함정의 네 번째 사례**
  - [x] 🔴 **웹 검색 전체가 출처 없이 답하고 있었다** — DDG 가 속성 순서를 바꾸고 `uddg=` 를 폐지해 URL 추출이 0건. `server/agent/ddg-parse.ts` 로 분리 + 하니스 11건
  - [x] 웹 폴백 — 각인을 읽었는데 식약처에 없으면 웹 검색(결정론적 1회, 출처 필수). 종단 실측으로 정답 확인
  - [ ] ⬜ **`[LangGraph] Pill web fallback gate/search` 계측 로그 유지 여부 판단** — 지금은 남겨뒀다. 이 경로가 조용히 안 도는 걸 한 번 겪었으므로 당분간 유지 권장
  - [ ] ⬜ **각인 이미지(`mark_code_front_img`) 활용 검토** — dev 에 10건뿐이라 지금은 무의미하지만, 상류가 채우기 시작하면 vision 으로 읽을 여지
  - [x] ~~웹 폴백을 `drug_info` 에도 적용~~ — **이미 있다**(2026-08-18 확인). `drug-info-tool.ts` 가 `[MFDS_NOT_FOUND]` 일 때 ①Google Search grounding ②DuckDuckGo ③"검색 못 함"과 "결과 없음"을 구분한 안내 순으로 탄다. 오늘 고친 DDG 파서가 ②를 같이 되살렸다
  - [ ] ⬜ **`drug_info` 는 각인으로 못 찾는다** — `search_drug_info` 가 *약품명* 기준이라, 이미지 없이 "OG37 각인 약이 뭐야?" 로 물으면 못 찾는다. 각인처럼 보이는 토큰이면 `drug_id` 의 웹 폴백과 같은 경로를 태울 여지

- [ ] 🔴 **무인증 라우트가 2개 더 있다 — `fetch-url`·`sync-drug-image`** (2026-08-18 발견) — 8/17 에 `upload`·`create-signed-url`·`parse-document` 를 막았는데 **같은 계열인 이 둘이 범위에서 빠졌다.** 침묵 제거 배포를 검증하려고 토큰 없이 호출해봤더니 그대로 200 이었다 — 그 순간 발견했다. `grep -n "createRouteClient|unauthorized|Authorization"` → **두 파일 다 0건.**
  - **왜 빠졌나**: 8/17 점검이 *"Storage 에 쓰는 라우트"* 를 훑었고, 이 둘은 **Storage 가 주업이 아니라서** 검색에 안 걸렸다(`fetch-url` 은 스크래핑, `sync-drug-image` 는 이미지 프록시인데 부수적으로 Storage 에 쓴다). 🔴 **DEV_260808 의 *"특정 사례로 이름 붙인 규칙은 그 사례에만 적용된다"* 와 같은 형태다** — 이번엔 코드가 아니라 **점검 범위**에 그 함정이 있었다. 다음 점검은 *"Storage 쓰는 곳"* 이 아니라 **"인증 없는 POST 라우트 전부"** 로 훑을 것
  - 🔴 **실질 위험 ① 유료 스크래퍼 소진** — `fetch-url` 은 임의 URL 을 받아 서버가 대신 가져온다. 캐시 미스면 browserless(**1000 units/월**, 회당 ~2)를 태운다. 아무나 새 URL 을 넣어 소진시킬 수 있고, **비용이 나가는데 로그로만 보인다.** 8/17 의 "열린 업로드"(용량·대역폭)보다 **단가가 높다**
  - 🟡 **실질 위험 ② 서비스 도메인 대리 요청** — 우리 IP·도메인으로 임의 사이트에 요청이 나간다. 차단당하면 우리가 막힌다
  - ✅ **SSRF 는 생각보다 낫다(실측)** — `SSRF_BLOCK`([fetch-url:18](../app/api/fetch-url/route.ts#L18))은 차단 목록인데 localhost·RFC1918·`169.254`(메타데이터)·IPv6 loopback/ULA/link-local 을 덮는다. **숫자 IP 우회도 막힌다** — WHATWG `new URL()` 이 `http://2130706433/` 을 `127.0.0.1` 로 정규화해주기 때문(정규식 덕이 아니라 **파서 덕**이다. 이 의존을 주석에 적어둘 것)
    ```
    127.0.0.1 → 400 · 2130706433 → 400 · 169.254.169.254 → 400
    [::ffff:127.0.0.1] → 502   ← 🟡 차단 목록 통과. fetch 까지 갔다가 실패
    ```
    - [ ] IPv4-mapped IPv6(`::ffff:*`) 를 `SSRF_BLOCK` 에 추가
    - [ ] **미검증**: ⓐ리다이렉트 추적(공개 URL → `169.254.169.254`) ⓑ내부 IP 로 해석되는 호스트명. 차단 목록 방식의 구조적 한계라 **해소하려면 응답 IP 검증이 필요**하다
  - [ ] **1차 조치는 인증이다** — 둘 다 로그인 사용자만 쓰면 소진 위험이 실사용자 범위로 줄어든다. `authedFetch` + `createRouteClient` 로 8/17 과 같은 패턴. ⚠️ **호출부를 먼저 확인할 것** — 8/17 에 SQL 을 먼저 올려야 했던 것과 같은 순서 문제가 있을 수 있다
  - [ ] 그 다음 **레이트 리밋** — 인증만으로는 로그인한 사용자 1명이 소진시키는 걸 못 막는다

- [~] **IDOR-3 → 실제로는 "열린 업로드"였다** (2026-08-17 재평가) — 이 항목의 기술이 실제보다 약했다. *"admin 클라이언트 + 형식 검증뿐"* 은 "인증은 되는데 소유권 검증이 없다"로 읽히지만, **세 라우트에 인증 코드가 0건**이었고 클라이언트도 `authedFetch` 가 아닌 평범한 `fetch` 였다. 누구나 공개 버킷에 파일을 쌓을 수 있었다(용량·대역폭 비용 + 이 서비스 도메인에서 서빙).
  - [x] **Phase 1** — `authedFetch` 전환 · JWT `sub` 로 `${uid}/` prefix · user-scoped 클라이언트 · `docs/guide/db/storage-user-prefix-rls.sql`. **버킷은 공개 유지.** 막는 것: 무인증 업로드 · 타인 파일 덮어쓰기 · 열거
  - [ ] **Phase 2** — 버킷 비공개 + 서명 다운로드 URL + `chat_messages.attachment_url` 백필. 🔴 **미뤄진 진짜 이유가 이것이다** — 저장된 값이 `getPublicUrl` 결과라 비공개로 돌리면 **과거 대화 이미지가 전부 400**
  - [x] 🔴 **적용 순서: SQL 먼저, 배포 나중.** 코드를 먼저 올리면 정책이 없어 업로드가 전부 거부된다 — 이 순서로 실행했고 무중단이었다
  - [x] 레거시 평면 경로는 **그대로 둔다** — 소유자를 알 수 없어 이관 불가. 정책에 읽기 예외를 뒀고 Phase 2 때 재검토
  - [x] **`/api/upload` 삭제** — `40ff02e`(2026-03-09) 서명 URL 도입으로 대체됐는데 Next.js 이관이 사용처 확인 없이 옮겨왔다. **5개월간 죽은 채 무인증**이었다
  - [x] 파일명 정리 `lib/storage-name.ts` — 한글이 대시로 뭉개져 Storage 콘솔에서 식별 불가였던 것(보안 아님, 조사용 가독성). 🟡 순한글 이름은 여전히 `file.hwp`
  - **실측 (dev, 2026-08-17)**: 정책 12행 ✅ · 신규 키 `uid/` prefix ✅ · 10MB HWP 종단 ✅ · 신규 첨부 이미지 세션 재진입 복원 ✅(2건)
  - [x] ~~**레거시 평면 경로 첨부가 여전히 보이는가**~~ — 🔴 **질문 자체가 틀렸다**(2026-08-18). 첨부 이미지는 `getPublicUrl` 결과를 `<img src>` 로 그대로 쓰므로 **공개 엔드포인트 직행이고 RLS 를 타지 않는다.** 정책을 롤백하든 말든 결과가 같아 이 테스트는 실패할 수 없었다. RLS 가 걸리는 유일한 곳은 `parse-document` 의 `download()` 인데 거기 정규식이 uid 세그먼트를 필수로 요구해 레거시는 400 으로 먼저 막힌다 → **되돌릴 것 없음.** 상세: [PLAN_PRIORITY §0](plans/PLAN_PRIORITY_260817.md)
  - [x] **무인증 401 실측** (2026-08-18, dev) — `create-signed-url` 401 · `parse-document` 401 · **위조 Bearer 도 401**(헤더 유무가 아니라 검증이 막는다) · `/api/upload` 404(삭제 확인)
  - 🔴 **교훈 — 롤백 기준을 적을 땐 그 기준이 걸리는 경로를 먼저 읽는다.** 위 항목을 "유일하게 되돌림이 필요한 것"으로 0순위에 올려뒀는데, 확인에 5분이면 될 것을 안 했다. **틀린 판정 기준은 없는 것보다 나쁘다** — 통과해도 아무것도 보장하지 않으면서 다른 항목을 밀어낸다
- [ ] **모델·API 레퍼런스 검토 후속** → [PLAN_MODEL_API_REVIEW_260817](plans/PLAN_MODEL_API_REVIEW_260817.md)
  - [ ] 🔴 `THINKING_MODE` 실측표 + `resolveThinkingConfig` 전환 — **3.7 은 `minimal` 을 400 으로 거부한다.** 지금 3.7 을 추가하면 전 호출이 죽는다
  - [ ] `MODEL_CAPS` 에 3.7 · `FLASH_3_7` 레지스트리 + i18n (**기본은 3.6 유지** — 출시 직후 503 잦음)
  - [ ] `services/geminiService.ts:220` 의 `'gemini-3.5-flash'` 리터럴 제거(기본값 불일치)
  - [ ] 🔴 **Files API 전환 검토** — 임의 URL 을 `fileData` 로 넘기는 현재 패턴은 **문서 어디에도 없다.** 3.x 의 429 는 결함이 아니라 계약 위반이고, 2.5 만 관대해서 강등이 통했다. Files API 는 무료·영상 지원
  - [ ] 프로브 A(도구 조합) — 되면 라우터의 존재 이유가 바뀐다. 단 thought signature 보존이 선행
  - [ ] `media_resolution` 을 PDF 에 적용 (BACKLOG D3 레버)
  - [ ] 라우터를 `3.5-flash-lite` 로 검토 — ⚠️ 기본 thinking 이 **On(minimal)** 이라 명시 지정 필요
  - [ ] 3.7 `fastLongInput` 재측정 (503 이 잦아든 뒤)
- [ ] 🔴 **`sync-drug-image` 가 `supabaseAdmin` 을 명시하게 한다** — `drug-cache/<md5>.jpg` 경로는 8/17 Storage RLS 정책(첫 세그먼트 = `auth.uid()`)상 **거부돼야 하는데**, `server/supabase.ts` 의 `supabase` 가 실제로는 `service_role` 키를 들고 있어 **우연히 살아 있다**. 키가 anon 으로 바뀌면 **조용히 죽는다**(공개 버킷이라 기존 캐시는 계속 보이고 **새 약품만 이미지를 잃는다**). 이름(`supabase`)과 권한(admin)이 어긋난 것을 코드에서 명시할 것
- [ ] **침묵 제거 2건** — 2026-08-17 사고 넷이 전부 "조용해서 오래 걸렸다"
  - [ ] `server/mfds-logic.ts` — `const { data }` 로 **`error` 를 버린다.** 테이블이 없어도 예외 없이 `match_type:'none'` 이 되어 스크래핑 폴백으로 내려간다
  - [ ] `app/api/fetch-url/route.ts` — `setCached` 의 upsert 반환 `error` 를 읽지 않는다. `getCached` 도 `if (error || !data) return null` 이라 **테이블 없음과 캐시 미스가 구분되지 않는다**
- [ ] **main `mfds_pills` 재적재** — 수정 전 스크립트로 적재해 약품 ~3,000건이 빠져 있다. ⚠️ `.env.local` 을 프로덕션 값으로 바꾸는 순간이 위험 지점이라 **컷오버와 함께** 할 것
- [ ] **HWP 파싱 산출물의 죽은 `<img>` 약 40개** — `<img src="image_001.bmp">` 는 HWP 내부 리소스명이라 어디로도 해석되지 않는다. 파서에서 제거하거나 자리표시로 대체 (먼저 화면에서 깨진 아이콘으로 보이는지 확인)
- [ ] **chat-docs 고아 파일 정리** — parse-document의 route-side `remove()` 제거로, Storage PUT 후 parse 호출 전 중단 시 잔존 가능 → 버킷 TTL 또는 스케줄 정리 (대용량 경로만 해당)
- [ ] `xlsx` 대안 패키지 검토 (Prototype Pollution·ReDoS fix 없음)
- [ ] CSP 도입 — 번들 최적화(자체 호스팅) 완료 후 연계

### 아키텍처 리팩토링
- [ ] **`generator.ts` 경로 분리 (진행 중)** — 1·2·4-A·3-A 완료(1148→685줄, -40%). 남은 3-B(SDK 경로 → `sdk-path.ts`)·4-B(에러 술어 수렴)는 [PLAN_GENERATOR_REFACTOR_260621](plans/PLAN_GENERATOR_REFACTOR_260621.md) 참조 (dev E2E 필수)
- [ ] **DTO 레이어** — Route Handlers 경계에서 Zod 스키마 기반 요청·응답 DTO 정의
- [ ] `app/api/chat/route.ts` — normalizer / stream-events / persistence 분리
- [ ] `geminiService.ts` — 에러 계약 통일 (Result 패턴)
- [ ] `attachment` + `attachments` 필드 단일화
- [ ] `ChatInput.tsx` — `useSpeechInput` / `useAttachmentProcessor` 훅 분리
- [ ] i18n 중앙화 (`src/i18n/messages.ts`)

### 다크모드 웜 차콜 테마 (검토·보류)

> reference `reference/news`(웜 종이+테라코타/틸 어시 팔레트) UI 이식 검토(2026-07-05). 결론: **다크 배경만** 안전, 라이트/오브 이식은 비추천. 프리뷰: [preview/dark-warm-charcoal.html](../preview/dark-warm-charcoal.html) (현재 `#131314` ↔ 웜 차콜 나란히 비교 + 오브 토글).

- [ ] `app/layout.tsx:54` — 다크 `bg-[#131314]` → 웜 차콜 그라디언트(`#111316→#1b1a17` + 올리브/러스트 radial) 이동 검토. 명도 거의 동일해 저리스크.
- [ ] 오브는 **바이올렛 톤 유지**(우리 아이덴티티) — 레퍼런스 어시(올리브/러스트) 오브는 바이올렛 액센트와 탁하게 충돌(프리뷰에서 확인). `globals.css` `.orb` 색만 조정.
- ❌ **라이트 베이지 배경(`#f2f0ea`) 이식 비추천** — 액센트(바이올렛→테라코타/틸)까지 통째 리브랜딩 각오 아니면 웜 배경+쿨 보라가 muddy. `.warm-bg` radial 워시도 어시 전용이라 부적합.

### 시각화 카드 전체화면 팝업
- [ ] `expandedViz` state + `VisualizationModal` Portal (`App.tsx`)
- [ ] ESC 키 닫기, `onExpand` prop (렌더러 전체)
- [ ] `isExpanded` prop (BioRenderer), `isPaused` prop (DiagramRenderer)

### 데이터 & 시각화
- [ ] CSV/XLSX 파싱 고도화 (대용량 행 제한·샘플링, 다중 시트)
- [ ] Chem-Viz 대형 분자 동적 스케일링

### 코드 품질
- [ ] ESLint / Prettier 설정
- [ ] 단위 테스트 (Vitest)

> `attachment`/`attachments` 단일화 · `ChatInput` 훅 분리는 §아키텍처 리팩토링 항목 참조 (중복 제거).

### 낮은 우선순위
- [ ] ARC (Agent RAG Cache) — 트래픽 증가 시 재검토
- [ ] 3D Astro-Viz, 3D Physics-Viz, Plotly/D3 벡터장
- [ ] Service Worker (PWA)
- [ ] 카카오 지도 모달 팝업 — 약국/병원 카드 마커 + 커스텀 오버레이

---

## 📋 장기 계획 (검토 중)

### 인증 시스템 전환 — ✅ 스테이징 완료 (2026-07-14)

nickname localStorage → **Supabase Auth + RLS**. 아래 L1~L4 로드맵 중 **L3+L4 직행**했다 — L1(자체 `auth_tokens` 테이블)은 Supabase Auth를 도입하는 순간 폐기될 코드라 만들지 않았고, L2(IDOR-1/2)는 라우트 삭제와 RLS로 **소멸**했다.

| 단계 | 결과 |
|---|---|
| ~~L1 서버 토큰 발급~~ | **생략** — Supabase Auth의 JWT가 대체 |
| ~~L2 IDOR 수정~~ | **소멸** — IDOR-1은 라우트 삭제, IDOR-2는 RLS가 강제 |
| **L3** Supabase Auth 전환 | ✅ Anonymous Sign-in(게스트) + Google `linkIdentity`(같은 uuid 유지 → 대화 승계) |
| **L4** RLS 활성화 | ✅ 전 테이블 정책 + Bearer 토큰 user-scoped 클라이언트. `service_role`은 Storage 라우트에만 잔존(→ IDOR-3) |

- 구현·검증: [DEV_260714](logs/2026/07/DEV_260714.md) · 설계 [PLAN_AUTH_MVP_260709](plans/PLAN_AUTH_MVP_260709.md) · 검증 [PLAN_AUTH_MVP_TEST_260709](plans/PLAN_AUTH_MVP_TEST_260709.md)
- [~] **로그인 경로 정비** — [PLAN_AUTH_SIGNIN_PATHS_260715](plans/PLAN_AUTH_SIGNIN_PATHS_260715.md). **구현 완료·tsc 0**(3파일, SQL 무변경). 계정 선택창(`prompt=select_account`) · 대화 0개 게스트는 `signInWithOAuth` 직행(= 캐시 지운 사용자가 실패 없이 로그인) · 설정에 "다른 계정으로 로그인". **남음: 브라우저 3건**(선택창 뜨는지 / 0개 게스트 충돌 없이 로그인 / 계정 전환 시 사이드바 완전 교체)
- [ ] **프로덕션 이관** — SQL 3종 적용(`docs/guide/db/auth-mvp-*.sql`) · 대시보드 3종(Anonymous Sign-ins / **Allow manual linking** / Google provider) · Google Cloud에 운영 콜백 URI + JS 원본 · Supabase Redirect URLs
- [ ] 크로스 디바이스 승계 실기기 확인 (구조는 스테이징 §5-2와 동일, 미검증)
- [ ] (post-MVP) Kakao · 이메일+비밀번호 — Google 연결 후엔 이메일이 검증된 상태라 `updateUser({ password })`가 깔끔하게 동작
- [ ] (보류) Google 동의 화면에 앱 이름 대신 `*.supabase.co` 노출 — Supabase Custom Domain(유료) 외 방법 없음

### Trial / Playground

로그인 없이 서비스 체험 가능한 게스트 플레이그라운드.

- 세션 미저장 — in-memory only, 탭 닫으면 소멸 (Supabase write 없음)
- 메시지 횟수 제한 — 세션당 N회 (미정), 초과 시 회원가입 유도
- 일부 기능 비활성 — 파일 업로드, 세션 히스토리, 세션 이름 변경 등
- 모델 제한 — 기본 모델만 허용, Flash 고급 옵션 잠금
- 회원가입 유도 배너 — 제한 도달 시 / 일정 메시지 수 초과 시

> 선행 조건: L1(서버 토큰) 완료 후 guest 토큰 흐름 분기 추가

---

### Agentic AI 업그레이드

현재: `router → (vision?) → generator ↔ tools` 단순 ReAct 루프

| 방향 | 항목 | 복잡도 |
|---|---|---|
| **A. 더 똑똑하게** | A1 Supervisor, A2 도메인 서브에이전트, A3 Planning Node, A4 Reflection Node | 중~높음 |
| **B. 더 많이** | B1 병렬 툴 호출, B2 코드 실행, B3 계산기, B4 Wikipedia/PubMed, B5 차트 생성, B6 파일 분석 | 낮~높음 |
| **C. 더 기억하게** | C1 세션 요약, C2 유저 프로필 메모리, C3 벡터 RAG, C4 크로스세션 컨텍스트 | 낮~높음 |

추천 순서: B3/B4/C1(단기) → B1/A4/C2(중기) → A1~A3/B2/C3(장기)

### 모델 확장 (멀티 프로바이더)

M1(프로바이더 추상화) 없이 OpenAI 추가 시 `generator.ts` 과부하 → M1이 진입점.

| 단계 | 내용 |
|---|---|
| M1 프로바이더 추상화 | `server/providers/` — gemini.ts / openai.ts / index.ts |
| M2 API 키 확장 | `config.ts` OPENAI_API_KEY 추가, `getGeminiKey()` / `getOpenAIKey()` 분리 |
| M3 모델 레지스트리 | `server/models.ts` provider/capability metadata 확장 |
| M4 OpenAI 매핑 | 공통 내부 포맷 → 프로바이더 변환 (이미지/시스템프롬프트/YouTube/Search) |
| M5 이미지 생성 | Imagen 4 → P3에서 선행 구현 가능 (M1 불필요) |
| M6 프론트 UI | 멀티 프로바이더 그룹 표시, 세션별 모델 기억 |

**Gemini 3.5 Flash 전환 완료 — 후속 점검** (`DEFAULT_CHAT_MODEL = gemini-3.5-flash` 이미 적용):
- [x] **모델 정책 정리** (2026-06-22, [DEV_260622 §3](./logs/2026/06/DEV_260622.md)) — 5/30 3.5 전환이 외부 API 도구 경로 전반을 느리게 한 회귀(drug_info는 Vercel 60s 초과 무응답)를 수정. **외부 API 도구 인텐트(drug_*/pharmacy/hospital/vet/law/movie/sports)는 2.5-flash**(fast-pass는 thinking off), **일반 대화(SDK)만 3.5 유지**. `langchain-path.ts` `pathModel` 다운시프트.
- [x] `drug-info-tool.ts` — 본문 `temperature: 0.1` **유지 결정** (2026-06-20, 약품 정보 일관성). 단 `extractImprintViaVision`(각인 OCR)은 2026-06-22 OCR 버그픽스로 `temperature: 0` + 2.5-flash + `thinkingBudget:0`으로 변경(각인 1자 판독 결정성·속도).
- [ ] LangChain path `maxOutputTokens: 8192` → 상향 검토 — 경로는 3-A로 [`langchain-path.ts`](../server/agent/nodes/langchain-path.ts)로 이동(generator.ts 아님). 도구 인텐트가 2.5로 내려간 지금은 우선순위 낮음.
- [x] **YouTube 영상 턴 2.5 고정** (2026-06-22, [DEV_260622 §7](./logs/2026/06/DEV_260622.md)) — 배포 실측 YouTube 요약 59.20s/60s(천장 0.8s)로 무응답 위험. `generator.ts:81`에서 `isYoutubeRequest && hasVideoData`(영상 실제 전송 턴)일 때만 `resolvedModel`을 2.5로 고정 → 16.4s. 멀티턴 후속 텍스트 Q&A는 영상 미재전송(hasVideoData=false)이라 3.5 일반 정책 복귀.
- [ ] **도구 인텐트 후속 가드 부재(분석, [DEV_260622 §8](./logs/2026/06/DEV_260622.md))** — 약국/병원/법령/약품/축구는 영화(`movieContext`)와 달리 전용 후속 가드가 없어, 멀티턴 후속이 라우터 재분류 변동성에 노출(같은 입력이 general↔도구로 흔들릴 수 있음). 카드 데이터는 history에 저장돼 SDK general 후속이 읽을 수 있으나(fast-pass는 카드 JSON만 저장), "영화 정보" 변동성(§5)과 동종 잠재 이슈. 보고되면 movie식 후속 가드 확장 검토. 현재 버그 아님 → 우선순위 보류.

> 의학·YouTube(영상 턴 2.5)·law 경로 및 Search two-track, PDF 토큰 증가는 3.5/2.5 정책으로 이미 운영 중 — 별도 검증 항목 제거.

**라우터 레이턴시 검토 후속** ([DEV_260622 §9](./logs/2026/06/DEV_260622.md), 라우터는 START 직후 serial-blocking LLM 1회):
- [x] **[A] 라우터 LLM `thinkingConfig:{thinkingBudget:0}` 추가** (2026-06-22, 저위험) — [`router.ts:112`](../server/agent/nodes/router.ts#L112) `config`에 thinking off 명시. 같은 flash-lite인 [`summarize-title/route.ts:44`](../app/api/summarize-title/route.ts#L44)와 동일 패턴. 순수 JSON 분류(15개 택1+boolean)는 얕은 작업이라 thinking 불필요 + 매 턴 blocking이라 영향 직접적. flash-lite 기본 off라도 API 기본값 변동 면역용 핀. tsc 0.
- [ ] **[B] 고신뢰 인텐트 휴리스틱 short-circuit** (중위험·중효과) — 명백·고정밀 패턴(예: "CGV 상영시간표", "약국 찾아줘")은 LLM 호출 스킵해 round-trip 통째 제거. 최대 절감이나 regex 오발=오라우팅 위험 → 고정밀 소수 패턴만 opt-in + 회귀 테스트 필요.
- 실패 재시도 2회(키 로테이션, [C])·전체 카테고리 프롬프트(~1.5KB, [D])는 현행 유지 결론(정확도/안정성 우선, 효과 작음).

**지연 단축 후속** ([DEV_260624](./logs/2026/06/DEV_260624.md), 기획·재점검 [PLAN_STREAMING_PARTIAL_260623](plans/PLAN_STREAMING_PARTIAL_260623.md) §9·§10):
- [x] **general `low → minimal`** (2026-06-24) — 비검색 general 3.5의 thinking을 minimal로. 코드·수학·추론 5케이스 실측 평균 −25%(코드 −58%)·품질 저하 0(`scripts/test-low-vs-minimal-reasoning.ts`). [`generation-config.ts`](../server/agent/nodes/generation-config.ts) 3.5 분기 minimal 통합. 롤백=한 줄(`low` 복귀).
- [x] **Stage2 503/429 분리** (2026-06-24) — 503(모델 폭주)에 키 로테이션 12회 헛돌던(~24s) 것을 백오프 최대 2회 후 2.5 폴백으로. 429/timeout만 로테이션 유지. [`generator.ts`](../server/agent/nodes/generator.ts) Stage2 catch.
- [ ] **폭주 정상화 후 재측정** — minimal·Stage2 fix 효과는 Google 503 "high demand" 이벤트 중 측정돼 오염됨(비검색 minimal인데 18.8s). 정상 시 minimal ~5s·Stage2 28s→6s 확인 + §8 체크리스트 A~D prod 실측.
- [ ] **503 처리 확장 점검** — Stage1·단일패스·라우터의 503 거동(Stage2만 수정). (후속/보류) 서킷 브레이커: 3.5 503 직후 ~30s 요청 2.5 우회.
- [ ] **Phase 1 스트리밍 전환** (미착수) — general 산문 토큰 스트리밍(TTFT·모바일 셀룰러). 렌더러 JSON·LangChain 카드는 제외. PLAN §3~5 + 회귀 체크리스트.
- [ ] **제목 미생성(모바일 간헐)** — summarize-title fetch가 스트림 완료 후 실행 → 모바일 백그라운딩 suspend, 또는 `updateSessionTitle` DB write 실패(삼킴). 로그로 갈래 판별 후 방어.

**URL 요약·이미지/영상 모델 정책 + 503 거동** (2026-06-26):
- [x] **URL 요약 = 2.5-flash + thinking off 고정** — URL 본문 주입 턴(`[URL_CONTENT:`)은 Search OFF + 본문이 답을 결정하는 추출성 작업. 3.5 무료티어 throughput 한계(20~30s)로 지연 → 외부 도구 인텐트와 같은 논리로 2.5 고정. [`generator.ts`](../server/agent/nodes/generator.ts) `hasUrlContentForModel` 분기 + [`generation-config.ts`](../server/agent/nodes/generation-config.ts) `hasUrlContent → thinkingBudget:0`. 실측 근거: 2.5 OFF가 5~15s·60s안전·품질 동등(일반/뉴스/기술 3유형), 3.5 무료는 86~97s 또는 전키 503. 스크립트 `scripts/test-url-summary-*.ts`.
- [x] **이미지·영상 미디어 턴 = 2.5 + thinking off 고정** — 멀티모달(이미지/업로드 영상)도 무료 3.5에서 throughput 한계로 60s 캡 초과(이미지 56s vs 2.5 5s, Tier1 3.5는 3.5s). `isMediaTurn = hasMultimodalContent && !hasDocumentContent`(PDF/문서 제외)로 [`generator.ts`](../server/agent/nodes/generator.ts) effectiveModel 2.5 핀 + [`generation-config.ts`](../server/agent/nodes/generation-config.ts) thinkingBudget0. YouTube 핀이 못 잡는 업로드 영상까지 커버. 멀티턴: chat route `isRecent`(최근 3턴) 윈도우 동안 미디어 재전송 → 2.5 유지, 윈도우 밖 → 3.5 복귀. PDF/문서는 별도 측정 후 결정(보류).
- [x] **SDK 경로 503 다운그레이드** — 3.5 첫 503에서 키 로테이션 대신 2.5로 강등(`unavailableDowngrade`). 같은 혼잡 모델에 12키 헛도는 것 방지. [`generator.ts`](../server/agent/nodes/generator.ts). (line 287 "서킷 브레이커: 3.5 503 직후 2.5 우회"의 SDK 경로분 해당)
- [ ] **하이브리드 Tier1 폴백 (검토)** — Tier1(유료) 키 실측 시 3.5가 **빠르고 안정**(URL 6~9s, 이미지 3.5s) + 품질 미세 우위(무료 86~97s/ERROR·이미지 56s는 3.5 탓이 아니라 무료티어 throughput/503 혼잡 탓으로 판명, 2026-06-26). **URL 요약·이미지·영상**을 무료 2.5 우선 → 503·전키 소진 시 Tier1 3.5 폴백하면 비용 최소화 + 혼잡 내성 + 고품질. 전제: `config.ts`가 현재 `API_KEY_TIER1` 미사용 → 별도 배선(Tier1 전용 getter 또는 경로별 키 오버라이드) 필요. 결정: 기본값은 무료 2.5 유지, 하이브리드는 추후.
  - **(2026-07-03 실측·기록)** 유튜브 요약 실패 건에서 이 Tier1 라우팅을 실제 배선해봄(`process.env.API_KEY_TIER1` 별도 로드 → 유튜브 턴만 라우팅). Tier1이 무료보다 ~10s 빠르나(raw 29.6 vs 39.9s), **§아래 mediaResolution LOW로 무료도 22.9s면 충분**해 불필요 → 코드 전부 제거. **재사용 가능한 지렛대로 기억**: 무거운 경로에서 무료 throughput이 부족하면 `API_KEY_TIER1`을 `process.env`로 별도 로드해 그 경로만 유료로 라우팅(정규식 `/^API_KEY\d*$/`엔 안 걸림).
- [x] **유튜브 요약 60s 캡 초과 근본 해결 — `mediaResolution: LOW`** (2026-07-03, [DEV_260703 §7](./logs/2026/07/DEV_260703.md)) — 긴 영상 요약이 타임아웃(93.7s). `usageMetadata` 실측 결과 병목은 **영상 입력 토큰**(기본 해상도 315,695 토큰, 출력은 1,943뿐 → maxOutputTokens 축소 무효). `generator.ts`가 `isYtVideoTurn`일 때 config에 `mediaResolution: 'MEDIA_RESOLUTION_LOW'` 주입 → 입력 110,243 토큰(-65%)·앱 무료 22.9s/Tier1 17.7s. 요약 화질 무관이라 품질 손실 없음. 타임아웃 상향(48→57s)은 미봉책이었고 이게 근본. (업로드 영상 등 다른 무거운 멀티모달에도 확장 검토 여지 — 현재는 유튜브 턴만.)
