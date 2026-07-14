-- ============================================================================
-- 델타 — 게스트 메시지 횟수 제한 (변조 불가 카운터)
--
-- auth-mvp-schema.sql + auth-mvp-sync-trigger.sql 적용 후 실행.
-- 검증: npx tsx scripts/test-auth-limit.ts
--
-- 왜 필요한가: 무료 Gemini 키의 일일 할당량(RPD)을 익명 유저가 소진하면
--              소유자 본인이 24시간 못 쓴다(DEV_260624 §7 실제 발생).
--              게이팅의 1차 목적은 회원 전환이 아니라 할당량 방어다.
--
-- 위협 모델 — 순진하게 구현하면 다음 두 가지로 즉시 뚫린다:
--   ① 메시지를 세면 → 세션을 지우고 다시 시작하면 리셋된다.
--   ② 카운터를 profiles 컬럼에 두면 → RLS 는 컬럼 단위를 막지 못하므로
--      사용자가 자기 행의 message_count 를 0 으로 UPDATE 한다.
--
-- 대응:
--   ① 카운터는 INSERT 트리거로만 증가한다. 메시지·세션을 지워도 줄지 않는다.
--   ② 컬럼 레벨 GRANT 로 사용자의 UPDATE 대상을 display_name/avatar_url 로 좁힌다.
--
-- 남는 우회: 브라우저 저장소를 비우면 새 익명 유저 = 새 할당량.
--            Supabase 의 익명 가입 제한(IP당 시간당 30회)이 폭발 반경을 잡는다.
--            **벽이 아니라 과속방지턱이다.** 남용이 관측되면 CAPTCHA(Turnstile)를 켠다.
-- ============================================================================

-- ── §1. 카운터 컬럼 ─────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists message_count integer not null default 0;


-- ── §2. 컬럼 레벨 GRANT — 사용자가 카운터를 못 건드리게 ──────────────────────
--
-- RLS 는 "어떤 행"만 통제한다. "어떤 컬럼"은 GRANT 의 영역이다.
-- 기존 `grant update on public.profiles` 는 전 컬럼을 열어줬다.

revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- 부수 효과(중요): 이제 message_count 와 is_guest 는 **트리거만** 쓸 수 있다.
-- 따라서 is_guest 를 서버 게이팅 판단에 써도 안전해진다(이전엔 표시 전용이었다).


-- ── §3. 증가 전용 트리거 ────────────────────────────────────────────────────
--
-- role='user' 인 메시지가 들어올 때만 센다. assistant 응답은 세지 않는다.
-- security definer: profiles 의 UPDATE 권한이 authenticated 에겐 없으므로 필요.

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

drop trigger if exists chat_messages_bump_count on public.chat_messages;
create trigger chat_messages_bump_count
  after insert on public.chat_messages
  for each row execute function public.bump_message_count();


-- ── §4. 적용 후 확인 ────────────────────────────────────────────────────────
--
-- 사용자가 카운터를 못 고치는지 (permission denied 여야 함):
--   -- 유저 토큰으로: update profiles set message_count = 0 where id = auth.uid();
--
-- 컬럼 권한 확인:
--   select column_name, privilege_type
--     from information_schema.column_privileges
--    where table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE';
--   -- display_name, avatar_url 두 줄만 나와야 한다.
--
-- 그 다음: npx tsx scripts/test-auth-limit.ts
