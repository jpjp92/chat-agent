# TODO

> 완료된 항목은 [DEV_HISTORY.md](DEV_HISTORY.md)에 기록됩니다.

---

## 🟡 P1 — 기능 개선

### 0. 🐞 이미지+검색 할루시네이션 — 가짜 출처 생성 (구현 완료 2026-06-20)

**증상:** 이미지 첨부 후 후속턴에서 "검색해서 확인해줘" 요청 시, 실제 Google Search grounding 없이 "검색어:/검색 결과 분석:/`[1]` 인용/참고 자료: ScienceDaily URL"을 통째로 지어냄. grounding 메타데이터 없음 → 소스 칩 미표시(= 가짜 검색의 증거).

**근본 원인:** [`generator.ts:275`](../server/agent/nodes/generator.ts#L275) `useGoogleSearch = !hasMultimodalContent && !historyHasImage`. 이미지가 history에 있으면 Google Search 강제 OFF(Gemini API: inline 이미지+Search 동시 불가). 라우터가 `needsSearch=true`로 정상 판정해도 [라인 345](../server/agent/nodes/generator.ts#L345) 게이트가 이미 false라 **명시적 검색 요청이 묵살**됨. 2차로 [`prompt.ts:103-104`](../server/agent/prompt.ts#L103)의 "검색 안 했으면 인용 지어내지 마라" 가드를 3.5-flash가 무시.

- [x] **근본 수정** (2026-06-20) — [`generator.ts`](../server/agent/nodes/generator.ts) while 루프 진입 전 `dropImageForSearch`(general && 현재턴 이미지없음 && history 이미지있음 && `_explicitSearchForGuard`) 시 `forceTextOnly=true` → parts 루프가 이미지 스킵 → `hasMultimodalContent=false` → 검색 활성화. line 275 `|| dropImageForSearch` 보강. `_explicitSearchForGuard`는 `state.needsSearch === true`(라우터 LLM 판정) 1순위 + 키워드 정규식 보조로 구성 — 라우터가 문맥으로 이미 판정한 값을 제너레이터가 무시하던 구조적 불일치 해소. (실 차단자는 `historyHasImage`가 아니라 history 이미지가 inlineData로 변환되며 켜지는 `hasMultimodalContent`였음 — 진단 정정.)
- [x] **하드 규칙(가짜 출처 절대 금지) + 최상단 이동** (2026-06-20) — [`prompt.ts`](../server/agent/prompt.ts) 언어 지시 직후 `[CRITICAL — ABSOLUTE RULE: NEVER FABRICATE SOURCES]` 신규(Google grounding 클로즈 기반). 기존 `[GROUNDING & CITATIONS]`는 긍정 지시만 남기고 부정 규칙 최상단 이관. (REF_Gemini_Prompt_Guide "critical instruction은 맨 앞" 원칙 적용)
- [ ] **후처리 방어(보조, 선택)** — grounding 메타데이터 부재 시 응답 내 fabricated 인용/참고자료 블록 strip (기존 `[N]` strip 로직 확장, cf. v4.53). 근본 수정으로 대부분 해소돼 우선순위 낮음.
- [x] **재현 테스트** (2026-06-20) — 이미지 첨부 → "팩트체크를 위해 웹에서 해당 연구가 있는지 검토해보자" 로컬 재시도. `dropImageForSearch` 미발동(초기 정규식 미매칭)이었으나 MALFORMED→2.5-flash 폴백→`tool_code` 감지→grounding 재시도 체인으로 `uni-bonn.de`·`thedebrief.org`·`miragenews.com` 실제 소스 칩 정상 표시, 가짜 출처 없음 확인. `needsSearch` 1순위 조건 추가 후 가드 직접 발동 경로로 개선.

### 1. 멀티턴 경고·차단

20개 메시지 시 Toast 경고, 30개 시 전송 차단 + 인라인 배너.

- [ ] `Toast.tsx` — `'warn'` 타입 추가 (앰버 계열)
- [ ] `useChatStream.ts` — 경고(20)·차단(30) 로직 + `onLimitReached` 콜백
- [ ] `App.tsx` — `isLimitReached` state + `onLimitReached` 핸들러
- [ ] `ChatArea.tsx` — 차단 배너 + 새 채팅 버튼
- [ ] `generator.ts` — 멀티턴 길이 기준 도달 시 thought signatures 제거 또는 히스토리 슬라이딩 윈도우 검토 (3.5 Flash thought preservation 비용 방지)

### 2. ChartRenderer 차트 품질 개선

> 테스트 스크립트로 케이스 확인 후 작업

- [ ] `prompt.ts` — `data_viz` intent에 차트 타입 선택 기준 명시 (시계열→bar/line, 비율→pie, 상관→scatter)
- [ ] `prompt.ts` — `chartType` 선택 가이드 주석 보강 + 레이블 10자 이내 지시
- [ ] `ChartRenderer.tsx` — x축 레이블 너무 길 때 `\n` 줄바꿈 추가 검토
- [ ] `ChartRenderer.tsx` — y축 단위 단축 `1M`/`1만` 티어 추가 (현재 `≥1000 → k`만 구현, line 214)
- [ ] `ChartRenderer.tsx` — `pie` 선택인데 항목 수 > 8이면 `bar`로 자동 보정

---

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
- [ ] `prompt.ts` — renderer schema 전역 주입을 intent별 주입으로 분리

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

### 핵심 UX
- [ ] **메시지 재생성** — 같은 프롬프트 재실행
- [ ] **메시지 편집** — 입력창 프리필은 구현됨(`editingMessageContent`/`editValue`, `ChatInput.tsx:100`); 남은 건 편집 시점 이후 히스토리 truncate 후 재실행
- [ ] **세션 문서 컨텍스트 영구 저장** — `lastActiveDoc` Supabase 저장

### 보안 (인증 전환 후)

> 전제: 장기 계획 **L1(서버 토큰 발급)** 완료 후 처리. 현재 `service_role` 키로 RLS 비활성 + 소유권 검증 없음.

- [ ] **IDOR-1** `app/api/auth/route.ts` — PATCH 소유권 검증 (Bearer 토큰 → `authenticatedUserId === id`)
- [ ] **IDOR-2** `app/api/sessions/route.ts` — GET/DELETE/PATCH 전 `user_id === authenticatedUser` 검증
- [ ] `xlsx` 대안 패키지 검토 (Prototype Pollution·ReDoS fix 없음)
- [ ] CSP 도입 — 번들 최적화(자체 호스팅) 완료 후 연계

### 아키텍처 리팩토링
- [ ] **DTO 레이어** — Route Handlers 경계에서 Zod 스키마 기반 요청·응답 DTO 정의
- [ ] `app/api/chat/route.ts` — normalizer / stream-events / persistence 분리
- [ ] `geminiService.ts` — 에러 계약 통일 (Result 패턴)
- [ ] `attachment` + `attachments` 필드 단일화
- [ ] `ChatInput.tsx` — `useSpeechInput` / `useAttachmentProcessor` 훅 분리
- [ ] i18n 중앙화 (`src/i18n/messages.ts`)

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

### 인증 시스템 전환

현재 nickname 기반 localStorage 인증 → 서버 검증 가능한 구조로 단계 전환.

| 단계 | 내용 | 선행 조건 |
|---|---|---|
| **L1** 서버 토큰 발급 | `auth_tokens` 테이블 + `POST /api/auth` 토큰 발급 + Bearer 헤더 검증 미들웨어 | — |
| **L2** IDOR 수정 | IDOR-1/2 소유권 검증 (토큰 기반 user_id 추출) → 백로그 항목 이행 | L1 |
| **L3** Supabase Auth 전환 | nickname → 이메일/OAuth 마이그레이션, `users` 테이블 재설계 | — (독립) |
| **L4** RLS 활성화 | anon 키 전환 + 테이블별 policy 작성, `supabaseAdmin`만 service role 사용 | L3 |

> L1/L2는 현재 구조 최소 변경으로 가능. L3/L4는 대규모 마이그레이션으로 별도 계획 필요.

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
- [x] `drug-info-tool.ts` — `temperature: 0.1` **유지 결정** (2026-06-20). Gemini 3.x 가이드는 <1.0 비권장이나, 약품 정보는 0.1이라야 일관된 답변이 나와 의도적 유지. (line 27·93)
- [ ] `generator.ts` LangChain path — `maxOutputTokens: 8192` → 65k 상향 검토 (line 887·933)

> 의학·YouTube·law 경로 및 Search two-track, PDF 토큰 증가는 3.5로 이미 운영 중 — 별도 검증 항목 제거.
