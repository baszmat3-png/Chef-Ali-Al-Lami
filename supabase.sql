-- شغّل هذا مرة واحدة في Supabase: SQL Editor
create table if not exists kv (id text primary key, data jsonb not null);
alter table kv enable row level security;  -- بدون سياسات: لا أحد يصل إلا المفتاح السري من السيرفر

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;
