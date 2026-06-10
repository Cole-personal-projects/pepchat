#!/usr/bin/env bash
# One-off verification that the roles engine migration seeded live data.
set -euo pipefail
cd "$(dirname "$0")/.."

export $(grep -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' .env.local | xargs)

auth=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")

echo '-- groups count:'
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/groups?select=id" "${auth[@]}" -H 'Prefer: count=exact' -I | grep -i content-range

echo '-- roles (per group):'
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/roles?select=group_id,name,is_default,permissions&order=group_id.asc,position.asc" "${auth[@]}"
echo

echo '-- member_roles count:'
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/member_roles?select=id" "${auth[@]}" -H 'Prefer: count=exact' -I | grep -i content-range

echo '-- group_members count:'
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/group_members?select=id" "${auth[@]}" -H 'Prefer: count=exact' -I | grep -i content-range
