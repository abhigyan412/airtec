/** @type {import('tailwindcss').Config} */
module.exports = {
  // Gates every `hover:` utility behind (hover: hover). This app is phone-first,
  // where :hover sticks after a tap and reads as a stuck selection.
  future: { hoverOnlyWhenSupported: true },
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      // One committed shape scale (see globals.css). `surface` is for cards,
      // sheets and dialogs; `control` for buttons, inputs and tiles; pills stay
      // fully round. Reaching outside these three is a bug, not a variation.
      borderRadius: {
        surface: 'var(--radius-surface)',
        control: 'var(--radius-control)',
        lg: 'var(--radius-control)',
        md: 'calc(var(--radius-control) - 2px)',
        sm: 'calc(var(--radius-control) - 4px)',
      },
      fontSize: {
        // Display steps for a 17px base. Bigger jumps than a desktop scale so
        // hierarchy survives being glanced at on a phone.
        'display-lg': ['2.125rem', { lineHeight: '1.1', letterSpacing: '-0.024em' }],
        display: ['1.75rem', { lineHeight: '1.15', letterSpacing: '-0.022em' }],
        title: ['1.3125rem', { lineHeight: '1.25', letterSpacing: '-0.015em' }],
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
        drawer: 'var(--ease-drawer)',
      },
      keyframes: {
        // Entrances start from an already-visible default (never scale(0)) and
        // travel a short distance — the content is the point, not the arrival.
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { transform: 'translateY(0)' },
          to: { transform: 'translateY(100%)' },
        },
        // Opacity-only, for scrims — a scrim that also moves reads as a second
        // object rather than as dimming.
        fade: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in var(--duration-base) var(--ease-out) both',
        'scale-in': 'scale-in var(--duration-fast) var(--ease-out) both',
        // Exits run shorter than entrances: on the way in the user is waiting to
        // see something, on the way out they've already decided and want it gone.
        'slide-up': 'slide-up var(--duration-base) var(--ease-drawer) both',
        'slide-down': 'slide-down var(--duration-fast) var(--ease-drawer) both',
        fade: 'fade var(--duration-fast) var(--ease-out) both',
        'fade-out': 'fade-out var(--duration-fast) var(--ease-out) both',
      },
    },
  },
  plugins: [],
}
