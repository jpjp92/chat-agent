# Plan Index

> 작성일: 2026-06-03 (갱신: 2026-09-04)
> 상태: Living index — active priorities, historical plans, and backlog references  
> Purpose: separate active work, completed historical plans, and backlog references.

---

## 지금 순서 (2026-08-02 · 부분 갱신 2026-08-23)

아래 Active Priorities 표는 **영역별 목록**이고, 이건 **시간 순서**다. 둘이 어긋나면 이쪽이 최신이다.

> 📌 **2026-08-23 모델 공급자 축:** OpenAI 일반 Responses, 로컬 도구 8종 function calling,
> generator의 Gemini 키 선행 의존 제거까지 완료했다. 다음 모델 작업은 공급자별 initial router와
> dev UI 카드/합성 종단 검증이다. 상세는
> [PLAN_MULTI_PROVIDER_ROUTING_260823](PLAN_MULTI_PROVIDER_ROUTING_260823.md)을 따른다.

> 📌 **서버 경계(인증·쿼터·SSRF·DTO) 축은 [PLAN_HARDENING_260822](PLAN_HARDENING_260822.md)** —
> 외부 리뷰(GPT 5.6)를 한 항목씩 코드로 대조한 검증본이다. **무인증 라우트가 8개**로 확인됐고
> (8/17 점검은 2개, 외부 리뷰는 또 다른 2개를 놓쳤다), 그 §6 작업 순서는 **컷오버와 충돌하는
> 항목(quota RPC)을 따로 갈라 놨다.** 컷오버 앞에 둘 것은 CI gate·model allowlist 두 개뿐이다.
>
> 📌 **버그·레거시 축의 우선순위는 [PLAN_PRIORITY_260817](PLAN_PRIORITY_260817.md)** — 실패의 나쁜 정도로
> 줄 세운 것이다. 아래 표(인증 컷오버 축)와 별도로 읽되, ~~**Storage IDOR-3 는 컷오버 앞에 두기를 권한다**~~
> → **2026-08-17 이행됨**: Phase 1(인증 + `${uid}/` prefix + Storage RLS) 완료·dev 배포·실측(`da2fe65`·`d7d5c10`).
> Phase 2(비공개 버킷)는 컷오버 뒤로 미뤘다 — `attachment_url` 백필이 선행이라 별개 작업이다.
>
> ⚠️ **이 표는 인증 컷오버 축으로만 쓰여 있다.** 8/15~17 의 검색 판정 재설계·의약 라우팅·룰 폴백
> 정밀도·날씨 후속 작업은 여기 반영돼 있지 않다 — 그 축의 현재 상태는
> [DEV_260815_DEPLOY_CHECK](../logs/2026/08/DEV_260815_DEPLOY_CHECK.md) 상단 표를 볼 것.
> 두 축을 한 표에 합칠지는 미정(합치면 컷오버 순서가 흐려진다).

