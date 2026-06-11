-- Role names become mention slugs: "@group-buy" must tokenize inside message
-- text, so spaces collapse to hyphens and only [A-Za-z0-9_-] survives.
-- @everyone (is_default) is exempt — it is never renamed or mentioned by slug.

do $$
declare
  r record;
  base_name text;
  new_name text;
  suffix int;
begin
  for r in
    select id, group_id, name
    from public.roles
    where not is_default
      and name ~ '[^A-Za-z0-9_-]'
  loop
    base_name := regexp_replace(
      regexp_replace(
        regexp_replace(trim(r.name), '\s+', '-', 'g'),
        '[^A-Za-z0-9_-]', '', 'g'
      ),
      '-{2,}', '-', 'g'
    );
    base_name := trim(both '-' from base_name);
    if base_name = '' then
      base_name := 'role';
    end if;

    new_name := base_name;
    suffix := 1;
    while exists (
      select 1 from public.roles
      where group_id = r.group_id and name = new_name and id <> r.id
    ) loop
      suffix := suffix + 1;
      new_name := base_name || '-' || suffix;
    end loop;

    update public.roles set name = new_name where id = r.id;
  end loop;
end
$$;
