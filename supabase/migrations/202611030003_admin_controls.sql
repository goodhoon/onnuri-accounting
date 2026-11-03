begin;
create function public.set_member_active(p_user_id uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(79335003);
 if p_active is null then raise exception 'active is required';end if;
 if not p_active and exists(select 1 from public.role_assignments where user_id=p_user_id and role='admin')
 and (select count(*) from public.role_assignments a join public.profiles p on p.id=a.user_id where a.role='admin' and p.active)<=1 then
  raise exception 'last administrator';
 end if;
 update public.profiles set active=p_active where id=p_user_id;
 if not found then raise exception 'unknown member';end if;
end;
$$;
create function public.rename_org(p_org_id uuid,p_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'forbidden' using errcode='42501';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 100 then raise exception 'invalid name';end if;
 update public.org_units set name=trim(p_name) where id=p_org_id;
 if not found then raise exception 'unknown organization';end if;
end;
$$;
revoke all on function public.set_member_active(uuid,boolean),public.rename_org(uuid,text) from public,anon;
grant execute on function public.set_member_active(uuid,boolean),public.rename_org(uuid,text) to authenticated;
commit;
