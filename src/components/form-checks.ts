/**
 * Field checks shown when a person leaves a field (design step 9.4), using the browser's own
 * constraint validation so the rules match the input's attributes. Empty fields are not flagged
 * on blur (only on submit, by the browser): tabbing past a field isn't a mistake.
 */

export function emailError(el: HTMLInputElement): string {
  if (!el.value.trim()) return "";
  return el.validity.typeMismatch ? "Enter a valid email address." : "";
}

export function nameError(el: HTMLInputElement): string {
  if (!el.value) return "";
  return el.value.trim() ? "" : "Enter your name.";
}
