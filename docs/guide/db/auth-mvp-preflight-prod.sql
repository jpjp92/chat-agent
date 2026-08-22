-- ============================================================================
-- 프로덕션 컷오버 사전 점검 (읽기 전용)
--
-- 대상: 프로덕션 gaomgqnpsjtabrvwnpad — Supabase 대시보드 → SQL Editor
-- 시점: auth-mvp-schema.sql 를 적용하기 **전**. 전부 select 라 안전하다.
-- 관련: docs/plans/PLAN_AUTH_PROD_ROLLOUT_260719.md §2-A · §2-A-1
--
-- 왜 필요한가: dev 는 빈 스테이징 프로젝트라 SQL 을 그냥 부으면 됐다. 프로덕션은
-- 구 스키마 + 실데이터가 있고, 컷오버가 기존 테이블을 `_legacy` 로 rename 한다.
-- rename 은 **의존 객체가 있으면 깨지거나 조용히 끌고 간다.** 라이브 DB 에서
-- 그걸 실행 중에 발견하면 늦다.
--
-- 블록마다 "무엇을 판단하는가"를 적어뒀다. 결과를 그 기준에 대보면 된다.
-- ============================================================================


-- ── A. 활성 사용자 — 컷오버 사전 안내가 필요한가 ─────────────────────────────
--
-- 컷오버 시 기존 대화는 `_legacy` 로 밀려 앱에서 사라지고, 구 사용자는 로그인
-- 방법 자체가 없어진다(닉네임 라우트 삭제). 아직 쓰는 사람이 있으면 안내가 필요하다.
-- 이관 여부와는 무관하다 — 이관은 이미 "하지 않음"으로 확정됐다(§2-A-1).

-- A1. 주간 활동 추이
--     판단: 최근 4~6주가 0에 가까우면 활성 사용자 없음 → 안내 불필요, 그대로 진행.
--           꾸준히 쌓이면 → 배포 전 화면 안내 검토.
select date_trunc('week', m.created_at)::date as week,
       count(*)                               as msgs,
       count(distinct s.user_id)              as users
from public.chat_messages m
join public.chat_sessions s on s.id = m.session_id
group by 1
order by 1 desc
limit 12;

-- A2. 사용자별 마지막 활동 (최근순)
--     판단: 상위가 전부 몇 달 전이면 사실상 유휴. 최근 며칠 항목이 있으면 그게 실사용자다.
--     ※ 앞선 실사는 msgs desc 정렬이라 최근성을 못 봤다 — 이 쿼리가 그 공백을 메운다.
select u.nickname,
       count(distinct s.id) as sessions,
       count(m.id)          as msgs,
       max(m.created_at)    as last_at
from public.users u
left join public.chat_sessions s on s.user_id = u.id
left join public.chat_messages  m on m.session_id = s.id
group by u.id, u.nickname
order by last_at desc nulls last
limit 30;

-- A3. 전체 규모 — 스냅샷 소요와 `_legacy` 보관 비용 가늠
select (select count(*) from public.users)         as users,
       (select count(*) from public.chat_sessions) as sessions,
       (select count(*) from public.chat_messages) as messages;


-- ── B. 컷오버 SQL 이 실패할 조건 ─────────────────────────────────────────────
--
-- 🔴 여기서 예상 밖의 결과가 나오면 **컷오버를 중단하고 먼저 해결**한다.

-- B1. rename 대상 3종이 실제로 존재하고 형태가 예상과 같은가
--     판단: users / chat_sessions / chat_messages 세 테이블이 다 나와야 한다.
--           하나라도 없으면 §0 의 rename 문을 그만큼 빼야 한다.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('users', 'chat_sessions', 'chat_messages')
order by table_name, ordinal_position;

-- B2. public 스키마의 전체 객체 — 우리가 모르는 테이블/뷰가 있나
--     판단: 위 3종 외에 BASE TABLE 이 있으면 그게 무엇인지 확인 후 진행.
--           VIEW 가 있으면 B3 에서 의존 여부를 반드시 본다.
select table_name, table_type
from information_schema.tables
where table_schema = 'public'
order by table_type, table_name;

-- B3. 🔴 rename 대상에 의존하는 뷰
--     판단: **한 건이라도 나오면 위험.** 뷰는 rename 을 따라가지 않고 깨지거나
--           예전 이름을 붙든다. 컷오버 전에 drop 하거나 재정의해야 한다.
select dependent_view.relname as dependent_view,
       source_table.relname   as depends_on
from pg_depend d
join pg_rewrite r            on d.objid = r.oid
join pg_class dependent_view on r.ev_class = dependent_view.oid
join pg_class source_table   on d.refobjid = source_table.oid
join pg_namespace ns         on ns.oid = dependent_view.relnamespace
where ns.nspname = 'public'
  and source_table.relname in ('users', 'chat_sessions', 'chat_messages')
  and dependent_view.relname <> source_table.relname
group by 1, 2;

-- B4. 외래키 — rename 후에도 제약은 따라가지만, 어떤 관계가 있었는지 기록해 둔다
select tc.table_name, tc.constraint_name,
       kcu.column_name, ccu.table_name as references_table
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
     on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
     on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public';

-- B5. 현재 RLS 상태 — 구 스키마는 RLS 가 꺼져 있어야 정상(그게 IDOR-1/2 였다)
--     판단: 이미 켜져 있거나 정책이 있으면 누군가 손댄 것이다. 원인 확인 후 진행.
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by tablename;

-- B6. 🔴 `_legacy` 이름이 이미 쓰이고 있나
--     판단: 한 건이라도 나오면 **이전 시도의 잔재**다. rename 이 이름 충돌로 실패한다.
--           덮어쓰지 말고 무엇인지 먼저 확인할 것.
select table_name from information_schema.tables
where table_schema = 'public' and table_name like '%\_legacy';

-- B7. auth.users 현황 — 트리거(handle_new_user)와의 충돌 가능성
--     판단: 0 이면 깨끗하다. 행이 있으면 과거 익명 로그인 테스트 흔적이며,
--           그 계정들은 profiles 가 없는 상태로 남는다(신규 INSERT 트리거라 소급 안 됨).
select count(*)                                as auth_users,
       count(*) filter (where is_anonymous)    as anonymous,
       count(*) filter (where not is_anonymous) as identified
from auth.users;


-- ── C. 스토리지 — 컷오버 후 고아 파일 ────────────────────────────────────────
--
-- 테이블은 rename 되지만 버킷 파일은 그대로 남는다. 새 스키마는 그 파일들을
-- 참조하지 않으므로 전부 고아가 된다. 지금 지우자는 게 아니라 **규모를 알아두는** 목적.

-- C1. 버킷 존재·공개 여부 (§2-D 체크박스와 같은 확인)
--     판단: chat-imgs / chat-videos / chat-docs 3종이 public = true 여야 한다.
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

-- C2. 버킷별 파일 수와 용량
select bucket_id,
       count(*) as objects,
       pg_size_pretty(coalesce(sum((metadata->>'size')::bigint), 0)) as total_size,
       max(created_at) as last_upload
from storage.objects
group by bucket_id
order by bucket_id;
