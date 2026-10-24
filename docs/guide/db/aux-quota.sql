-- ============================================================================
-- 델타 — 보조 라우트 게스트 일일 한도 (PLAN_SECURITY_REVIEW_261023 #4)
--
-- auth-mvp-schema.sql + auth-mvp-guest-limit.sql 적용 후 실행.
-- 🔴 **앱 배포보다 먼저 적용한다.** 게스트 요청은 이 RPC 가 없으면 공급자를 부르지 않고 503 을 낸다(fail-closed).
--    회원은 RPC 를 부르지 않는다 — 적용 전 배포해도 회원 경로는 그대로다.
--
-- 왜 필요한가: fetch-url(ScrapingBee·browserless·OpenAI) · sync-drug-image(외부 다운로드 + 공용 Storage 쓰기)
--   · showtimes(browserless) 가 requireProfile 만 거친다. 익명 세션은 무료·자동 발급이라 인증만으로는
--   유료 호출 반복을 막지 못한다. 캐시 히트는 비용이 없어 세지 않는다 — 라우트가 캐시 미스 뒤에만 부른다.
--
-- 위협 모델은 tts-quota.sql 과 같다: 테이블은 RLS on·정책 없음 · 한도는 함수 안 상수 ·
--   종류는 화이트리스트 · 단일 upsert 조건부 갱신으로 원자 판정.
-- 남는 우회: 익명 계정을 계속 새로 만들면 계정마다 한도를 받는다. 최종 방어선은 공급자 월 예산 상한이다.
-- ============================================================================

create table if not exists public.aux_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind text not null,
  calls integer not null default 0 check (calls >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day, kind)
);

alter table public.aux_usage enable row level security;
revoke all on public.aux_usage from anon, authenticated;

-- 반환: { allowed, reason, used, limit }   reason: 'ok' | 'member' | 'unauthenticated' | 'invalid' | 'quota'
create or replace function public.consume_aux_quota(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  guest boolean;
  today date := (now() at time zone 'Asia/Seoul')::date;
  daily_limit integer;
  used integer;
begin
  if uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  -- 🔧 게스트 하루 한도(캐시 미스 호출 수). 약 답변 하나가 이미지 여러 장을 부른다.
  daily_limit := case p_kind
    when 'fetch_url' then 20
    when 'drug_image' then 60
    when 'showtimes' then 20
  end;
  if daily_limit is null then
    return jsonb_build_object('allowed', false, 'reason', 'invalid');
  end if;

  -- 프로필이 없으면 게스트로 본다(fail-closed). 회원은 세지 않는다.
  select coalesce(p.is_guest, true) into guest from public.profiles p where p.id = uid;
  if guest is not null and not guest then
    return jsonb_build_object('allowed', true, 'reason', 'member');
  end if;

  insert into public.aux_usage as u (user_id, day, kind, calls)
  values (uid, today, p_kind, 1)
  on conflict (user_id, day, kind) do update
     set calls = u.calls + 1, updated_at = now()
   where u.calls + 1 <= daily_limit
  returning u.calls into used;

  if used is null then
    return jsonb_build_object('allowed', false, 'reason', 'quota', 'used', daily_limit, 'limit', daily_limit);
  end if;
  return jsonb_build_object('allowed', true, 'reason', 'ok', 'used', used, 'limit', daily_limit);
end;
$$;

revoke execute on function public.consume_aux_quota(text) from public, anon;
grant execute on function public.consume_aux_quota(text) to authenticated;

-- ── 적용 후 확인 ────────────────────────────────────────────────────────────
-- 게스트 토큰: select public.consume_aux_quota('fetch_url');  -- {"allowed":true,"used":1,...}
-- 회원 토큰:   → {"allowed":true,"reason":"member"}
-- 잘못된 종류: select public.consume_aux_quota('x');            -- {"reason":"invalid"}
-- 오늘 사용량(관리자): select kind, count(*), sum(calls) from public.aux_usage
--   where day = (now() at time zone 'Asia/Seoul')::date group by kind;
