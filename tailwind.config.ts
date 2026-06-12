import type { Config } from 'tailwindcss'

const config: Config = {
  future: {
    // Wrap hover:/group-hover: styles in @media (hover: hover). Touch
    // devices that emulate hover (iPad) otherwise reveal hover-only
    // controls on the first tap, and Safari swallows that tap as "hover
    // intent" — making channel rows take two taps to open.
    hoverOnlyWhenSupported: true,
  },
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        'bg-deepest':   '#120d0a',
        'bg-primary':   '#191310',
        'bg-secondary': '#211a15',
        'bg-tertiary':  '#2b221b',
        'bg-elevated':  '#312721',
        'accent':       '#f25c3d',
        'accent-hover': '#ff7150',
        'text-primary': '#f6ede0',
        'text-muted':   '#bcab98',
        'text-faint':   '#8f8071',
        'text-link':    '#f0a878',
        'online':       '#6aa08a',
        'typing':       '#d89a3a',
        // Keep legacy tokens for any components using var()-based Tailwind classes
        danger:  'var(--danger)',
        success: 'var(--success)',
      },
      borderRadius: {
        'sm':  '6px',
        'md':  '8px',
        'lg':  '12px',
        'xl':  '14px',
        '2xl': '16px',
      },
      spacing: {
        '13': '52px',
        '14': '56px',
      },
    },
  },
  plugins: [],
}

export default config
