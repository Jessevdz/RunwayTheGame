import tsParser from '@typescript-eslint/parser';

// Design-system adherence checks for component prop shapes, raw color/px literals, and font family restrictions.
export default [
  {
    // The token mirror is the one sanctioned home for raw hex in src/**.
    // Nothing else is exempt — widening this is how the drift comes back.
    ignores: ['src/design-system/theme/tokens.generated.ts'],
  },
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message: 'Raw hex color — use a design-system color token via var().',
        },
        {
          selector: "Literal[value=/\\b\\d+px\\b/]",
          message: 'Raw px value — use a design-system spacing token via var().',
        },
        {
          selector:
            "Literal[value=/font-family\\s*:\\s*(?!['\\\"]?(?:Archivo Black|Inter|JetBrains Mono|Playfair Display))/i]",
          message:
            'Font not provided by the design system. Available: Archivo Black, Inter, JetBrains Mono, Playfair Display.',
        },
        {
          selector:
            "JSXOpeningElement[name.name='Badge'] > JSXAttribute > JSXIdentifier[name!=/^(?:tone|children|key|ref|className|style|children)$/]",
          message: "<Badge> doesn't accept that prop. Declared props: tone, children.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Badge'] > JSXAttribute[name.name='tone'] > Literal[value!=/^(?:gold|rust|moss|crimson|neutral)$/]",
          message: "<Badge> tone must be one of 'gold' | 'rust' | 'moss' | 'crimson' | 'neutral'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Button'] > JSXAttribute > JSXIdentifier[name!=/^(?:variant|size|icon|disabled|children|onClick|title|key|ref|className|style)$/]",
          message: "<Button> doesn't accept that prop. Declared props: variant, size, icon, disabled, children, onClick, title.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Button'] > JSXAttribute[name.name='variant'] > Literal[value!=/^(?:primary|secondary|ghost)$/]",
          message: "<Button> variant must be one of 'primary' | 'secondary' | 'ghost'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Button'] > JSXAttribute[name.name='size'] > Literal[value!=/^(?:sm|md|lg)$/]",
          message: "<Button> size must be one of 'sm' | 'md' | 'lg'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Card'] > JSXAttribute > JSXIdentifier[name!=/^(?:interactive|children|style|key|ref|className|style|children)$/]",
          message: "<Card> doesn't accept that prop. Declared props: interactive, children, style.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Checkbox'] > JSXAttribute > JSXIdentifier[name!=/^(?:label|checked|onChange|key|ref|className|style|children)$/]",
          message: "<Checkbox> doesn't accept that prop. Declared props: label, checked, onChange.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Dialog'] > JSXAttribute > JSXIdentifier[name!=/^(?:open|title|children|onClose|key|ref|className|style|children)$/]",
          message: "<Dialog> doesn't accept that prop. Declared props: open, title, children, onClose.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='IconButton'] > JSXAttribute > JSXIdentifier[name!=/^(?:icon|label|variant|size|onClick|key|ref|className|style|children)$/]",
          message: "<IconButton> doesn't accept that prop. Declared props: icon, label, variant, size, onClick.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='IconButton'] > JSXAttribute[name.name='variant'] > Literal[value!=/^(?:primary|secondary|ghost)$/]",
          message: "<IconButton> variant must be one of 'primary' | 'secondary' | 'ghost'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='IconButton'] > JSXAttribute[name.name='size'] > Literal[value!=/^(?:sm|md|lg)$/]",
          message: "<IconButton> size must be one of 'sm' | 'md' | 'lg'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Input'] > JSXAttribute > JSXIdentifier[name!=/^(?:label|hint|error|type|placeholder|value|onChange|onKeyDown|readOnly|disabled|maxLength|inputMode|autoCapitalize|autoComplete|autoCorrect|spellCheck|enterKeyHint|autoFocus|id|key|ref|className|style|children)$/]",
          message:
            "<Input> doesn't accept that prop. Declared props: label, hint, error, type, placeholder, value, onChange, onKeyDown, readOnly, disabled, maxLength, id, and the mobile keyboard hints (inputMode, autoCapitalize, autoComplete, autoCorrect, spellCheck, enterKeyHint, autoFocus).",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Radio'] > JSXAttribute > JSXIdentifier[name!=/^(?:name|label|checked|onChange|key|ref|className|style|children)$/]",
          message: "<Radio> doesn't accept that prop. Declared props: name, label, checked, onChange.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Select'] > JSXAttribute > JSXIdentifier[name!=/^(?:label|hint|value|onChange|children|key|ref|className|style|children)$/]",
          message: "<Select> doesn't accept that prop. Declared props: label, hint, value, onChange, children.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Switch'] > JSXAttribute > JSXIdentifier[name!=/^(?:label|checked|onChange|key|ref|className|style|children)$/]",
          message: "<Switch> doesn't accept that prop. Declared props: label, checked, onChange.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Tabs'] > JSXAttribute > JSXIdentifier[name!=/^(?:items|active|onChange|key|ref|className|style|children)$/]",
          message: "<Tabs> doesn't accept that prop. Declared props: items, active, onChange.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Tag'] > JSXAttribute > JSXIdentifier[name!=/^(?:children|onRemove|key|ref|className|style|children)$/]",
          message: "<Tag> doesn't accept that prop. Declared props: children, onRemove.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Toast'] > JSXAttribute > JSXIdentifier[name!=/^(?:tone|children|key|ref|className|style|children)$/]",
          message: "<Toast> doesn't accept that prop. Declared props: tone, children.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Toast'] > JSXAttribute[name.name='tone'] > Literal[value!=/^(?:gold|rust|moss|crimson|neutral)$/]",
          message: "<Toast> tone must be one of 'gold' | 'rust' | 'moss' | 'crimson' | 'neutral'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Tooltip'] > JSXAttribute > JSXIdentifier[name!=/^(?:label|children|key|ref|className|style|children)$/]",
          message: "<Tooltip> doesn't accept that prop. Declared props: label, children.",
        },
      ],
    },
  },
  {
    // Enforces memory-only session storage rule for analytics to ensure compliance with privacy specifications.
    files: ['src/core/analytics/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Identifier[name=/^(?:localStorage|sessionStorage|indexedDB)$/]",
          message:
            'Analytics must not persist anything to the device. The session id is memory-only — see the note in eslint.adherence.config.js and PRIVACY.md §2.4.',
        },
        {
          selector: "MemberExpression[property.name='cookie']",
          message:
            'Analytics must not read or write cookies. The session id is memory-only — see PRIVACY.md §2.4.',
        },
      ],
    },
  },
];
