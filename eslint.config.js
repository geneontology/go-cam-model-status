import eslintJs from "@eslint/js";
import eslintReact from "@eslint-react/eslint-plugin";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";
import pluginQuery from "@tanstack/eslint-plugin-query";

export default tseslint.config([
  globalIgnores(["dist"]),
  ...pluginQuery.configs["flat/recommended"],
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      eslintJs.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs["recommended-latest"],
      reactRefresh.configs.vite,
      eslintReact.configs["recommended-typescript"],
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ["./tsconfig.node.json", "./tsconfig.app.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      curly: ["error", "all"],
    },
  },
]);
