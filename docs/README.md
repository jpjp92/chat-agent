# Chat Agent 문서

> 최종 갱신: 2026-09-13

이 페이지는 현재 상태와 최근 작업을 찾는 문서 진입점이다. 장기 이력은 [DEV_HISTORY](DEV_HISTORY.md), 아직 남은 일은 [TODO](TODO.md), 실행 순서는 [PLAN_INDEX](plans/PLAN_INDEX.md)를 기준으로 한다.

## 현재 상태

| 영역 | 현재 정책 | 상세 |
|---|---|---|
| 채팅 모델 | Gemini 3.6 Flash 기본. Gemini 3.7/3.5/2.5 및 GPT-5.4 mini/GPT-5.6 Luna 선택 가능. **3.8 은 계획만 있고 코드에 없다** — 선택 옵션 공개는 하드닝 1·2 뒤 | [Architecture — Model Policy](guide/REF_Architecture.md#model-policy), [Gemini 3.8 계획](plans/PLAN_MODEL_3_8_MIGRATION_260906.md) |
| GPT 라우팅 | 일반 텍스트·URL·이미지·검색과 로컬 도구 8종은 선택 GPT 유지. 영상·오디오/fileData와 알약 Vision만 Gemini 2.5 capability fallback | [멀티 공급자 라우팅 계획](plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md) |
| 알려진 라우팅 공백 | initial router는 아직 Gemini 2.5 Flash Lite 우선이며, 실패 시 규칙 분류로 복구한다. GPT 일반/도구 실행 자체는 Gemini 키와 분리됨 | [계획 P0](plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md#3-현재-충돌-지점) |
| URL Fetch | Wikidocs는 ScrapingBee render/premium/KR 우선, 일반 URL은 direct 우선. browserless는 후순위, OpenAI URL fallback은 기본 OFF | [2026-08-23 실측](logs/2026/08/DEV_260823.md) |
| 오류 노출 | 공급자 status/code/message는 서버 로그에만 기록하고 UI에는 지역화된 정제 문구만 표시 | [오류 분류 계약](plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md#4-오류-분류-계약) |
| 검색 grounding | tier 로 판정(400 물리제약 > 300 사용자 명시 > 200 근거제공 > 100 분류기). **400 은 Gemini 전용** — OpenAI 는 이미지와 web_search 를 함께 보낼 수 있어 신호를 내지 않는다 | [2026-09-02 로그](logs/2026/09/DEV_260902.md), [검색 정책 계획](plans/PLAN_SEARCH_POLICY_260815.md) |
| 자동 검증 | `npm test` 회귀 하니스 18종, 외부 공급자 프로브는 `tests/manual/`로 분리 | [tests/README](../tests/README.md) |
| 서버 경계 | 🔴 **무인증 라우트 6개** 미결(`fetch-url`·`proxy-image`·`showtimes`·`speech`·`summarize-title`·`sync-drug-image`). 그중 `speech`·`summarize-title` 은 **인증 없이 Gemini 키 풀을 쓰는 LLM 엔드포인트**라 최우선 | [TODO §보안](TODO.md), [PLAN_HARDENING_260822](plans/PLAN_HARDENING_260822.md), [보안 검토 §3.4](logs/2026/09/DEV_260903.md) |

## 최근 문서

- **2026-09-13** — [의존성 보안 업데이트](logs/2026/09/DEV_260913_DEPS.md) — `next` 16.3.5 · `kordoc` 4.13.1. **Critical 0 달성**(24→20건). 남은 High 12건은 전부 안 쓰는 OCR 선택적 의존. **dev 미배포**
- **2026-09-13** — [문서 정리](logs/2026/09/DEV_260913.md) — 🔴 활성 하드닝 계획의 **P0-2 가 이미 해소된 취약점**이었다(model allowlist). 깨진 링크 13건 정리 · TODO §보안을 백로그 → **P0** 로 승격 · 앵커/행번호 검사기 `tests/test-doc-links.mts` 신설
- **2026-09-06** — [Gemini 3.8 도입 계획](plans/PLAN_MODEL_3_8_MIGRATION_260906.md) — 검증 설계·비용 상한·선택 옵션과 기본 승격 분리. **모델 호출·코드 변경 없음**
- **2026-09-05** — [하드닝 작업 순서 재정렬](plans/PLAN_HARDENING_260822.md#6-작업-순서) — 1순위를 `speech`·`summarize-title` 토큰 검증으로. **전부 미구현**
- **2026-09-04** — [문서 전수 감사](logs/2026/09/DEV_260904.md) — md 161개 링크 전수 검사(깨진 링크 0), 보안 검토 2차 정정, 인덱스 누락 보정
- **2026-09-03** — [보안 검토](logs/2026/09/DEV_260903.md) — `dev` 218파일. 신규 취약점 0건·인증 축 순개선. ⚖️ **09-04 에 두 차례 자체 정정**(SSRF 우회표·우선순위)
- **2026-09-03** — [검색 라우팅 레퍼런스 + 테스트 질의](guide/REF_SearchRouting.md)
- **2026-09-02** — ["검색해"라고 했는데 검색이 안 되던 두 경로](logs/2026/09/DEV_260902.md)
- **2026-08-30~09-02** — [외부 의학·검색 소스와 논문 카드 정착](logs/2026/08/DEV_260830.md), [9월 로그 인덱스](logs/2026/09/README.md)
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
- **2026/04~07 은 월 `README.md` 를 만들지 않고 [DEV_HISTORY](DEV_HISTORY.md)로 갈음한다.**
  이 규칙은 08 부터 생겼고 소급하지 않았다 — 그 넉 달의 로그 77개는 `DEV_HISTORY` 가 이미 날짜별로 서술하고 있어
  월 인덱스는 중복에 가깝다. 08·09 인덱스의 가치는 목록이 아니라 *"이 날 무엇이 왜 틀렸나"* 의 **큐레이션**이라
  기계 생성으로는 동급이 안 된다(04~07 H1 의 절반이 `개발 노트 — 2026-04-05` 처럼 무정보다).
  판단 근거는 [09-04 문서 감사 §4](logs/2026/09/DEV_260904.md) — **빈 규칙을 남기는 것보다 규칙을 현실에 맞춘다.**
