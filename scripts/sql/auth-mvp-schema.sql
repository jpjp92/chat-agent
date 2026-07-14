-- ============================================================================
-- 인증 MVP 스키마 — profiles / chat_sessions / chat_messages + RLS
-- 설계: docs/plans/PLAN_AUTH_MVP_260709.md §3
-- 검증: docs/plans/PLAN_AUTH_MVP_TEST_260709.md §3 (RLS 매트릭스 18케이스)
--
-- 적용: Supabase 대시보드 → SQL Editor에 전문 붙여넣기 → Run
-- 대상: 스테이징(ghdpnuwbvlrxmxcazzci) 먼저. 프로덕션은 §0 주석 참조.
--
-- 선행: 대시보드에서 Anonymous Sign-ins + Manual Linking 활성화
-- ============================================================================

-- ── §0. 프로덕션 적용 시에만 (스테이징은 빈 프로젝트라 불필요) ──────────────
-- 클린 스타트: 기존 테이블을 지우지 말고 rename 해서 백업으로 남긴다.
--
--   alter table public.chat_messages rename to chat_messages_legacy;
--   alter table public.chat_sessions rename to chat_sessions_legacy;
--   alter table public.users         rename to users_legacy;
--
-- 되돌릴 일이 없다고 확신할 때까지 drop 하지 않는다.
-- ---------------------------------------------------------------------------


-- ── §1. 테이블 ──────────────────────────────────────────────────────────────

-- profiles: auth.users 와 1:1. 로그인 식별자는 auth 가 담당하고 여기엔 표시 정보만.
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default '사용자',
  avatar_url    text,
  is_guest      boolean not null default true,   -- 트리거만 기록(§4 컬럼 GRANT)
  message_count integer not null default 0,      -- 증가 전용. 게스트 횟수 제한용.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- chat_sessions: user_id 를 DB 가 채운다 (default auth.uid()).
-- 덕분에 API 라우트는 유저 id 를 몰라도 되고, getUser() 왕복이 사라진다.
create table public.chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null default 'New Chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.chat_sessions(id) on delete cascade,
  role              text not null check (role in ('user', 'assistant')),
  content           text not null,
  attachment_url    text,
  grounding_sources jsonb,
  created_at        timestamptz not null default now()
);

-- 사이드바 정렬(updated_at desc) / 메시지 조회(created_at asc) 경로
create index chat_sessions_user_updated_idx on public.chat_sessions (user_id, updated_at desc);
create index chat_messages_session_created_idx on public.chat_messages (session_id, created_at);


-- ── §2. 트리거 ──────────────────────────────────────────────────────────────

