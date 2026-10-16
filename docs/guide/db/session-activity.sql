-- 사이드바 "마지막 대화 순" — 메시지가 저장되면 그 세션의 updated_at 을 올린다. 여러 번 실행해도 안전.
--
-- 사이드바는 chat_sessions.updated_at desc 로 정렬하는데(app/api/sessions/route.ts),
-- updated_at 은 세션 행이 수정될 때(= 제목 변경)만 바뀌었다. 예전 채팅에 이어서 대화해도
-- 목록 위로 올라오지 않았다(2026-10-16).
--
-- touch_updated_at(before update) 트리거가 now() 로 덮으므로 여기서는 행만 건드리면 된다.

create or replace function public.touch_session_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_sessions
     set updated_at = now()
   where id = new.session_id;
  return new;
end;
$$;

revoke execute on function public.touch_session_on_message() from public, anon, authenticated;

drop trigger if exists chat_messages_touch_session on public.chat_messages;
create trigger chat_messages_touch_session
  after insert on public.chat_messages
  for each row execute function public.touch_session_on_message();

-- 기존 데이터 1회 보정 — 세션의 updated_at 을 마지막 메시지 시각으로.
-- touch_updated_at 트리거가 now() 로 덮어쓰지 않게 이 문장 동안만 끈다. 중간에 실패해도 꺼진 채로 남지 않게 한 트랜잭션.
begin;
alter table public.chat_sessions disable trigger chat_sessions_touch_updated_at;

update public.chat_sessions s
   set updated_at = m.last_at
  from (
    select session_id, max(created_at) as last_at
      from public.chat_messages
     group by session_id
  ) m
 where m.session_id = s.id
   and s.updated_at is distinct from m.last_at;

alter table public.chat_sessions enable trigger chat_sessions_touch_updated_at;
commit;
