/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F7F5F0',
        surface: '#FFFFFF',
        ink: '#172033',
        muted: '#667085',
        primary: '#355CFF',
        primarySoft: '#EEF2FF',
        danger: '#E5484D',
        // Amber "not an error, just currently inactive" role — the caption
        // editor uses it for text removed by an active cut.
        warning: '#B45309',
        warningSoft: '#FDF3E0',
        highlight: '#FFE800',
        border: '#E6E2DA',
        success: '#16A36A',
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
