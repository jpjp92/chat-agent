-- chat_messages.trace_id — 턴 ID 로 Supabase(원문)·Vercel([turn] 로그)·LangSmith(루트 run)를 잇는다. 여러 번 실행해도 안전.
-- 계획: docs/plans/PLAN_TRACE_ID_261108.md T3
--
-- 🔴 코드 배포보다 먼저. 열이 없는 DB 에 trace_id 를 넣는 insert 는 실패해 메시지 저장이 깨진다.
--    dev·운영 Supabase 는 서로 다른 프로젝트라 **각각** 실행한다(dev → dev 배포 확인 → 운영 → main 반영).
--
-- uuid null — 기존 행·옛 코드와 호환. default 가 없어 열 추가는 테이블을 다시 쓰지 않는다(즉시 끝남).
-- 조회는 "LangSmith 에서 본 trace → 그 턴의 메시지" 한 방향이라 값이 있는 행만 색인한다.
-- 같은 턴의 user·assistant 행이 같은 값을 가지므로 unique 가 아니다.
-- RLS 는 바꾸지 않는다 — 기존 "own messages" 정책이 행 단위로 그대로 적용된다.

alter table public.chat_messages add column if not exists trace_id uuid;

create index if not exists chat_messages_trace_id_idx
  on public.chat_messages (trace_id)
  where trace_id is not null;

-- 확인: 열 1행, 인덱스 1행이 나와야 한다
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'chat_messages' and column_name = 'trace_id';

select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'chat_messages' and indexname = 'chat_messages_trace_id_idx';
