/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Motion tokens (see AGENTS.md-adjacent motion pass): reuse these everywhere, never a
      // one-off inline duration. Pair with the existing `ease-out`/`ease-in-out` utilities.
      transitionDuration: {
        fast: '120ms', // micro-feedback: button press, favorite toggle, checkbox
        standard: '200ms', // content swap: skeleton -> real content, tab switch
        page: '280ms', // route/page transitions, modal/sheet open-close
      },
    },
  },
  plugins: [],
};
