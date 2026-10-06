begin;
do $$
declare
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); conn uuid; result jsonb; again jsonb; denied boolean;
 payload jsonb:='{"version":1,"intent":"capture","external_id":"fixture-1","text":"原始想法","title":"选题测试","url":"https://example.com","angle":"企业应用"}';
begin
 insert into auth.users(id,email) values(u,u||'@example.invalid'),(outsider,outsider||'@example.invalid');
 insert into public.profiles(user_id,email,display_name) values(u,u||'@example.invalid','Intake owner'),(outsider,outsider||'@example.invalid','Other user');
 insert into public.organizations(id,slug,name) values(org,'intake-'||org,'Intake fixture'),(other_org,'intake-'||other_org,'Other fixture');
 insert into public.organization_roles(organization_id,role_key,name,description,permissions,assignment_permission) values(org,'owner','Owner','Test role',array['content.view','content.manage'],'owner.grant');
 insert into public.organization_members(organization_id,user_id,role) values(org,u,'owner');
 perform set_config('request.jwt.claim.sub',u::text,true);
 set local role authenticated;
 insert into public.intake_connections(organization_id,name,adapter,token_hash) values(org,'Test Dot','dot',repeat('a',64)) returning id into conn;
 denied:=false; begin perform token_hash from public.intake_connections where id=conn; exception when insufficient_privilege then denied:=true; end;
 assert denied,'browser can read token hash';
 denied:=false; begin perform public.accept_intake(repeat('a',64),payload); exception when insufficient_privilege then denied:=true; end;
 assert denied,'authenticated bypassed gateway';
 denied:=false; begin insert into public.intake_connections(organization_id,name,adapter,token_hash) values(other_org,'Wrong tenant','dot',repeat('b',64)); exception when insufficient_privilege then denied:=true; end;
 assert denied,'cross tenant credential created';
 reset role;
 -- Service path with no user JWT, like production Edge Function.
 perform set_config('request.jwt.claim.sub','',true);
 set local role service_role;
 result:=public.accept_intake(repeat('a',64),payload);
 again:=public.accept_intake(repeat('a',64),payload);
 assert result->>'selection_id'=again->>'selection_id' and again->>'duplicate'='true','retry created duplicate';
 assert (select count(*)=1 from public.signals where organization_id=org),'signal duplicate';
 assert (select count(*)=1 from public.selections where organization_id=org),'selection missing';
 denied:=false; begin perform public.accept_intake(repeat('a',64),payload||'{"text":"changed"}'::jsonb); exception when unique_violation then denied:=true; end;
 assert denied,'conflicting id accepted';

 -- Storage failure must roll back the preceding source/topic inserts.
 reset role;
 revoke insert on public.intake_receipts from service_role;
 set local role service_role;
 denied:=false; begin perform public.accept_intake(repeat('a',64),payload||'{"external_id":"storage-failure"}'::jsonb); exception when insufficient_privilege then denied:=true; end;
 assert denied,'fixture failed to simulate storage failure';
 assert (select count(*)=1 from public.signals where organization_id=org),'partial source survived rollback';
 assert (select count(*)=1 from public.selections where organization_id=org),'partial topic survived rollback';
 reset role;
 grant insert on public.intake_receipts to service_role;
 set local role service_role;
 insert into public.intake_receipts(organization_id,connection_id,external_id,payload,signal_id,selection_id)
 select org,conn,'rate-fixture-'||n,payload,(result->>'signal_id')::bigint,(result->>'selection_id')::bigint from generate_series(1,99) n;
 denied:=false; begin perform public.accept_intake(repeat('a',64),payload||'{"external_id":"over-limit"}'::jsonb); exception when raise_exception then denied:=true; end;
 assert denied,'rate limit ignored';
 again:=public.accept_intake(repeat('a',64),payload);
 assert again->>'duplicate'='true','rate limiting blocked an already committed retry';
 update public.intake_connections set revoked_at=now() where id=conn;
 denied:=false; begin perform public.accept_intake(repeat('a',64),payload); exception when invalid_authorization_specification then denied:=true; end;
 assert denied,'revoked key accepted';
 update public.intake_connections set revoked_at=null,expires_at=now()-interval '1 second' where id=conn;
 denied:=false; begin perform public.accept_intake(repeat('a',64),payload); exception when invalid_authorization_specification then denied:=true; end;
 assert denied,'expired key accepted';
 update public.intake_connections set expires_at=now()+interval '1 day' where id=conn;
 update public.organization_roles set permissions=array['content.view'] where organization_id=org;
 denied:=false; begin perform public.accept_intake(repeat('a',64),payload); exception when invalid_authorization_specification then denied:=true; end;
 assert denied,'removed permission accepted';
 reset role;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 set local role authenticated;
 assert (select count(*)=0 from public.intake_receipts where organization_id=org),'receipt leaked';
 assert (select count(*)=0 from public.intake_connections where organization_id=org),'connection leaked';
 reset role;
end;
$$;
rollback;
