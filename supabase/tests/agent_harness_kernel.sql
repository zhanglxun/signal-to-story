-- Run as postgres against local or test Supabase (also executed in vitest via the PGlite harness).
-- Fixtures are always rolled back.
begin;
do $$
declare
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
 owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); viewer_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 project uuid; doc uuid; job public.agent_jobs; job2 public.agent_jobs; claimed public.agent_jobs; ap public.approval_requests; ke uuid; denied boolean; n integer;
begin
 insert into auth.users(id,email) values(owner_id,owner_id||'@example.invalid'),(member_id,member_id||'@example.invalid'),(viewer_id,viewer_id||'@example.invalid'),(outsider,outsider||'@example.invalid');
 insert into public.profiles(user_id,email,display_name) values(owner_id,owner_id||'@example.invalid','Owner'),(member_id,member_id||'@example.invalid','Member'),(viewer_id,viewer_id||'@example.invalid','Viewer'),(outsider,outsider||'@example.invalid','Outsider');
 insert into public.organizations(id,slug,name) values(org,'agent-'||org,'Agent kernel test'),(other_org,'agent-'||other_org,'Other tenant');
 insert into public.organization_roles(organization_id,role_key,name,description,permissions,assignment_permission) values
 (org,'owner','Owner','Test role',array['content.view','content.manage','content.review','content.publish','agent.dispatch','agent.approve'],'owner.grant'),
 (org,'member','Member','Test role',array['content.view','content.manage','agent.dispatch'],'account.manage'),
 (org,'viewer','Viewer','Test role',array['content.view'],'account.manage'),
 (other_org,'owner','Owner','Test role',array['content.view','content.manage','content.review','content.publish','agent.dispatch'],'owner.grant');
 insert into public.organization_members(organization_id,user_id,role) values(org,owner_id,'owner'),(org,member_id,'member'),(org,viewer_id,'viewer'),(other_org,outsider,'owner');

 -- Member enqueues a draft job (idempotent).
 perform set_config('request.jwt.claim.sub',member_id::text,true);
 set local role authenticated;
 insert into public.content_projects(organization_id,title) values(org,'Kernel test') returning id into project;
 insert into public.content_documents(organization_id,project_id,platform,title,body) values(org,project,'x','Doc','Body') returning id into doc;
 job:=public.enqueue_agent_job(org,'content_draft','k1',jsonb_build_object('instruction','write'),'content_document',doc::text,1);
 job2:=public.enqueue_agent_job(org,'content_draft','k1',jsonb_build_object('instruction','write'),'content_document',doc::text,1);
 assert job.id=job2.id and job.status='queued','enqueue not idempotent';
 denied:=false; begin update public.agent_jobs set status='succeeded' where id=job.id; get diagnostics n=row_count; denied:=n=0; exception when insufficient_privilege then denied:=true; end;
 assert denied,'browser updated job directly';
 denied:=false; begin perform public.claim_agent_job(array['content_draft'],60); exception when insufficient_privilege then denied:=true; end;
 assert denied,'browser claimed job';
 -- Viewer cannot enqueue; outsider cannot see.
 perform set_config('request.jwt.claim.sub',viewer_id::text,true);
 denied:=false; begin perform public.enqueue_agent_job(org,'content_draft','k2','{}','content_document',doc::text,1); exception when insufficient_privilege then denied:=true; end;
 assert denied,'viewer enqueued';
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 assert (select count(*) from public.agent_jobs where organization_id=org)=0,'job leaked across tenants';
 reset role;

 -- Worker claims; second claim finds nothing. (PostgREST sets claims from the service_role JWT.)
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 set local role service_role;
 select * into claimed from public.claim_agent_job(array['content_draft'],60);
 assert claimed.id=job.id and claimed.status='running' and claimed.attempts=1 and claimed.lease_epoch=1,'claim failed';
 assert not exists(select 1 from public.claim_agent_job(array['content_draft'],60)),'double claim';
 assert (public.heartbeat_agent_job(job.id,0,60)->>'ok')::boolean=false,'stale-epoch heartbeat accepted';
 denied:=false; begin perform public.record_agent_job_step(job.id,0,'context'); exception when sqlstate 'P0002' then denied:=true; end;
 assert denied,'stale-epoch step accepted';
 perform public.record_agent_job_step(job.id,claimed.lease_epoch,'context','succeeded',jsonb_build_object('round',0));
 denied:=false; begin insert into public.agent_job_steps(organization_id,job_id,seq,kind) values(org,job.id,9,'context'); exception when insufficient_privilege then denied:=true; end;
 assert denied,'node inserted a step directly';
 denied:=false; begin update public.agent_jobs set status='succeeded' where id=job.id; exception when insufficient_privilege then denied:=true; end;
 assert denied,'node updated a job directly';
 perform public.complete_agent_job(job.id,claimed.lease_epoch,'pending_review',jsonb_build_object('proposal_id',null));
 reset role;
 denied:=false; begin update public.agent_jobs set status='running' where id=job.id; exception when check_violation then denied:=true; end;
 assert denied,'illegal transition pending_review -> running';
 set local role service_role;
 -- Agent cannot write governance data or approve.
 denied:=false; begin insert into public.knowledge_entries(organization_id,slug,title,content,trust_level) values(org,'agent-kb','x','x','trusted'); exception when insufficient_privilege then denied:=true; end;
 assert denied,'agent wrote knowledge';
 denied:=false; begin perform public.enqueue_agent_job(org,'publish_external','p0','{}','content_document',doc::text,1); exception when insufficient_privilege then denied:=true; end;
 assert denied,'service role used human enqueue';
 reset role;

 -- Mandate: a publish job without approval is refused for every writer (service_role cannot insert at all;
 -- even the table owner is stopped by the trigger).
 set local role service_role;
 denied:=false; begin insert into public.agent_jobs(organization_id,kind,idempotency_key,payload) values(org,'publish_external','p1',jsonb_build_object('target',jsonb_build_object('type','content_document','id',doc::text,'revision',1))); exception when insufficient_privilege then denied:=true; end;
 assert denied,'service role inserted a job directly';
 reset role;
 denied:=false; begin insert into public.agent_jobs(organization_id,kind,idempotency_key,payload) values(org,'publish_external','p1',jsonb_build_object('target',jsonb_build_object('type','content_document','id',doc::text,'revision',1))); exception when insufficient_privilege then denied:=true; end;
 assert denied,'publish job queued without approval';
 set local role service_role;
 ap:=public.create_approval_request(org,'publish_external','content_document',doc::text,1,'publish v1','{}',null,job.id);
 assert ap.status='pending','approval not pending';
 denied:=false; begin perform public.decide_approval_request(ap.id,'approved',''); exception when insufficient_privilege then denied:=true; end;
 assert denied,'agent approved its own request';
 denied:=false; begin update public.approval_requests set status='approved' where id=ap.id; exception when insufficient_privilege then denied:=true; end;
 assert denied,'agent updated approval directly';
 reset role;

 -- Member lacks content.publish; owner approves.
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 perform set_config('request.jwt.claim.sub',member_id::text,true);
 set local role authenticated;
 denied:=false; begin perform public.decide_approval_request(ap.id,'approved',''); exception when insufficient_privilege then denied:=true; end;
 assert denied,'member approved publish';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 ap:=public.decide_approval_request(ap.id,'approved','ok');
 assert ap.status='approved' and ap.decided_by=owner_id,'owner approval failed';
 perform public.enqueue_agent_job(org,'publish_external','p1','{}','content_document',doc::text,1,null,null,ap.id);
 reset role;

 -- Editing the document expires the approval; the queued publish job is parked on claim.
 perform set_config('request.jwt.claim.sub',member_id::text,true);
 set local role authenticated;
 update public.content_documents set body='Body v2' where id=doc;
 reset role;
 assert (select status from public.approval_requests where id=ap.id)='expired','revision change did not expire approval';
 perform set_config('request.jwt.claim.sub','',true);
 set local role service_role;
 assert not exists(select 1 from public.claim_agent_job(array['publish_external'],60)),'stale publish job was claimed';
 assert (select status from public.agent_jobs where idempotency_key='p1' and organization_id=org)='blocked_needs_human','stale publish job not parked';
 reset role;

 -- Knowledge trust: member import stays unreviewed; only reviewer can trust; edits drop trust.
 perform set_config('request.jwt.claim.sub',member_id::text,true);
 set local role authenticated;
 insert into public.knowledge_entries(organization_id,slug,title,content) values(org,'imported','Imported','<script>x</script> raw') returning id into ke;
 assert (select trust_level='unreviewed' and content like '<script>%' from public.knowledge_entries where id=ke),'import not stored verbatim/unreviewed';
 denied:=false; begin update public.knowledge_entries set trust_level='trusted' where id=ke; exception when insufficient_privilege then denied:=true; end;
 assert denied,'member trusted knowledge';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 update public.knowledge_entries set trust_level='trusted' where id=ke;
 assert (select trust_level='trusted' and reviewed_by=owner_id from public.knowledge_entries where id=ke),'reviewer could not trust';
 perform set_config('request.jwt.claim.sub',member_id::text,true);
 update public.knowledge_entries set content='edited' where id=ke;
 assert (select trust_level='unreviewed' and reviewed_by is null from public.knowledge_entries where id=ke),'edit kept trust';
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 assert (select count(*) from public.knowledge_entries where organization_id=org)=0,'knowledge leaked across tenants';
 set local role anon;
 denied:=false; begin perform 1 from public.agent_jobs; exception when insufficient_privilege then denied:=true; end;
 assert denied,'anonymous job access';
 reset role;
end $$;
rollback;
select 'PASS: enqueue idempotency, browser/agent write limits, claim exclusivity, lease epoch, state machine, mandate approval by permitted human only, revision expiry parks stale jobs, knowledge trust, tenant isolation' as result;