-- auth.users insert 시 프로필 자동 생성.
-- security definer: RLS 를 우회해 insert 해야 하므로 필요. search_path='' 로 고정하고
-- 모든 객체를 스키마 수식해 search_path 하이재킹을 막는다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, is_guest)
  values (
    new.id,
    -- 게스트: raw_user_meta_data 가 비어 폴백. Google: name/avatar 자동 채움.
    coalesce(
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      '사용자_' || upper(substr(md5(random()::text), 1, 4))
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;   -- 재실행 안전
  return new;
end;
$$;

-- 이름에 앱을 박아 다른 앱과의 충돌을 피한다 (표준 예제명 on_auth_user_created 회피).
drop trigger if exists on_auth_user_created_chatagent on auth.users;
create trigger on_auth_user_created_chatagent
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 익명 → 정식 승격(linkIdentity/updateUser) 시 profiles 동기화.
--
-- 왜 트리거인가: auth.users.is_anonymous 는 승격 시 false 로 바뀌지만,
-- 위 트리거는 INSERT 에만 걸려 있어 profiles.is_guest 는 true 로 남는다(실측 확인).
-- 이걸 클라이언트가 update 하게 두면, 링크 직후 크래시·탭 종료 시 영구히 어긋난다.
-- DB 가 원천(auth.users)과 사본(profiles)을 같은 트랜잭션에서 맞추면 그 창이 사라진다.
create or replace function public.sync_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p set
    is_guest = coalesce(new.is_anonymous, false),

    -- 사용자가 직접 바꾼 이름은 보존한다. 아직 자동 생성 폴백('사용자' / '사용자_XXXX')
    -- 상태일 때만 OAuth 프로필 이름으로 채운다.
    display_name = case
      when p.display_name ~ '^사용자(_[A-Z0-9]{4})?$' then
        coalesce(
          nullif(new.raw_user_meta_data ->> 'name', ''),
          nullif(new.raw_user_meta_data ->> 'full_name', ''),
          p.display_name
        )
      else p.display_name
    end,

    -- 커스텀 아바타를 덮지 않는다. 비어 있을 때만 채운다.
    avatar_url = coalesce(p.avatar_url, new.raw_user_meta_data ->> 'avatar_url')
  where p.id = new.id;

  return new;
end;
$$;

-- WHEN 절이 없으면 로그인마다(last_sign_in_at 갱신) 불필요하게 발화한다.
drop trigger if exists on_auth_user_updated_chatagent on auth.users;
create trigger on_auth_user_updated_chatagent
  after update on auth.users
  for each row
  when (
    old.is_anonymous is distinct from new.is_anonymous
    or old.raw_user_meta_data is distinct from new.raw_user_meta_data
  )
  execute function public.sync_profile_from_auth();


-- 🔴 위 트리거만으로는 부족하다 — **linkIdentity 는 raw_user_meta_data 를 채우지 않는다.**
-- 실측(2026-07-13, 실제 Google 링크):
--     identities   : [{ provider: "google", name: "Juan Park", ... }]
--     user_metadata: { "email_verified": true }        ← 이름도 아바타도 없다
-- is_guest 는 is_anonymous 변화로 뒤집히지만 이름·아바타는 게스트 값 그대로 남는다.
-- provider 정보의 원천은 auth.identities.identity_data 다. 거기를 본다.
create or replace function public.chatagent_is_default_avatar(url text)
returns boolean
language sql
immutable
as $$
  -- 클라이언트(useAuthSession)가 저장하는 게스트 기본 아바타.
  -- null 과 함께 "사용자가 고르지 않은 값"으로 취급해 OAuth 사진으로 덮는다.
  select url is null
      or url like 'https://images.unsplash.com/photo-1591160690555%';
$$;

create or replace function public.sync_profile_from_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p set
    is_guest = false,

    display_name = case
      when p.display_name ~ '^사용자(_[A-Z0-9]{4})?$' then
        coalesce(
          nullif(new.identity_data ->> 'full_name', ''),
          nullif(new.identity_data ->> 'name', ''),
          p.display_name
        )
      else p.display_name
    end,

    avatar_url = case
      when public.chatagent_is_default_avatar(p.avatar_url) then
        coalesce(
          nullif(new.identity_data ->> 'avatar_url', ''),
          nullif(new.identity_data ->> 'picture', ''),
          p.avatar_url
        )
      else p.avatar_url
    end,

    updated_at = now()
  where p.id = new.user_id;

  return new;
end;
$$;

-- 익명 유저는 identities 행 자체가 없다 → 실제 provider 연결에만 발화한다.
drop trigger if exists on_auth_identity_created_chatagent on auth.identities;
create trigger on_auth_identity_created_chatagent
  after insert on auth.identities
  for each row
  execute function public.sync_profile_from_identity();


-- updated_at 자동 갱신 (사이드바 정렬 기준)
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger chat_sessions_touch_updated_at
  before update on public.chat_sessions
  for each row execute function public.touch_updated_at();


-- 게스트 횟수 제한용 카운터. **증가 전용** — 메시지·세션을 지워도 줄지 않는다.
-- (메시지를 세는 방식이면 세션 삭제로 리셋되어 제한이 무의미해진다.)
create or replace function public.bump_message_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'user' then
    update public.profiles p
       set message_count = p.message_count + 1
     where p.id = (
       select s.user_id from public.chat_sessions s where s.id = new.session_id
     );
  end if;
  return new;
end;
$$;

create trigger chat_messages_bump_count
  after insert on public.chat_messages
  for each row execute function public.bump_message_count();


-- ── §3. RLS ────────────────────────────────────────────────────────────────
--
-- ⚠️ 익명 유저도 Postgres 'authenticated' 롤을 갖는다.
--    → auth.role() = 'authenticated' 검사는 익명까지 통과시켜 무의미.
--    → 반드시 `to authenticated` + 소유권 술어(auth.uid() = user_id) 조합.
--    → `to authenticated` 만 쓰면 인증만 하고 인가는 안 하는 IDOR.
--
-- ⚠️ UPDATE 는 USING 뿐 아니라 WITH CHECK 도 필수.
--    없으면 행의 user_id 를 타인으로 재지정할 수 있다.
--
-- ⚠️ auth.uid() 를 (select auth.uid()) 로 감싸면 플랜당 1회만 평가된다(성능).

alter table public.profiles      enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- profiles: 본인 행만. insert 는 트리거(security definer)가 담당 → 정책 없음.
create policy "own profile select" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "own profile update" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);   -- id 변조 차단

-- chat_sessions: 본인 세션만 CRUD
create policy "own sessions" on public.chat_sessions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- chat_messages: 소속 세션이 본인 것일 때만
create policy "own messages" on public.chat_messages
  for all to authenticated
  using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = (select auth.uid())
    )
  );


-- ── §4. GRANT ───────────────────────────────────────────────────────────────
--
-- RLS 는 "어떤 행"을 통제하고, GRANT 는 "테이블에 닿을 수 있는가"를 통제한다.
-- 둘은 별개다. GRANT 가 없으면 정책이 옳아도 전면 거부되고,
-- 그러면 RLS 음성 테스트가 "엉뚱한 이유로" 통과한다(거짓 통과).
--
-- anon(미인증)에는 아무것도 부여하지 않는다 → 접근 시 permission denied.

grant usage on schema public to authenticated;

-- profiles 의 UPDATE 는 **컬럼 레벨**로 좁힌다.
-- RLS 는 "어떤 행"만 통제하고 "어떤 컬럼"은 못 막는다. 테이블 전체 UPDATE 를 주면
-- 사용자가 자기 행의 message_count 를 0 으로, is_guest 를 false 로 되돌린다.
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

grant select, insert, update, delete on public.chat_sessions to authenticated;
grant select, insert, update, delete on public.chat_messages to authenticated;


-- ── §5. 적용 후 확인 ────────────────────────────────────────────────────────
--
-- RLS 켜짐 여부:
--   select tablename, rowsecurity from pg_tables where schemaname = 'public';
--
-- 정책 목록 (roles 에 {authenticated}, qual 에 auth.uid() 가 보여야 함):
--   select tablename, policyname, roles, cmd, qual, with_check
--   from pg_policies where schemaname = 'public' order by tablename, cmd;
--
-- auth.users 트리거 (on_auth_user_created_chatagent 하나만 있어야 함):
--   select tgname from pg_trigger t
--     join pg_class c on c.oid = t.tgrelid
--     join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal;
--
-- 그 다음: npx tsx scripts/test-auth-rls.ts  (18/18 통과해야 함)
