# Chat Agent 문서

> 최종 갱신: 2026-10-09

이 페이지는 현재 상태와 최근 작업을 찾는 문서 진입점이다. 장기 이력은 [DEV_HISTORY](DEV_HISTORY.md), 아직 남은 일은 [TODO](TODO.md), 실행 순서는 [PLAN_INDEX](plans/PLAN_INDEX.md)를 기준으로 한다.

## 현재 상태

| 영역 | 현재 정책 | 상세 |
|---|---|---|
| 채팅 모델 | Gemini 3.6 Flash 기본. Gemini 3.7/3.5/2.5 및 **GPT-6 luna**/GPT-5.6 luna 선택 가능(GPT-5.4 mini 는 2026-09-23 legacy 강등 — 목록에서만 내렸고 계속 동작한다). **채팅 모델로서 3.8 은 계획만 있고 코드에 없다**(TTS 는 이미 3.8 Flash Lite TTS 사용) — 선택 옵션 공개는 하드닝 1·2 뒤 | [Architecture — Model Policy](guide/REF_Architecture.md#model-policy), [Gemini 3.8 계획](plans/PLAN_MODEL_3_8_MIGRATION_260906.md) |
| Gemini 키 등급 | **회원은 유료 키(`API_KEY_TIER1`) 우선** → 실패 시 무료 로테이션 + 2.5 강등, 게스트·무인증 라우트는 무료만. 10-05 운영 on(`GEMINI_PAID_FIRST=true`) | [PLAN_GEMINI_PAID_FIRST_261004](plans/PLAN_GEMINI_PAID_FIRST_261004.md), [DEV_261005](logs/2026/10/DEV_261005.md) |
| GPT 라우팅 | 일반 텍스트·URL·이미지·검색과 로컬 도구 8종은 선택 GPT 유지. 영상·오디오/fileData와 알약 Vision만 Gemini 2.5 capability fallback | [멀티 공급자 라우팅 계획](plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md) |
| 알려진 라우팅 공백 | initial router는 아직 Gemini 2.5 Flash Lite 우선이며, 실패 시 규칙 분류로 복구한다. GPT 일반/도구 실행 자체는 Gemini 키와 분리됨 | [계획 P0](plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md#3-현재-충돌-지점) |
| URL Fetch | Wikidocs는 ScrapingBee render/premium/KR 우선, 일반 URL은 direct 우선. browserless는 후순위, OpenAI URL fallback은 기본 OFF | [2026-08-23 실측](logs/2026/08/DEV_260823.md) |
| 오류 노출 | 공급자 status/code/message는 서버 로그에만 기록하고 UI에는 지역화된 정제 문구만 표시 | [오류 분류 계약](plans/PLAN_MULTI_PROVIDER_ROUTING_260823.md#4-오류-분류-계약) |
| 검색 grounding | tier 로 판정(400 물리제약 > 300 사용자 명시 > 200 근거제공 > 100 분류기). **400 은 Gemini 전용** — OpenAI 는 이미지와 web_search 를 함께 보낼 수 있어 신호를 내지 않는다 | [2026-09-02 로그](logs/2026/09/DEV_260902.md), [검색 정책 계획](plans/PLAN_SEARCH_POLICY_260815.md) |
| 함수 타임아웃 | 🔴 **60s 는 플랫폼 한계가 아니다** — Hobby 도 fluid 기본·최대 **300s** 다. `/api/chat` 은 `maxDuration=300`, Gemini 일반 25s·무거운 미디어 90s, OpenAI **120s(호출당)**. 새 경로를 만들 때 **60 을 베껴 오지 말 것** — 이 정정이 세 번 필요했다 | [2026-08-08 §9](logs/2026/08/DEV_260808.md), [2026-09-28 §11](logs/2026/09/DEV_260928.md) |
| 오늘 날짜 | 주입된 `[CURRENT_SYSTEM_TIME]` 이 **유일한 출처**이고 블록은 base **맨 앞**(실측). 자정 직후 Gemini 2.5 가 기사 날짜로 "오늘" 을 재추론하는 실패는 **문구로 세 번 못 고쳤다** → 출력 사후 검증이 정정을 덧붙인다 | [2026-09-28 §13·§14](logs/2026/09/DEV_260928.md), [today-guard.ts](../server/agent/today-guard.ts) |
| 자동 검증 | `npm test` 회귀 하니스 25종(`tests/*.mts` 자동 수집), 외부 공급자 프로브는 `tests/manual/`로 분리 | [tests/README](../tests/README.md) |
| 서버 경계 | ⚖️ `speech` 는 인증·게스트 차단·회원 일일 한도가 **운영 배포됨**(10-05) — 운영 DB `tts-quota.sql` 적용 여부는 미확인([DEV_261003](logs/2026/10/DEV_261003.md)). ✅ 10-10 `summarize-title` 인증 + **anon 키 Bearer 우회 차단**(chat 포함, 프로필 행 필수), SSRF 공용 판정 `server/ssrf.ts`(IPv6 대괄호·DNS·리다이렉트 hop 재검사) — [DEV_261010](logs/2026/10/DEV_261010.md). 🔴 **무인증 라우트 4개** 남음 — `fetch-url`·`proxy-image`·`showtimes`·`sync-drug-image`. SSRF 남은 공백은 DNS 재바인딩 | [TODO §보안](TODO.md), [PLAN_HARDENING_260822](plans/PLAN_HARDENING_260822.md), [보안 검토 §3.4](logs/2026/09/DEV_260903.md) |

## 최근 문서

- **2026-10-04** — [REF_TTS](guide/REF_TTS.md) — TTS 단일 레퍼런스 신설: **1순위 Gemini 3.8 Flash Lite TTS → 폴백 OpenAI**, 가격(Lite $0.009/분, 2027 2배), 흐름·인증/한도·오류 처리. 🔴 OpenAI `gpt-4o-mini-tts` **2027-01-06 제거** → 폴백 교체 예정
- **2026-10-03** — [TTS 스트리밍 전환](logs/2026/10/DEV_261003.md) — 2.5 TTS 는 스트리밍이 안 되고 2000자에서 **실패**했다. 긴 입력은 두 공급자 모두 **중간을 건너뛴다** → 500자 분할(8/8). OpenAI 기본. 🔴 카드 JSON 을 **철자로 읽던** 결함 → 서버 전처리. `speech` 인증 + 게스트 차단 + 회원 일일 한도. **미배포**
- **2026-09-28** — [luna 60s 절단 · 오늘 날짜 사후 검증](logs/2026/09/DEV_260928.md) — 🔴 사용자가 본 *"서버가 일시적으로 불안정합니다"* 는 지연이 아니라 **실패**였다. `OPENAI_CHAT_TIMEOUT_MS` 60s 는 **근거가 이미 폐기된 값**(도입 2주 전에 `maxDuration 60→300` 이 밝혀져 있었다) → 120s + **타이머를 호출당으로**(예산을 공유해 카드 턴이 반으로 쓰고 있었다). 실측 정상 6~20s(상한의 17%)
- **2026-09-28** — [시각 블록 A/B 3연속 기각 → 구조로 전환](logs/2026/09/DEV_260928.md) — 위치 `end`(Q1, 56턴) · 재진술 `both`(순효과 **p=1.000** — F1 을 줄이고 F2 로 옮겼다) · 렌더 `iso24`(n=14 **p=0.678** 판정 불가). **원인은 문구가 아니다** — 날짜를 직접 물으면 검색이 붙어도 주입값을 쓴다(§13-3). 금지 규칙은 이미 프롬프트에 있다 → 출력 사후 검증 [today-guard.ts](../server/agent/today-guard.ts) 구현(**치환 대신 덧붙이기**, §14). 📐 방법론: n=14 + **교대 배치** · **사전 등록**(주 지표를 순효과로) · 기각 시 손잡이 제거
- **2026-09-25** — [계층 충돌 프로브 · 8단계](logs/2026/09/DEV_260925.md) — 가설 **기각(0/7)**. ⚖️ *"오분류 턴 0/7"* 은 **결함이 아니었다**(§8 — 라우터가 이미 분리, 수정 되돌림). 8단계로 영상·본문 조항을 조건부화해 일반 턴 base **27% 감소**(본문·영상 턴 바이트 동일). 테스트 러너(`&&` 체인이 실패를 가리던 것) 교체
- **2026-09-24** — [프롬프트 계층 분리](logs/2026/09/DEV_260924.md) — 0~7단계 완료. **프롬프트 문구 변경 0건**(바이트 동일 증명). 부수로 **소스 grep 하니스 49건**과 블록이 사라져도 통과하던 순서 검사를 고쳤다. 8·9단계는 응답이 바뀔 수 있어 미착수
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
