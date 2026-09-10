export function normalizeNumericInput(value: string) {
  return value.replaceAll(',', '').trim();
}

export function withThousandsSeparators(rawValue: string) {
  if (!rawValue) return rawValue;

  const sign = rawValue.startsWith('-') ? '-' : '';
  const unsigned = sign ? rawValue.slice(1) : rawValue;
  const [whole, decimal] = unsigned.split('.');
  const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (decimal !== undefined) return `${sign}${formattedWhole}.${decimal}`;
  return `${sign}${formattedWhole}`;
}

export function formatNumericDisplayValue(value: number | string | null | undefined) {
  return withThousandsSeparators(normalizeNumericInput(String(value ?? '')));
}

export function formatCurrencyInputValue(value: number | string | null | undefined) {
  const numericValue = Number(normalizeNumericInput(String(value ?? '')));
  return Number.isFinite(numericValue) ? withThousandsSeparators(numericValue.toFixed(2)) : '';
}

export function parseNumericInputValue(value: string) {
  const numericValue = Number(normalizeNumericInput(value));
  return Number.isFinite(numericValue) ? numericValue : 0;
}
