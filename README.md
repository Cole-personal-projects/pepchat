# 🌶️ SideBar

A real-time Discord-light chat app built with **Next.js 14**, **Supabase**, and **Tailwind CSS**. Multiple groups, multiple channels, live messaging, presenze indicators, and a full role-based permission system — no external UI libraries.

---

## ✨ Features

### 💬 Real-Time Messaging
- Send and receive messages instantly via **Supabase Realtime Broadcast**
- Compact mode — consecutive messages from the same user collapse the avatar/header
- Date separators, edited indicators, and smooth auto-scroll
- Inline edit and delete for your own messages
- Paginated history — load earlier messages on demand

### 🏠 Groups (Servers)
- Create groups with a name and optional icon
- Invite others with a shareable **invite code**
- Leave or delete groups
- `#welcome` and `#general` channels created automatically

### 📢 Channels
- Create and delete text channels (admins / moderators)
- Reorder channels with up/down controls
- Noobs are restricted to `#welcome` until promoted

### 🔐 Role-Based Access Control

| Role | Capabilities |
|---|---|
| **admin** | Full control — manage channels, assign roles, kick members, delete group |
| **moderator** | Manage channels, kick users/noobs, view members panel |
| **user** | Send messages, edit/delete own messages |
| **noob** | Read-only access to `#welcome` until promoted |

- Roles enforced at both **database level** (Postgres RLS) and **UI level**
- Admins can promote/demote members live via dropdown in the sidebar
- Kick button with confirmation dialog

### 👥 Presence
- Typing indicators — "[user] is typing…" updates live
- Collapsible **Online Members** panel on the right side of the chat area
- Green online dot on avatars

### 📱 Responsive
- Full desktop 3-panel layout
- Mobile: sidebars slide in as an overlay via hamburger menu

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 14](https://nextjs.org) (App Router, Server Actions) |
| Database | [Supabase](https://supabase.com) (Postgres + Realtime + Auth) |
| Styling | [Tailwind CSS](https://tailwindcss.com) — no external UI libraries |
| Auth | Supabase Auth (email / password) |
| Deployment | [Cloudflare Pages](https://pages.cloudflare.com) via `@cloudflare/next-on-pages` |
| Language | TypeScript (strict mode) |

---

## 🗂️ Project Structure

```
├── app/
│   ├── (auth)/          # Login, signup, profile setup
│   └── (app)/           # Authenticated shell + routes
│       ├── channels/    # Channel pages + server actions
│       ├── groups/      # Group actions
│       ├── members/     # Role assignment + kick actions
│       └── messages/    # Message CRUD actions
├── components/
│   ├── chat/            # MessageList, MessageInput, ChannelShell,
│   │                    # TypingIndicator, PresencePanel
│   ├── modals/          # Create/join group, channel, settings
│   ├── sidebar/         # GroupsSidebar, ChannelsSidebar, MembersPanel
│   └── ui/              # Avatar, Button, Modal
├── lib/
│   ├── hooks/           # useMessages, usePresence, useGroups, useChannels
│   ├── supabase/        # Browser + server + middleware clients
│   ├── permissions.ts   # Central RBAC helper
│   └── types.ts         # TypeScript interfaces
├── schema.sql           # Full DB setup — run on a fresh Supabase project
├── migrate-roles.sql    # RBAC migration (role enum + updated RLS policies)
└── wrangler.toml        # Cloudflare Pages config
```

---

## 🚀 Getting Started

### 1. Clone & install

```bash
git clone https://github.com/ColeMatthewBienek/pepchat.git
cd pepchat
npm install
```

### 2. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run `schema.sql` in the Supabase **SQL Editor** to create all tables, RLS policies, and indexes
3. Run `image-paste-migration.sql` in the SQL Editor to add the `attachments` column and create the `chat-images` storage bucket with RLS policies
4. Enable **Email confirmations off** under Authentication → Email (for local dev)

### 3. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in your values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## ☁️ Deploy to Cloudflare Pages

```bash
# Build for Cloudflare Pages
npm run pages:build

# Deploy
npm run pages:deploy
```

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as **environment variables** in the Cloudflare Pages dashboard.

---

## 🗄️ Database

The full schema lives in `schema.sql` and can be re-run on any fresh Supabase project to recreate everything:

- `profiles` — extends `auth.users` with username + avatar
- `groups` — servers with invite codes
- `group_members` — membership + role (`admin | moderator | user | noob`)
- `channels` — text channels with position ordering
- `messages` — channel messages with edit history
- `direct_messages` — 1:1 DM table (stubbed)

Row Level Security is enforced on all tables. Security-definer helper functions prevent RLS recursion.

---

## 📄 License

MIT
