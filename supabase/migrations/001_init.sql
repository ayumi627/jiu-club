-- Paste into Supabase SQL Editor once. Monetary amounts are integer TWD (no floating point).
create extension if not exists pgcrypto;

create table public.clubs (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 80),
 invite_code text not null unique default upper(substr(encode(gen_random_bytes(8),'hex'),1,10)),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.memberships (
 club_id uuid not null references public.clubs(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 nickname text not null check(length(trim(nickname)) between 1 and 60)),
 role text not null check(role in ('admin','member')) default 'member',
 created_at timestamptz not null default now(), primary key (club_id,user_id)
);
create table public.topup_requests (
 id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id) on delete cascade,
 user_id uuid not null references auth.users(id), amount integer not null check(amount between 1 and 1000000),
 note text not null default '', status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reviewer_id uuid references auth.users(id), reviewed_at timestamptz, created_at timestamptz not null default now()
);
create table public.ledger (
 id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id) on delete cascade,
 user_id uuid not null references auth.users(id), delta integer not null check(delta <> 0),
 type text not null check(type in ('topup','order','refund','adjustment')),
 reference_id uuid, note text not null default '', created_at timestamptz not null default now()
);
create unique index ledger_unique_reference on public.ledger(type,reference_id) where reference_id is not null;
create index ledger_account_idx on public.ledger(club_id,user_id,created_at desc);
create table public.campaigns (
 id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 100), shop text not null default '',
 closes_at timestamptz not null, status text not null default 'open' check(status in ('open','closed')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.products (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 100), price integer not null check(price between 0 and 1000000),
 created_at timestamptz not null default now()
);
create table public.orders (
 id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id),
 campaign_id uuid not null references public.campaigns(id), user_id uuid not null references auth.users(id),
 total integer not null check(total >= 0), status text not null default 'placed' check(status in ('placed','cancelled')),
 created_at timestamptz not null default now()
);
create table public.order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 product_id uuid not null references public.products(id), name_snapshot text not null,
 price_snapshot integer not null, qty integer not null check(qty between 1 and 99)
);

create or replace function public.is_member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m where m.club_id=cid and m.user_id=(select auth.uid()));
$$;
create or replace function public.is_admin(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m where m.club_id=cid and m.user_id=(select auth.uid()) and m.role='admin');
$$;
create or replace function public.balance_for(cid uuid, uid uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(delta),0)::bigint from public.ledger where club_id=cid and user_id=uid
 and (uid=(select auth.uid()) or public.is_admin(cid));
$$;

-- Prevent arbitrary table writes: all sensitive changes go through checked RPCs.
alter table public.clubs enable row level security;
alter table public.memberships enable row level security;
alter table public.topup_requests enable row level security;
alter table public.ledger enable row level security;
alter table public.campaigns enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
create policy club_select on public.clubs for select to authenticated using(public.is_member(id));
create policy member_select on public.memberships for select to authenticated using(public.is_member(club_id));
create policy topup_select on public.topup_requests for select to authenticated using(user_id=(select auth.uid()) or public.is_admin(club_id));
create policy ledger_select on public.ledger for select to authenticated using(user_id=(select auth.uid()) or public.is_admin(club_id));
create policy campaign_select on public.campaigns for select to authenticated using(public.is_member(club_id));
create policy product_select on public.products for select to authenticated using(exists(select 1 from public.campaigns c where c.id=campaign_id and public.is_member(c.club_id)));
create policy order_select on public.orders for select to authenticated using(user_id=(select auth.uid()) or public.is_admin(club_id));
create policy item_select on public.order_items for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and (o.user_id=(select auth.uid()) or public.is_admin(o.club_id))));

-- Serialize all wallet mutations in a club on advisory lock (club/user specific).
create or replace function public.lock_wallet(cid uuid, uid uuid) returns void language sql volatile set search_path='' as $$
 select pg_advisory_xact_lock(hashtextextended(cid::text || ':' || uid::text, 0));
