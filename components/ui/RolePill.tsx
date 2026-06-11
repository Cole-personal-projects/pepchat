interface RolePillProps {
  role: 'owner' | 'admin' | 'moderator' | 'user' | 'noob'
  size?: 'sm' | 'md'
}

const ROLE_MAP = {
  owner:     { label: 'owner', glyph: '♛', tone: '#e6543a', bg: 'rgba(230,84,58,0.14)' },
  admin:     { label: 'admin', glyph: '♕', tone: '#d89a3a', bg: 'rgba(216,154,58,0.14)' },
  moderator: { label: 'mod',   glyph: '⚡', tone: '#c070a0', bg: 'rgba(192,112,160,0.14)' },
  noob:      { label: 'new',   glyph: '🌱', tone: '#6aa08a', bg: 'rgba(106,160,138,0.14)' },
} as const

export default function RolePill({ role, size = 'sm' }: RolePillProps) {
  if (role === 'user') return null

  const cfg = ROLE_MAP[role]
  const fontSize = size === 'sm' ? 10 : 11
  const padding  = size === 'sm' ? '1px 6px' : '2px 8px'

  return (
    <span
      data-testid="role-pill"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        background: cfg.bg,
        color: cfg.tone,
        fontSize,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding,
        borderRadius: 999,
        lineHeight: 1.4,
        userSelect: 'none',
      }}
    >
      {cfg.glyph} {cfg.label}
    </span>
  )
}
