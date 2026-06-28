# Plan Index

> 작성일: 2026-06-03 (갱신: 2026-06-20)  
> 상태: Living index — active priorities, historical plans, and backlog references  
> Purpose: separate active work, completed historical plans, and backlog references.

---

## Active Priorities

| Priority | Area | Plan | Status | Next action |
|---:|---|---|---|---|
| — | Security | [PLAN_SECURITY_VERIFICATION.md](PLAN_SECURITY_VERIFICATION.md) | Bucket whitelist verification guide; SSRF/redirect blocking applied (DEV_260504) | Remaining items (IDOR-1/2, xlsx, CSP) live in `docs/TODO.md` 백로그 §보안, gated behind L1 server tokens |
| P1 | Image generation (test/policy) | [PLAN_OPENAI_IMAGE2_INFOGRAPHIC_TEST_260602.md](PLAN_OPENAI_IMAGE2_INFOGRAPHIC_TEST_260602.md) | 1st test complete, policy/routing design done | Add Korean case-set, report aggregation, intent/layout guardrail tests |
| P1 | Image generation (integration) | [PLAN_IMAGE_GEN_SERVICE_INTEGRATION_260603.md](PLAN_IMAGE_GEN_SERVICE_INTEGRATION_260603.md) | Integration design approved | Start P0: extract `server/image/` core modules from test script |
| P1 | i18n cleanup | [PLAN_I18N_CLEANUP_260602.md](PLAN_I18N_CLEANUP_260602.md) | Steps 1·2 done (2026-06-04) | Decide step 3 shared-module boundary before extracting `src/i18n/` |
| P1 | Mobile/session UX | [../TODO.md](../TODO.md) | Backlog item | Add minimum recovery for missing current session on mobile resume |
| P2 | Frontend performance | [PLAN_LIGHTHOUSE_FRONTEND_OPTIMIZATION_260602.md](PLAN_LIGHTHOUSE_FRONTEND_OPTIMIZATION_260602.md) | Measured, selected quick wins | Apply quick wins after P0/P1 stability work |
| P2 | Search/thinking latency | [PLAN_THINKING_LATENCY_260602.md](PLAN_THINKING_LATENCY_260602.md) | Major fix applied, residual checks remain | Recheck non-search `thinkingLevel: "low"` before changing |
| P2 | generator.ts 리팩토링 | [PLAN_GENERATOR_REFACTOR_260621.md](PLAN_GENERATOR_REFACTOR_260621.md) | 1·2·4-A·3-A 완료(`04d291c`·`cce3baf`·`0fec111`+3-A 커밋대기, **1148→685줄 -40%**, 동등성 19,423 0 fail + 3-A dev E2E 4종) | 다음=3-B(SDK 경로 분리 → `sdk-path.ts`, dev E2E 필수). (선택)4-B 에러술어 수렴. 필수 아님 |
| — | 웰컴 화면 UI 정비 | [PLAN_WELCOME_UI_REVAMP_260628.md](PLAN_WELCOME_UI_REVAMP_260628.md) | **구현 완료 (2026-06-28, [DEV_260628](../logs/2026/06/DEV_260628.md))**. 모델 선택기 반응형 하이브리드·추천 칩(`SuggestChips`)·웰컴 한 줄·반응형 입력창 배치·폭 4xl 통일. tsc 0 | (선택) 웰컴 ChatInput 단일 마운트화, es/fr 칩 문구 검수. 빌드 CI 확인 |

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
