# PLAN_STABILITY_261112 — 운영 안정성·라우터 지연 개선

> 2026-11-12 작성. 외부 검토안(`dev` `59d6e9b` 기준 P0~P3)을 코드와 대조해 실행 순서를 다시 정했다.
> 원칙: 라우팅·검색 정책·SSE 이벤트 계약 유지, 새 프레임워크 없음, 최소 수정, 수정 전후 측정.

## 0. 요약

| 순서 | 항목 | 코드 대조 결과 | 결정 |
|---|---|---|---|
| 1 | P0-1 `unhandledRejection` | 실제 문제 — 동시 요청 전부에 오류 이벤트. 근원은 LangChain 이 버린 SDK Promise | ✅ 11-13 [DEV_261113](../logs/2026/11/DEV_261113.md) |
| 2 | P0-2 메시지 저장 | 위험 작음 — 순서·실패가 확정 안 될 뿐 | 작게 진행 |
| 3 | P1-2 준비 + P1-3 | `routerMs`·`needsSearch` 가 `[turn]` 에 없음 | 진행(무료) |
| 4 | P1-2 라우터 제한 시간 | 호출 상한 없음 | 3번 측정 뒤 |
| — | P1-1 근거 재사용 규칙 | 요구 내용 대부분 이미 규칙에 있음 | 보류(실패 사례 나오면) |
| — | P1-4 회귀 테스트 | — | 각 항목에 붙여서 |
| — | P2·P3 구조 개선 | — | 보류(P0·P1 안정 뒤) |

## 1. P0-1 요청 단위 `unhandledRejection` 리스너

**현재** — [route.ts](../../app/api/chat/route.ts) 가 요청마다 `process.once('unhandledRejection', guard)` 를 걸고 `finally` 에서 뗀다. guard 는 자기 요청 스트림에 generic 오류를 보낸다.

**문제** — Fluid Compute 는 한 인스턴스가 요청을 동시에 처리한다. rejection 1건이면 그 순간 걸려 있는 **모든 요청의** guard 가 돌아, 무관한 요청도 오류 문구를 받는다(검토안의 "오인"보다 넓다).

**주의** — 리스너를 그냥 지우면 Node 15+ 는 처리 안 된 rejection 에 프로세스를 끝낸다. 이 guard 가 그걸 막아 주던 셈이다.

**수정**
- 모듈 수준에 리스너 **하나**를 한 번만 등록한다 — 로그만(오류 코드·`name`, 원문·사용자 내용 없음), SSE 안 보냄.
- 요청별 `process.once`/`process.off` 제거. 요청 오류는 기존 `try/catch/finally` 로만 전파.
- 실제 rejection 출처를 찾으면 그 Promise 에서 직접 처리(배포 로그에서 리스너 로그가 찍히는지로 확인).

**결과(11-13)** — 근원을 찾아 막고(SDK `response` Promise 빈 catch) 리스너는 모듈 1개로 → [DEV_261113](../logs/2026/11/DEV_261113.md). 배포 후 `[process]` 줄이 찍히면 다른 출처를 찾는다.

**완료 기준**
- 하니스: 동시 요청 3개 중 1개에서 떠돌이 rejection → 나머지 2개 스트림 오류 이벤트 0개, 프로세스 유지.
- 리스너가 중복 등록되지 않음(모듈 재평가해도 1개).

## 2. P0-2 메시지 저장 순서·실패

**현재** — user insert 는 await 없음(TTFT 보호), assistant insert 는 await. 둘 다 `trace_id` 저장(T3). URL 실패 경로 insert 는 오류 객체를 통째로 로그.

**판단** — 스트림이 insert 보다 훨씬 길어 user 저장은 사실상 끝나고, 먼저 출발해 순서 역전도 드물다. 다만 "끝났는지"가 코드상 확정되지 않는다.

**수정**
- user insert Promise 를 보관하고 **assistant insert 직전에** await — 응답 시작 전이 아니라 끝난 뒤라 TTFT 영향 없음.
- 저장 실패 로그를 한 모양으로: `{ role, traceId, code }`(`dbErrorSummary`). URL 실패 경로도 같은 함수로.
- user 저장 실패·assistant 성공 같은 부분 저장은 로그로만 드러낸다(롤백 안 함 — 답은 이미 화면에 나감).

**완료 기준** — 하니스: user insert 실패 주입 → 로그 1줄(role=user, traceId), assistant 저장은 진행. 정상 턴 TTFT 변화 없음.

## 3. `[turn]` 필드 추가 — `routerMs`·`needsSearch`

**현재**
- 라우터 소요 시간을 남기지 않아 제한 시간을 정할 근거가 없다.
- 검색은 `search`(실제 실행)·`searchBy`·`sources`(출처 수)만 있고, 라우터의 검색 필요 판정(`needsSearch`)이 없다.

**수정** — `turnFields()` 에 두 필드 추가(LangSmith 루트 메타도 같은 함수라 자동). 검토안의 `SearchExecutionInfo` 새 타입은 만들지 않는다.

**이걸로 구분되는 경우**

| needsSearch | search | sources | 뜻 |
|---|---|---|---|
| true | true | >0 | 정상 |
| true | false | — | 요청했는데 미실행(공급자 제약 등) |
| true | true | 0 | 실행했는데 출처 0건 — Google 은 출처 없이도 검색했을 수 있어 "미실행"으로 단정 안 함 |
| false | false | — | 히스토리 재사용·검색 불필요 |

**완료 기준** — `test-turn-log` 에 두 필드 허용·값 범위 확인, dev 배포에서 `[turn]` 줄에 찍힘.

## 4. P1-2 라우터 제한 시간

**현재** — [router.ts](../../server/agent/nodes/router.ts) Gemini 호출에 상한 없음, 키를 바꿔 최대 2회. 실패 시 규칙 폴백과 `intentFrom=rule` 기록은 이미 된다.

**순서** — 3번 배포 → 며칠간 `routerMs` p50/p90/p95 수집(추가 비용 0) → 시도당 상한과 라우터 전체 예산을 따로 정한다(예: p99 근처 시도당, 전체는 2회 합). 타임아웃도 규칙 폴백으로 가고 `retryReasons` 에 `timeout`.

**완료 기준** — 수정 전후 p95 TTFT·`intentFrom=rule` 비율 비교. 비율이 눈에 띄게 늘면 상한을 늘린다.

## 5. 보류

- **P1-1 근거 재사용 규칙**([grounded-history-rules.ts](../../server/agent/grounded-history-rules.ts)) — 사용자 정정 = 새 근거, 명시적으로 다른 출처일 때만 정정, 없는 세부는 "확인 필요"가 이미 들어 있다. 실패 사례 없이 문구를 바꾸면 막아 둔 "최신 사실 번복"이 되살아날 수 있다. 기존 MT 하니스([test-prompt-assembly](../../tests/test-prompt-assembly.mts))는 조립만 보고 답 정확도는 안 보므로, 바꿀 때는 유료 실측 전후 비교가 필요하다(호출 수·비용 먼저 제시).
- **P2**(공급자별 재시도 계측 통일·Generator 실행 함수 분리·카드 참조 ID)·**P3**(후속 상태 공통화) — P0·P1 이 안정된 뒤. Generator 는 LangGraph 노드를 유지한 채 내부 함수만 나눈다.
