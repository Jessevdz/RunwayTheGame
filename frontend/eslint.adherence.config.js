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
            "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > Property[value.type='Literal'][value.raw=/^-?[1-9]/]:not([key.name=/^(?:opacity|zIndex|flex|flexGrow|flexShrink|order|lineHeight|fontWeight|zoom|scale|aspectRatio|gridColumn|gridRow|WebkitLineClamp|lineClamp|animationIterationCount|columns|tabSize)$/]):not([key.value=/^--/])",
          message:
            'Number-valued inline style becomes raw px — use a token string such as var(--sp-3), or a CSS class.',
        },
        {
          selector:
            "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > Property[key.name='fontSize'][value.type='Literal']:not([value.raw=/var\\(--fs-/])",
          message: 'Raw font size in an inline style — use var(--fs-*) from the type scale.',
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
            "JSXOpeningElement[name.name='Dialog'] > JSXAttribute > JSXIdentifier[name!=/^(?:open|presentation|title|children|onClose|key|ref|className|style|children)$/]",
          message: "<Dialog> doesn't accept that prop. Declared props: open, presentation, title, children, onClose.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Dialog'] > JSXAttribute[name.name='presentation'] > Literal[value!=/^(?:center|sheet|fullscreen)$/]",
          message: "<Dialog> presentation must be one of 'center' | 'sheet' | 'fullscreen'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Icon'] > JSXAttribute > JSXIdentifier[name!=/^(?:name|size|label|key|ref|className|style)$/]",
          message: "<Icon> doesn't accept that prop. Declared props: name, size, label.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Icon'] > JSXAttribute[name.name='size'] > Literal[value!=/^(?:sm|md|lg)$/]",
          message: "<Icon> size must be one of 'sm' | 'md' | 'lg'.",
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
        {
          selector:
            "JSXOpeningElement[name.name='Sheet'] > JSXAttribute > JSXIdentifier[name!=/^(?:snap|defaultSnap|onSnapChange|onSettle|summary|children|label|peekRatio|expandedRatio|key|ref|className|style)$/]",
          message:
            "<Sheet> doesn't accept that prop. Declared props: snap, defaultSnap, onSnapChange, onSettle, summary, children, label, peekRatio, expandedRatio.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Sheet'] > JSXAttribute[name.name=/^(?:snap|defaultSnap)$/] > Literal[value!=/^(?:collapsed|peek|expanded)$/]",
          message: "<Sheet> snap must be one of 'collapsed' | 'peek' | 'expanded'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='ConfirmSheet'] > JSXAttribute > JSXIdentifier[name!=/^(?:open|title|children|confirmLabel|cancelLabel|danger|hideCancel|onConfirm|onCancel|key|ref)$/]",
          message:
            "<ConfirmSheet> doesn't accept that prop. Declared props: open, title, children, confirmLabel, cancelLabel, danger, hideCancel, onConfirm, onCancel.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='ActionBar'] > JSXAttribute > JSXIdentifier[name!=/^(?:position|children|key|ref|className|style)$/]",
          message: "<ActionBar> doesn't accept that prop. Declared props: position, children.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='ActionBar'] > JSXAttribute[name.name='position'] > Literal[value!=/^(?:sticky|fixed)$/]",
          message: "<ActionBar> position must be one of 'sticky' | 'fixed'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='ToastRegion'] > JSXAttribute > JSXIdentifier[name!=/^(?:position|key|ref|className|style)$/]",
          message: "<ToastRegion> doesn't accept that prop. Declared props: position.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='ToastRegion'] > JSXAttribute[name.name='position'] > Literal[value!=/^(?:top|bottom)$/]",
          message: "<ToastRegion> position must be one of 'top' | 'bottom'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Skeleton'] > JSXAttribute > JSXIdentifier[name!=/^(?:variant|lines|width|height|label|key|ref|className|style)$/]",
          message: "<Skeleton> doesn't accept that prop. Declared props: variant, lines, width, height, label.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Skeleton'] > JSXAttribute[name.name='variant'] > Literal[value!=/^(?:text|block|circle)$/]",
          message: "<Skeleton> variant must be one of 'text' | 'block' | 'circle'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Progress'] > JSXAttribute > JSXIdentifier[name!=/^(?:value|max|label|valueText|variant|key|ref|className|style)$/]",
          message: "<Progress> doesn't accept that prop. Declared props: value, max, label, valueText, variant.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Progress'] > JSXAttribute[name.name='variant'] > Literal[value!=/^(?:bar|sunset|arc)$/]",
          message: "<Progress> variant must be one of 'bar' | 'sunset' | 'arc'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Clock'] > JSXAttribute > JSXIdentifier[name!=/^(?:seconds|flap|size|caption|ariaLabel|key|ref|className|style)$/]",
          message: "<Clock> doesn't accept that prop. Declared props: seconds, flap, size, caption, ariaLabel.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Clock'] > JSXAttribute[name.name='size'] > Literal[value!=/^(?:md|lg|xl)$/]",
          message: "<Clock> size must be one of 'md' | 'lg' | 'xl'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='BrandMark'] > JSXAttribute > JSXIdentifier[name!=/^(?:size|iconOnly|key|ref|className|style)$/]",
          message: "<BrandMark> doesn't accept that prop. Declared props: size, iconOnly.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='BrandMark'] > JSXAttribute[name.name='size'] > Literal[value!=/^(?:sm|md|lg)$/]",
          message: "<BrandMark> size must be one of 'sm' | 'md' | 'lg'.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='PageHeader'] > JSXAttribute > JSXIdentifier[name!=/^(?:title|eyebrow|onBack|backLabel|actions|brand|key|ref|className|style)$/]",
          message: "<PageHeader> doesn't accept that prop. Declared props: title, eyebrow, onBack, backLabel, actions, brand.",
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
