#!/usr/bin/env bash
# One-off live spot check of has_permission() against seeded data.
set -euo pipefail
cd "$(dirname "$0")/.."

export $(grep -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' .env.local | xargs)
auth=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H 'Content-Type: application/json')

echo '-- sample memberships (group, user, enum role):'
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/group_members?select=group_id,user_id,role&order=role.asc&limit=7" "${auth[@]}"
echo

rpc() {
  local group="$1" user="$2" bit="$3" label="$4"
  printf '%s -> ' "$label"
  curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/has_permission" "${auth[@]}" \
    -d "{\"p_group_id\":\"$group\",\"p_channel_id\":null,\"p_bit\":$bit,\"p_user_id\":\"$user\"}"
  echo
}

# Fill in below after reading the membership list output.
if [ "${1:-}" = "check" ]; then
  GROUP="$2"; ADMIN_USER="$3"; PLAIN_USER="$4"
  rpc "$GROUP" "$ADMIN_USER" 8 'admin MANAGE_CHANNELS (expect true)'
  rpc "$GROUP" "$ADMIN_USER" 4194304 'admin MANAGE_ONBOARDING (expect true)'
  rpc "$GROUP" "$PLAIN_USER" 8 'member MANAGE_CHANNELS (expect false)'
  rpc "$GROUP" "$PLAIN_USER" 256 'member SEND_MESSAGES (expect true)'
  rpc "$GROUP" "$PLAIN_USER" 2097152 'member CREATE_EVENTS (expect true)'
fi
