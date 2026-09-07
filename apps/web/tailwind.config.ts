import type { Config } from 'tailwindcss'

/**
 * The palette from `docs/m0-design-brief.md`, closed rather than extended.
 *
 * Two rules of the brief are enforced here instead of being remembered:
 *
 * - `colors` is replaced, not extended, so Tailwind's own palette is gone. Colour
 *   carries exactly two meanings in this product — `moved` for what the policy
 *   displaced, `extracted` for value taken — and a stray `text-green-500` cannot be
 *   written by accident because the class does not exist.
 * - `fontFamily` is replaced too, so `font-mono` and `font-serif` do not exist. The
 *   brief bans monospace everywhere, addresses and signatures included.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      /** Page ground. */
      ground: '#EEF0F2',
      /** Panels that need separating from the ground. */
      panel: '#F7F8F9',
      /** Ink. */
      ink: '#141A24',
      /** Muted ink, for labels and anything the eye should pass over. */
      muted: '#5C6874',
      /** Hairline rules — the only structure in the layout. */
      hairline: '#CBD2D9',
      /** The policy moved this. Ribbons and changed positions. */
      moved: '#2B4C7E',
      /** Value extracted. Triple marks and extracted sums. */
      extracted: '#C8402B',
    },
    fontFamily: {
      sans: ['ui-sans-serif', 'system-ui', 'sans-serif'],
    },
    extend: {
      spacing: {
        /** Height of an ordering column, fixed regardless of transaction count. */
        column: '560px',
        /** Width of the ribbon field between the two columns. */
        field: '220px',
      },
    },
  },
  plugins: [],
} satisfies Config
