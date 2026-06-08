/** @type {import('tailwindcss').Config} */

// "Tabletop Almanac" palette — warm parchment + ink, a deep petrol-teal signature
// (remapped onto `indigo`, the app's primary accent), and earthy editorial accents.
// Re-skinning the default scales lets the whole app inherit the new look without
// touching component markup. Only scales actually used by the app are overridden.

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
        sans: ['"Hanken Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"Spline Sans Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Cards / "white" surfaces → warm paper so they float on the parchment bg.
        white: '#fbf8f1',

        // Neutral — warm stone/parchment (the workhorse: text, borders, fills).
        gray: {
          50: '#f7f2e9', 100: '#efe6d6', 200: '#e1d5bd', 300: '#cabd9f',
          400: '#8a7a55', 500: '#6a5c3e', 600: '#514631', 700: '#3c3324',
          800: '#2a2419', 900: '#1d1810', 950: '#120e08',
        },

        // Primary — deep petrol teal (buttons, links, active nav, focus rings).
        indigo: {
          50: '#e4f1ef', 100: '#c2e1de', 200: '#95cbc6', 300: '#5fb0aa',
          400: '#2f918c', 500: '#167571', 600: '#0e615e', 700: '#0a4d4b',
          800: '#073b3a', 900: '#062d2c', 950: '#031c1b',
        },

        // Danger — warm crimson/vermillion (errors, delete, alert dots).
        red: {
          50: '#fceee9', 100: '#f9d6cc', 200: '#f0b1a0', 300: '#e2856e',
          400: '#d05c42', 500: '#bd4329', 600: '#a4341d', 700: '#842616',
          800: '#661d12', 900: '#4d160e', 950: '#2f0d08',
        },

        // Success — muted sage.
        green: {
          50: '#eef2e4', 100: '#dae5c4', 200: '#bccd96', 300: '#9ab368',
          400: '#7c9748', 500: '#647e34', 600: '#536c2a', 700: '#425621',
          800: '#33421a', 900: '#283314', 950: '#161d0b',
        },

        // Money / positive — cooler sage.
        emerald: {
          50: '#e8f1ea', 100: '#cce0d2', 200: '#a3c8ae', 300: '#74ab86',
          400: '#4f9065', 500: '#3a7650', 600: '#2e6342', 700: '#245033',
          800: '#1b3d27', 900: '#142f1e', 950: '#0a1c11',
        },

        // Wants — plum / mulberry.
        purple: {
          50: '#f5ecf0', 100: '#ead4df', 200: '#d6abc1', 300: '#be81a1',
          400: '#a65d83', 500: '#8c476a', 600: '#743a57', 700: '#5d2f46',
          800: '#482435', 900: '#371b28', 950: '#220f19',
        },

        // Match cycles — plum with more blue.
        violet: {
          50: '#f0ebf5', 100: '#ddd2ea', 200: '#c2aedb', 300: '#a283c6',
          400: '#855fae', 500: '#6d4894', 600: '#593a79', 700: '#482f61',
          800: '#38254b', 900: '#2a1c39', 950: '#190f22',
        },

        // Specific listings — dusty slate-blue.
        blue: {
          50: '#ecf0f6', 100: '#d7e0ed', 200: '#b3c4dd', 300: '#88a3c8',
          400: '#6082b0', 500: '#466797', 600: '#38537c', 700: '#2d4263',
          800: '#24344d', 900: '#1c283b', 950: '#111824',
        },

        // Warning — ochre.
        amber: {
          50: '#faf1da', 100: '#f2e0b2', 200: '#e6c577', 300: '#d5a63f',
          400: '#c28f28', 500: '#a87a20', 600: '#87611a', 700: '#674b15',
          800: '#4c3811', 900: '#38290c', 950: '#221806',
        },

        // Warning (brighter) — mustard.
        yellow: {
          50: '#f9f2d6', 100: '#f0e0a6', 200: '#e1c769', 300: '#cdaa37',
          400: '#b89327', 500: '#9f7e21', 600: '#80651b', 700: '#604c15',
          800: '#463810', 900: '#34290c', 950: '#1f1807',
        },
      },
      boxShadow: {
        // Warm, low-spread "printed paper" depth (cool default shadows → ink-brown).
        sm: '0 1px 2px 0 rgb(60 45 20 / 0.06)',
        DEFAULT: '0 1px 3px 0 rgb(60 45 20 / 0.10), 0 1px 2px -1px rgb(60 45 20 / 0.08)',
        md: '0 4px 10px -2px rgb(60 45 20 / 0.10), 0 2px 6px -2px rgb(60 45 20 / 0.07)',
        lg: '0 12px 24px -6px rgb(50 38 18 / 0.14)',
        xl: '0 20px 40px -10px rgb(50 38 18 / 0.18)',
        '2xl': '0 28px 60px -12px rgb(40 30 15 / 0.24)',
      },
    },
  },
  plugins: [],
}
