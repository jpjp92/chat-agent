# PLAN_TRACE_ID_261108 — 턴 ID 로 Supabase·Vercel·LangSmith 잇기

> 상태: T1 완료(11-09) · T2 완료(11-09) · T3 다음 · 상위 계획 [PLAN_LANGSMITH_TRACING_261107](PLAN_LANGSMITH_TRACING_261107.md) §4 L3 를 넓힌 것
> 출발점: 11-08 GPT 검토(역할 분담) — Supabase = 원문 기준 저장소, Vercel = 운영 로그, LangSmith = 실행 분석. 계획 GPT 2차 검토 반영(11-08, §3 주의).
> Supabase: **dev 와 운영(main)은 서로 다른 프로젝트**(DB·Storage 모두, 11-08 사용자 확인).

## 0. 요약

- **문제**: 세 시스템에 공통 ID 가 없다. LangSmith 에서 느린·이상한 trace 를 찾아도 그 대화 원문(Supabase)으로 못 가고, 사용자가 신고한 답에서 trace 를 못 찾는다. `[turn]` 로그도 어느 trace 인지 모른다.
- **해법**: 요청마다 서버가 무작위 **턴 ID(`traceId`, UUID v4)** 를 만들어 세 곳에 같은 값으로 남긴다.
  - LangSmith: 루트 run 의 ID 로 지정(새 값이 아니라 원래 있던 run ID 를 우리가 정한다)
  - Vercel: `[turn]` 로그 `traceId`
  - Supabase: `chat_messages.trace_id`(그 턴의 user·assistant 행)
- **`session_id` 는 밖으로 내보내지 않는다.** 대화방 전체를 엮는 열쇠라 LangSmith·로그에 나가면 한 사람의 대화가 외부 데이터만으로 묶인다. 원문까지의 길은 **권한 있는 DB 안에서만**: `trace_id → chat_messages → session_id → 대화`.

```
LangSmith 루트 run ID ─┐
Vercel [turn].traceId  ├─ 같은 턴 ID (매 턴 새 무작위 값)
chat_messages.trace_id ┘ → (DB 안에서만) session_id → 대화 원문
```

## 1. 현재 코드 — 연결 지점

| 지점 | 위치 | 지금 |
|---|---|---|
| 요청 시작 | `app/api/chat/route.ts` POST | ID 없음 |
| user 메시지 저장 | route.ts `chat_messages.insert`(그래프 전) | `session_id, role, content, attachment_url` |
| 그래프 실행 | route.ts `graph.streamEvents(initialState, { version, callbacks })` | 루트 run ID 는 LangChain 이 임의 생성 |
| assistant 저장 | route.ts 스트림 끝(정상) · URL 실패 경로 | 위와 같음 + `grounding_sources` |
| `[turn]` 로그 | route.ts `finally` → `logTurn` | 허용 목록 필드만, 식별자 없음 |
| 스키마 | `docs/guide/db/auth-mvp-schema.sql` `chat_messages` | `id, session_id, role, content, attachment_url, grounding_sources, created_at` |

## 2. 원칙

- 턴 ID 는 **서버가 만든다**(클라이언트 값은 받지 않는다 — 위조·재사용 방지). `crypto.randomUUID()`.
- 턴 ID 하나로는 아무것도 알 수 없다. 원문은 Supabase(RLS·service key) 안에서만 이어진다.
- **로그 규칙 예외 1개**: `[turn]` 은 "허용 목록·식별자 없음" 이었다 → **상관관계 ID `traceId` 하나만** 허용(11-08 사용자 결정). 사용자·세션 ID 는 여전히 금지.
- 추적이 꺼져 있어도 턴 ID 는 만든다 — `[turn]` 과 DB 연결은 LangSmith 와 무관하게 쓸모 있다.
- 샘플링(`LANGSMITH_TRACING_SAMPLING_RATE<1`)이면 LangSmith 에 없는 ID 도 생긴다 — 정상(로그·DB 는 항상 있음).

## 3. 단계

