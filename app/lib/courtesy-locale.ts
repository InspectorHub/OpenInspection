/**
 * The locale a courtesy translation is offered in, on the client side.
 *
 * ONE, deliberately — no third locale until the second has a paying customer —
 * and derived from the contact-locale set rather than written out. That module
 * is documented as PURE and browser-safe for exactly this reason: the language
 * a report can be translated into has to be the same language the product can
 * address a recipient in, and two lists would let one drift into offering a
 * language nothing else can speak.
 *
 * The server has its own derivation from the same source
 * (`server/lib/validations/courtesy-translation.schema.ts`). Two derivations
 * from ONE list is not duplication; two lists would be.
 */
import { SUPPORTED_CONTACT_LOCALES } from "../../server/lib/i18n/contact-locale";

export const COURTESY_TRANSLATION_LOCALE: string =
  SUPPORTED_CONTACT_LOCALES.find((l) => l !== "en") ?? "es-419";