| # | 할 일 | 배포 필요 | 근거 |
|---:|---|---|---|
| ~~0~~ | ~~프로덕션 사전 점검 SQL~~ | — | **✅ 2026-08-02 완료** — 🔴 두 항목(의존 뷰·`_legacy` 충돌) 모두 clear, `auth.users`=0. 실데이터 **이관 안 함**·**사전 안내 안 함** 확정 ([PROD_ROLLOUT §2-A-1](PLAN_AUTH_PROD_ROLLOUT_260719.md)) |
| **0-B** | 🔴 **main Vercel env 3개 교정 — 그 전까지 재배포 금지** | ❌ | [PROD_ROLLOUT §E-1·§E-2](PLAN_AUTH_PROD_ROLLOUT_260719.md). `.env.local`(stg) 값이 main 에 들어갔다. `NEXT_PUBLIC_*` 2개 프로덕션 값으로 교체 + `SUPABASE_SERVICE_ROLE_KEY` 삭제. **머지와 무관하게 현재 main 코드도 읽는 변수**라 지금 배포하면 파일 업로드가 깨진다. 🔴 **2026-08-17 정정 — `SUPABASE_SERVICE_ROLE_KEY` 는 삭제가 아니라 프로덕션 값으로 교체한다.** 이 행이 삭제를 지시한 본래 이유는 *"스테이징 값이 main 에 들어갔다"* 인데, 실제로는 **키가 계속 필요하다**: Phase 1 로 스토리지 라우트가 admin 을 떠나 남은 소비자는 `app/api/fetch-url/route.ts` 하나이고, 그 `url_cache` 는 **공유 캐시라 RLS 정책을 둘 수 없다**(anon INSERT 를 열면 임의 본문을 심어 모델에 주입하는 **간접 프롬프트 인젝션** 경로가 된다) → `service_role` 만 통과시킨다. `supabaseAdmin ?? supabase` 폴백이라 키를 지우면 **조용히 anon 으로 강등되고 에러도 안 난다.** ⚠️ 부수 발견: **dev DB 에는 `url_cache` 테이블이 아예 없었다**(인증 MVP 가 빈 프로젝트를 새로 세웠는데 `auth-mvp-schema.sql` 에 이 테이블이 없다) → 복원 `docs/guide/db/url-cache.sql`. ([PRIORITY §5-2](PLAN_PRIORITY_260817.md)) |
| 1 | **Google Console — 승인된 도메인에 `chat-gem.vercel.app` 추가 시도** | ❌ | [PROD_ROLLOUT §5-1](PLAN_AUTH_PROD_ROLLOUT_260719.md). 5분·무료로 B안의 성패가 갈린다. 거부되면 자체 도메인이 필요해 A(유료 Custom Domain)와 비용이 비슷해진다 — **로고·페이지 준비보다 먼저** |
| ~~2~~ | ~~`CONTACT_EMAIL` 실제 주소로 교체~~ | — | **✅ 완료** — `app/legal/LegalPage.tsx` 는 실제 주소를 쓴다. 이 행이 "지금 순서" 최상단에 남아 외부 리뷰가 **최우선 미해결**로 오독했다(2026-08-17) |
| 3 | dev 푸시·배포 후 **화면 확인 3종** | ✅ | 수식(§3-1)·극장 매칭(§3-3-1)이 `4a8141a` 로 배포됐으나 **아직 눈으로 안 봤다** + 신규 `/privacy`·`/terms` ([DEV_260801 §5](../logs/2026/08/DEV_260801.md)) |
| 4 | **인증 프로덕션(main) 컷오버** | ✅ | [PROD_ROLLOUT](PLAN_AUTH_PROD_ROLLOUT_260719.md) 순서대로. 별도 세션·유지보수 창 |
| 5 | 프론트 구조 작업 — [ChatMessage 분리](PLAN_CHATMESSAGE_REFACTOR_260801.md) + [URL 라우팅](PLAN_APP_ROUTING_260802.md) | ✅ | 둘 다 `App.tsx`·훅을 건드린다. **컷오버와 섞지 않는다** — 문제 시 원인 분리가 안 된다 |
| 6 | [백로그](PLAN_BACKLOG_260801.md) B1 → A1 → C1 측정 → A2 | — | 재발 방지 · 폴백 크래시 · 커버리지 |
| ~~7~~ | ~~[비한국어 커버리지](PLAN_LANG_COVERAGE_260805.md)~~ | — | **✅ 2026-08-05 완료** — 측정(날씨 es/fr 11/11 · 영화 en 8/8) → 규칙 다국어화 **기각**, 렌더러 i18n 12/12 구현·화면 검증. 부수 발견은 [BACKLOG A3](PLAN_BACKLOG_260801.md)(CGV 실패가 "상영 없음"으로 보임)로 분리 |

> **2026-08-08**: 업로드 첨부(영상·대용량 PDF) 분석 실패 3건 수정 — [DEV_260808](../logs/2026/08/DEV_260808.md). `models.ts`·`generator.ts` 변경이라 **컷오버와 겹치는 파일이 아니다**. dev 배포 후 실제 UI 확인만 남음.

