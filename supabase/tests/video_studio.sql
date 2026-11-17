-- P5 video studio acceptance. Run as postgres against local/test Supabase (also run in vitest via PGlite). Always rolled back.
begin;
do $$
declare
 org uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid();
 plan uuid; s1 uuid; s2 uuid; ap public.approval_requests; j public.agent_jobs; denied boolean; rev integer;
begin
 insert into auth.users(id,email) values(owner_id,owner_id||'@example.invalid'),(member_id,member_id||'@example.invalid');
 insert into public.profiles(user_id,email,display_name) values(owner_id,owner_id||'@example.invalid','Owner'),(member_id,member_id||'@example.invalid','Member');
 insert into public.organizations(id,slug,name) values(org,'video-'||org,'Video studio test');
 insert into public.organization_roles(organization_id,role_key,name,description,permissions,assignment_permission) values
 (org,'owner','Owner','Test role',array['content.view','content.manage','agent.dispatch','agent.approve'],'owner.grant'),
 (org,'member','Member','Test role',array['content.view','content.manage','agent.dispatch'],'account.manage');
 insert into public.organization_members(organization_id,user_id,role) values(org,owner_id,'owner'),(org,member_id,'member');

 perform set_config('request.jwt.claims', json_build_object('sub',member_id,'role','authenticated')::text, true);
 set local role authenticated;
 insert into public.video_plans(organization_id,title,created_by) values(org,'SQL 验收',member_id) returning id into plan;
 reset role;
 -- separate "request": shots inserted after the plan exists bump the revision once
 update public.video_plans set created_at = created_at where id = plan; -- no-op content
 set local role authenticated;
 insert into public.video_shots(organization_id,plan_id,position,motion_mode,narration,created_by) values
  (org,plan,1,'local_ken_burns','第一句',member_id),(org,plan,2,'cloud_video_model','第二句',member_id);
 select id into s1 from public.video_shots where plan_id=plan and position=1;
 select id into s2 from public.video_shots where plan_id=plan and position=2;
 select revision into rev from public.video_plans where id=plan;
 -- (same transaction as plan creation => still revision 1)
 assert rev=1, 'plan created in the same transaction must keep revision 1, got '||rev;

 j:=public.enqueue_video_job(plan,'video_shot_render',s1);
 assert j.status='queued' and (j.payload->'server_estimate'->>'requires_approval')::boolean = false, 'free ken burns job should queue';
 denied:=false; begin perform public.enqueue_video_job(plan,'video_shot_render',s2); exception when insufficient_privilege then denied:=true; end;
 assert denied, 'paid cloud render queued without approval';
 ap:=public.request_video_render_approval(plan);
 assert ap.status='pending' and ap.estimated_cost_cents=35, 'approval estimate';
 denied:=false; begin perform public.decide_approval_request(ap.id,'approved',''); exception when insufficient_privilege then denied:=true; end;
 assert denied, 'member without agent.approve approved';
 perform set_config('request.jwt.claims', json_build_object('sub',owner_id,'role','authenticated')::text, true);
 ap:=public.decide_approval_request(ap.id,'approved','');
 assert ap.status='approved', 'owner approval';
 j:=public.enqueue_video_job(plan,'video_shot_render',s2,ap.id);
 assert j.status='queued', 'approved paid render should queue';
 update public.video_shots set narration='改稿' where id=s1;
 assert (select revision from public.video_plans where id=plan)=2, 'content edit bumps revision';
 assert (select status from public.approval_requests where id=ap.id)='expired', 'revision bump expires approval';
 reset role;
end $$;
rollback;
select 'video_studio ok' as result;
