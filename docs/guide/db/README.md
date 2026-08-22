# DB 스키마 — 새 환경을 세우는 유일한 출처

> 2026-08-18. 이전에는 `scripts/sql/` 에 있었고, 그 폴더가 `.gitignore` 범위와 엉켜 **두 번 사고**를 냈다.
> 여기 있는 것은 **버리면 안 되는 것**이라 `scripts/`(일회성 습작 전용)와 분리했다.

## 🔴 왜 이 폴더가 따로 있나

`mfds_pills` 의 DDL 이 한때 `sync-mfds-pills.mjs` **주석 안에만** 있었고 그 파일은 `sync-*` 로 무시되고 있었다.
인증 MVP 가 **빈 Supabase 프로젝트를 새로 세웠을 때** 테이블이 따라오지 못했고,
약품 식별 1순위 경로가 dev 에서 조용히 죽어 있었다(2026-08-17 발견).
`url_cache` 도 같은 형태로 **약 45일간** 없는 채였고 매 요청이 유료 스크래퍼를 태웠다.

→ **스키마의 출처는 코드 주석이나 문서 본문이 아니라 실행 가능한 `.sql` 파일이다.**

## 실행 순서 (새 Supabase 프로젝트)

Supabase → SQL Editor 에 **전문을 붙여넣고 Run**. 순서를 지킬 것.

| # | 파일 | 무엇 | 비고 |
|---|---|---|---|
| 1 | `auth-mvp-schema.sql` | `profiles` · `chat_sessions` · `chat_messages` | 기본 3개 테이블 |
| 2 | `auth-mvp-storage-buckets.sql` | `chat-imgs` · `chat-videos` · `chat-docs` | 공개 버킷 |
| 3 | `storage-user-prefix-rls.sql` | Storage RLS (`uid/` prefix 강제) | 🔴 **코드 배포보다 먼저** — 순서를 바꾸면 업로드가 전부 거부된다 |
| 4 | `url-cache.sql` | URL 본문 캐시 | RLS 켜고 **정책 없음**(service_role 전용, 공유 캐시) |
| 5 | `mfds-pills.sql` | 약품 낱알식별 테이블 | RLS 동일. 각인 GIN 인덱스가 핵심 |
| 6 | `node docs/guide/db/sync-mfds-pills.mjs` | 약품 데이터 적재 (~25,000행) | 아래 참조 |

인증 컷오버(프로덕션)는 `auth-mvp-preflight-prod.sql` → `auth-mvp-cutover-prod.sql` → `auth-mvp-verify-prod.sql` 순서를
따로 탄다. `auth-mvp-sync-trigger.sql` · `auth-mvp-identity-sync.sql` · `auth-mvp-guest-limit.sql` 은 그 부속이다.

## 약품 데이터 적재

```bash
node docs/guide/db/sync-mfds-pills.mjs --count     # 총 건수만 확인
node docs/guide/db/sync-mfds-pills.mjs --dry-run   # API 연결·파싱만
node docs/guide/db/sync-mfds-pills.mjs             # 전체 동기화
```

필요 env: `MFDS_API_KEY` · `MFDS_API_ENDPOINT` · `SUPABASE_URL` · `SUPABASE_KEY`(service_role).

> 🔴 **마지막 줄을 자르지 말 것.** `완료: N건 저장, M건 오류, K건 배치내중복` 이 유일한 검증 지점이다.
> 2026-08-17 에 `| tail -40` 으로 이 줄을 날려 **3,000건 누락을 못 보고 한 바퀴를 더 돌았다.**
> 배치 **안**에 같은 `item_seq` 가 둘 이상이면 Postgres 가 문장 전체를 거부해
> **정상 499건이 같이 날아간다** — 그 방어가 스크립트에 들어 있다.

## 알아둘 것 — 각인 커버리지 8.7%

`mark_code_front_anal`(각인 텍스트)을 가진 행은 **25,345 중 2,214** 뿐이다(2026-08-18 실측).
23,121행은 각인 텍스트·이미지가 **둘 다 없다**. 상류 MFDS 낱알식별 API 의 한계지 적재 버그가 아니다.
→ 각인 검색은 원리적으로 8.7% 만 덮으므로, 나머지는 색상·모양 후보 또는 **웹 폴백**으로 간다.
그래서 "각인 없음"과 "정보 없음"을 **구분해서 표시**해야 한다(`server/agent/nodes/pill-messages.ts`).

관련: [REF_DB](../REF_DB.md) · [PLAN_PRIORITY_260817](../../plans/PLAN_PRIORITY_260817.md)
