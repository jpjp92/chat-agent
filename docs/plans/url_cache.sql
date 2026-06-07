-- url_cache: Cloudflare-blocked URL fetch 결과 캐시 (browserless/scraperapi 비용 절약)
-- 적용: Supabase Dashboard > SQL Editor 에 붙여넣고 실행
-- 근거: docs/logs/DEV_260606.md §11

create table if not exists public.url_cache (
  url_key    text primary key,                 -- 정규화된 URL (fragment 제거)
  content    text not null,                    -- 추출된 본문
  status     text not null default 'ok',       -- 'ok' (성공만 저장)
  provider   text,                             -- 'browserless' | 'scraperapi' | 'jina' | 'direct'
  fetched_at timestamptz not null default now()
);

-- TTL 정리는 애플리케이션에서 fetched_at 기준으로 판정(기본 14일).
-- 필요 시 오래된 행 수동/크론 정리:
--   delete from public.url_cache where fetched_at < now() - interval '30 days';
