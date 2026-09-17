import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "public/sw.js", "public/sw.js.map", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Money is bigint minor units everywhere. These are the two functions
      // that would quietly turn an amount back into a float.
      "no-restricted-globals": [
        "error",
        { name: "parseFloat", message: "Money is bigint minor units — use parseAmount()." },
        { name: "parseInt", message: "Money is bigint minor units — use parseAmount() or BigInt()." },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
