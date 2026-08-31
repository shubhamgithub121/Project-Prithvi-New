/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Because they use html.dark
  theme: {
    extend: {},
  },
  plugins: [],
}
