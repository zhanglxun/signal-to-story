-- Run as postgres against local or test Supabase. Fixtures are always rolled back.
begin;
do $$
declare
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); editor_id uuid:=gen_random_uuid(); viewer_id uuid:=gen_random_uuid();
 source_id bigint; selection_id bigint; category_id bigint; wechat_doc uuid; wechat_channel uuid; wechat_pub uuid; project uuid; doc uuid; channel uuid; pub uuid; count_rows integer; denied boolean;
begin
 insert into auth.users(id,email) values(owner_id,owner_id||'@example.invalid'),(editor_id,editor_id||'@example.invalid'),(viewer_id,viewer_id||'@example.invalid');
 insert into public.profiles(user_id,email,display_name) values(owner_id,owner_id||'@example.invalid','MVP owner'),(editor_id,editor_id||'@example.invalid','MVP editor'),(viewer_id,viewer_id||'@example.invalid','MVP viewer');
 insert into public.organizations(id,slug,name) values(org,'mvp-'||org,'MVP transaction test'),(other_org,'mvp-'||other_org,'Other tenant');
 insert into public.organization_roles(organization_id,role_key,name,description,permissions,assignment_permission) values
 (org,'owner','Owner','Test role',array['content.view','content.manage','content.review','content.publish'],'owner.grant'),
 (org,'member','Editor','Test role',array['content.view','content.manage'],'account.manage'),
 (org,'viewer','Viewer','Test role',array['content.view'],'account.manage');
 insert into public.organization_members(organization_id,user_id,role) values(org,owner_id,'owner'),(org,editor_id,'member'),(org,viewer_id,'viewer');
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 set local role authenticated;
 insert into public.source_categories(organization_id,name,created_by,updated_by) values(org,'Rehearsal sources',owner_id,owner_id) returning id into category_id;
 insert into public.signals(organization_id,category_id,name,site_url,summary,is_organized,created_by,updated_by) values(org,category_id,'Optogenetics source','https://erc.europa.eu/news-events/news/erc-grantee-peter-hegemann-shares-nobel-prize-medicine','Rehearsal: verified public source',true,owner_id,owner_id) returning id into source_id;
 insert into public.selections(organization_id,signal_id,name,core_thesis,created_by,updated_by) values(org,source_id,'Optogenetics explainer','Causal research, not mind reading',owner_id,owner_id) returning id into selection_id;
 insert into public.content_projects(organization_id,title,selection_id) values(org,'Cloud MVP Test',selection_id) returning id into project;
 assert (select s.signal_id=source_id from public.content_projects p join public.selections s on s.id=p.selection_id where p.id=project),'source lineage lost';
 insert into public.content_documents(organization_id,project_id,platform,title,body) values(org,project,'x','Test','First draft') returning id into doc;
 assert (select count(*) from public.content_revisions where document_id=doc)=1,'first revision missing';
 denied:=false;
 begin update public.content_documents set status='approved' where id=doc; exception when others then denied:=true; end;
 assert denied,'draft must not jump to approved';
 update public.content_documents set status='in_review' where id=doc;
 update public.content_documents set status='approved',review_note='Checked' where id=doc;
 insert into public.publishing_channels(organization_id,platform,name) values(org,'x','Test account') returning id into channel;
 insert into public.content_publications(organization_id,document_id,revision,channel_id,scheduled_at) values(org,doc,1,channel,now()) returning id into pub;
 update public.content_documents set body='Second draft' where id=doc and revision=1;
 assert (select revision=2 and status='draft' from public.content_documents where id=doc),'editing must invalidate approval';
 update public.content_documents set body='Stale overwrite' where id=doc and revision=1;
 get diagnostics count_rows=row_count; assert count_rows=0,'optimistic write must conflict';
 assert (select body='First draft' from public.content_revisions where document_id=doc and revision=1),'snapshot changed';
 denied:=false;
 begin update public.content_publications set status='published',published_url='https://example.com/test',published_at=now() where id=pub; exception when others then denied:=true; end;
 assert denied,'stale approved version must not publish';
 update public.content_publications set status='cancelled' where id=pub;
 -- Editor can submit, but cannot approve or publish.
 perform set_config('request.jwt.claim.sub',editor_id::text,true);
 update public.content_documents set status='in_review' where id=doc;
 denied:=false;
 begin update public.content_documents set status='approved' where id=doc; exception when insufficient_privilege then denied:=true; end;
 assert denied,'editor approved without permission';
 denied:=false;
 begin insert into public.publishing_channels(organization_id,platform,name) values(org,'youtube','forbidden'); exception when insufficient_privilege then denied:=true; end;
 assert denied,'editor published without permission';
 -- Viewer has read-only access.
 perform set_config('request.jwt.claim.sub',viewer_id::text,true);
 assert (select count(*) from public.content_documents where id=doc)=1,'viewer cannot read';
 update public.content_documents set body='viewer overwrite' where id=doc;
 get diagnostics count_rows=row_count; assert count_rows=0,'viewer wrote document';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 update public.content_documents set status='approved' where id=doc;
 insert into public.content_publications(organization_id,document_id,revision,channel_id,scheduled_at) values(org,doc,2,channel,now()) returning id into pub;
 update public.content_publications set status='published',published_url='https://example.com/test',published_at=now() where id=pub;
 insert into public.publication_metrics(organization_id,publication_id,observed_at,views,retrospective) values(org,pub,now(),0,'Test completed');
 assert (select views=0 and likes is null from public.publication_metrics where publication_id=pub),'missing metrics must differ from zero';
 -- A second destination must have its own draft, review and matching account.
 insert into public.content_documents(organization_id,project_id,platform,title,body) values(org,project,'wechat_official','WeChat explainer','Evidence and limitations') returning id into wechat_doc;
 insert into public.publishing_channels(organization_id,platform,name) values(org,'wechat_official','WeChat simulation only') returning id into wechat_channel;
 denied:=false;
 begin insert into public.content_publications(organization_id,document_id,revision,channel_id,scheduled_at) values(org,wechat_doc,1,wechat_channel,now()); exception when others then denied:=true; end;
 assert denied,'unapproved WeChat draft must not be scheduled';
 update public.content_documents set status='in_review' where id=wechat_doc;
 update public.content_documents set status='approved',review_note='Simulated reviewer in rollback-only fixture' where id=wechat_doc;
 denied:=false;
 begin insert into public.content_publications(organization_id,document_id,revision,channel_id,scheduled_at) values(org,wechat_doc,1,channel,now()); exception when others then denied:=true; end;
 assert denied,'WeChat draft accepted X account';
 insert into public.content_publications(organization_id,document_id,revision,channel_id,scheduled_at) values(org,wechat_doc,1,wechat_channel,now()) returning id into wechat_pub;
 update public.content_publications set status='published',published_url='https://example.invalid/simulation-wechat',published_at=now()-interval '49 hours' where id=wechat_pub;
 insert into public.publication_metrics(organization_id,publication_id,observed_at,views,retrospective) values
 (org,wechat_pub,now()-interval '25 hours',null,'SIMULATED 24-hour observation; unknown views'),
 (org,wechat_pub,now()-interval '1 hour',0,'SIMULATED 48-hour observation; known zero');
 assert (select count(*)=2 from public.publication_metrics where publication_id=wechat_pub),'24h/48h snapshots missing';
 assert (select views is null from public.publication_metrics where publication_id=wechat_pub order by observed_at limit 1),'unknown observation changed to zero';
 -- Immutable publication and revision history.
 denied:=false;
 begin update public.content_publications set published_url='https://example.com/rewrite' where id=pub; exception when others then denied:=true; end;
 assert denied,'completed publication modified';
 denied:=false;
 begin update public.content_revisions set body='tampered' where document_id=doc; exception when insufficient_privilege then denied:=true; end;
 assert denied,'history was writable';
 -- Same user must not create cross-tenant content.
 denied:=false;
 begin insert into public.content_projects(organization_id,title) values(other_org,'cross tenant'); exception when insufficient_privilege then denied:=true; end;
 assert denied,'cross tenant insert succeeded';
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 assert (select count(*) from public.content_documents where id=doc)=0,'outsider read document';
 set local role anon;
 denied:=false;
 begin perform 1 from public.content_documents; exception when insufficient_privilege then denied:=true; end;
 assert denied,'anonymous table access';
 reset role;
end $$;
rollback;
select 'PASS: source-to-topic-to-project, X then WeChat, 24h/48h simulated snapshots, rollback-only workflow, revision snapshots, conflicts, review/publish permissions, tenant isolation, immutable history, metrics' as result;
