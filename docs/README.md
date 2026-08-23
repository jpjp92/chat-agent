# Chat Agent 문서

> 최종 갱신: 2026-08-23

이 페이지는 현재 상태와 최근 작업을 찾는 문서 진입점이다. 장기 이력은 [DEV_HISTORY](DEV_HISTORY.md), 아직 남은 일은 [TODO](TODO.md), 실행 순서는 [PLAN_INDEX](plans/PLAN_INDEX.md)를 기준으로 한다.

## 현재 상태

| 영역 | 현재 정책 | 상세 |
|---|---|---|
| 채팅 모델 | Gemini 3.6 Flash 기본. Gemini 3.7/3.5/2.5 및 GPT-5.4 mini/GPT-5.6 Luna 선택 가능 | [Architecture — Model Policy](guide/REF_Architecture.md#model-policy) |
| GPT 라우팅 | 일반 텍스트·URL·이미지·검색과 로컬 도구 8종은 선택 GPT 유지. 영상·오디오/fileData와 알약 Vision만 Gemini 2.5 capability fallback | [멀티 공급자 라우팅 계획](plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md) |
| 알려진 라우팅 공백 | initial router는 아직 Gemini 2.5 Flash Lite 우선이며, 실패 시 규칙 분류로 복구한다. GPT 일반/도구 실행 자체는 Gemini 키와 분리됨 | [계획 P0](plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md#3-현재-충돌-지점) |
| URL Fetch | Wikidocs는 ScrapingBee render/premium/KR 우선, 일반 URL은 direct 우선. browserless는 후순위, OpenAI URL fallback은 기본 OFF | [2026-08-23 실측](logs/2026/08/DEV_260823.md) |
| 오류 노출 | 공급자 status/code/message는 서버 로그에만 기록하고 UI에는 지역화된 정제 문구만 표시 | [오류 분류 계약](plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md#4-오류-분류-계약) |
| 자동 검증 | `npm test` 회귀 하니스 10종, 외부 공급자 프로브는 `tests/manual/`로 분리 | [tests/README](../tests/README.md) |

## 최근 문서

- **2026-08-23** — [URL 공급자 재검증과 모델/UI/오류 정책](logs/2026/08/DEV_260823.md), [멀티 공급자 라우팅 계획](plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md)
- **2026-08-22** — [서버 경계 하드닝 검토](plans/PLAN_HARDENING_260822.md)
- **2026-08-18** — 테스트 폴더 재편과 알약/DDG 수정은 [DEV_HISTORY](DEV_HISTORY.md#최근-작업-로그)에 통합 기록
- **2026-08-17** — [Gemini 3.7 검토](plans/PLAN_MODEL_3_7_MIGRATION_260817.md), [모델 API 검토](plans/PLAN_MODEL_API_REVIEW_260817.md), [작업 우선순위](plans/PLAN_PRIORITY_260817.md)
- **2026-08-15** — [검색 정책 작업 로그](logs/2026/08/DEV_260815.md), [배포 검증](logs/2026/08/DEV_260815_DEPLOY_CHECK.md)

8월 날짜별 기록과 계획서의 대응 관계는 [2026년 8월 로그 인덱스](logs/2026/08/README.md)에서 한 번에 볼 수 있다.

## 문서 구조

| 경로 | 역할 |
|---|---|
| `docs/logs/YYYY/MM/` | 실제 구현·검증의 날짜별 작업 로그 |
| `docs/plans/` | 계획, 분석, 미완료 항목과 완료 기준 |
| [`docs/guide/`](guide/README.md) | 현재 동작을 설명하는 기능·아키텍처 레퍼런스 |
| `docs/guide/db/` | 추적되는 DB 스키마와 실행 순서의 유일한 출처 |
| `docs/DEV_HISTORY.md` | 날짜별 핵심 변경을 모은 장기 이력 |
| `docs/TODO.md` | 구현되지 않은 작업 목록 |

## 기록 규칙

- 의미 있는 코드 변경과 검증을 마친 날에는 `docs/logs/YYYY/MM/DEV_YYMMDD.md`를 만든다.
- 계획만 작성하거나 분석만 한 날은 `docs/plans/`에 남길 수 있지만, 월별 로그 인덱스에는 그 날짜와 계획서를 함께 표시한다.
- 새 날짜 로그는 `DEV_HISTORY.md`와 해당 월 `README.md`에 링크한다.
- 현재 동작이 바뀌면 루트 `README.md`와 관련 `docs/guide/REF_*.md`도 함께 갱신한다.
