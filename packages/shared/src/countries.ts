/**
 * Países donde operan las tiendas: código, bandera, prefijo telefónico, moneda y zona horaria.
 * Los usan el registro (WhatsApp del dueño), «Crea tu tienda» y Configuración.
 */
export const STORE_COUNTRIES = [
  {
    code: "EC",
    name: "Ecuador",
    flag: "🇪🇨",
    dial: "593",
    currency: "USD",
    tz: "America/Guayaquil",
  },
  { code: "CO", name: "Colombia", flag: "🇨🇴", dial: "57", currency: "COP", tz: "America/Bogota" },
  {
    code: "MX",
    name: "México",
    flag: "🇲🇽",
    dial: "52",
    currency: "MXN",
    tz: "America/Mexico_City",
  },
  { code: "PE", name: "Perú", flag: "🇵🇪", dial: "51", currency: "PEN", tz: "America/Lima" },
  { code: "CL", name: "Chile", flag: "🇨🇱", dial: "56", currency: "CLP", tz: "America/Santiago" },
  {
    code: "CR",
    name: "Costa Rica",
    flag: "🇨🇷",
    dial: "506",
    currency: "CRC",
    tz: "America/Costa_Rica",
  },
  { code: "PA", name: "Panamá", flag: "🇵🇦", dial: "507", currency: "USD", tz: "America/Panama" },
  {
    code: "GT",
    name: "Guatemala",
    flag: "🇬🇹",
    dial: "502",
    currency: "GTQ",
    tz: "America/Guatemala",
  },
  {
    code: "PY",
    name: "Paraguay",
    flag: "🇵🇾",
    dial: "595",
    currency: "PYG",
    tz: "America/Asuncion",
  },
  {
    code: "AR",
    name: "Argentina",
    flag: "🇦🇷",
    dial: "54",
    currency: "ARS",
    tz: "America/Argentina/Buenos_Aires",
  },
  { code: "ES", name: "España", flag: "🇪🇸", dial: "34", currency: "EUR", tz: "Europe/Madrid" },
] as const;
export type StoreCountry = (typeof STORE_COUNTRIES)[number];
export type StoreCountryCode = StoreCountry["code"];

export const countryByCode = (code: string | null | undefined) =>
  STORE_COUNTRIES.find((c) => c.code === code);

/**
 * Número internacional en dígitos (593991234567) a partir del prefijo del país y el número
 * como lo escribe la persona (con o sin el 0 de la operadora, espacios o guiones).
 * Devuelve "" si no parece un número válido (menos de 7 dígitos locales).
 */
export function internationalPhone(dial: string, typed: string): string {
  let digits = typed.replace(/\D/g, "");
  if (digits.startsWith(dial) && digits.length > dial.length + 6)
    digits = digits.slice(dial.length);
  digits = digits.replace(/^0+/, "");
  return digits.length >= 7 && digits.length <= 12 ? `${dial}${digits}` : "";
}
