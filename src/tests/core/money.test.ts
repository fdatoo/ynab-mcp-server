import { describe, expect, it } from "vitest";
import { USD, formatMoney, fromMilliunits, toMilliunits, type Currency } from "../../ynab/money.js";

const EUR: Currency = { ...USD, iso_code: "EUR", decimal_separator: ",", group_separator: ".", currency_symbol: "€", symbol_first: false };
const JPY: Currency = { ...USD, iso_code: "JPY", decimal_digits: 0, currency_symbol: "¥" };
const BHD: Currency = { ...USD, iso_code: "BHD", decimal_digits: 3, currency_symbol: "BD" };

describe("money", () => {
  it("converts to milliunits, rounding to the currency's precision", () => {
    expect(toMilliunits(10.99, USD)).toBe(10990);
    expect(toMilliunits(0.1 + 0.2, USD)).toBe(300);
    expect(toMilliunits(-12.345, USD)).toBe(-12350);
    expect(toMilliunits(1234.6, JPY)).toBe(1235000);
    expect(toMilliunits(1.2345, BHD)).toBe(1235);
    expect(() => toMilliunits(Number.NaN, USD)).toThrow(/Invalid amount/);
  });

  it("converts from milliunits", () => {
    expect(fromMilliunits(-12000, USD)).toBe(-12);
    expect(fromMilliunits(10990, USD)).toBe(10.99);
    expect(fromMilliunits(1235, BHD)).toBe(1.235);
    expect(fromMilliunits(1235000, JPY)).toBe(1235);
  });

  it("formats in the currency's style", () => {
    expect(formatMoney(1234567, USD)).toBe("$1,234.57");
    expect(formatMoney(-12000, USD)).toBe("-$12.00");
    expect(formatMoney(1234567, EUR)).toBe("1.234,57€");
    expect(formatMoney(1234000, JPY)).toBe("¥1,234");
    expect(formatMoney(5000, { ...USD, display_symbol: false })).toBe("5.00");
  });
});
