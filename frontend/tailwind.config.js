/** @type {import('tailwindcss').Config} */

// "Tabletop Picnic" palette — soft pastel parchment, warm ink-green, and a
// playful trio of board-game accents (butter / sage / coral). Re-skinning the
// default Tailwind scales lets the whole app inherit the new comfy look without
// touching component markup; the named tokens below (butter, sage, coral, ink,
// moss, cream, parchment) are used for intentional "sticker card" styling.

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        xs: '480px',
      },
      fontFamily: {
        sans: ['Satoshi', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Cabinet Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Spline Sans Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // ── Board-game named tokens (use these for intentional styling) ──
        parchment: '#f5f1e8',   // page background
        cream: '#fffaf0',       // card / "white" surface
        butter: '#f4d89f',      // warm primary accent
        sage: '#c9d7a1',        // calm secondary accent
        coral: '#e8a084',       // pop / playful accent
        ink: '#283421',         // near-black warm green (text & borders)
        moss: '#526246',        // muted green (secondary text)

        // Cards / "white" surfaces → cream so they float on the parchment bg.
        white: '#fffaf0',

        // Neutral — warm stone/parchment with a faint green-ink dark end.
        gray: {
          50: '#f6f1e6', 100: '#ece2d0', 200: '#ddd0b4', 300: '#c5b793',
          400: '#9a8d6c', 500: '#6e6850', 600: '#524d3a', 700: '#3d3a2b',
          800: '#2b2a1f', 900: '#222a1b', 950: '#151a10',
        },

        // Primary — moss → sage green (buttons, links, active nav, focus rings).
        indigo: {
          50: '#eef3e4', 100: '#dde8c6', 200: '#c9d7a1', 300: '#aec17d',
          400: '#8fa75a', 500: '#6f8a44', 600: '#586d3c', 700: '#46552f',
          800: '#374324', 900: '#283421', 950: '#19200f',
        },

        // Danger — warm coral/terracotta (errors, delete, alert dots).
        red: {
          50: '#fcefe8', 100: '#f9dccd', 200: '#f0b89e', 300: '#e8a084',
          400: '#db7a57', 500: '#c95c39', 600: '#ab4527', 700: '#88341d',
          800: '#682716', 900: '#4e1d11', 950: '#2f1008',
        },

        // Success — muted sage.
        green: {
          50: '#eef4e1', 100: '#dbe8bf', 200: '#c1d693', 300: '#a4c067',
          400: '#88a648', 500: '#6d8a36', 600: '#58712b', 700: '#455822',
          800: '#36441b', 900: '#293414', 950: '#161d0b',
        },

        // Money / positive — cooler sage.
        emerald: {
          50: '#e8f1ea', 100: '#cce0d2', 200: '#a3c8ae', 300: '#74ab86',
          400: '#4f9065', 500: '#3a7650', 600: '#2e6342', 700: '#245033',
          800: '#1b3d27', 900: '#142f1e', 950: '#0a1c11',
        },

        // Wants — soft plum / mulberry.
        purple: {
          50: '#f6edf2', 100: '#ecd8e4', 200: '#dcb6cd', 300: '#c890b2',
          400: '#b06d97', 500: '#955078', 600: '#7a4061', 700: '#62334e',
          800: '#4c283c', 900: '#391d2c', 950: '#21101a',
        },

        // Match cycles — pastel lavender.
        violet: {
          50: '#f1edf7', 100: '#e1d6ef', 200: '#c8b3e0', 300: '#aa8bce',
          400: '#8e66b6', 500: '#74509b', 600: '#5f3f80', 700: '#4d3367',
          800: '#3b2850', 900: '#2c1d3c', 950: '#190f22',
        },

        // Specific listings — dusty powder blue.
        blue: {
          50: '#ecf1f4', 100: '#d6e3e8', 200: '#b3cdd6', 300: '#88aebc',
          400: '#608ea1', 500: '#467186', 600: '#385a6c', 700: '#2d4757',
          800: '#243845', 900: '#1c2b35', 950: '#111a20',
        },

        // Warning — honey/butter.
        amber: {
          50: '#fbf2da', 100: '#f6e4ad', 200: '#f0d07a', 300: '#e6b647',
          400: '#d49a28', 500: '#b27d20', 600: '#8e611a', 700: '#6b4915',
          800: '#4e3510', 900: '#39270c', 950: '#221706',
        },

        // Warning (brighter) — bright butter.
        yellow: {
          50: '#fdf6da', 100: '#f9e9a0', 200: '#f2d863', 300: '#e3c038',
          400: '#cca528', 500: '#a98620', 600: '#84681a', 700: '#624d15',
          800: '#473810', 900: '#34290c', 950: '#1f1807',
        },

        // Secondary status accents (kept pastel so misc badges stay on-palette).
        // Sage-teal.
        teal: {
          50: '#e6f1ee', 100: '#c8e2dc', 200: '#9fccc3', 300: '#6fb1a6',
          400: '#479389', 500: '#327a70', 600: '#27645c', 700: '#1f4f49',
          800: '#193e39', 900: '#142f2b', 950: '#0a1917',
        },
        // Airy powder blue.
        sky: {
          50: '#e9f4f6', 100: '#d0e8ec', 200: '#a8d3da', 300: '#76b6c2',
          400: '#4f97a6', 500: '#3a7d8b', 600: '#2f6573', 700: '#264f5b',
          800: '#203f48', 900: '#193038', 950: '#0f1d22',
        },
        // Peach / terracotta.
        orange: {
          50: '#fcefe6', 100: '#f8dcc8', 200: '#f0bd9b', 300: '#e69b6c',
          400: '#d97c45', 500: '#c2602b', 600: '#a14a20', 700: '#7e3a1a',
          800: '#5f2c14', 900: '#46210f', 950: '#2a1308',
        },
        // Soft green-yellow.
        lime: {
          50: '#f2f5e0', 100: '#e3ebbd', 200: '#cdda8a', 300: '#b3c659',
          400: '#9aaf3a', 500: '#7e922c', 600: '#647523', 700: '#4d5b1d',
          800: '#3c4718', 900: '#2e3613', 950: '#181d09',
        },
      },
      borderRadius: {
        // Rounder, comfier everything (board-game token feel).
        none: '0', sm: '0.375rem', DEFAULT: '0.625rem', md: '0.75rem',
        lg: '1rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '2rem', full: '9999px',
      },
      boxShadow: {
        // Warm, low-spread "printed paper" depth (cool default shadows → ink-green).
        sm: '0 1px 2px 0 rgb(40 52 33 / 0.07)',
        DEFAULT: '0 1px 3px 0 rgb(40 52 33 / 0.10), 0 1px 2px -1px rgb(40 52 33 / 0.08)',
        md: '0 4px 12px -2px rgb(40 52 33 / 0.12), 0 2px 6px -2px rgb(40 52 33 / 0.08)',
        lg: '0 14px 28px -8px rgb(40 52 33 / 0.16)',
        xl: '0 22px 44px -12px rgb(40 52 33 / 0.20)',
        '2xl': '0 30px 64px -14px rgb(40 52 33 / 0.26)',
        // Playful "sticker / token" depth — soft offset drop plus ambient.
        card: '0 8px 0 -2px rgb(82 98 70 / 0.18), 0 18px 32px -14px rgb(40 52 33 / 0.22)',
        // Chunky pressable button (hard offset, no blur).
        pop: '0 4px 0 0 rgb(40 52 33 / 0.55)',
        'pop-sm': '0 3px 0 0 rgb(40 52 33 / 0.45)',
        soft: '0 14px 35px -10px rgb(40 52 33 / 0.14)',
      },
    },
  },
  plugins: [],
}
