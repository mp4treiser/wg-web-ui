/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#050816",
        card: "#0f172a",
        accent: "#38bdf8"
      }
    }
  },
  plugins: []
};


