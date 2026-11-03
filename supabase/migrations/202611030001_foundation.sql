-- Day 1: enforce authorization in PostgreSQL, not only in the UI.
begin;
create type public.org_kind as enum ('church','headquarters','division','team','event');
create type public.app_role as enum ('admin','applicant','team_leader','department_head','vision_member','payment_officer','auditor');
create type public.step_kind as enum ('approval','payment');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (length(trim(display_name)) between 1 and 100),
 active boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.org_units (
 id uuid primary key default gen_random_uuid(),
 parent_id uuid references public.org_units(id) on delete restrict,
 code text not null unique check(code ~ '^[A-Z0-9_-]{1,40}$'),
 name text not null check(length(trim(name)) between 1 and 100),
 kind public.org_kind not null,
 sort_order integer not null default 0,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 check(parent_id is distinct from id)
);
create index on public.org_units(parent_id);
create unique index one_church_root on public.org_units((kind)) where kind='church';
create table public.role_assignments (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 role public.app_role not null,
 org_unit_id uuid references public.org_units(id) on delete restrict,
 created_at timestamptz not null default now(),
 -- Global privileges must always be explicit. Admin cannot be scoped.
 check((role='admin' and org_unit_id is null) or (role in ('payment_officer','auditor')) or (role not in ('admin','payment_officer','auditor') and org_unit_id is not null)),
 unique nulls not distinct(user_id,role,org_unit_id)
);
create index on public.role_assignments(user_id);
create index on public.role_assignments(org_unit_id);
create table public.workflow_versions (
 id uuid primary key default gen_random_uuid(),
 version integer not null unique check(version>0),
 name text not null default '기본 지출 결재선',
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create table public.workflow_steps (
 id uuid primary key default gen_random_uuid(),
 workflow_id uuid not null references public.workflow_versions(id) on delete restrict,
 position integer not null check(position between 1 and 12),
 label text not null check(length(trim(label)) between 1 and 50),
 role public.app_role not null check(role in ('team_leader','department_head','vision_member','payment_officer')),
 kind public.step_kind not null,
 unique(workflow_id,position), unique(workflow_id,label),
 check((kind='payment' and role='payment_officer') or (kind='approval' and role<>'payment_officer'))
);
create table public.audit_events (
 id bigint generated always as identity primary key,
 actor_id uuid,
 entity text not null,
 entity_id text not null,
 action text not null,
 before_value jsonb,
 after_value jsonb,
 created_at timestamptz not null default now()
);
create index on public.audit_events(created_at);

create function public.is_active_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_member() and exists(select 1 from public.role_assignments a where a.user_id=auth.uid() and a.role='admin')
$$;
-- Reusable scoped authorization for future expense/budget RLS. A role in a
-- parent unit extends to descendants. Possession of another role does not.
create function public.has_org_role(p_role public.app_role,p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 with recursive ancestors as (
  select o.id,o.parent_id from public.org_units o where o.id=p_org
  union
  select p.id,p.parent_id from public.org_units p join ancestors a on a.parent_id=p.id
 )
 select public.is_active_member() and (public.is_admin() or exists(
  select 1 from public.role_assignments a where a.user_id=auth.uid() and a.role=p_role
   and (a.org_unit_id is null or a.org_unit_id in (select id from ancestors))
 ))
$$;

create function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,display_name,active) values(new.id,
  left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),nullif(split_part(new.email,'@',1),''),'등록 대기 사용자'),100),false);
 -- Never trust self-supplied metadata for activation or roles.
 return new;
end;
$$;
create trigger auth_user_created after insert on auth.users for each row execute function public.create_profile();

create function public.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value)
 values(auth.uid(),tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id'),tg_op,
  case when tg_op='INSERT' then null else to_jsonb(old) end,
  case when tg_op='DELETE' then null else to_jsonb(new) end);
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger audit_profiles after insert or update or delete on public.profiles for each row execute function public.audit_change();
create trigger audit_orgs after insert or update or delete on public.org_units for each row execute function public.audit_change();
create trigger audit_roles after insert or update or delete on public.role_assignments for each row execute function public.audit_change();
create trigger audit_workflows after insert or update or delete on public.workflow_versions for each row execute function public.audit_change();
create trigger audit_steps after insert or update or delete on public.workflow_steps for each row execute function public.audit_change();

-- Prevent cycles and enforce source hierarchy, including privileged writes.
create function public.validate_org_parent() returns trigger language plpgsql set search_path='' as $$
declare parent_kind public.org_kind;
begin
 perform pg_advisory_xact_lock(79335001);
 if new.kind='church' then
  if new.parent_id is not null then raise exception 'church must be root'; end if;
 else
  select kind into parent_kind from public.org_units where id=new.parent_id;
  if parent_kind is null then raise exception 'parent is required'; end if;
  if not ((new.kind='headquarters' and parent_kind='church') or (new.kind='division' and parent_kind='headquarters') or (new.kind='team' and parent_kind='division') or (new.kind='event' and parent_kind in ('church','headquarters','division','team'))) then
   raise exception 'invalid organization hierarchy';
  end if;
 end if;
 if exists(with recursive descendants as (
  select id from public.org_units where parent_id=new.id
  union select o.id from public.org_units o join descendants d on o.parent_id=d.id
 ) select 1 from descendants where id=new.parent_id) then raise exception 'organization cycle'; end if;
 if tg_op='UPDATE' and new.kind<>old.kind and exists(select 1 from public.org_units where parent_id=new.id) then raise exception 'cannot change kind with children';end if;
 return new;
