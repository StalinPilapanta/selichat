/** Monedas de los países donde opera Dropi y vecinos. */
export const CURRENCIES = [
  { code: "USD", label: "Dólar estadounidense (USD)" },
  { code: "COP", label: "Peso colombiano (COP)" },
  { code: "MXN", label: "Peso mexicano (MXN)" },
  { code: "PEN", label: "Sol peruano (PEN)" },
  { code: "CLP", label: "Peso chileno (CLP)" },
  { code: "ARS", label: "Peso argentino (ARS)" },
  { code: "CRC", label: "Colón costarricense (CRC)" },
  { code: "GTQ", label: "Quetzal (GTQ)" },
  { code: "PYG", label: "Guaraní (PYG)" },
  { code: "DOP", label: "Peso dominicano (DOP)" },
  { code: "BOB", label: "Boliviano (BOB)" },
  { code: "UYU", label: "Peso uruguayo (UYU)" },
  { code: "HNL", label: "Lempira (HNL)" },
  { code: "EUR", label: "Euro (EUR)" },
] as const;
export type CurrencyCode = (typeof CURRENCIES)[number]["code"];
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [CurrencyCode, ...CurrencyCode[]];
