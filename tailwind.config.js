/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        courier: ['"Courier Prime"', "Courier New", "Courier", "monospace"],
      },
    },
  },
  plugins: [],
};