| 단계 | 내용 | 변경 | 검증 |
|---|---|---|---|
| **T1** | 턴 ID 생성 → 루트 run ID(`streamEvents` config `runId`) · `[turn].traceId` | route.ts · turn-log.ts · 하니스 | **먼저** 가짜 전송으로 `runId` 가 실제 루트 run `id` 가 되는지 확인. 하니스: `[turn]` 에 UUID 형식 `traceId`. 실화면: LangSmith run ID = Vercel 로그 값 |
| **T2** | 루트 run 메타데이터 = `[turn]` 값(`intent`·`model`·`modelDowngraded`·`search`·`searchBy`·`sources`·`sourceKinds`·`outcome`) + **배포 커밋**(`VERCEL_GIT_COMMIT_SHA` 앞 7자, 로컬은 `local`). `ms` 는 넣지 않는다(LangSmith 가 run 시간을 이미 잰다). `retry_reason` 은 `[turn]` 에 아직 없어 별도 항목 | tracing.ts · route.ts | LangSmith 에서 `intent`·`outcome`·`commit` 필터 |
| **T3** | `chat_messages.trace_id uuid null` + 부분 인덱스(`where trace_id is not null`) · user·assistant·URL 실패 행에 저장 | SQL 파일 1개 · route.ts | 마이그레이션 적용 후 실화면: 한 턴의 두 행이 같은 `trace_id` |
| T4(나중) | 대화방 단위 묶어 보기 — LangSmith Threads 에 `session_id` 의 **HMAC**(서버 비밀키) · 숨김 모드에서만 | — | 필요해지면 |
| T5(나중) | 관리자 조회 화면·접근 감사 로그 | — | 사용자 규모가 커지면. 그 전엔 Supabase SQL |

### T2 주의 — 루트 메타데이터를 언제 붙이나
`[turn]` 값(의도·출처 수)은 그래프가 끝나야 확정되는데, 루트 run 은 그 순간 끝나 `updateRun` 이 콜백으로 나간다(경합). 후보:
1. 원문 모드처럼 정리 Client 가 **루트 `updateRun` 을 잠깐 잡아 두고**, route.ts 가 `[turn]` 값을 넘기면 합쳐 보낸다(숨김 모드에도 보류가 생긴다 — 오버헤드 재측정).
2. 그래프가 끝난 뒤 루트 run 에 **메타데이터만 한 번 더 PATCH**(langsmith 가 덮어쓰기인지 병합인지 확인 필요).
3. 루트 아래에 메타데이터만 든 짧은 자식 run `turn.summary` 를 하나 더 만든다(가장 단순, 필터는 자식 기준).
→ **1 을 우선**(같은 run 에 결과가 붙고 요청이 늘지 않는다, GPT 2차 검토). 원문 모드 보류·해제와 같은 자리(정리 Client 의 루트 `updateRun`)라 두 로직이 한 번에 맞물리게 — 원문 보류 중이면 해제 때, 숨김 모드면 짧게(턴 값이 올 때까지, 상한 있음) 잡아 둔다. 안 되면 2. 3 은 실제로 실행하지 않은 span 이 생겨 trace 구조를 흐리므로 쓰지 않는다.

### T1 주의 — 루트 run ID 를 못 정하면
LangChain 추적기가 `runId` 를 루트에 쓰지 않으면, langsmith 내부를 고치지 않고 **루트 메타데이터 `traceId`** 로 바꾼다(LangSmith 에서 메타데이터로 찾는다). 세 곳에 같은 값이 남는다는 목표는 같다.

### T3 주의
- **저장은 서버(route.ts)** 에서 한다 — 턴 ID 를 브라우저로 넘길 필요가 없다.
- **dev·운영 Supabase 가 다르다** → 순서: dev DB 마이그레이션 → dev 코드 배포·검증 → **운영 DB 마이그레이션** → main 반영. 열이 없는 DB 에 새 코드가 insert 하면 실패하므로 **각 DB 는 그 코드보다 먼저**. 운영 DB 적용을 잊으면 main 반영 때 메시지 저장이 깨진다 — `docs/guide/db/README.md` 실행 순서와 main 반영 체크리스트에 적는다.
- 열은 `uuid null` 이라 기존 행·옛 코드와 호환. 인덱스는 지금 규모면 일반 `create index`, 커지면 `concurrently`.
- 부분 실패도 정상 상태로 조회되어야 한다: user 행만 있고 assistant 행이 없는 턴(생성 실패·사용자 중단·assistant 저장 실패), 재시도·폴백(같은 턴이면 같은 ID — 턴 ID 는 요청 하나에 하나). `[turn].outcome` 으로 어느 경우인지 구분.
- 게스트·`session_id` 없는 요청은 행이 없다 — 로그·LangSmith 에만 ID.

