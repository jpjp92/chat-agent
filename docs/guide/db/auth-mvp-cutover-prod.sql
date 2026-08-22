-- ============================================================================
-- 프로덕션 컷오버 — rename + 스키마 적용 (파괴적, 유지보수 창 전용)
--
-- 대상: 프로덕션 gaomgqnpsjtabrvwnpad — Supabase 대시보드 → SQL Editor
-- 선행: auth-mvp-preflight-prod.sql 통과 · 대시보드 스냅샷 · §B 토글 4종
-- 후행: auth-mvp-verify-prod.sql 로 PASS/FAIL 확인 → 즉시 main 배포
-- 관련: docs/plans/PLAN_AUTH_PROD_ROLLOUT_260719.md §1 · §2-A
--
-- ── 왜 이 파일이 따로 있는가 ────────────────────────────────────────────────
--
-- auth-mvp-schema.sql 은 **스테이징 기준**으로 쓰였다. 빈 프로젝트라 rename 이
-- 필요 없었고, 그래서 §0 의 rename 3줄이 주석 처리돼 있다.
--
-- 프로덕션에서 그대로 실행하면 `create table public.chat_sessions` 에서
-- 이름 충돌로 **중간에 실패한다.** 그 시점엔 이미 profiles 가 만들어진 뒤라
-- 부분 적용 상태가 되고, 유지보수 창 한복판에서 수습해야 한다.
--
-- 이 파일은 schema.sql 을 **복제하지 않는다**(복제는 곧 drift 다). rename 과
-- 트랜잭션 경계만 제공하고, 본문은 붙여넣게 한다.
--
-- ── 실행 방법 ───────────────────────────────────────────────────────────────
--
--   1. 이 파일 전문을 SQL Editor 에 붙여넣는다
--   2. 아래 §2 자리에 auth-mvp-schema.sql 의 **§1 이후 전문**을 붙여넣는다
--      (schema.sql 의 §0 rename 주석 블록은 여기 §1 과 중복이므로 제외)
--   3. Run → 결과 확인 → 문제 없으면 이미 commit 됨
--
-- 🔴 begin/commit 으로 감싸는 이유: 중간 실패 시 **통째로 롤백**된다.
--    부분 적용 상태가 만들어지지 않는다. Postgres 는 DDL 도 트랜잭션이다.
--    (단 `create index concurrently` 는 트랜잭션 안에서 못 쓴다 — schema.sql 은
--     평문 `create index` 만 쓰므로 문제없다.)
-- ============================================================================

begin;


-- ── §1. 기존 테이블을 `_legacy` 로 rename ───────────────────────────────────
--
-- 지우지 않는다. rename 이 곧 백업이고, 롤백 경로다(§4).
-- 순서 주의: 자식(chat_messages) 먼저. FK 는 rename 을 따라가지만
-- 읽는 사람 기준으로 의존 방향과 같은 순서가 오해가 없다.
--
-- 사전 점검 B6 에서 `%_legacy` 0건을 확인했다. 이름 충돌이 있으면 여기서 멈춘다.

alter table public.chat_messages rename to chat_messages_legacy;
alter table public.chat_sessions rename to chat_sessions_legacy;
alter table public.users         rename to users_legacy;


-- ── §2. 여기에 auth-mvp-schema.sql 의 §1 이후 전문을 붙여넣는다 ─────────────
--
--   테이블 3종 · 인덱스 · 트리거 6종 · RLS 정책 4종 · GRANT
--
--   ⚠️ schema.sql 의 §0(rename 주석 블록)은 위 §1 과 중복이므로 제외할 것.
--
-- <<<<<<<<<<<<<<<<<<<< PASTE HERE >>>>>>>>>>>>>>>>>>>>




-- ── §3. 커밋 ────────────────────────────────────────────────────────────────
--
-- 여기까지 에러 없이 왔으면 확정한다.
-- 중간에 하나라도 실패했다면 Postgres 가 트랜잭션을 abort 시키므로
-- 이 commit 은 rollback 으로 처리된다 — 즉 아무것도 적용되지 않는다.

commit;


-- ── 다음 단계 ───────────────────────────────────────────────────────────────
--
--   1. auth-mvp-verify-prod.sql 실행 → 전 항목 PASS 확인
--   2. 즉시 dev → main 머지 → Vercel 재빌드 (§1-4)
--      🔴 여기가 벌어질수록 "새 스키마 + 옛 코드" 상태가 길어진다 = 전면 장애
--   3. §3 스모크 시나리오
--
-- 롤백이 필요하면:
--   drop table public.chat_messages, public.chat_sessions, public.profiles cascade;
--   alter table public.users_legacy         rename to users;
--   alter table public.chat_sessions_legacy rename to chat_sessions;
--   alter table public.chat_messages_legacy rename to chat_messages;
--   → 그리고 main 을 인증 이전 커밋으로 재배포.
