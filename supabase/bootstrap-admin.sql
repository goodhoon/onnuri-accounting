-- Run ONCE in your own Supabase SQL Editor after creating a verified user.
-- Replace the email below. Do not run this from a browser or client API.
begin;
do $$
declare v_id uuid;
begin
 select id into v_id from auth.users where lower(email)=lower('goodhoon73@gmail.com');
 if v_id is null then raise exception 'Create the administrator Auth user first and replace the email';end if;
 update public.profiles set active=true where id=v_id;
 if not found then raise exception 'Apply migrations before creating the Auth user';end if;
 insert into public.role_assignments(user_id,role,org_unit_id) values(v_id,'admin',null)
 on conflict(user_id,role,org_unit_id) do nothing;
end;
$$;
commit;
