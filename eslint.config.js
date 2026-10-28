import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/** 地図の描画層が読んではいけない状態（空洞・進捗・資材・派生指標・イベントが漏れる） */
const mapStatePattern = {
  group: ["**/domain/GameState", "**/domain/Construction", "**/domain/Events", "**/domain/DerivedStats", "**/domain/Map"],
  message: "地図の描画層は MapViewModel だけを受け取る（CLAUDE.md §4-26）",
};

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
  {
    // 不変条件26: 地図の描画層は GameState などを import しない（投影型 MapViewModel だけを受け取る。DECISIONS BB-11）
    files: ["src/ui/map/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [mapStatePattern] }],
    },
  },
  {
    // 不変条件27: 地形生成は DOM に依存しない純関数（Node の Vitest で試せる）。Worker は薄いラッパー
    files: ["src/ui/map/terrain/**/*.ts"],
    ignores: ["src/ui/map/terrain/terrain.worker.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            mapStatePattern,
            { group: ["effect", "effect/*", "@effect/*", "phaser", "react", "react-dom", "react/*", "react-dom/*"], message: "地形生成は純関数（CLAUDE.md §4-27）" },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "document",
        "window",
        "self",
        "localStorage",
        "fetch",
        "navigator",
        "requestAnimationFrame",
        "OffscreenCanvas",
        "ImageData",
        "Worker",
      ],
    },
  },
);
