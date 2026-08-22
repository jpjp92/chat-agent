-- ============================================================================
-- 컷오버 검증 — PASS / FAIL (읽기 전용)
--
-- 대상: 프로덕션 gaomgqnpsjtabrvwnpad — auth-mvp-cutover-prod.sql **직후**
-- 관련: docs/plans/PLAN_AUTH_PROD_ROLLOUT_260719.md §1-5 · §3
--
-- ── 왜 필요한가 ─────────────────────────────────────────────────────────────
--
-- schema.sql §5 에 확인 쿼리가 주석으로 있지만 **결과를 눈으로 대조**해야 한다.
-- 컷오버는 유지보수 창에서 급하게 도는 작업이라, 그 시점에 "정책 4개가 맞나,
-- roles 에 authenticated 가 들어갔나"를 사람이 세고 있으면 놓친다.
--
-- 이 파일은 기대값을 코드에 박아 **PASS/FAIL 한 컬럼**으로 떨군다.
-- FAIL 이 하나라도 보이면 배포하지 말고 원인부터 잡는다.
--
-- 🔴 여기서 못 잡는 것: 정책이 **실제로 차단하는지**.
--    정책이 존재해도 GRANT 가 어긋나면 전면 거부가 되고, 그러면 음성 테스트가
--    엉뚱한 이유로 통과한다(거짓 통과). 아래 §4 가 GRANT 를 따로 보는 이유다.
--    최종 확인은 §3 스모크(IDOR 4·5번) — 실제 두 계정으로 확인한다.
--    scripts/test-auth-rls.ts 는 픽스처를 생성하므로 프로덕션에서 돌리지 않는다.
-- ============================================================================

with checks as (

-- ── §1. 테이블 ──────────────────────────────────────────────────────────────

  select 1 as seq, '신규 테이블 3종' as item,
         count(*)::text as actual, '3' as expected
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
    and table_name in ('profiles', 'chat_sessions', 'chat_messages')

  union all
  -- rename 이 백업이자 롤백 경로다. 없으면 롤백이 불가능한 상태로 진입한 것이다.
  select 2, '_legacy 백업 3종',
         count(*)::text, '3'
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
    and table_name in ('users_legacy', 'chat_sessions_legacy', 'chat_messages_legacy')

  union all
  -- 구 `users` 가 남아 있으면 rename 이 안 된 것이다.
  -- (chat_sessions·chat_messages 는 같은 이름으로 새로 만들어지므로 여기서 못 본다)
  select 3, '구 users 잔존(0이어야)',
         count(*)::text, '0'
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
    and table_name = 'users'


-- ── §2. RLS ─────────────────────────────────────────────────────────────────

  union all
  -- 🔴 이게 꺼져 있으면 anon 키가 그대로 전 데이터 접근권이 된다(= IDOR-1/2 재현).
  select 4, 'RLS 켜짐 3종',
         count(*) filter (where rowsecurity)::text, '3'
  from pg_tables
  where schemaname = 'public'
    and tablename in ('profiles', 'chat_sessions', 'chat_messages')

  union all
  select 5, '정책 4종',
         count(*)::text, '4'
  from pg_policies
  where schemaname = 'public'
    and policyname in ('own profile select', 'own profile update',
                       'own sessions', 'own messages')

  union all
  -- roles 가 {public} 이면 미인증에게도 열린다. 전부 {authenticated} 여야 한다.
  select 6, '정책 roles=authenticated',
         count(*)::text, '4'
  from pg_policies
  where schemaname = 'public'
    and policyname in ('own profile select', 'own profile update',
                       'own sessions', 'own messages')
    and roles = '{authenticated}'

  union all
  -- ⚠️ UPDATE/ALL 정책에 with_check 가 없으면 행의 user_id 를 타인으로
  --    재지정할 수 있다. qual 만 보고 넘어가면 놓치는 항목이다.
  select 7, 'with_check 있는 정책 3종',
         count(*)::text, '3'
  from pg_policies
  where schemaname = 'public'
    and policyname in ('own profile update', 'own sessions', 'own messages')
    and with_check is not null

  union all
  select 8, '정책에 auth.uid() 사용',
         count(*)::text, '4'
  from pg_policies
  where schemaname = 'public'
    and policyname in ('own profile select', 'own profile update',
                       'own sessions', 'own messages')
    and qual like '%auth.uid()%'


-- ── §3. 트리거·함수 ─────────────────────────────────────────────────────────

  union all
  -- auth.users 에 붙는 것 2종 + auth.identities 1종.
  -- handle_new_user 가 없으면 신규 가입자에게 profiles 행이 안 생겨
  -- 로그인은 되는데 앱이 빈 화면이 된다.
  select 9, 'auth 스키마 트리거 3종',
         count(*)::text, '3'
  from pg_trigger t
  join pg_class c     on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and not t.tgisinternal
    and t.tgname in ('on_auth_user_created_chatagent',
                     'on_auth_user_updated_chatagent',
                     'on_auth_identity_created_chatagent')

  union all
  select 10, 'public 트리거 3종',
         count(*)::text, '3'
  from pg_trigger t
  join pg_class c     on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
    and t.tgname in ('profiles_touch_updated_at',
                     'chat_sessions_touch_updated_at',
                     'chat_messages_bump_count')

  union all
  select 11, '함수 6종',
         count(*)::text, '6'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('handle_new_user', 'sync_profile_from_auth',
                      'sync_profile_from_identity', 'chatagent_is_default_avatar',
                      'touch_updated_at', 'bump_message_count')


-- ── §4. GRANT — RLS 와 별개의 축 ────────────────────────────────────────────
--
-- RLS 는 "어떤 행", GRANT 는 "테이블에 닿을 수 있는가". 둘 다 맞아야 한다.

  union all
  select 12, 'authenticated → sessions CRUD',
         count(*)::text, '4'
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated'
    and table_name = 'chat_sessions'
    and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')

  union all
  select 13, 'authenticated → messages CRUD',
         count(*)::text, '4'
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated'
    and table_name = 'chat_messages'
    and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')

  union all
  -- ⚠️ profiles 의 UPDATE 는 **컬럼 레벨**이어야 한다. 테이블 전체 UPDATE 를 주면
  --    사용자가 자기 message_count 를 0 으로, is_guest 를 false 로 되돌린다.
  --    RLS 는 "어떤 컬럼"은 못 막으므로 여기서만 걸러진다.
  select 14, 'profiles UPDATE = 컬럼 2개만',
         count(*)::text, '2'
  from information_schema.column_privileges
  where table_schema = 'public' and grantee = 'authenticated'
    and table_name = 'profiles' and privilege_type = 'UPDATE'
    and column_name in ('display_name', 'avatar_url')


-- ── §5. 스토리지 ────────────────────────────────────────────────────────────

  union all
  -- 버킷은 스키마와 별개다. 없으면 업로드가 전부 깨진다.
  -- (공개 버킷 자체는 IDOR-3 로 §5 에 남아 있는 별건 — 여기선 존재만 본다)
  select 15, '버킷 3종 public',
         count(*)::text, '3'
  from storage.buckets
  where id in ('chat-imgs', 'chat-videos', 'chat-docs') and public
)

