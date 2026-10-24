import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      // 不変条件3: 乱数は Rng サービス経由のみ
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "乱数は Rng サービス経由で使うこと（CLAUDE.md §4-3）" },
      ],
    },
  },
  {
    // 不変条件4: domain/ は純粋
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["effect", "effect/*", "@effect/*"], message: "domain/ は Effect 非依存（CLAUDE.md §4-4）" },
            { group: ["phaser", "react", "react-dom", "react/*", "react-dom/*"], message: "domain/ は UI 非依存（CLAUDE.md §4-4）" },
          ],
        },
      ],
      "no-restricted-globals": ["error", "fetch", "document", "window", "localStorage"],
    },
  },
);
