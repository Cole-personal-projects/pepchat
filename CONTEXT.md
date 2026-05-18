# SideBar Context

This document defines durable SideBar domain terms. Future architecture PRs that introduce durable domain nouns must update `CONTEXT.md` in the same PR.

## Domain Glossary

| Term | Meaning |
|---|---|
| **Group** | A "server" in Discord parlance — top-level community with members, channels, an owner, invite codes, and audit history. Modeled by `groups` table. |
| **Channel** | A text room scoped to one Group. Has a `noob_access` flag controlling whether the noob role can read it. Modeled by `channels`. |
| **Membership** | A `(user, group)` tuple with a role. Modeled by `group_members`. Role is one of `admin \| moderator \| user \| noob`. |
| **Direct Message** (DM) | 1:1 conversation outside any Group. Stored in `direct_messages` + `dm_conversations`. |
| **Message** | A post in a Channel. Has optional attachments, reactions, replies, pins, edit history. |
| **Managed Invite** | An invite record with expiration, usage cap, revoke state, creator metadata, and usage history. Distinct from the legacy bearer-token invite code on the Group itself. |
| **Audit Event** | A row written to the audit log for lifecycle-relevant moderator/admin actions. |
| **Notification Event** | A row in the notification queue for mentions, DMs, and other addressable events. Includes delivery state (`pushed_at`, `push_error`). |
| **Presence** | Live status (`online \| away \| dnd`) + typing indicator. Driven by Supabase Realtime presence. |
| **Report** | A user-submitted moderation flag against a Message, with lifecycle states and moderator notes. |
