import { useId } from 'react';
import { chooseTheme, type ThemeChoice, useThemeChoice } from './theme';

const CHOICES: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The theme choice (docs/10 §8.2). It takes effect on the tap and is the device's own, so it sits
 * outside the profile form: there is nothing to save, and it is there before the profile exists.
 */
export function ThemeField() {
  const choice = useThemeChoice();
  const name = useId();
  return (
    <section className="form form--secondary form--after">
      <fieldset className="segments segments--three">
        <legend className="field__label">Theme</legend>
        {CHOICES.map(({ value, label }) => (
          <label key={value} className="segments__segment">
            <input
              type="radio"
              name={name}
              value={value}
              checked={choice === value}
              onChange={() => chooseTheme(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <p className="form__lede">
        System follows this device’s light or dark setting. The choice is kept on this device.
      </p>
    </section>
  );
}