select seq                                              as "#",
       item                                             as "항목",
       actual                                           as "실제",
       expected                                         as "기대",
       case when actual = expected then 'PASS'
            else '🔴 FAIL' end                          as "결과"
from checks
order by seq;


-- ── 결과 판정 ───────────────────────────────────────────────────────────────
--
--   전 항목 PASS  → 즉시 main 머지·배포로 진행
--   FAIL 하나라도 → 배포 중단. 원인 확인 후 재실행.
--
-- FAIL 이 났는데 원인이 불분명하면 롤백이 안전하다(cutover-prod.sql 하단 참조).
-- rename 을 되돌리면 구 앱이 그대로 살아난다 — 데이터는 그대로 있다.


-- ============================================================================
-- 참고 조회 — PASS/FAIL 로 두지 않은 것 (아래를 눈으로 본다)
--
-- 🔴 왜 자동 판정에서 뺐는가:
--    Supabase 는 프로젝트 생성 시 `alter default privileges in schema public
--    grant all on tables to anon, authenticated, service_role` 을 걸어둔다.
--    그래서 **새로 만든 테이블에 anon 권한이 자동으로 붙을 수 있다.**
--    schema.sql §4 주석은 "anon 에 아무것도 부여하지 않는다"고 적었지만,
--    그건 "명시적으로 grant 하지 않는다"는 뜻이지 "권한이 0"이라는 보장이 아니다.
--
--    기대값을 0 으로 박아두면 정상 상태에서도 FAIL 이 뜬다 — 유지보수 창에서
--    가짜 경보만큼 나쁜 게 없어서 자동 판정에서 뺐다.
--
--    anon 이 GRANT 를 갖더라도 **정책이 전부 `to authenticated`** 라 미인증은
--    행을 한 건도 못 본다(정책 없는 role = 전면 거부). 즉 보안은 RLS 가 잡는다.
--    다만 "GRANT 는 있고 RLS 가 꺼지는" 조합이 최악이므로 값은 봐 둔다.
-- ============================================================================

-- (가) 3개 테이블의 role 별 테이블 레벨 권한
--      판단: anon 행이 보여도 위 이유로 정상이다. 대신 §1 의 4번(RLS 켜짐)이
--            반드시 PASS 여야 한다 — 둘 중 하나라도 무너지면 전면 노출이다.
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('profiles', 'chat_sessions', 'chat_messages')
  and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- (나) profiles 의 UPDATE 가 어떤 컬럼까지 열려 있나
--      판단: display_name·avatar_url 외에 **message_count 나 is_guest 가 보이면
--            문제다.** 사용자가 자기 게스트 한도를 0 으로 되돌릴 수 있다.
--            RLS 는 "어떤 컬럼"을 못 막으므로 이 조회로만 걸러진다.
select column_name, grantee
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and privilege_type = 'UPDATE' and grantee in ('anon', 'authenticated')
order by grantee, column_name;