$$;
create or replace function public.create_club(p_name text, p_nickname text) returns uuid
language plpgsql security definer set search_path='' as $$
declare cid uuid; uid uuid := auth.uid();
begin
 if uid is null then raise exception '請先登入'; end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 80 or length(trim(coalesce(p_nickname,''))) not between 1 and 60 then raise exception '名稱長度不正確'; end if;
 insert into public.clubs(name,created_by) values(trim(p_name),uid) returning id into cid;
 insert into public.memberships(club_id,user_id,nickname,role) values(cid,uid,trim(p_nickname),'admin');
 return cid;
end $$;
create or replace function public.join_club(p_code text, p_nickname text) returns uuid
language plpgsql security definer set search_path='' as $$
declare cid uuid; uid uuid:=auth.uid();
begin
 if uid is null then raise exception '請先登入'; end if;
 if length(trim(coalesce(p_nickname,''))) not between 1 and 60 then raise exception '暱稱長度不正確'; end if;
 select id into cid from public.clubs where invite_code=upper(trim(p_code));
 if cid is null then raise exception '邀請碼不存在'; end if;
 insert into public.memberships(club_id,user_id,nickname) values(cid,uid,trim(p_nickname)) on conflict (club_id,user_id) do nothing;
 return cid;
end $$;
create or replace function public.request_topup(p_club uuid,p_amount integer,p_note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if not public.is_member(p_club) then raise exception '無權操作'; end if;
 insert into public.topup_requests(club_id,user_id,amount,note) values(p_club,auth.uid(),p_amount,left(coalesce(p_note,''),500)) returning id into rid;
 return rid;
end $$;
create or replace function public.review_topup(p_id uuid,p_approve boolean) returns void
language plpgsql security definer set search_path='' as $$
declare r public.topup_requests%rowtype;
begin
 select * into r from public.topup_requests where id=p_id for update;
 if not found or not public.is_admin(r.club_id) then raise exception '無權審核'; end if;
 if r.status<>'pending' then raise exception '此筆已處理'; end if;
 if p_approve then
   perform public.lock_wallet(r.club_id,r.user_id);
   insert into public.ledger(club_id,user_id,delta,type,reference_id,note) values(r.club_id,r.user_id,r.amount,'topup',r.id,'管理員確認收款');
 end if;
 update public.topup_requests set status=case when p_approve then 'approved' else 'rejected' end,reviewer_id=auth.uid(),reviewed_at=now() where id=p_id;
end $$;
create or replace function public.create_campaign(p_club uuid,p_title text,p_shop text,p_closes_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if not public.is_admin(p_club) then raise exception '僅團主可開團'; end if;
 if length(trim(coalesce(p_title,''))) not between 1 and 100 or p_closes_at <= now() then raise exception '標題或截止時間無效'; end if;
 insert into public.campaigns(club_id,title,shop,closes_at,created_by) values(p_club,trim(p_title),left(coalesce(p_shop,''),100),p_closes_at,auth.uid()) returning id into cid;
 return cid;
end $$;
create or replace function public.add_product(p_campaign uuid,p_name text,p_price integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.campaigns%rowtype; pid uuid;
begin
 select * into c from public.campaigns where id=p_campaign;
 if not found or not public.is_admin(c.club_id) then raise exception '無權新增商品'; end if;
 if c.status<>'open' or c.closes_at<=now() then raise exception '團購已截止'; end if;
 insert into public.products(campaign_id,name,price) values(p_campaign,trim(p_name),p_price) returning id into pid;
 return pid;
end $$;
create or replace function public.place_order(p_campaign uuid,p_items jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.campaigns%rowtype; uid uuid:=auth.uid(); oid uuid; total_amount bigint; item_count integer; matched integer;
begin
 select * into c from public.campaigns where id=p_campaign for update;
 if not found or not public.is_member(c.club_id) then raise exception '無權下單'; end if;
 if c.status<>'open' or c.closes_at<=now() then raise exception '團購已截止'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception '購物車內容無效'; end if;
 -- Reject invalid, duplicate, and out-of-campaign product IDs before any balance changes.
 with requested as (select (x->>'product_id')::uuid pid,(x->>'qty')::integer qty from jsonb_array_elements(p_items) x)
 select count(*), count(distinct p.id), coalesce(sum(p.price * r.qty),0)
 into item_count, matched, total_amount from requested r left join public.products p on p.id=r.pid and p.campaign_id=p_campaign
 where r.qty between 1 and 99;
 if item_count<>jsonb_array_length(p_items) or matched<>item_count or total_amount<=0 or total_amount>10000000 then raise exception '商品或數量不合法'; end if;
 perform public.lock_wallet(c.club_id,uid);
 if public.balance_for(c.club_id,uid)<total_amount then raise exception '餘額不足，請先申請儲值'; end if;
 insert into public.orders(club_id,campaign_id,user_id,total) values(c.club_id,p_campaign,uid,total_amount::integer) returning id into oid;
 insert into public.order_items(order_id,product_id,name_snapshot,price_snapshot,qty)
 select oid,p.id,p.name,p.price,(x->>'qty')::integer from jsonb_array_elements(p_items) x
 join public.products p on p.id=(x->>'product_id')::uuid and p.campaign_id=p_campaign;
 insert into public.ledger(club_id,user_id,delta,type,reference_id,note) values(c.club_id,uid,-total_amount::integer,'order',oid,'團購扣款');
 return oid;
end $$;
create or replace function public.cancel_order(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; c public.campaigns%rowtype;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or not (o.user_id=auth.uid() or public.is_admin(o.club_id)) then raise exception '無權取消'; end if;
 select * into c from public.campaigns where id=o.campaign_id;
 if c.closes_at<=now() and not public.is_admin(o.club_id) then raise exception '截止後請聯繫團主'; end if;
 if o.status<>'placed' then raise exception '訂單已取消'; end if;
 perform public.lock_wallet(o.club_id,o.user_id);
 update public.orders set status='cancelled' where id=p_order;
 insert into public.ledger(club_id,user_id,delta,type,reference_id,note) values(o.club_id,o.user_id,o.total,'refund',o.id,'取消訂單退款');
end $$;
create or replace function public.set_campaign_status(p_campaign uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 select club_id into cid from public.campaigns where id=p_campaign;
 if cid is null or not public.is_admin(cid) then raise exception '無權操作'; end if;
 if p_status not in ('open','closed') then raise exception '狀態無效'; end if;
 update public.campaigns set status=p_status where id=p_campaign;
end $$;
-- Grant RPC, not raw write access.
revoke all on function public.lock_wallet(uuid,uuid) from public,anon,authenticated;
revoke all on function public.balance_for(uuid,uuid) from public,anon;
revoke all on function public.is_member(uuid) from public,anon;
revoke all on function public.is_admin(uuid) from public,anon;
grant execute on function public.balance_for(uuid,uuid), public.is_member(uuid), public.is_admin(uuid) to authenticated;
do $$ declare f regprocedure; begin
 foreach f in array array[
 'public.create_club(text,text)'::regprocedure,'public.join_club(text,text)'::regprocedure,
 'public.request_topup(uuid,integer,text)'::regprocedure,'public.review_topup(uuid,boolean)'::regprocedure,
 'public.create_campaign(uuid,text,text,timestamp with time zone)'::regprocedure,
 'public.add_product(uuid,text,integer)'::regprocedure,'public.place_order(uuid,jsonb)'::regprocedure,
 'public.cancel_order(uuid)'::regprocedure,'public.set_campaign_status(uuid,text)'::regprocedure]
 loop execute format('revoke all on function %s from public,anon',f); execute format('grant execute on function %s to authenticated',f); end loop;
end $$;
