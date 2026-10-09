import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { FieldError } from './components';
import { deviceTimezone, searchTimezones, timezoneList } from './timezones';

/**
 * A time zone chosen from a searchable list (docs/10 §8.1). The value is always an IANA name from
 * the list: typing only narrows it, and leaving the field without choosing puts the saved name back.
 */
export function TimezoneField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (zone: string) => void;
  error?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const zones = useMemo(() => timezoneList([value, deviceTimezone()]), [value]);
  const [query, setQuery] = useState<string>();
  const [active, setActive] = useState(0);
  const open = query !== undefined;
  const matches = useMemo(() => (open ? searchTimezones(zones, query) : []), [zones, open, query]);

  const close = () => setQuery(undefined);
  const choose = (zone: string) => {
    onChange(zone);
    close();
  };
  const search = (text: string) => {
    setQuery(text);
    setActive(0);
  };
  const move = (to: number) => setActive(Math.min(Math.max(to, 0), matches.length - 1));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setQuery('');
        setActive(Math.max(zones.indexOf(value), 0));
        return;
      }
      move(active + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Enter' && open) {
      // The list is open: Enter picks from it and does not submit the form behind it.
      event.preventDefault();
      const zone = matches[active];
      if (zone !== undefined) choose(zone);
    }
  };

  return (
    <div className="field">
      <div className="field__label-row">
        <label htmlFor={id} className="field__label">
          {label}
        </label>
      </div>
      <input
        id={id}
        type="text"
        role="combobox"
        className="field__input"
        value={open ? query : value}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches.length > 0 ? `${id}-${active}` : undefined}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onFocus={(event) => {
          setQuery('');
          setActive(Math.max(zones.indexOf(value), 0));
          event.target.select();
        }}
        onBlur={close}
        onChange={(event) => search(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- the combobox pattern's popup; a native select cannot be searched
          role="listbox"
          aria-label={`${label} choices`}
          className="combobox__list"
          ref={(list) => {
            // Keep the highlighted option in view as the arrows move it.
            list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
          }}
        >
          {matches.map((zone, index) => (
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the keys are on the combobox input, which keeps focus
            <li
              key={zone}
              id={`${id}-${index}`}
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- the combobox pattern's option
              role="option"
              aria-selected={index === active}
              className="combobox__option"
              data-current={zone === value ? '' : undefined}
              // Before the input's blur, which would close the list ahead of the click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(zone)}
            >
              <span>{zone}</span>
            </li>
          ))}
          {matches.length === 0 && <li className="combobox__empty">No time zone matches.</li>}
        </ul>
      )}
      {error !== undefined && <FieldError id={`${id}-error`} message={error} />}
    </div>
  );
}