end;
$$;
create trigger validate_org before insert or update on public.org_units for each row execute function public.validate_org_parent();

-- Immutable versions: submit-time requests will refer to one version, never
-- a mutable current template. Assignment snapshots belong to Day 3/4.
create function public.deny_workflow_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'workflow versions are immutable'; end;
$$;
create trigger immutable_versions before update or delete on public.workflow_versions for each row execute function public.deny_workflow_mutation();
create trigger immutable_steps before update or delete on public.workflow_steps for each row execute function public.deny_workflow_mutation();

create function public.save_workflow(p_steps jsonb,p_expected_version integer) returns uuid language plpgsql security definer set search_path='' as $$
declare v_current integer; v_id uuid; item jsonb; n integer; pos integer=0; payment_count integer=0; v_kind text; v_role text;
begin
 if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(79335002);
 select coalesce(max(version),0) into v_current from public.workflow_versions;
 if p_expected_version is null or p_expected_version<>v_current then raise exception 'version conflict'; end if;
 if p_steps is null or jsonb_typeof(p_steps)<>'array' then raise exception 'steps must be array';end if;
 n=jsonb_array_length(p_steps);
 if n<2 or n>12 then raise exception '2 to 12 steps required';end if;
 insert into public.workflow_versions(version,created_by) values(v_current+1,auth.uid()) returning id into v_id;
 for item in select value from jsonb_array_elements(p_steps) loop
  pos=pos+1;v_kind=item->>'kind';v_role=item->>'role';
  if jsonb_typeof(item->'label') is distinct from 'string' or length(trim(item->>'label')) not between 1 and 50 then raise exception 'invalid label';end if;
  if v_kind is null or v_kind not in ('approval','payment') or v_role is null or v_role not in ('team_leader','department_head','vision_member','payment_officer') then raise exception 'invalid role or kind';end if;
  if v_kind='payment' then
   payment_count=payment_count+1;
   if pos<>n or v_role<>'payment_officer' then raise exception 'payment must be last';end if;
  elsif v_role='payment_officer' then raise exception 'payment role is not an approval role';
  end if;
  insert into public.workflow_steps(workflow_id,position,label,role,kind) values(v_id,pos,trim(item->>'label'),v_role::public.app_role,v_kind::public.step_kind);
 end loop;
 if payment_count<>1 then raise exception 'exactly one payment required';end if;
 return v_id;
end;
$$;

create function public.assign_member_role(p_user_id uuid,p_role public.app_role,p_org_unit_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not public.is_admin() then raise exception 'forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(79335003);
 if p_org_unit_id is not null and not exists(select 1 from public.org_units where id=p_org_unit_id and active) then raise exception 'inactive or unknown organization';end if;
 update public.profiles set active=true where id=p_user_id;
 if not found then raise exception 'unknown member';end if;
 insert into public.role_assignments(user_id,role,org_unit_id) values(p_user_id,p_role,p_org_unit_id)
 on conflict(user_id,role,org_unit_id) do update set role=excluded.role returning id into v_id;
 return v_id;
end;
$$;
create function public.remove_member_role(p_assignment_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare target public.role_assignments;
begin
 if not public.is_admin() then raise exception 'forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(79335003);
 select * into target from public.role_assignments where id=p_assignment_id;
 if not found then raise exception 'unknown assignment';end if;
 if target.role='admin' and (select count(*) from public.role_assignments a join public.profiles p on p.id=a.user_id where a.role='admin' and p.active)<=1 then raise exception 'last administrator';end if;
 delete from public.role_assignments where id=p_assignment_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.org_units enable row level security;
alter table public.role_assignments enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.audit_events enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy org_read on public.org_units for select to authenticated using(public.is_active_member());
create policy assignments_read on public.role_assignments for select to authenticated using((user_id=auth.uid() and public.is_active_member()) or public.is_admin());
create policy workflow_read on public.workflow_versions for select to authenticated using(public.is_active_member());
create policy steps_read on public.workflow_steps for select to authenticated using(public.is_active_member());
create policy audit_read on public.audit_events for select to authenticated using(public.is_admin());
-- No direct client writes. Changes pass through restricted, audited RPCs.
revoke all on public.profiles,public.org_units,public.role_assignments,public.workflow_versions,public.workflow_steps,public.audit_events from anon,authenticated;
grant select on public.profiles,public.org_units,public.role_assignments,public.workflow_versions,public.workflow_steps,public.audit_events to authenticated;
revoke all on function public.is_active_member(),public.is_admin(),public.has_org_role(public.app_role,uuid),public.create_profile(),public.audit_change(),public.validate_org_parent(),public.deny_workflow_mutation(),public.save_workflow(jsonb,integer),public.assign_member_role(uuid,public.app_role,uuid),public.remove_member_role(uuid) from public,anon;
grant execute on function public.is_active_member(),public.is_admin(),public.has_org_role(public.app_role,uuid),public.save_workflow(jsonb,integer),public.assign_member_role(uuid,public.app_role,uuid),public.remove_member_role(uuid) to authenticated;
commit;