> **2026-08-16 (5)**: ✅ dev 배포 후 실측 — **C2 통과**. 재설계에서 **유일하게 위험 방향으로 움직인 변경**(URL 첨부 + 명시 검색요청 시 grounding ON, tier 300 > 200)이 검증됐다. 네이버 뉴스로 2턴: 1턴 `요약해줘`로 기준선 확보 → 2턴 `검색해서 팩트체크 해줘`에서 **출처 10개가 붙었는데도 수치가 하나도 안 바뀌었다**(우려하던 "다른 기사 요약" 실패 모드 미재현). **기준선을 먼저 잡은 것이 판정을 쉽게 만들었다** — 대조군 없이 팩트체크 응답만 봤다면 맞는지 알 수 없었다. 함께 룰 폴백 K1(날씨 오탐 없음)·K8(병원 정탐 유지) 통과. 🔴 남은 최고 위험은 **H·J 의약 시퀀스** — 지어낸 약품명이 이 앱 최악의 실패이고 로컬에서 실제로 재현됐다. [DEV_260815_DEPLOY_CHECK](../logs/2026/08/DEV_260815_DEPLOY_CHECK.md)

> **2026-08-16 (4)**: ✅ 룰 폴백 정밀도 작업 **완료**(로컬 GREEN, 미배포) — 오탐 **35 → 0**, 회귀 0, 회귀 가드 34건 유지. 하니스 `scripts/test-intent-rules.mts`를 먼저 세운 것이 결정적이었다: 착수 후 **오탐 8건을 추가로 발견**(`이번 달 일정`·`달러 환율`·`태양광 발전`→astronomy, **`Gemini 모델 비교`→astronomy** ← 이 앱의 주력 모델명, `cancer 치료제`→astronomy, `국회의원 정수`→hospital), 게다가 수정 중 만든 새 오탐(`A안과 B안` → 진료과 `안과`)과 이스케이프 결함(`\\s`)까지 그 자리에서 잡혔다. 교훈: **오탐 측정은 프로브 발화의 상상력에 상한이 걸린다 — 토큰 단위 감사를 먼저 할 것.** [PLAN_INTENT_RULES_PRECISION_260816](PLAN_INTENT_RULES_PRECISION_260816.md)

> **2026-08-16 (3)**: 🔴 룰 폴백 정밀도 문제 발견 — `classifyIntentByRules` 오탐 **27건**(정탐 16·미포착 3). 최악은 `분기별 매출을 막대 차트로 그려줘` → **astronomy**(`별\s` 패턴이 `분기별 `를 물고, first-match-wins라 뒤에 있는 data_viz에 닿지도 못함). 라우터 LLM이 429/503으로 죽었을 때만 발동하지만 무료티어에선 상시 조건에 가깝다. `weather`·`movie_search`는 구제 경로라 **LLM 성공 시에도** 오탐이 산다. 계획: [PLAN_INTENT_RULES_PRECISION_260816](PLAN_INTENT_RULES_PRECISION_260816.md)

> **2026-08-16 (2)**: 로컬 검증에서 3건 추가 수정 — ⓐ 제형 어휘 기반 의약 intent 복구(`인공 타액제`가 general로 새며 MFDS 경로 우회) ⓑ drug 툴 폴백이 "훈련 지식으로 상세히 쓰고 **못 찾겠다고 하지 마라**"고 지시해 제품명을 지어내던 것 교체 + 검색 실패를 할당량/오류/결과없음 3분류 ⓒ 재구성 요청(`표로 정리해줘`) 턴에 항목이 추가되던 결함 — 라우터가 `follow_up=refine`을 판정하고도 state로 안 넘겨 generator가 몰랐다 → `state.reformatTurn` 신설. 🔴 부수: `next.config.ts`의 `removeConsole`이 **서버 로그까지 지워** `[SearchPolicy]`가 프로덕션에 존재한 적이 없었다(클라 `console.log`는 0개 — 지키던 게 없었다) → `KEEP_LOGS` 게이트. 검증·쿼리: [DEV_260815_DEPLOY_CHECK](../logs/2026/08/DEV_260815_DEPLOY_CHECK.md)

