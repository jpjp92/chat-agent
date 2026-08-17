-- ============================================================================
-- Storage RLS — 유저별 prefix 강제 (IDOR-3 Phase 1)
--
-- 왜: 2026-08-17 점검에서 `/api/upload`·`/api/create-signed-url`·`/api/parse-document`
--     세 라우트에 **인증이 전혀 없었다**(grep 결과 0건). service_role 클라이언트를 쓰고
--     있어서 누구나 공개 버킷에 파일을 쌓을 수 있었다 — IDOR 가 아니라 **열린 업로드**였다.
--     라우트를 user-scoped 클라이언트로 바꿨으므로, 이제 DB 가 소유권을 강제한다.
--
-- 경로 규약: `${auth.uid()}/${timestamp}_${safeName}.ext`
--            정책은 첫 폴더 세그먼트만 본다 — `(storage.foldername(name))[1]`.
--
-- ⚠️ 버킷은 **공개 유지**다(Phase 1). `chat_messages.attachment_url` 에 `getPublicUrl` 결과가
--    저장돼 있어, 비공개로 돌리면 **기존 대화의 이미지가 전부 400** 이 된다. 비공개 전환은
--    서명 다운로드 URL + 기존 행 백필이 필요한 별개 작업이다(Phase 2).
--    따라서 이 정책이 막는 것은 **쓰기·덮어쓰기·열거**이지, "URL 을 아는 제3자의 읽기"가 아니다.
--
-- 🔴 적용 순서 — **SQL 을 먼저, 배포를 나중에.**
--    라우트가 service_role → user-scoped 로 바뀌면 RLS 를 타게 되는데, `storage.objects` 는
--    RLS 가 켜져 있고 이 버킷들에 대한 정책이 **하나도 없다**. 코드를 먼저 배포하면
--    모든 업로드가 거부된다. 반대 순서(SQL 먼저)는 안전하다 — 구 코드는 admin 이라 정책을 우회한다.
--
--    1) 이 스크립트 Run  →  2) dev 배포  →  3) 업로드 실측  →  4) 프로덕션도 같은 순서
--
-- 적용: Supabase → SQL Editor → 전문 Run.
-- ============================================================================

-- storage.objects 의 RLS 는 Supabase 가 **기본 활성화**해 둔다. 호스티드에서는 소유자가 아니라
-- `alter table` 이 거부될 수 있으므로 시도만 하고 실패는 무시한다(이미 켜져 있으면 그대로 진행).
do $$
begin
  execute 'alter table storage.objects enable row level security';
exception when insufficient_privilege or others then
  raise notice 'storage.objects RLS 변경 생략 (이미 활성화돼 있거나 권한 없음)';
end $$;

do $$
declare b text;
begin
  foreach b in array array['chat-imgs','chat-videos','chat-docs'] loop
    -- 재실행 가능하게 먼저 지운다
    execute format('drop policy if exists %I on storage.objects', b || '_own_insert');
    execute format('drop policy if exists %I on storage.objects', b || '_own_update');
    execute format('drop policy if exists %I on storage.objects', b || '_own_delete');
    execute format('drop policy if exists %I on storage.objects', b || '_own_select');

    -- INSERT: 자기 폴더에만 올릴 수 있다
    execute format($f$
      create policy %I on storage.objects for insert to authenticated
      with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)
    $f$, b || '_own_insert', b);

    -- UPDATE: upsert 경로. 자기 파일만 덮어쓴다
    execute format($f$
      create policy %I on storage.objects for update to authenticated
      using      (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)
    $f$, b || '_own_update', b, b);

    -- DELETE: 자기 파일만
    execute format($f$
      create policy %I on storage.objects for delete to authenticated
      using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)
    $f$, b || '_own_delete', b);

    -- SELECT: 자기 파일 + **레거시 평면 경로**.
    --   레거시(`1234567890_name.ext`)는 무인증 시절 파일이라 소유자를 알 수 없다. 이관이
    --   불가능하고, 막으면 과거 대화의 문서 파싱이 깨진다 → 읽기만 허용한다.
    --   `storage.foldername()` 은 폴더가 없으면 빈 배열이라 [1] 이 null 이다. 그걸로 구분한다.
    --   🔴 이 조항은 Phase 2(비공개 전환) 때 재검토한다 — 그때는 백필로 소유자를 붙일 수 있다.
    execute format($f$
      create policy %I on storage.objects for select to authenticated
      using (
        bucket_id = %L
        and (
          (storage.foldername(name))[1] = auth.uid()::text
          or (storage.foldername(name))[1] is null   -- 레거시 평면 경로(읽기 전용)
        )
      )
    $f$, b || '_own_select', b);
  end loop;
end $$;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   order by policyname;
--   → 버킷 3개 × 4개 = 12행이 보여야 한다.
--
-- ── 수동 검증 (앱에서) ───────────────────────────────────────────────────────
--   1) 로그인 상태로 파일 업로드 → 성공, 경로가 `<uuid>/…` 인지 확인
--        select name from storage.objects where bucket_id='chat-imgs' order by created_at desc limit 3;
--   2) 토큰 없이 업로드 시도 → 401 (라우트가 막는다). 앱이 실제로 쓰는 경로로 확인한다.
--        curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<host>/api/create-signed-url \
--             -H 'content-type: application/json' -d '{"fileName":"a.hwp","bucket":"chat-docs"}'
--   3) 과거 대화의 이미지가 여전히 보이는지 (레거시 경로 + 공개 버킷)
