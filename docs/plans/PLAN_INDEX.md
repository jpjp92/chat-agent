# Plan Index

> 작성일: 2026-06-03 (갱신: 2026-06-20)  
> 상태: Living index — active priorities, historical plans, and backlog references  
> Purpose: separate active work, completed historical plans, and backlog references.

---

## Active Priorities

| Priority | Area | Plan | Status | Next action |
|---:|---|---|---|---|
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
| P1 | Mobile/session UX | [../TODO.md](../TODO.md) | Backlog item | Add minimum recovery for missing current session on mobile resume |
| P3 | 날씨 전용 툴 (KMA+OWM) | [PLAN_WEATHER_TOOL_260706.md](PLAN_WEATHER_TOOL_260706.md) | **구현 완료 (2026-07-06, [DEV_260706](../logs/2026/07/DEV_260706.md))**. `server/lib/weather` 코어 + weatherTool(멀티도시) + WeatherRenderer + router intent/해석가드 + on_tool_end 스트리밍. grounding 15s+ → 결정론 카드 ~1s. tsc 0·라이브 스모크(서울/전주/부산=KMA·Tokyo=OWM) 통과. 예외처리(fetch 타임아웃·빈데이터 폴백·에러카드) 포함 | (선택) Supabase TTL 캐시. 필요 시 weatherContext 멀티턴. [TODO §P3 ⓪](../TODO.md) |
| P2 | Frontend performance | [PLAN_LIGHTHOUSE_FRONTEND_OPTIMIZATION_260602.md](PLAN_LIGHTHOUSE_FRONTEND_OPTIMIZATION_260602.md) | Measured, selected quick wins | Apply quick wins after P0/P1 stability work |
| P2 | Search/thinking latency | [PLAN_THINKING_LATENCY_260602.md](PLAN_THINKING_LATENCY_260602.md) | Major fix applied, residual checks remain | Recheck non-search `thinkingLevel: "low"` before changing |
| P2 | ChatMessage.tsx 분리 | [PLAN_CHATMESSAGE_REFACTOR_260801.md](PLAN_CHATMESSAGE_REFACTOR_260801.md) | **설계만 (착수 전, 2026-08-01)** — 924줄. 동기는 줄 수가 아니라 **테스트 가능성**: 하루에 마크다운 결함 2건이 나왔고 둘 다 회귀 스크립트를 통과했다. 전처리를 import 할 수 없어 스크립트에 복붙해 뒀던 게 원인([DEV_260801 §3-4-1](../logs/2026/08/DEV_260801.md)). 1단계 = `renderContent` 파싱부(433–568, 클로저 의존은 `content`·`isStreaming` 뿐)를 `lib/markdown/parseMessageBlocks.ts` 로 추출 + 테스트를 import 전환 | **인증 프로덕션 컷오버 이후 착수.** 1단계만으로 목적의 8할 |
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
| [PLAN_LATENCY_SEARCH_ROUTING.md](PLAN_LATENCY_SEARCH_ROUTING.md) | Historical + residual reference. Main routing implementation completed. |
| [PLAN_CHANGES_LATENCY_SEARCH_ROUTING.md](PLAN_CHANGES_LATENCY_SEARCH_ROUTING.md) | Change summary for completed latency search routing work. |
| [PLAN_DB_MIGRATION.md](PLAN_DB_MIGRATION.md) | Evergreen migration/reference doc. Use only when Supabase project migration is active. |
| [PLAN_ERROR_HANDLING.md](PLAN_ERROR_HANDLING.md) | Architecture reference and backlog. |
| [PLAN_WORLDCUP_SPORTS_TOOL_260621.md](PLAN_WORLDCUP_SPORTS_TOOL_260621.md) · [PLAN_WORLDCUP_IMPL_260621.md](PLAN_WORLDCUP_IMPL_260621.md) | **구현 완료 (2026-06-21)**. football-data.org `sports` intent tool (월드컵 순위/대진/득점왕), grounding 우회. 로그 [DEV_260621](../logs/2026/06/DEV_260621.md). 추후: WC 외 리그·전용 카드 UI. |
| [PLAN_KORDOC_INTEGRATION_260620.md](PLAN_KORDOC_INTEGRATION_260620.md) | **구현 완료 (2026-06-21)**. HWP 4종(`.hwp/.hwpx/.hwp3/.hwpml`) kordoc 파싱(구조 보존 표) — `app/api/parse-document` 라우트(4MB 임계값: 직행 multipart / Storage 경유) + ChatInput 연동 + search-gate(첨부 문서 grounding off). 보안 IDOR 대응(경로검증·remove 제거). 로그 [DEV_260621 §6·§7](../logs/2026/06/DEV_260621.md). 백로그: 고아파일 TTL·앱 전역 인증/유저별 prefix. |

---

## Cleanup Rules

- Keep detailed experiment logs in dated plan files.
- Keep implementation priorities in this index and `docs/TODO.md`.
- When a dated plan becomes implemented, record the implementation in `docs/logs/DEV_YYMMDD.md` and move remaining work into `docs/TODO.md`.
- Avoid editing completed historical plans unless correcting factual errors or adding a clear completion note.
