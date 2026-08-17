-- url_cache — URL 프리페치 결과 캐시 (browserless/ScrapingBee/ScraperAPI 유닛 절약)
--
-- 🔴 이 파일이 왜 다시 생겼나 (2026-08-17)
--   원본 `supabase/migrations/url_cache.sql` 은 2026-06-06 에 만들어 실행됐지만,
--   2026-06-26 에 **레포에서 삭제**됐다(REF_DB.md 문서화로 대체).
--   그 뒤 인증 MVP 가 **빈 Supabase 프로젝트**를 새로 세웠는데(`auth-mvp-cutover-prod.sql` §11-12),
--   `auth-mvp-schema.sql` 이 만드는 건 profiles·chat_sessions·chat_messages **3개뿐**이라
--   `url_cache` 가 따라오지 못했다. 실측 2026-08-17: dev 에 테이블이 **없다**.
--
--   → 교훈: **스키마의 출처가 문서뿐이면 새 환경에서 재현되지 않는다.**
--     문서는 읽어야 알지만, `scripts/sql/` 에 있으면 순서대로 실행된다.
--
-- 🔴 왜 아무도 몰랐나 — `app/api/fetch-url/route.ts` 가 실패를 완전히 삼킨다.
--   `getCached`: `if (error || !data) return null` → **테이블 없음과 캐시 미스가 구분되지 않는다**
--   `setCached`: upsert 의 반환 `error` 를 읽지 않는다
--   결과: 기능은 멀쩡히 동작하고 **매 요청이 유료 스크래퍼를 태운다**(browserless 1000 units/월, 회당 ~2).
--
-- 적용: Supabase SQL Editor 에서 실행. 멱등이므로 재실행해도 안전하다.

create table if not exists public.url_cache (
  url_key    text primary key,          -- 정규화된 URL(fragment 제거) — route.ts `normalizeKey`
  content    text not null,             -- 추출된 본문
  status     text not null default 'ok',-- 성공 응답만 저장한다
  provider   text,                      -- direct | scrapingbee | scrapingbee-static | browserless | scraperapi
  fetched_at timestamptz not null default now()
);

-- TTL 14일은 **애플리케이션에서 판정한다**(route.ts `CACHE_TTL_MS`). DB 에는 만료 장치가 없다.
-- 오래된 행은 수동 정리: delete from public.url_cache where fetched_at < now() - interval '30 days';
create index if not exists url_cache_fetched_at_idx on public.url_cache (fetched_at);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- 🔴 **의도적으로 켜고, 정책을 만들지 않는다.**
--
--   이 테이블은 유저 데이터가 아니라 **공유 캐시**라 `auth.uid()` 기준으로 나눌 수가 없다.
--   그렇다고 anon/authenticated 에 INSERT 를 열면 **캐시 오염**이 된다 —
--   임의의 `url_key` 에 원하는 본문을 넣어두면 앱이 그걸 "페이지 원문"으로 믿고
--   모델에게 주입한다. 즉 **간접 프롬프트 인젝션 경로**가 열린다.
--
--   정책이 없으면 anon/authenticated 는 전부 거부되고 `service_role` 만 통과한다
--   (service_role 은 RLS 를 우회한다). 이 라우트는 서버 전용이므로 그게 맞다.
--
-- ⚠️ 따라서 **`SUPABASE_SERVICE_ROLE_KEY` 를 지우면 캐시가 죽는다.**
--    `server/supabase.ts` 가 `supabaseAdmin ?? supabase` 폴백이라 조용히 anon 으로 강등되고,
--    route 가 error 를 안 읽으므로 **에러도 안 난다.**
--    [PLAN_INDEX](../../docs/plans/PLAN_INDEX.md) 0-B 는 그 키의 **삭제**를 지시하는데,
--    본래 이유는 "스테이징 값이 main 에 들어갔다"는 것이므로 **삭제가 아니라 교체**가 맞다.
alter table public.url_cache enable row level security;

-- ── 검증 ───────────────────────────────────────────────────────────────────
-- select relrowsecurity from pg_class where relname = 'url_cache';        -- t
-- select count(*) from pg_policies where tablename = 'url_cache';         -- 0 (의도된 값)
