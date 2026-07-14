-- ============================================================================
-- 델타 — linkIdentity 로 붙은 OAuth 프로필을 profiles 에 반영
--
-- auth-mvp-schema.sql + auth-mvp-sync-trigger.sql 를 적용한 프로젝트에 추가 실행.
--
-- 🔴 배경 (2026-07-13, 실제 Google 링크에서 발견한 버그)
--
--   기존 트리거들은 auth.users.raw_user_meta_data 에서 name/avatar 를 읽는다.
--   그런데 **linkIdentity 는 그 컬럼을 채우지 않는다.** 실측:
--
--     identities   : [{ provider: "google", name: "Juan Park", ... }]
--     user_metadata: { "email_verified": true }        ← 이름도 아바타도 없다
--
--   그래서 is_guest 는 false 로 잘 뒤집혔지만 이름은 '사용자_FF8F',
--   아바타는 게스트 시절 기본 이미지 그대로 남았다.
--
--   provider 정보의 진짜 출처는 auth.identities.identity_data 다. 거기를 본다.
--
--   신원 스위트(10/10)가 이걸 놓친 이유: admin.createUser({ user_metadata }) 는
--   **신규 가입** 경로의 형태를 만든다. 기존 유저에 신원을 덧붙이는 링크 경로는
--   메타데이터가 다르게 채워진다. 실제 OAuth 리다이렉트로만 드러나는 차이였다.
-- ============================================================================

-- 게스트 기본 아바타 — 클라이언트가 이 URL 을 profiles 에 저장해 둔다(useAuthSession).
-- null 과 함께 "사용자가 고르지 않은 값"으로 취급해 OAuth 사진으로 덮는다.
-- 사용자가 직접 넣은 아바타는 건드리지 않는다.
create or replace function public.chatagent_is_default_avatar(url text)
returns boolean
language sql
immutable
as $$
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
    -- 신원이 붙었다는 건 더 이상 게스트가 아니라는 뜻이다.
    -- (auth.users.is_anonymous 갱신 트리거와 중복이지만, 순서에 의존하지 않으려 여기서도 못박는다.)
    is_guest = false,

    -- 사용자가 직접 바꾼 이름은 보존한다. 폴백('사용자' / '사용자_XXXX') 일 때만 덮는다.
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

-- 익명 유저는 identities 행 자체가 없다 → 이 트리거는 실제 provider 연결에만 발화한다.
drop trigger if exists on_auth_identity_created_chatagent on auth.identities;
create trigger on_auth_identity_created_chatagent
  after insert on auth.identities
  for each row
  execute function public.sync_profile_from_identity();

-- ---------------------------------------------------------------------------
-- 백필 — 트리거 생기기 전에 이미 링크된 유저 (INSERT 트리거라 소급 발화하지 않는다)
-- ---------------------------------------------------------------------------
update public.profiles p set
  is_guest = false,
  display_name = case
    when p.display_name ~ '^사용자(_[A-Z0-9]{4})?$' then
      coalesce(
        nullif(i.identity_data ->> 'full_name', ''),
        nullif(i.identity_data ->> 'name', ''),
        p.display_name
      )
    else p.display_name
  end,
  avatar_url = case
    when public.chatagent_is_default_avatar(p.avatar_url) then
      coalesce(
        nullif(i.identity_data ->> 'avatar_url', ''),
        nullif(i.identity_data ->> 'picture', ''),
        p.avatar_url
      )
    else p.avatar_url
  end,
  updated_at = now()
from auth.identities i
where i.user_id = p.id
  and i.provider <> 'email';
