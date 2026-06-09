# TODO

> 완료된 항목은 [DEV_HISTORY.md](DEV_HISTORY.md)에 기록됩니다.

---

## 🟡 P1 — 기능 개선

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

현재 Lighthouse: Performance 91 / Accessibility 63 / Best Practices 100 / SEO 91 (2026-04-04)

### DB 쿼리 최적화 및 캐싱

> 쿼리 효율화(select 컬럼 축소·`hasMore` 패턴·`updated_at` trigger), 인덱스 3종 확인, 싱글톤 연결 확인 완료 (DEV_HISTORY 참조). 남은 항목:

- [ ] 요청량 증가 대비 Supabase connection pool 설정 점검 (현재 direct client, pgBouncer 전환 검토)

### LCP 개선 (~3,300ms — `isAuthLoading` 블로킹)

> `isAuthLoading` 전체 차단 제거 + 백그라운드 인증, 세션/메시지 스켈레톤 UI 완료 (DEV_HISTORY 참조). 남은 항목:

- [ ] `handleNewSession` Optimistic UI (tempId 패턴)

### 번들 최적화

- [ ] FontAwesome — npm 패키지(`@fortawesome/fontawesome-svg-core`) 설치는 됐으나 CDN 병행 사용 중 → CDN 제거 후 npm 단일화 (18KB + 100ms 절감)
- [ ] KaTeX / Google Fonts 자체 호스팅 (CDN 의존성 제거 + CSP 전제조건)
- [ ] `fonts.gstatic.com` preconnect `crossorigin="anonymous"` 추가

> CSP 도입은 KaTeX·FontAwesome 자체 호스팅 + inline style 의존성 제거 완료 후 가능

---

## 🔵 P3 — 기능 확장

### 외부 API 신규 연동

공통 구현 패턴: `tools.ts` → `router.ts` → `generator.ts` → `prompt.ts` → `ChatMessage.tsx` → `Renderer.tsx`

**① arXiv + PubMed 논문 검색** (★★★)
- [ ] `server/agent/tools/paper-tool.ts` — arXiv Atom XML + PubMed esearch→esummary→efetch 파이프라인
- [ ] `components/PaperRenderer.tsx`
- [ ] `state.ts`, `router.ts`, `generator.ts`, `prompt.ts`, `ChatMessage.tsx` 공통 패턴 적용

**② 서울 문화행사** (★★) — 키: `CULTURE_API_KEY`
- [ ] `server/agent/tools/culture-tool.ts` — 구 필터 + 오늘 이후 정렬 + 썸네일
- [ ] `components/CultureRenderer.tsx`
- [ ] `state.ts`, `router.ts`, `generator.ts`, `prompt.ts`, `ChatMessage.tsx` 공통 패턴 적용

**③ NEIS 학교기본정보** (★★) — 키: `EDU_KEY`
- [ ] `server/agent/tools/school-tool.ts` — `SCHUL_NM`/`LCTN_SC_NM`/`SCHUL_KND_SC_NM` 파라미터
- [ ] `components/SchoolRenderer.tsx`
- [ ] `state.ts`, `router.ts`, `generator.ts`, `prompt.ts`, `ChatMessage.tsx` 공통 패턴 적용

**④ 영화 상영정보 / 박스오피스** (★★★) — 키: `KOBIS_KEY` (포스터는 CGV/메가박스/롯데 CDN)

박스오피스·예매율·관객수는 KOBIS(영화관입장권통합전산망) Open API, 포스터·예매 링크는 멀티플렉스(CGV/메가박스/롯데시네마) 수집. **carousel(가로 스크롤 슬라이드) 렌더러가 신규** — 기존 단일 카드 렌더러와 다른 첫 carousel UI.

- [ ] `server/agent/tools/movie-tool.ts` — KOBIS `boxOfficeResult`(일일/주간 예매율·관객수) + 멀티플렉스 포스터/예매 URL 매핑
- [ ] `components/MovieRenderer.tsx` — 가로 스크롤 carousel, 포스터 + 제목 + 메타(연령/장르/예매율/관객수) + `예매하기` CTA
- [ ] `state.ts`, `router.ts`, `generator.ts`, `prompt.ts`, `ChatMessage.tsx` — `movie_search` intent + `json:movie` 블록 공통 패턴 적용
- [ ] **포스터 hotlinking 대응** — CGV/메가박스 CDN은 Referer 차단(깨진 이미지) 가능 → 기존 [`app/api/proxy-image/route.ts`](../app/api/proxy-image/route.ts) 경유로 렌더, 수집 단계에서 URL 유효성 사전 검증
- [ ] **`json:movie` 스키마 표준화** — 슬라이드 배열 `[{ image_url, title, sub_text, postback, buttons[] }]` 표준 JSON 준수(Kakao식 `type:N`/`0:{}` 표기 금지), 파서 견고성 확보
- [ ] **메타 텍스트 예외 처리** — `sub_text` 줄바꿈(`\n`) 기반 메타에서 관객수/예매율 누락 시(예: 개봉 전·이벤트관) 빈 줄 제거 + 필드 조건부 렌더

> 주의사항: arXiv timeout → `AbortSignal.timeout(6000)` 필수 / PubMed `NCBI_KEY` 없으면 10 req/s / NEIS `schoolInfo[0].head[1].RESULT.CODE` 에러 체크 필수 / KOBIS `boxOfficeResult` 키 부재·일자 미마감 응답 가드 + 포스터 URL은 반드시 `proxy-image` 경유

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
- [ ] `drug-info-tool.ts` — `temperature: 0.1` 제거 검토 (line 27·93, `searchDrugViaGoogleSearch`/`extractImprintViaVision`)
- [ ] `generator.ts` LangChain path — `maxOutputTokens: 8192` → 65k 상향 검토 (line 880·926)

> 의학·YouTube·law 경로 및 Search two-track, PDF 토큰 증가는 3.5로 이미 운영 중 — 별도 검증 항목 제거.
