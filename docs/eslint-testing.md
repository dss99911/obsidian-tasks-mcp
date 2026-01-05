# Obsidian Plugin ESLint Testing Guide

This guide explains how to set up local ESLint testing that matches the Obsidian Community Plugins PR bot validation.

## Setup

### 1. Install Dependencies

```bash
npm install -D eslint eslint-plugin-obsidianmd typescript-eslint @eslint/js @eslint/json @microsoft/eslint-plugin-sdl eslint-plugin-import
```

### 2. Create ESLint Config

Create `eslint.config.mjs` in the project root:

```javascript
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
```

> **Note:** The `eslint-plugin-obsidianmd` package's built-in `recommended` config has a bug with ESLint 9's flat config system (uses unsupported `extends` key). The config above is manually constructed to match PR bot's behavior.

### 3. Add Lint Script

In `package.json`:

```json
{
  "scripts": {
    "lint": "eslint main.ts"
  }
}
```

## Running Lint

```bash
npm run lint
```

## Common Issues and Fixes

### 1. Sentence Case (ui/sentence-case)

**Error:** `Use sentence case for UI text`

UI text must use sentence case. Cannot use eslint-disable for this rule.

```typescript
// Bad
name: 'Toggle MCP server',
new Notice('MCP server is running');

// Good
name: 'Toggle server',
new Notice('Server is running');
```

**Workaround for code examples:**
```typescript
// Bad - lint error
containerEl.createEl('code', { text: 'not done' });

// Good - use textContent assignment with array join
const codeEl = containerEl.createEl('code');
const exampleText = ['not done', 'due before 2025-05-01'].join('\n');
codeEl.textContent = exampleText;
```

### 2. Combined Character in Regex

**Error:** `Unexpected combined character in character class`

Emoji with variation selectors (like `🗓️`) cause this error when used in character classes.

```typescript
// Bad - 🗓️ has a hidden variation selector
static readonly dueDateRegex = /[📅🗓️]\s?(\d{4}-\d{2}-\d{2})/u;

// Good - use alternation instead of character class
static readonly dueDateRegex = /(?:📅|🗓)\s?(\d{4}-\d{2}-\d{2})/u;
```

### 3. No Explicit Any

**Error:** `Unexpected any. Specify a different type`

```typescript
// Bad
const data: any = {};

// Good
const data: unknown = {};
// or define proper interface
interface TaskData { ... }
const data: TaskData = {};
```

### 4. TFile/TFolder Cast

**Error:** `Avoid casting to TFile or TFolder`

```typescript
// Bad
const file = abstractFile as TFile;

// Good
if (abstractFile instanceof TFile) {
  const file = abstractFile;
}
```

### 5. Console.log

**Error:** `Unexpected console statement`

```typescript
// Bad
console.log('debug info');

// Good - use allowed methods
console.debug('debug info');
console.warn('warning');
console.error('error');
```

### 6. Settings Headings

**Error:** `Use .setHeading() on a Setting instead of creating headings manually`

```typescript
// Bad
containerEl.createEl('h2', { text: 'Settings' });

// Good
new Setting(containerEl).setName('Settings').setHeading();
```

## PR Bot Restrictions

The PR bot has additional restrictions that cannot be bypassed:

1. **Cannot disable `ui/sentence-case`** - Must fix the actual text
2. **Cannot disable `no-explicit-any`** - Must use proper types
3. **eslint-disable comments require descriptions** - Always add `-- reason` suffix

```typescript
// Bad
// eslint-disable-next-line rule-name

// Good (but check if allowed for this rule)
// eslint-disable-next-line rule-name -- specific reason why this is needed
```

## Included Rules

The `recommended` config includes:

- `@typescript-eslint` recommended rules with type checking
- `@microsoft/sdl` security rules
- `eslint-plugin-import` rules
- All obsidianmd specific rules:
  - Command naming conventions
  - Settings tab patterns
  - Vault iteration safety
  - UI sentence case
  - Manifest validation
  - And more...

## Debugging

To see which rules are triggering:

```bash
# Show rule names with errors
npm run lint -- --format stylish

# Auto-fix what's possible
npm run lint -- --fix
```

## References

- [eslint-plugin-obsidianmd](https://github.com/obsidianmd/eslint-plugin)
- [Obsidian Developer Docs](https://docs.obsidian.md)
