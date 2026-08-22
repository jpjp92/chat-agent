-- ============================================================================
-- 스토리지 버킷 — chat-imgs / chat-videos / chat-docs (공개)
--
-- 왜 필요한가: 인증 스키마(auth-mvp-schema.sql)는 테이블만 만든다. 버킷은 별개다.
-- 스테이징을 dev DB 로 승격하면(PLAN_AUTH_DEV_ROLLOUT_260716) 업로드 라우트가
-- 이 세 버킷을 참조하는데, 스테이징엔 없어서 dev 에서 업로드가 전부 깨진다.
--
-- 적용: 스테이징(ghdpnuwbvlrxmxcazzci) Supabase → SQL Editor → 전문 Run.
--       (대시보드 Storage → New bucket 으로 수동 생성해도 동일 — public 켜기만 하면 됨)
--
-- public = true 인 이유: 앱이 getPublicUrl 로 채팅 이미지를 렌더한다. 비공개면
-- 그 URL 이 400 → 이미지가 안 뜬다. 프로덕션도 같은 이유로 공개 버킷이다.
--
-- 🔴 보안 메모: 현재 업로드는 service_role(admin) 클라이언트라 object RLS 를 우회한다.
--    그래서 이 스크립트엔 storage 정책이 없다(있어도 admin 이 통과). 공개 버킷 +
--    무인증 라우트 = IDOR-3(TODO §보안). 이관의 blocker 는 아니지만, 근본해결 시
--    버킷을 비공개로 돌리고 유저별 prefix + storage 정책을 넣게 된다.
--
-- file_size_limit / allowed_mime_types 는 두지 않는다(무제한). 프로덕션이 특정
-- 제한을 걸어놨다면 아래 값을 그에 맞춰 채워 dev 를 동일하게 만든다.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('chat-imgs',   'chat-imgs',   true, null, null),
  ('chat-videos', 'chat-videos', true, null, null),
  ('chat-docs',   'chat-docs',   true, null, null)
on conflict (id) do update
  set public = excluded.public;   -- 이미 있으면 공개 여부만 맞춘다(비공개로 만들어졌을 때 교정)

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select id, public, file_size_limit, allowed_mime_types
--   from storage.buckets
--   where id in ('chat-imgs','chat-videos','chat-docs');
--   → 3행, public = true 여야 한다.
