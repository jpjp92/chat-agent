-- ============================================================================
-- 델타 — TTS 회원 일일 한도 + 게스트 차단 (PLAN_TTS_STREAMING_261002 §7)
--
-- auth-mvp-schema.sql + auth-mvp-guest-limit.sql 적용 후 실행.
-- 🔴 **앱 배포보다 먼저 적용한다.** /api/speech 는 이 RPC 가 없으면 공급자를 부르지 않고 500 을 낸다(fail-closed).
--
-- 왜 필요한가: /api/speech 가 유료 키(Gemini API_KEY_TIER1 / OpenAI)를 쓴다.
--   토큰 검증만으로는 부족하다 — 로그인한 사용자 하나가 반복 호출할 수 있다.
--   비용은 오디오 길이에 비례하므로 **호출 수가 아니라 글자 수**로 센다
--   (Gemini 3.1 TTS: 2000자 ≈ 280s ≈ 7000 오디오 토큰 ≈ $0.14).
--
-- 위협 모델 — guest-limit.sql 과 같은 함정을 피한다:
--   ① 사용자가 자기 사용량을 0 으로 고친다 → 테이블에 사용자 권한을 주지 않는다(RLS on, 정책 없음).
--      쓰기는 security definer RPC 만 한다.
--   ② RPC 인자로 한도를 받으면 사용자가 큰 값을 넘긴다 → 한도는 **함수 안의 상수**다.
--   ③ 음수 글자 수로 사용량을 되돌린다 → p_chars 를 1..2000 으로 검사한다.
--   ④ 동시 요청이 각자 "아직 여유 있음"을 읽고 둘 다 통과 → 단일 upsert 문의 조건부 갱신으로 원자적으로 판정한다.
--
-- 남는 우회: 익명 계정을 새로 만들어도 게스트라 TTS 를 못 쓴다. 회원 계정을 여러 개 만드는 것은
--            OAuth 가입 비용이 막는다 — 최종 방어선은 공급자 쪽 월 예산 상한이다.
-- ============================================================================

-- ── §1. 사용량 테이블 ──────────────────────────────────────────────────────

create table if not exists public.tts_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 한국 날짜 기준으로 리셋한다(서비스 사용자 기준 "오늘")
  day date not null,
  chars integer not null default 0 check (chars >= 0),
  calls integer not null default 0 check (calls >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- RLS 를 켜고 정책을 두지 않는다 → authenticated/anon 은 읽기·쓰기 모두 불가. RPC 만 접근한다.
alter table public.tts_usage enable row level security;
revoke all on public.tts_usage from anon, authenticated;


-- ── §2. 원자적 소비 RPC ────────────────────────────────────────────────────
--
-- 반환: { allowed, reason, used, limit }
--   reason: 'ok' | 'unauthenticated' | 'guest' | 'quota' | 'invalid'
-- 호출: 유저 토큰의 Supabase 클라이언트로 db.rpc('consume_tts_quota', { p_chars })
--       — PostgREST 가 JWT 서명을 검증하므로 위조 토큰은 여기 오기 전에 401 이다.

create or replace function public.consume_tts_quota(p_chars integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 🔧 회원 하루 한도(글자). 2000자 읽기 10회 ≈ Gemini $1.4/일/회원 최악.
  daily_limit constant integer := 20000;
  uid uuid := auth.uid();
  guest boolean;
  today date := (now() at time zone 'Asia/Seoul')::date;
  used integer;
begin
  if uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;
  if p_chars is null or p_chars < 1 or p_chars > 2000 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid');
  end if;

  -- is_guest 는 컬럼 GRANT 로 사용자가 못 고친다(guest-limit.sql §2) — 판정에 써도 안전하다.
  -- 프로필이 없으면 게스트로 본다(fail-closed).
  select coalesce(p.is_guest, true) into guest from public.profiles p where p.id = uid;
  if guest is null or guest then
    return jsonb_build_object('allowed', false, 'reason', 'guest');
  end if;

  -- 한 문장으로 "여유가 있으면 더하고, 없으면 아무것도 안 한다". 동시 요청도 행 잠금으로 직렬화된다.
  insert into public.tts_usage as u (user_id, day, chars, calls)
  values (uid, today, p_chars, 1)
  on conflict (user_id, day) do update
     set chars = u.chars + excluded.chars,
         calls = u.calls + 1,
         updated_at = now()
   where u.chars + excluded.chars <= daily_limit
  returning u.chars into used;

  -- 첫 행 삽입 자체가 한도를 넘는 경우(p_chars ≤ 2000 이라 실제로는 없지만 상수를 바꿀 때를 대비)
  if used is not null and used > daily_limit then
    delete from public.tts_usage where user_id = uid and day = today and calls = 1;
    used := null;
  end if;

  if used is null then
    select u.chars into used from public.tts_usage u where u.user_id = uid and u.day = today;
    return jsonb_build_object('allowed', false, 'reason', 'quota', 'used', coalesce(used, 0), 'limit', daily_limit);
  end if;

  return jsonb_build_object('allowed', true, 'reason', 'ok', 'used', used, 'limit', daily_limit);
end;
$$;

-- 기본 PUBLIC 실행 권한을 걷고 로그인 사용자만 부르게 한다.
revoke execute on function public.consume_tts_quota(integer) from public, anon;
grant execute on function public.consume_tts_quota(integer) to authenticated;


-- ── §3. 적용 후 확인 ────────────────────────────────────────────────────────
--
-- 사용자가 테이블을 못 보는지 (빈 결과 또는 permission denied 여야 함):
--   -- 유저 토큰으로: select * from tts_usage;
--
-- 회원 토큰으로 두 번 호출하면 used 가 누적되는지:
--   select public.consume_tts_quota(500);  -- {"allowed":true,"used":500,...}
--   select public.consume_tts_quota(500);  -- {"allowed":true,"used":1000,...}
--
-- 게스트 토큰 → {"allowed":false,"reason":"guest"}
-- 오늘 사용량 보기(관리자): select * from public.tts_usage where day = (now() at time zone 'Asia/Seoul')::date;
