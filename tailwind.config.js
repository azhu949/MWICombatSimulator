/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./index.html", "./src/ui/**/*.{js,vue}"],
    theme: {
        extend: {
            fontFamily: {
                heading: ["Chakra Petch", "sans-serif"],
                body: ["IBM Plex Sans", "sans-serif"],
            },
            colors: {
                panel: "#0f1722",
                shell: "#0b1019",
                accent: "#f59e0b",
                mint: "#14b8a6",
                danger: "#f87171",
            },
            boxShadow: {
                panel: "0 20px 40px rgba(0, 0, 0, 0.32)",
            },
        },
    },
    plugins: [],
};
