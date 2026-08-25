export interface Choice<T extends string> {
  id: T;
  title: string;
  blurb: string;
}

interface ChoiceCardsProps<T extends string> {
  /** Shown as the fieldset's legend, in the label voice. */
  legend: string;
  options: Array<Choice<T>>;
  value: T;
  onChange: (next: T) => void;
}

/** Component rendering a fieldset row of mutually exclusive selection cards. */
export function ChoiceCards<T extends string>({ legend, options, value, onChange }: ChoiceCardsProps<T>) {
  return (
    <fieldset
      style={{
        border: 0,
        padding: 0,
        margin: '0 0 var(--sp-5)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
        gap: 'var(--sp-3)'
      }}
    >
      <legend className="t-label fs-label" style={{ marginBottom: 'var(--sp-2)' }}>
        {legend}
      </legend>
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            className={`card card--pad${selected ? ' card--interactive' : ''}`}
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              borderColor: selected ? 'var(--brand-warm)' : undefined,
              boxShadow: selected ? '0 0 0 0.125rem var(--brand-warm)' : undefined
            }}
          >
            <span
              className="t-announce fs-6"
              style={{ display: 'block', color: 'var(--ink-strong)', marginBottom: 'var(--sp-2)' }}
            >
              {option.title}
            </span>
            <span className="fs-5" style={{ color: 'var(--ink-muted)' }}>
              {option.blurb}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

export default ChoiceCards;
