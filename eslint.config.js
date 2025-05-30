import antfu from "@antfu/eslint-config";

export default antfu({
  formatters: {
    prettierOptions: {
      printWidth: 100,
      trailingComma: "all",
      singleQuote: false,
      semi: true,
      tabWidth: 2,
      quoteProps: "as-needed",
      jsxSingleQuote: false,
      arrowParens: "always",
    },
  },
  stylistic: {
    indent: 2,
    quotes: "double",
    semi: true,
    arrowParens: "as-needed",
  },
  type: "lib",
  typescript: true,
  name: "raft",
}).append({
  ignores: ["README.md", "packages/*/README.md"],
  files: ["./packages/**/*.ts"],
  rules: {
    "style/indent": "off",
    "style/brace-style": "off",
    "style/arrow-parens": "off",
    "style/quote-props": ["error", "as-needed"],
    "style/operator-linebreak": "off",
    "ts/no-unsafe-function-type": "off",
    "perfectionist/sort-imports": "off",
    "ts/explicit-function-return-type": "off",
    "regexp/no-unused-capturing-group": "off",
    "node/prefer-global/buffer": "off",
    "node/prefer-global/process": "off",
    "no-throw-literal": "off",
    "perfectionist/sort-named-imports": ["error", { order: "desc" }],
  },
});
