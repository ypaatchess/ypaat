-- YPAAT Chess Academy: secure CMS schema
-- Run this once in Supabase SQL Editor.
-- Create the admin user first in Supabase Authentication, then replace ADMIN_USER_UUID below.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text not null default '',
  content text not null,
  status text not null default 'draft' check (status in ('published','draft')),
  nav text not null default 'no' check (nav in ('yes','no')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_ypaat_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid()
  );
$$;

alter table public.admin_users enable row level security;
alter table public.pages enable row level security;

drop policy if exists "Admins can read their admin record" on public.admin_users;
create policy "Admins can read their admin record"
on public.admin_users for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Public can read published pages" on public.pages;
create policy "Public can read published pages"
on public.pages for select
to anon, authenticated
using (status = 'published' or public.is_ypaat_admin());

drop policy if exists "Admins can create pages" on public.pages;
create policy "Admins can create pages"
on public.pages for insert
to authenticated
with check (public.is_ypaat_admin());

drop policy if exists "Admins can update pages" on public.pages;
create policy "Admins can update pages"
on public.pages for update
to authenticated
using (public.is_ypaat_admin())
with check (public.is_ypaat_admin());

drop policy if exists "Admins can delete pages" on public.pages;
create policy "Admins can delete pages"
on public.pages for delete
to authenticated
using (public.is_ypaat_admin());

grant select on public.pages to anon, authenticated;
grant insert, update, delete on public.pages to authenticated;
grant select on public.admin_users to authenticated;

-- After creating the administrator account in Authentication > Users,
-- replace the UUID below with that user's UUID and run:
-- insert into public.admin_users (user_id) values ('ADMIN_USER_UUID');

-- Optional seed pages. The website also has local fallback copies until
-- these records are created in the database.
insert into public.pages (title, slug, description, content, status, nav)
values
('General Chess Curriculum','general-chess-curriculum','Six progressive levels of chess topics.',
'<h1>General Chess Curriculum</h1><p>YPAAT''s general chess curriculum is organised into six progressive levels. The curriculum moves from board fundamentals and tactical patterns toward strategic planning, advanced endgames and practical defence.</p><h2>Level 1 — Foundations</h2><ul><li>The board and naming of squares</li><li>Moves of the pieces</li><li>Attacking, defending and checkmate</li><li>Castling, exchanges and notation</li><li>Basic tactics and winning material</li></ul><h2>Level 2 — Tactical Patterns</h2><ul><li>Piece activity and targets</li><li>Double attacks and pins</li><li>Elimination of defence</li><li>Discovered attacks</li></ul>',
'published','yes'),
('Advanced Training','advanced-training','Overview of YPAAT advanced training methodology.',
'<h1>Advanced Training</h1><p>YPAAT''s advanced training approach emphasises active calculation, strategic understanding and practical technique rather than passive content consumption.</p><h2>Core pillars</h2><ul><li><b>Tactical precision:</b> coordinated attacks, forcing moves and intermediate ideas.</li><li><b>Calculation discipline:</b> candidate moves, short variations and concrete evaluation.</li><li><b>Strategic depth:</b> pawn structures, weaknesses, space and exchanges.</li><li><b>Practical technique:</b> prophylaxis, conversion and endgame decision-making.</li></ul>',
'published','yes'),
('Opening Repertoire','opening-repertoire','A flexible 1.Nf3 repertoire guide.',
'<h1>1.Nf3 Opening Repertoire</h1><p>The 1.Nf3 move offers a flexible route into several opening families. YPAAT''s guide focuses on plans, key squares, piece placement and model-game ideas rather than memorising moves in isolation.</p><h2>Against 1...d5</h2><p>A common plan is 2.c4, placing pressure on the centre and allowing transpositions into systems such as the Catalan.</p>',
'published','yes')
on conflict (slug) do nothing;