> **2026-08-16**: Step 4·6 구현 완료(로컬 GREEN, 미배포) — 게이트를 tier 기반 신호 제출로 전환 + `prevSearched`를 실제 grounding 출처로 교체. 배포 검증은 [DEV_260815_DEPLOY_CHECK](../logs/2026/08/DEV_260815_DEPLOY_CHECK.md). 검증 중 파생 발견 2건: ⓐ `인공타액제`류 제형 명칭이 의약 키워드에 없어 `general`로 떨어짐 → `gray`+라우터 LLM 한 표로 검색 여부가 갈린다 ⓑ 검색 OFF 턴에 "실시간 검색 없이…" 고백 문구가 조건을 무시하고 샌다 → [PLAN_SEARCH_SUGGEST_CHIPS_260816](PLAN_SEARCH_SUGGEST_CHIPS_260816.md)(프롬프트 침묵화 + 추천 칩)

> **2026-08-15**: 검색 의도분류 누락 진단 — [DEV_260815](../logs/2026/08/DEV_260815.md) · 재설계 계획 [PLAN_SEARCH_POLICY_260815](PLAN_SEARCH_POLICY_260815.md). 테스트 하니스(`scripts/test-search-policy.mts`)까지 완료, **구현 착수 전**. `router.ts`·`search-gate.ts`·`intentRules.ts` 변경이라 **컷오버와 겹치는 파일이 아니다**. 부수 발견: 기존 검증 스크립트가 이미 RED였다(문서는 초록이라 주장) — 계획 §4 C5.

**1~3 은 4를 막지 않는다.** 1은 브랜딩(기능 아님), 3은 이미 배포된 것의 사후 확인이다.
**0-B 가 막는 것은 `main` 브랜치 배포뿐이다.** 3(dev 푸시)은 chat-agent-dev 프로젝트를 배포하므로 무관하다 — main 프로젝트는 dev 브랜치를 Preview 로만 빌드하고, 프로덕션 배포는 `main` 브랜치에서만 일어난다.

---

## Active Priorities

