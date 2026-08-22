-- mfds_pills — 식약처 낱알 식별 정보 로컬 사본 (이미지 약품 식별 1순위 경로)
--
-- 🔴 이 파일이 왜 생겼나 (2026-08-17)
--   이 DDL 은 여태 `docs/guide/db/sync-mfds-pills.mjs` **상단 주석 안에만** 있었고,
--   그 파일은 `.gitignore` 의 `scripts/sync-*` 에 걸려 **레포에 없었다.**
--   REF_DB.md 에도 이 테이블 항목이 없었다 → **스키마의 출처가 어디에도 없었다.**
--
--   실측 2026-08-17: dev DB(poc-test)에 이 테이블이 **없다.** main(PoC-prd)에는 있다.
--   인증 MVP 가 빈 프로젝트를 새로 세울 때 `auth-mvp-schema.sql` 이 만드는 3개만 따라왔다.
--   → `url_cache` 와 **똑같은 사고**이고, 이쪽이 더 나쁘다(문서에도 없었으므로).
--
-- 🔴 왜 아무도 몰랐나 — 실패가 조용하다.
--   `server/mfds-logic.ts` 는 `const { data } = await supabase.from('mfds_pills')...` 로
--   **`error` 를 버린다.** 테이블이 없어도 `data` 가 null 일 뿐이라 3단계를 전부 통과해
--   `match_type: 'none'` 을 반환한다. **예외가 안 나므로** `identifyPillTool` 의 catch 도
--   안 걸리고, 조용히 2순위 pharm.or.kr 스크래핑으로 내려간다.
--   ⚠️ 스크래핑까지 실패하면 *"시각적 유사성을 기반으로 답변하되…"* 경로다 —
--      **H그룹에서 잡았던 약품명 날조 자리**다.
--
-- 적용:
--   ① 이 파일을 Supabase SQL Editor 에서 실행(멱등)
--   ② 데이터 적재: `node docs/guide/db/sync-mfds-pills.mjs`
--      (`.env.local` 에서 MFDS_API_KEY·MFDS_API_ENDPOINT·SUPABASE_URL·SUPABASE_KEY 를 읽는다)
--      먼저 `--count` 로 총 건수, `--dry-run` 으로 파싱만 확인할 수 있다.

create table if not exists public.mfds_pills (
  item_seq             text primary key,  -- 품목일련번호
  item_name            text,              -- 품목명
  entp_name            text,              -- 업체명
  chart                text,              -- 성상
  drug_shape           text,              -- 모양 (장방형, 원형 …)
  color_class1         text,              -- 색상앞 (노랑, 하양 …)
  color_class2         text,              -- 색상뒤
  form_code_name       text,              -- 제형 (필름코팅정, 캡슐 …)
  mark_code_front_anal text,              -- 앞면 각인 텍스트 (쉼표 구분 변형 포함)
  mark_code_back_anal  text,              -- 뒷면 각인 텍스트
  mark_codes           text[],            -- 정규화된 각인 변형 배열 (GIN 인덱스용)
  item_image           text,              -- 약품 이미지 URL
  mark_code_front_img  text,              -- 앞면 각인 이미지 URL
  mark_code_back_img   text,              -- 뒷면 각인 이미지 URL
  class_name           text,              -- 분류명
  etc_otc_name         text,              -- 전문/일반 구분
  leng_long            text,              -- 장축(mm)
  leng_short           text,              -- 단축(mm)
  thick                text,              -- 두께(mm)
  synced_at            timestamptz default now()
);

-- 각인 배열 GIN — **각인 검색의 핵심**이다. `mfds-logic.ts` 의 `.overlaps('mark_codes', …)` 가 탄다.
create index if not exists idx_mfds_pills_mark_codes on public.mfds_pills using gin (mark_codes);

-- 3단계(각인 무관, 색상+모양) 대응
create index if not exists idx_mfds_pills_color on public.mfds_pills (color_class1);
create index if not exists idx_mfds_pills_shape on public.mfds_pills (drug_shape);
create index if not exists idx_mfds_pills_name  on public.mfds_pills (item_name);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- 🔴 `url_cache` 와 같은 판단: **켜고 정책을 두지 않는다** → `service_role` 만 통과.
--   식약처 공개 데이터라 기밀은 아니지만, **쓰기를 열면 약품 정보를 조작할 수 있다.**
--   이 앱에서 가장 해로운 실패가 잘못된 약품 정보이므로 쓰기는 서버 전용으로 닫는다.
--   (읽기만 열고 싶어지면 select 정책을 따로 추가할 것 — 지금은 서버만 읽는다.)
alter table public.mfds_pills enable row level security;

-- ── 검증 ───────────────────────────────────────────────────────────────────
-- select count(*) from public.mfds_pills;                                  -- 적재 후 수만 건
-- select count(*) from public.mfds_pills where mark_codes is not null;     -- 각인 인덱스 대상
-- select max(synced_at) from public.mfds_pills;
