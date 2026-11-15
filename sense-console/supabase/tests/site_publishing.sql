-- Run as postgres against local or test Supabase. Fixtures are always rolled back.
-- Covers: anon / unverified / verified readers A+B / editor / publisher / other organization,
-- publish gate on approved revision, immutable snapshots, unpublish, republish,
-- bookmarks, resource download authorization and back-office isolation.
begin;
do $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  publisher uuid := gen_random_uuid(); editor uuid := gen_random_uuid(); other_publisher uuid := gen_random_uuid();
  reader_a uuid := gen_random_uuid(); reader_b uuid := gen_random_uuid(); unverified uuid := gen_random_uuid();
  site uuid; other_site uuid; category uuid; project uuid; doc_public uuid; doc_registered uuid; doc_draft uuid;
  result jsonb; entry_public uuid; entry_registered uuid; res_public uuid; res_registered uuid;
  n integer; denied boolean; msg text;
begin
  insert into auth.users (id, email, email_confirmed_at) values
    (publisher, publisher || '@example.invalid', now()), (editor, editor || '@example.invalid', now()),
    (other_publisher, other_publisher || '@example.invalid', now()),
    (reader_a, reader_a || '@example.invalid', now()), (reader_b, reader_b || '@example.invalid', now()),
    (unverified, unverified || '@example.invalid', null);
  insert into public.profiles (user_id, email, display_name) values
    (publisher, publisher || '@example.invalid', 'Site publisher'), (editor, editor || '@example.invalid', 'Site editor'),
    (other_publisher, other_publisher || '@example.invalid', 'Other publisher');
  insert into public.organizations (id, slug, name) values (org, 'site-' || org, 'Site test'), (other_org, 'site-' || other_org, 'Other tenant');
  insert into public.organization_roles (organization_id, role_key, name, description, permissions, assignment_permission) values
    (org, 'owner', 'Owner', 'Test role', array['content.view', 'content.manage', 'content.review', 'content.publish'], 'owner.grant'),
    (org, 'member', 'Editor', 'Test role', array['content.view', 'content.manage'], 'account.manage'),
    (other_org, 'owner', 'Owner', 'Test role', array['content.view', 'content.manage', 'content.review', 'content.publish'], 'owner.grant');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, publisher, 'owner'), (org, editor, 'member'), (other_org, other_publisher, 'owner');
  insert into public.site_settings (organization_id, slug, name, status) values (org, 'site-' || org, 'Test site', 'online') returning id into site;
  insert into public.site_settings (organization_id, slug, name, status) values (other_org, 'site-' || other_org, 'Other site', 'online') returning id into other_site;
  insert into public.site_categories (organization_id, site_id, slug, name) values (org, site, 'enterprise-ai', '企业 AI 实战') returning id into category;

  -- Back office prepares two approved documents and one draft.
  perform set_config('request.jwt.claim.sub', publisher::text, true);
  set local role authenticated;
  insert into public.content_projects (organization_id, title) values (org, 'Site test project') returning id into project;
  insert into public.content_documents (organization_id, project_id, platform, title, body)
    values (org, project, 'master', 'Public article', E'# Public\n\nFirst approved body') returning id into doc_public;
  insert into public.content_documents (organization_id, project_id, platform, title, body)
    values (org, project, 'x', 'Registered article', 'Registered approved body') returning id into doc_registered;
  insert into public.content_documents (organization_id, project_id, platform, title, body)
    values (org, project, 'youtube', 'Draft only', 'Never published') returning id into doc_draft;
  update public.content_documents set status = 'in_review' where id in (doc_public, doc_registered);
  update public.content_documents set status = 'approved', review_note = 'ok' where id in (doc_public, doc_registered);

  -- Gate: draft and stale revisions cannot publish; member access level is rejected.
  denied := false;
  begin perform public.publish_site_entry(site, doc_draft, 1, '{"slug":"draft","summary":"s"}'); exception when others then denied := true; end;
  assert denied, 'draft must not publish';
  denied := false;
  begin perform public.publish_site_entry(site, doc_public, 2, '{"slug":"stale","summary":"s"}'); exception when others then denied := true; end;
  assert denied, 'non-current revision must not publish';
  denied := false;
  begin perform public.publish_site_entry(site, doc_public, 1, '{"slug":"paid","summary":"s","access_level":"member"}'); exception when others then denied := true; end;
  assert denied, 'member access level must be rejected in v1';
  denied := false;
  begin perform public.publish_site_entry(site, doc_public, 1, '{"slug":"bad","summary":"s","cover_url":"javascript:alert(1)","cover_alt":"x"}'); exception when others then denied := true; end;
  assert denied, 'unsafe cover url must be rejected';

  result := public.publish_site_entry(site, doc_public, 1, jsonb_build_object('slug', 'public-article', 'summary', 'Public summary', 'category_id', category));
  entry_public := (result ->> 'entry_id')::uuid;
  assert result ->> 'action' = 'publish' and (result ->> 'version')::int = 1, 'first publish failed';
  result := public.publish_site_entry(site, doc_public, 1, jsonb_build_object('slug', 'public-article', 'summary', 'Public summary', 'category_id', category));
  assert (result ->> 'unchanged')::boolean, 'same revision and metadata must be idempotent';
  result := public.publish_site_entry(site, doc_registered, 1, '{"slug":"registered-article","summary":"Registered summary","access_level":"registered"}');
  entry_registered := (result ->> 'entry_id')::uuid;
  denied := false;
  begin perform public.publish_site_entry(site, doc_registered, 1, '{"slug":"public-article","summary":"dup"}'); exception when unique_violation then denied := true; end;
  assert denied, 'slug collision must be rejected';

  -- Resources: one public, one registered-only.
  insert into public.site_resources (organization_id, site_id, entry_id, title, file_name, access_level, status)
    values (org, site, entry_public, 'Public checklist', 'checklist.pdf', 'public', 'online') returning id into res_public;
  insert into public.site_resources (organization_id, site_id, title, file_name, access_level, status)
    values (org, site, 'Registered template', 'template.zip', 'registered', 'online') returning id into res_registered;
  insert into public.site_resource_files (resource_id, organization_id, site_id, object_path)
    values (res_public, org, site, org || '/' || site || '/checklist.pdf'), (res_registered, org, site, org || '/' || site || '/template.zip');
  -- Publisher uploads through storage RLS (path is <organization_id>/<site_id>/<file>).
  insert into storage.objects (bucket_id, name) values
    ('site-resources', org || '/' || site || '/checklist.pdf'), ('site-resources', org || '/' || site || '/template.zip');
  denied := false;
  begin insert into storage.objects (bucket_id, name) values ('site-resources', other_org || '/' || other_site || '/x.pdf'); exception when insufficient_privilege then denied := true; end;
  assert denied, 'publisher uploaded into another organization folder';

  -- Editor without content.publish cannot publish or unpublish.
  perform set_config('request.jwt.claim.sub', editor::text, true);
  denied := false;
  begin perform public.unpublish_site_entry(entry_public, ''); exception when insufficient_privilege then denied := true; end;
  assert denied, 'editor unpublished without permission';
  -- Other organization cannot publish into this site, nor see its back-office rows.
  perform set_config('request.jwt.claim.sub', other_publisher::text, true);
  denied := false;
  begin perform public.publish_site_entry(site, doc_public, 1, '{"slug":"steal","summary":"s"}'); exception when insufficient_privilege then denied := true; end;
  assert denied, 'cross-organization publish must be denied';
  denied := false;
  begin perform public.publish_site_entry(other_site, doc_public, 1, '{"slug":"steal","summary":"s"}'); exception when insufficient_privilege then denied := true; end;
  assert denied, 'foreign document must not publish to own site';
  assert (select count(*) from public.site_entry_releases where site_id = site) = 0, 'other org read releases';

  -- Anonymous visitor.
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  assert (select count(*) from public.site_entries where site_id = site) = 2, 'anon must see both online cards';
  assert (select count(*) from public.site_entry_bodies where site_id = site) = 1, 'anon must only read public body';
  assert (select count(*) from public.site_resource_files where site_id = site) = 1, 'anon must only download public resource';
  assert (select count(*) from public.site_resources where site_id = site) = 2, 'anon must see resource listing';
  assert (select count(*) from storage.objects where bucket_id = 'site-resources') = 1, 'anon must only read the public object';
  foreach msg in array array[
    'select count(*) from public.content_documents', 'select count(*) from public.content_revisions',
    'select count(*) from public.site_entry_releases', 'select source_document_id from public.site_entries',
    'select count(*) from public.site_bookmarks', 'select count(*) from public.organization_members'] loop
    denied := false;
    begin execute msg; exception when insufficient_privilege then denied := true; end;
    assert denied, 'anon was allowed: ' || msg;
  end loop;
  denied := false;
  begin perform public.publish_site_entry(site, doc_public, 1, '{"slug":"anon","summary":"s"}'); exception when insufficient_privilege then denied := true; end;
  assert denied, 'anon executed publish';

  -- Unverified reader behaves like a visitor for registered content.
  reset role;
  perform set_config('request.jwt.claim.sub', unverified::text, true);
  set local role authenticated;
  assert (select count(*) from public.site_entry_bodies where site_id = site) = 1, 'unverified reader read registered body';
  assert (select count(*) from storage.objects where bucket_id = 'site-resources') = 1, 'unverified reader read registered object';
  denied := false;
  begin insert into public.site_bookmarks (site_id, entry_id) values (site, entry_public); exception when insufficient_privilege then denied := true; end;
  assert denied, 'unverified reader bookmarked';

  -- Verified reader A.
  perform set_config('request.jwt.claim.sub', reader_a::text, true);
  assert (select count(*) from public.site_entry_bodies where site_id = site) = 2, 'verified reader must read registered body';
  assert (select count(*) from public.site_resource_files where site_id = site) = 2, 'verified reader must download registered resource';
  assert (select count(*) from storage.objects where bucket_id = 'site-resources') = 2, 'verified reader must read registered object';
  assert (select count(*) from public.content_documents) = 0, 'reader read back-office documents';
  assert (select count(*) from public.organizations) = 0, 'reader read organizations';
  assert (select count(*) from public.organization_members) = 0, 'reader read memberships';
  assert (select count(*) from public.site_entry_releases) = 0, 'reader read releases';
  assert (select count(*) from public.site_release_events) = 0, 'reader read release events';
  insert into public.site_readers (site_id, display_name) values (site, 'Reader A');
  insert into public.site_bookmarks (site_id, entry_id) values (site, entry_public), (site, entry_registered);
  denied := false;
  begin insert into public.site_bookmarks (user_id, site_id, entry_id) values (reader_b, site, entry_public); exception when insufficient_privilege then denied := true; end;
  assert denied, 'reader A wrote bookmark for B';
  foreach msg in array array[
    format('update public.site_entries set title = %L where id = %L', 'hijack', entry_public),
    format('update public.site_entries set access_level = %L where id = %L', 'public', entry_registered),
    format('insert into public.site_entry_bodies (release_id, organization_id, site_id, entry_id, markdown) values (gen_random_uuid(), %L, %L, %L, %L)', org, site, entry_public, 'x'),
    format('update public.site_settings set status = %L where id = %L', 'offline', site),
    format('insert into public.site_categories (organization_id, site_id, slug, name) values (%L, %L, %L, %L)', org, site, 'spam', 'spam')] loop
    denied := false;
    begin execute msg; get diagnostics n = row_count; denied := n = 0; exception when insufficient_privilege then denied := true; end;
    assert denied, 'reader was allowed: ' || msg;
  end loop;

  -- Reader B cannot see A's bookmarks or profile.
  perform set_config('request.jwt.claim.sub', reader_b::text, true);
  assert (select count(*) from public.site_bookmarks) = 0, 'reader B saw A bookmarks';
  assert (select count(*) from public.site_readers) = 0, 'reader B saw A profile';
  delete from public.site_bookmarks where entry_id = entry_public;
  perform set_config('request.jwt.claim.sub', reader_a::text, true);
  assert (select count(*) from public.site_bookmarks) = 2, 'reader B deleted A bookmark';

  -- Editing the source after publish does not change the live snapshot.
  perform set_config('request.jwt.claim.sub', publisher::text, true);
  update public.content_documents set body = 'Edited after publish' where id = doc_public;
  assert (select b.markdown from public.site_entry_bodies b join public.site_entries e on e.current_release_id = b.release_id where e.id = entry_public) = E'# Public\n\nFirst approved body', 'snapshot followed draft';
  denied := false;
  begin perform public.publish_site_entry(site, doc_public, 2, '{"slug":"public-article","summary":"Public summary"}'); exception when others then denied := true; end;
  assert denied, 'unreviewed edit must not publish';

  -- Unpublish: entry, body, bookmarks and resources disappear for readers.
  result := public.unpublish_site_entry(entry_public, 'test offline');
  assert result ->> 'status' = 'offline', 'unpublish failed';
  assert (select count(*) from public.site_entries where id = entry_public and status = 'offline') = 1, 'back office lost sight of offline entry';
  assert (select count(*) from public.site_entry_releases r join public.site_entries e on e.id = r.entry_id where r.source_document_id = doc_public) = 1, 'back office cannot list document releases';
  perform set_config('request.jwt.claim.sub', reader_a::text, true);
  assert (select count(*) from public.site_entries where id = entry_public) = 0, 'offline entry visible';
  assert (select count(*) from public.site_entry_bodies where entry_id = entry_public) = 0, 'offline body visible';
  assert (select count(*) from public.site_bookmarks) = 1, 'offline bookmark visible';
  assert (select count(*) from public.site_resource_files where resource_id = res_public) = 0, 'offline entry resource downloadable';

  -- Re-review and republish switches to a new immutable version.
  perform set_config('request.jwt.claim.sub', publisher::text, true);
  update public.content_documents set status = 'in_review' where id = doc_public;
  update public.content_documents set status = 'approved', review_note = 'ok again' where id = doc_public;
  result := public.publish_site_entry(site, doc_public, 2, '{"slug":"public-article","summary":"Public summary v2"}');
  assert result ->> 'action' = 'republish' and (result ->> 'version')::int = 2, 'republish failed';
  assert (select count(*) from public.site_entry_releases where entry_id = entry_public) = 2, 'release history lost';
  assert (select array_agg(action order by id) from public.site_release_events where entry_id = entry_public) = array['publish', 'unpublish', 'republish'], 'release events incomplete';
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  assert (select markdown from public.site_entry_bodies where entry_id = entry_public) = 'Edited after publish', 'anon must read new version only';
  assert (select count(*) from public.site_entry_bodies where entry_id = entry_public) = 1, 'old version leaked';

  -- Snapshots are append-only even for the database owner.
  reset role;
  denied := false;
  begin update public.site_entry_bodies set markdown = 'tamper' where entry_id = entry_public; exception when insufficient_privilege then denied := true; end;
  assert denied, 'snapshot body mutated';
  denied := false;
  begin delete from public.site_entry_releases where entry_id = entry_public; exception when insufficient_privilege then denied := true; end;
  assert denied, 'release deleted';
end $$;
rollback;
