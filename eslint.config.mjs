import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";
import js from "@eslint/js";
import sdl from "@microsoft/eslint-plugin-sdl";
import importPlugin from "eslint-plugin-import";

// Manually construct config similar to PR bot's recommended config
// (eslint-plugin-obsidianmd's recommended config has a bug with "extends" in flat config)
export default [
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      import: importPlugin,
      "@microsoft/sdl": sdl,
      obsidianmd,
    },
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // General rules (from PR bot config)
      "no-unused-vars": "off",
      "no-self-compare": "warn",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-implicit-globals": "error",
      "no-console": ["error", { allow: ["warn", "error", "debug"] }],
      "no-alert": "error",
      "no-undef": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/no-unused-vars": ["warn", { args: "none" }],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-explicit-any": ["error", { fixToUnknown: true }],
      "@microsoft/sdl/no-document-write": "error",
      "@microsoft/sdl/no-inner-html": "error",
      "import/no-extraneous-dependencies": "error",

      // Obsidianmd plugin rules
      "obsidianmd/commands/no-command-in-command-id": "error",
      "obsidianmd/commands/no-command-in-command-name": "error",
      "obsidianmd/commands/no-default-hotkeys": "error",
      "obsidianmd/commands/no-plugin-id-in-command-id": "error",
      "obsidianmd/commands/no-plugin-name-in-command-name": "error",
      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/vault/iterate": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/hardcoded-config-path": "error",
      "obsidianmd/no-forbidden-elements": "error",
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/no-sample-code": "error",
      "obsidianmd/no-tfile-tfolder-cast": "error",
      "obsidianmd/no-view-references-in-plugin": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/object-assign": "error",
      "obsidianmd/platform": "error",
      "obsidianmd/prefer-file-manager-trash-file": "warn",
      "obsidianmd/prefer-abstract-input-suggest": "error",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/validate-manifest": "error",
      "obsidianmd/validate-license": "error",
      "obsidianmd/ui/sentence-case": ["error", { enforceCamelCaseLower: true }],
    },
  },
];
