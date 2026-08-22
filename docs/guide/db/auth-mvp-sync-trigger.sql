-- ============================================================================
-- 델타 — 익명→정식 승격 시 profiles 동기화 트리거
--
-- auth-mvp-schema.sql 를 이미 적용한 프로젝트에 추가로 실행한다.
-- (신규 설치는 auth-mvp-schema.sql 전문에 이미 포함돼 있으니 이 파일 불필요)
--
-- 배경: auth.users.is_anonymous 는 승격 시 false 로 바뀌지만 handle_new_user 는
--       INSERT 트리거라 profiles.is_guest 가 true 로 남는다(실측 확인).
--       클라이언트가 update 하게 두면 링크 직후 크래시·탭 종료 시 영구히 어긋난다.
--
-- 검증: npx tsx scripts/test-auth-identity.ts  → 10/10
-- ============================================================================

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