| Priority | Area | Plan | Status | Next action |
|---:|---|---|---|---|
| P1 | **멀티 공급자 모델 라우팅** | [PLAN_MULTI_PROVIDER_ROUTING_260823.md](PLAN_MULTI_PROVIDER_ROUTING_260823.md) | OpenAI 일반 생성·Gemini 키 분리·로컬 도구 8종 strict function calling 완료. 두 GPT 모델 chat+function 라이브 통과 | 공급자별 initial router → dev UI 카드/합성 종단 → 모델 전환 스냅샷 UX |
| — | Security | [PLAN_SECURITY_VERIFICATION.md](PLAN_SECURITY_VERIFICATION.md) | Bucket whitelist verification guide; SSRF/redirect blocking applied (DEV_260504) | IDOR-1/2는 인증 MVP로 해소(라우트 삭제 + RLS). 남은 IDOR-3(Storage prefix)·xlsx·CSP는 `docs/TODO.md` §보안 |
| P1 | **인증 MVP (실행)** | [PLAN_AUTH_MVP_260709.md](PLAN_AUTH_MVP_260709.md) | **스테이징 검증 완료 (2026-07-14)** — 익명로그인 + Google `linkIdentity` + RLS. Bearer 세션. 라우트가 유저 id 불요(`user_id default auth.uid()` + RLS) → IDOR-1/2 소멸. 구현 로그 [DEV_260714](../logs/2026/07/DEV_260714.md) | **프로덕션 이관만 남음** — SQL 3종 + 대시보드 3종(Anonymous·**Manual Linking**·Google) + Google Cloud 운영 콜백 URI |
| P1 | **인증 dev 이관 런북** | [PLAN_AUTH_DEV_ROLLOUT_260716.md](PLAN_AUTH_DEV_ROLLOUT_260716.md) | **✅ dev 이관 완료 (2026-07-19)** — 스테이징을 dev 상시 DB 로 승격(main DB 미변경). dev 머지·배포 후 스테이징(서울) 정상 바인딩·로그인/대화/업로드 실동작 확인. 검증 중 버그 3개 수정 + 함수 리전 icn1 최적화([DEV_260719](../logs/2026/07/DEV_260719.md)) | **프로덕션 이관은 별도 단계** → [PLAN_AUTH_PROD_ROLLOUT_260719](PLAN_AUTH_PROD_ROLLOUT_260719.md) |
| P1 | **인증 프로덕션(main) 이관 검토·런북** | [PLAN_AUTH_PROD_ROLLOUT_260719.md](PLAN_AUTH_PROD_ROLLOUT_260719.md) | **검토·대기 (실행 전)** — main 은 라이브 프로덕션 DB(`gaomgqnpsjtabrvwnpad`) 공유라 dev 와 달리 **원자적 컷오버 필수**. 선행 외부설정(대시보드 토글·Google 콜백·env·**함수 리전 icn1 대시보드 설정**·버킷) → SQL(`_legacy` rename) → main 배포 최소간격. 롤백(rename 되돌리기)·검증 8+2종·미결(IDOR-3·동의화면 도메인) 정리 | 별도 세션에서 유지보수 창에 실행. 실데이터 이관 여부 결정 |
| P1 | **로그인 경로 정비** | [PLAN_AUTH_SIGNIN_PATHS_260715.md](PLAN_AUTH_SIGNIN_PATHS_260715.md) | **구현 완료 (2026-07-15, tsc 0) — 수동 OAuth 검증 대기** — 계정 선택창(`prompt=select_account`) · 대화 0개 게스트(=캐시 지운 사용자) 로그인 직행 · 설정 "다른 계정으로 로그인". 🔴 철칙 정정: "활성 세션이면 signInWithOAuth 금지" → **"승계할 게스트 데이터가 있을 때 금지"** | 브라우저 3건(§5 a/b/c) 확인 후 완료. 카카오는 의도적 제외(§7) |
| P1 | 인증 MVP 테스트 전략 | [PLAN_AUTH_MVP_TEST_260709.md](PLAN_AUTH_MVP_TEST_260709.md) | **검증 완료 (2026-07-14)** — 자동 40건(RLS 18 · identity 10 · limit 6 · routes 6) + 수동 OAuth 5건 통과. 🔴 **교훈: 자동 40건이 초록불인 채로 실제 리다이렉트에서만 버그 3개가 나왔다**(identity 동기화·리다이렉트 에러 무시·캐시 유출) — §5 수동 검증을 남긴 이유 | 프로덕션 이관 후 동일 스위트 재실행(스테이징 가드 `STG≠PROD` 유지) |
| — | 인증 전체 설계 (참조) | [PLAN_AUTH_SUPABASE_260708.md](PLAN_AUTH_SUPABASE_260708.md) | 참조 설계 — Kakao/이메일/Naver, Storage 유저 prefix(IDOR-3), 쿠키 세션 대안 등 MVP 범위 밖 항목 보관 | MVP 완료 → 다음은 Storage prefix(IDOR-3) → Kakao → 이메일 |
| P1 | Image generation (test/policy) | [PLAN_OPENAI_IMAGE2_INFOGRAPHIC_TEST_260602.md](PLAN_OPENAI_IMAGE2_INFOGRAPHIC_TEST_260602.md) | 1st test complete, policy/routing design done | Add Korean case-set, report aggregation, intent/layout guardrail tests |
| P1 | Image generation (integration) | [PLAN_IMAGE_GEN_SERVICE_INTEGRATION_260603.md](PLAN_IMAGE_GEN_SERVICE_INTEGRATION_260603.md) | Integration design approved | Start P0: extract `server/image/` core modules from test script |
| P1 | i18n cleanup | [PLAN_I18N_CLEANUP_260602.md](PLAN_I18N_CLEANUP_260602.md) | Steps 1·2 done (2026-06-04) | Decide step 3 shared-module boundary before extracting `src/i18n/` |
| P2 | 비한국어 경로 커버리지 (es/fr) | [PLAN_LANG_COVERAGE_260805.md](PLAN_LANG_COVERAGE_260805.md) | **✅ 완료 (2026-08-05)** — 날씨 **es/fr 11/11**, 영화 **en 8/8**(ko 회귀 유지). 회색지대까지 통과해 **영화 규칙 다국어화는 기각**(규칙은 LLM 판정보다 우선순위가 높아 잘못 늘리면 지금 맞는 걸 틀리게 만든다). 🔴 측정 전 **하니스 결함 2건**을 코드 읽기로 먼저 잡았다(`WM_LANG=es` 가 "영어로 묻고 스페인어로 답하기"를 재고 있었다). 렌더러 12종 전수 조사 → **i18n 구현 완료**: 정상 6 · 🔴 죽은 i18n 1(Diagram — 번역은 있는데 prop 미전달) · 미구현 5(도구 카드). API 계약값(`'휴무'`·`'상급종합'`)은 **제어 흐름 키라 한글 그대로 상수화**, 고유명사·주소는 유지 | **없음** — es 화면 검증까지 통과. 부수 발견 2건(동물병원 `'정상'` 미매칭 · CGV 0건)은 별건으로 분리 |
| P1 | Mobile/session UX | [../TODO.md](../TODO.md) | Backlog item | Add minimum recovery for missing current session on mobile resume |
| P3 | 날씨 전용 툴 (KMA+OWM) | [PLAN_WEATHER_TOOL_260706.md](PLAN_WEATHER_TOOL_260706.md) | **구현 완료 (2026-07-06, [DEV_260706](../logs/2026/07/DEV_260706.md))**. `server/lib/weather` 코어 + weatherTool(멀티도시) + WeatherRenderer + router intent/해석가드 + on_tool_end 스트리밍. grounding 15s+ → 결정론 카드 ~1s. tsc 0·라이브 스모크(서울/전주/부산=KMA·Tokyo=OWM) 통과. 예외처리(fetch 타임아웃·빈데이터 폴백·에러카드) 포함 | (선택) Supabase TTL 캐시. 필요 시 weatherContext 멀티턴. [TODO §P3 ⓪](../TODO.md) |
| P2 | Frontend performance | [PLAN_LIGHTHOUSE_FRONTEND_OPTIMIZATION_260602.md](PLAN_LIGHTHOUSE_FRONTEND_OPTIMIZATION_260602.md) | Measured, selected quick wins | Apply quick wins after P0/P1 stability work |
| P2 | Search/thinking latency | [PLAN_THINKING_LATENCY_260602.md](PLAN_THINKING_LATENCY_260602.md) | Major fix applied, residual checks remain | Recheck non-search `thinkingLevel: "low"` before changing |
| P2 | 앱 URL 라우팅 (세션별 주소) | [PLAN_APP_ROUTING_260802.md](PLAN_APP_ROUTING_260802.md) | **설계만 (착수 전, 2026-08-02)** — 앱 본체가 `/` 하나라 새로고침·북마크·뒤로가기가 대화를 따라가지 않는다. `app/c/[sessionId]` 얇은 래퍼 + `lib/chatRoute.ts`(경로↔상태 단일 소스) + **`history.pushState`**(🔴 `router.push` 는 트리를 리마운트해 **SSE 스트림이 끊긴다**). 동기화 지점은 `selectSession`/`createNewSession`(push)·`removeSession`(replace)·`popstate`. 함정: auth 초기화 중 `userId` 가 잠시 null 이라 URL 을 `currentSessionId` 로 미러링하면 **딥링크가 지워진다**. 레퍼런스 `reference/cowork26` | **인증 컷오버 이후.** ChatMessage 분리와 한 묶음으로 검증 |
| P2 | ChatMessage.tsx 분리 | [PLAN_CHATMESSAGE_REFACTOR_260801.md](PLAN_CHATMESSAGE_REFACTOR_260801.md) | **설계만 (착수 전, 2026-08-01 v2)** — 924줄. 분리 기준은 "용도"가 아니라 **무엇이 언제 바뀌는가**: ⓐ 반복 작업(렌더러 추가)이 한 파일에서 **8곳**을 건드린다 — 렌더러 목록이 4번 따로 선언(드리프트는 현재 0건이나 하나만 빠져도 조용히 깨짐), `smiles`→`chemical`·`treemap`→`chart` 매핑이 else-if 코드 속에만 존재 ⓑ 마크다운 결함 2건이 회귀 스크립트를 통과 — 전처리를 import 할 수 없어 복붙해 둔 탓([DEV_260801 §3-4-1](../logs/2026/08/DEV_260801.md)). 순서 = **① `lib/renderers.ts` 레지스트리(데이터화) → ② 파싱부(433–568, 클로저 의존 `content`·`isStreaming` 뿐) 추출 + 테스트 import 전환 → ③ 뷰 → ④ 훅**. v1의 "파싱 먼저"를 뒤집음(else-if 13분기가 레지스트리로 사라질 코드라 두 번 만지게 됨) | **인증 프로덕션 컷오버 이후 착수.** ①+②로 목적의 8할. 검증 여력 없으면 ②→① 순서 허용(②는 순수 이동) |
| P2 | generator.ts 리팩토링 | [PLAN_GENERATOR_REFACTOR_260621.md](PLAN_GENERATOR_REFACTOR_260621.md) | 1·2·4-A·3-A 완료(`04d291c`·`cce3baf`·`0fec111`+3-A 커밋대기, **1148→685줄 -40%**, 동등성 19,423 0 fail + 3-A dev E2E 4종) | 다음=3-B(SDK 경로 분리 → `sdk-path.ts`, dev E2E 필수). (선택)4-B 에러술어 수렴. 필수 아님 |
| — | 웰컴 화면 UI 정비 | [PLAN_WELCOME_UI_REVAMP_260628.md](PLAN_WELCOME_UI_REVAMP_260628.md) | **구현 완료 (2026-06-28, [DEV_260628](../logs/2026/06/DEV_260628.md))**. 모델 선택기 반응형 하이브리드·추천 칩(`SuggestChips`)·웰컴 한 줄·반응형 입력창 배치·폭 4xl 통일. tsc 0. **후속 [DEV_260703](../logs/2026/07/DEV_260703.md)**: 컴포저 반응형 하이브리드(모바일=1행 복원/데스크톱=2단, flex-wrap+`sm:basis-full`)로 textarea 폭 낭비 해소·모바일 사이드바 제목 편집 밑줄 보정 | (선택) 웰컴 ChatInput 단일 마운트화, es/fr 칩 문구 검수. 빌드 CI 확인 |

