import type * as ynab from "ynab";

export type Currency = Pick<
  ynab.CurrencyFormat,
  "iso_code" | "decimal_digits" | "decimal_separator" | "group_separator" | "currency_symbol" | "symbol_first" | "display_symbol"
>;

export const USD: Currency = {
  iso_code: "USD",
  decimal_digits: 2,
  decimal_separator: ".",
  group_separator: ",",
  currency_symbol: "$",
  symbol_first: true,
  display_symbol: true,
};

/**
 * YNAB stores every amount in milliunits: thousandths of the currency unit,
 * whatever the currency. Only rounding and display depend on the currency.
 */
export function toMilliunits(amount: number, currency: Currency): number {
  if (!Number.isFinite(amount)) throw new Error(`Invalid amount: ${amount}`);
  const step = 10 ** (3 - Math.min(currency.decimal_digits, 3));
  // toFixed strips float noise (12.345 * 1000 is 12344.999...) before rounding half away from zero.
  const scaled = Math.abs(Number((amount * 1000).toFixed(6))) / step;
  return Math.sign(amount) * Math.round(scaled) * step || 0;
}

export function fromMilliunits(milliunits: number, currency: Currency): number {
  const digits = Math.min(currency.decimal_digits, 3);
  return Number((milliunits / 1000).toFixed(digits));
}

export function formatMoney(milliunits: number, currency: Currency): string {
  const digits = Math.min(currency.decimal_digits, 3);
  const [whole, fraction] = Math.abs(milliunits / 1000).toFixed(digits).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, currency.group_separator);
  const number = fraction ? `${grouped}${currency.decimal_separator}${fraction}` : grouped;
  const withSymbol = !currency.display_symbol
    ? number
    : currency.symbol_first
      ? `${currency.currency_symbol}${number}`
      : `${number}${currency.currency_symbol}`;
  return milliunits < 0 ? `-${withSymbol}` : withSymbol;
}
