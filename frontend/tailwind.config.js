export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {fontSize:{helper:"var(--text-helper)",body:"var(--text-body)",heading:"var(--text-heading)",metric:"var(--text-metric)"},spacing:{1:"var(--space-1)",2:"var(--space-2)",3:"var(--space-3)",4:"var(--space-4)"}} },
  plugins: [],
};