---

## Image Generation Plan Split

The current Image2 document is intentionally broad: it contains raw test results, service policy, routing design, Korean QA, and implementation notes. Before implementation, split the work mentally into these tracks:

| Track | Source section | Deliverable |
|---|---|---|
| Test evidence | 1st generation results, subtype/style smoke tests, cost observation | Report aggregation script and quality/cost summary table |
| Korean QA | Korean normal/dense/style tests, Korean test matrix | `--case-set korean` and manual QA checklist |
| Routing design | Language routing, intent-based generation control, layout taxonomy | Typed schema and deterministic prompt builder rules |
| Service limits | Usage limits, queue policy, metering fields | Job table/queue design and credit policy |
| UI integration | Implementation considerations | Image job status UI and result renderer |

Recommended next order:

1. Add report aggregation for existing `report-*.json`.
2. Add `--case-set korean` without changing production code.
3. Run only low-cost Korean/layout tests needed to close decision gaps.
4. Convert the tested schema into production router/prompt-builder code.
5. Add queue/limit/metering before exposing image generation broadly.

---

## Completed Or Historical Plans

| Plan | Current use |
|---|---|
| [PLAN_NEXTJS_MIGRATION.md](PLAN_NEXTJS_MIGRATION.md) | Historical reference. Next.js migration completed. |
| [PLAN_LATENCY_SEARCH_ROUTING.md](PLAN_LATENCY_SEARCH_ROUTING.md) | Historical. 구현 완료했으나 **§4-2·§6-2·§6-3·§7·§9-B 폐기** (2026-08-15) → [PLAN_SEARCH_POLICY_260815](PLAN_SEARCH_POLICY_260815.md). 핵심 통찰(§1 직교성)·§5 라우터 합승은 유효. |
| [PLAN_CHANGES_LATENCY_SEARCH_ROUTING.md](PLAN_CHANGES_LATENCY_SEARCH_ROUTING.md) | Change summary. ⚠️ 검증표 수치 **스테일** — `verify-intentrules-search.mts`는 22/22가 아니라 현재 20/22 RED. |
| [PLAN_DB_MIGRATION.md](PLAN_DB_MIGRATION.md) | Evergreen migration/reference doc. Use only when Supabase project migration is active. |
| [PLAN_ERROR_HANDLING.md](PLAN_ERROR_HANDLING.md) | Architecture reference and backlog. |
| [PLAN_WORLDCUP_SPORTS_TOOL_260621.md](PLAN_WORLDCUP_SPORTS_TOOL_260621.md) · [PLAN_WORLDCUP_IMPL_260621.md](PLAN_WORLDCUP_IMPL_260621.md) | **구현 완료 (2026-06-21)**. football-data.org `sports` intent tool (월드컵 순위/대진/득점왕), grounding 우회. 로그 [DEV_260621](../logs/2026/06/DEV_260621.md). 추후: WC 외 리그·전용 카드 UI. |
| [PLAN_KORDOC_INTEGRATION_260620.md](PLAN_KORDOC_INTEGRATION_260620.md) | **구현 완료 (2026-06-21)**. HWP 4종(`.hwp/.hwpx/.hwp3/.hwpml`) kordoc 파싱(구조 보존 표) — `app/api/parse-document` 라우트(4MB 임계값: 직행 multipart / Storage 경유) + ChatInput 연동 + search-gate(첨부 문서 grounding off). 보안 IDOR 대응(경로검증·remove 제거). 로그 [DEV_260621 §6·§7](../logs/2026/06/DEV_260621.md). 백로그: 고아파일 TTL·앱 전역 인증/유저별 prefix. |
| [PLAN_MODEL_API_REVIEW_260817.md](PLAN_MODEL_API_REVIEW_260817.md) | **측정 결과의 출처 문서.** `MODEL_CAPS` 실측 프로브 + Gemini 공식 가이드 6종 대조(2026-08-17). 후속 항목은 [TODO §보안 "모델·API 레퍼런스 검토 후속"](../TODO.md)에 열려 있다(Files API 전환 검토·프로브 A·공급자별 initial router). |
| [PLAN_MODEL_3_7_MIGRATION_260817.md](PLAN_MODEL_3_7_MIGRATION_260817.md) | 기본 모델 3.6 → 3.7 전환 설계. §5-1·§5-2 진행 가능, 기본 전환(§5-3)은 **긴 히스토리 측정 1건 대기**. 🔴 검색 폴백은 2.5 유지(별개 축). 근거는 위 API_REVIEW. |
| [PLAN_STREAMING_PARTIAL_260623.md](PLAN_STREAMING_PARTIAL_260623.md) | **설계 기획 — 구현 대기 (2026-06-23).** SDK 경로 부분 스트리밍(general 산문 한정). 선행 분석 [PLAN_THINKING_LATENCY_260602](PLAN_THINKING_LATENCY_260602.md). |
| [PLAN_THEATER_BRANCHES_DATA_260627.md](PLAN_THEATER_BRANCHES_DATA_260627.md) | `data/theater-branches.json`(3사 532지점) 데이터 관리 정비. 영화 도구는 구현 완료이고 이건 **데이터 갱신 절차** 쪽. 관련 [REF_Movie](../guide/REF_Movie.md)·`lib/theaters.ts`. |
| [PLAN_CONSTELLATION_POSTER_REDESIGN_260707.md](PLAN_CONSTELLATION_POSTER_REDESIGN_260707.md) | 별자리 렌더러 웜 골드 포스터 리스킨 설계. **프로토타입 검증 완료 · 컴포넌트 반영 전.** 별도 사본이 [superpowers/plans/2026-07-08-constellation-poster-redesign.md](../superpowers/plans/2026-07-08-constellation-poster-redesign.md) 에도 있다. |

---

## Cleanup Rules

- Keep detailed experiment logs in dated plan files.
- Keep implementation priorities in this index and `docs/TODO.md`.
- When a dated plan becomes implemented, record the implementation in `docs/logs/DEV_YYMMDD.md` and move remaining work into `docs/TODO.md`.
- Avoid editing completed historical plans unless correcting factual errors or adding a clear completion note.
