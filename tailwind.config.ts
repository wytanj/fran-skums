// Fran SKUMS design tokens — ported from fran-hrm / fran-mobile.
// House rules: warm cream page, brown ink (never pure grey/black), yellow for
// action/selection only, brown low-opacity shadows, generous radii.
import type { Config } from 'tailwindcss'

export default {
  content: [
    './app/**/*.{vue,ts}',
    './apps/**/*.{vue,ts}',
    './app.vue',
  ],
  theme: {
    extend: {
      colors: {
        yellow: { DEFAULT: '#FFE14D', soft: '#FFF4A8', deep: '#F0C820' },
        blue: { DEFAULT: '#5BBFE0', soft: '#D6F1F9' },
        cream: '#FFFEF5',
        peach: { DEFAULT: '#F2D2AE', soft: '#FAE8D4' },
        tan: '#C4A070',
        brown: { DEFAULT: '#3A2415', soft: '#5C4030', muted: '#8B7355' },
        ink: '#3A2415',
        'ink-soft': '#5C4030',
        muted: '#8B7355',
        line: { soft: '#F4EDDF', DEFAULT: '#EDE4D4', strong: '#D9CDB8' },
        surface: { DEFAULT: '#FFFFFF', sunken: '#FBF7EE' },
        success: { DEFAULT: '#2D8A5E', soft: '#E6F5EE' },
        warning: { DEFAULT: '#C47A1A', soft: '#FFF4E5' },
        danger: { DEFAULT: '#C43A3A', soft: '#FDECEC' },
        streak: '#E85D2A',
        // Keep brand.* as warm aliases so any leftover indigo-era tokens
        // still land on-palette rather than pure indigo.
        brand: {
          50: '#FFF9E6',
          100: '#FFF4A8',
          200: '#FFE14D',
          300: '#F0C820',
          400: '#C4A070',
          500: '#8B7355',
          600: '#5C4030',
          700: '#3A2415',
          800: '#2A1A0F',
          900: '#1A1009',
          950: '#0F0905',
        },
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        xs: '6px', sm: '10px', md: '14px', lg: '18px', xl: '24px', '2xl': '32px',
      },
      boxShadow: {
        'warm-xs': '0 1px 3px rgba(58,36,21,.04)',
        'warm-sm': '0 2px 10px rgba(58,36,21,.06)',
        'warm-md': '0 6px 20px rgba(58,36,21,.09)',
        'warm-lg': '0 14px 34px rgba(58,36,21,.13)',
        glow: '0 5px 14px rgba(240,200,32,.34)',
        nav: '0 5px 18px rgba(58,36,21,.16)',
      },
    },
  },
} satisfies Config