## 결과

### T1 (11-08 코드 · 11-09 배포 검증) — 완료
- 확인 먼저: 가짜 전송으로 `streamEvents(..., { runId })` 를 주면 **루트 run ID = 넘긴 UUID, 자식 run `trace_id` 도 모두 같은 값** — 메타데이터 대안 불필요.
- route.ts: 턴 시작에 `crypto.randomUUID()` → `streamEvents` `runId` · `logTurn({ traceId })`.
- turn-log: `traceId` 필드(UUID 형식만, 아니면 `null` — 세션 ID·문장이 이 칸으로 새지 않게). 키 허용 목록 하니스 갱신, `PLAN_TURN_LOG` 필드 표에 식별자 예외로 기록.
- 추적이 꺼져 있어도 `[turn].traceId` 는 남는다.
- 배포 검증(11-09, `52ef4f2` Production): 일반 질문 1턴 → Vercel `[turn].traceId` `8e48a22a-…` = LangSmith `chat-agent-dev-vercel` 루트 run(`LangGraph`) `id`·`trace_id`, `parent_run_id` null, 입출력 null(숨김). `[turn]` 은 요청당 1줄(중복 없음). 이전 배포 턴엔 `traceId` 없음 — 정상.

### T2 (11-09) — 완료
- 후보 1(루트 끝 전송 보류 후 합치기)로 구현. 상세·하니스·오버헤드는 [DEV_261109](../logs/2026/11/DEV_261109.md) §2.
- 필드는 `turnFields()`(turn-log) → `turnMetaOf()`(tracing) 한 경로로 만든다. 보류·턴 값은 `traceId` 별이고, 응답 뒤 flush 는 그 요청의 trace 만 바로 보낸다.
- 배포 확인(`c0e1693`): 루트 Metadata 에 턴 값·`commit` 이 붙었고, 기존 `ls_run_depth`·`LANGSMITH_*` 도 남았다(서버가 병합한다). 입출력 숨김.

### T3 (11-09) — SQL·코드 준비, dev DB 적용 대기
- `docs/guide/db/chat-messages-trace-id.sql` · route.ts 세 insert. 진행 상황은 [DEV_261109](../logs/2026/11/DEV_261109.md) §4.
- [x] dev DB SQL 실행(11-09, 인덱스 확인) → [ ] dev 배포·실화면(한 턴의 두 행이 같은 `trace_id` = `[turn].traceId`) → [ ] **운영 DB SQL** → [ ] main 반영

## 4. 조회 (T3 이후, 관리자)

```sql
-- LangSmith 에서 본 trace → 대화
select m.session_id, m.role, m.created_at, left(m.content, 200)
from chat_messages m where m.trace_id = '<traceId>';

-- 신고된 답 → trace
select trace_id from chat_messages where id = '<message id>';
```
원문 조회는 사용자 동의·필요가 있을 때만(운영 원문 열람 규칙 유지).

## 5. 하지 않는 것

- `session_id`·`user_id` 를 LangSmith·로그로 보내기
- 클라이언트가 턴 ID 를 정하게 하기
- 턴 ID 를 SSE 로 브라우저에 내리기 — "이 답 신고" 버튼이 생길 때 다시 본다
- 운영(Production) 적용 — PLAN_LANGSMITH §6 2단계(개인정보처리방침 고지) 뒤

## 6. 테스트

- 하니스(`test-turn-log`·`test-tracing`): `traceId` 형식, 루트 run ID 일치, 메타데이터 허용 목록, `session_id` 미포함(숨김·원문 둘 다).
- 실화면(dev): 한 턴의 LangSmith run ID = `[turn].traceId` = `chat_messages.trace_id`(T3 후).
- 오버헤드: T2 가 보류를 쓰면 `bench-tracing-overhead` 재측정.
