#!/usr/bin/env bash
# One-off live verification of the RLS cutover: noob vs member channel visibility.
set -euo pipefail
cd "$(dirname "$0")/.."

export $(grep -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' .env.local | xargs)
auth=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H 'Content-Type: application/json')

GROUP="42bb7fcd-0c0e-485d-8124-60a8c8082d0e"
NOOB="76baeaec-b0ce-4485-a55b-652cee5ba3f7"
ADMIN="bfe3c1e2-41e4-439c-8bb7-48d05cba84d2"

echo '-- channels in group (id, name, noob_access):'
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/channels?select=id,name,noob_access&group_id=eq.$GROUP&order=position" "${auth[@]}"
echo

echo '-- everyone VIEW overwrites backfilled:'
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/channel_overwrites?select=channel_id,allow,deny,roles(name,is_default)" "${auth[@]}"
echo

check() {
  local user="$1" channel="$2" label="$3"
  printf '%s -> ' "$label"
  curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/has_permission" "${auth[@]}" \
    -d "{\"p_group_id\":\"$GROUP\",\"p_channel_id\":\"$channel\",\"p_bit\":128,\"p_user_id\":\"$user\"}"
  echo
}

if [ "${1:-}" = "check" ]; then
  WELCOME_CH="$2"; NORMAL_CH="$3"
  check "$NOOB" "$WELCOME_CH" 'noob VIEW welcome (expect true)'
  check "$NOOB" "$NORMAL_CH" 'noob VIEW normal channel (expect false)'
  check "$ADMIN" "$NORMAL_CH" 'admin VIEW normal channel (expect true)'
fi
