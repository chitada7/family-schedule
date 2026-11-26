-- 우리집 일정 (가족 일정 앱) — kids-study Supabase 프로젝트에 함께 넣는 표
-- SQL Editor에 통째로 붙여넣고 Run 한 번이면 돼요. 여러 번 실행해도 괜찮아요.

create table if not exists fam_access (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz default now()
);
alter table fam_access enable row level security;
drop policy if exists fam_access_self on fam_access;
create policy fam_access_self on fam_access for select using (user_id = auth.uid());

create or replace function fam_is_member() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from fam_access where user_id = auth.uid())
$$;

create table if not exists fam_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  person text not null,          -- grandma / mom / dad / taemin / ina / family
  kind text not null default '기타',
  start_date date not null,
  end_date date not null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  repeat_days smallint[],        -- 0=일 … 6=토 (매주 반복)
  repeat_until date,
  skip_dates date[] not null default '{}',  -- 반복 중 빠지는 날 (휴강 등)
  memo text,
  important boolean not null default false,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists fam_events_start on fam_events (start_date);
alter table fam_events enable row level security;
drop policy if exists fam_events_family on fam_events;
create policy fam_events_family on fam_events for all using (fam_is_member()) with check (fam_is_member());

alter table fam_events add column if not exists important boolean not null default false;

grant select on fam_access to authenticated;
grant select, insert, update, delete on fam_events to authenticated;

-- 실시간 공유 (한 사람이 저장하면 다른 폰에 바로 반영)
do $$ begin
  alter publication supabase_realtime add table fam_events;
exception when duplicate_object then null; end $$;

-- ▼ 가족 계정 등록: 앱에서 가입한 이메일을 아래에 넣고 이 줄만 다시 실행
-- insert into fam_access (user_id) select id from auth.users where email in ('이메일1', '이메일2') on conflict do nothing;
