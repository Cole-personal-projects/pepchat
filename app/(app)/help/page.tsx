import Link from 'next/link'

const userTasks = [
  {
    title: 'Join or create a group',
    body: 'Use an invite link or code to join an existing group. If you do not have any groups yet, SideBar opens the group creator so you can start one.',
  },
  {
    title: 'Find your channels',
    body: 'Channels live inside each group. New members usually start in #welcome, then gain access to the rest of the group after an admin or moderator promotes them.',
  },
  {
    title: 'Send messages and media',
    body: 'Use the message box to chat, upload images, add GIFs, react, reply, pin important posts when your role allows it, and delete your own messages.',
  },
  {
    title: 'Search conversations',
    body: 'Use channel or group search to find older messages without scrolling through the full history.',
  },
  {
    title: 'Direct message people',
    body: 'Start a DM from a member profile or the DM section. DMs are separate from group channels.',
  },
  {
    title: 'Control notifications',
    body: 'Open your profile settings to adjust notification preferences and keep unread channels manageable.',
  },
]

const adminTasks = [
  {
    title: 'Set up the first channels',
    body: 'Keep #welcome clear for first steps, use #general for day-to-day chat, and add focused channels as the group grows.',
  },
  {
    title: 'Manage invites',
    body: 'Create invite links with optional expiration dates and usage limits, review usage history, and revoke links that should no longer work.',
  },
  {
    title: 'Promote trusted members',
    body: 'New members enter as noobs. Admins can promote members to user or moderator when they are ready for broader access.',
  },
  {
    title: 'Moderate the group',
    body: 'Admins and moderators can remove disruptive messages, review reports, and kick members when needed.',
  },
  {
    title: 'Review admin records',
    body: 'The admin dashboard tracks reports, moderation work, user management, group deletion, invite changes, and role changes.',
  },
]

const roles = [
  ['Admin', 'Owns the group, manages settings, invites, roles, channels, reports, and member removal.'],
  ['Moderator', 'Helps manage channels, messages, reports, invites, and member removal within the limits set by admins.'],
  ['User', 'Participates in normal group channels, DMs, reactions, uploads, and message management.'],
  ['Noob', 'Starts with limited access, usually #welcome, until promoted by an admin.'],
]

export default function HelpPage() {
  return (
    <main className="h-full overflow-y-auto bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 pb-24 pt-8 md:px-8 md:pb-8">
        <header className="border-b border-[var(--border-soft)] pb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-[var(--accent)]">SideBar Help</p>
          <h1 className="mt-2 text-3xl font-semibold">Use SideBar without losing your place</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
            SideBar is organized around private groups, channels, direct messages, and lightweight moderation.
            This page is a reference you can open when you need it; the app stays out of your way while you chat.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/channels"
              className="rounded border border-[var(--border-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              Back to channels
            </Link>
            <Link
              href="/settings/profile"
              className="rounded border border-[var(--border-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              Profile settings
            </Link>
          </div>
        </header>

        <section>
          <h2 className="text-xl font-semibold">Everyday Tasks</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {userTasks.map(task => (
              <article key={task.title} className="rounded border border-[var(--border-soft)] bg-[var(--bg-secondary)] p-4">
                <h3 className="text-base font-semibold">{task.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{task.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Roles</h2>
          <div className="mt-4 overflow-hidden rounded border border-[var(--border-soft)]">
            {roles.map(([role, description]) => (
              <div key={role} className="grid gap-2 border-b border-[var(--border-soft)] bg-[var(--bg-secondary)] p-4 last:border-b-0 md:grid-cols-[140px_1fr]">
                <div className="text-sm font-semibold">{role}</div>
                <div className="text-sm leading-6 text-[var(--text-muted)]">{description}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Admin And Moderator Tasks</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {adminTasks.map(task => (
              <article key={task.title} className="rounded border border-[var(--border-soft)] bg-[var(--bg-secondary)] p-4">
                <h3 className="text-base font-semibold">{task.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{task.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-[var(--border-soft)] pt-6">
          <h2 className="text-xl font-semibold">First Group Checklist</h2>
          <ol className="mt-4 space-y-3 text-sm leading-6 text-[var(--text-muted)]">
            <li>1. Set a clear group name and description in group settings.</li>
            <li>2. Keep #welcome focused on new-member orientation.</li>
            <li>3. Create a limited invite for the people you want to bring in.</li>
            <li>4. Promote trusted members after they arrive.</li>
            <li>5. Review reports and the audit log when moderation work happens.</li>
          </ol>
        </section>
      </div>
    </main>
  )
}
