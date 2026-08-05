// @vitest-environment happy-dom
/**
 * The language selector on the public booking surfaces.
 *
 * Two of these tests defend the MEASUREMENT rather than the UI: the field
 * exists so someone can count how many clients ask for another language, and
 * that count is only meaningful if a default can never be mistaken for an
 * answer, and if the options are labelled where the people who need them can
 * read them.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { LanguageChoice } from "./LanguageChoice";
import { SUPPORTED_CONTACT_LOCALES } from "../../../server/lib/i18n/contact-locale";

describe("LanguageChoice", () => {
  it("submits the chosen language with the booking", () => {
    const onChange = vi.fn();
    render(<LanguageChoice value={null} onChange={onChange} options={["en", "es-419"]} />);
    fireEvent.click(screen.getByRole("radio", { name: /español/i }));
    expect(onChange).toHaveBeenCalledWith("es-419");
  });

  it("defaults to nothing selected, so a default is never mistaken for a choice", () => {
    render(<LanguageChoice value={null} onChange={vi.fn()} options={["en", "es-419"]} />);
    expect(screen.queryByRole("radio", { checked: true })).toBeNull();
  });

  it("shows the chosen option as checked once the client answers", () => {
    render(<LanguageChoice value="es-419" onChange={vi.fn()} options={["en", "es-419"]} />);
    expect(screen.getByRole("radio", { name: /español/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /english/i })).not.toBeChecked();
  });

  it("labels each option in its own language", () => {
    render(<LanguageChoice value={null} onChange={vi.fn()} options={["en", "es-419"]} />);
    // "Español", not "Spanish": someone who cannot read English cannot find an
    // option labelled in English, which would defeat the whole control.
    expect(screen.getByRole("radio", { name: /español/i })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /^spanish/i })).toBeNull();
  });

  it("offers exactly the locales the server will accept", () => {
    // Offering a language the server cannot store would collect an answer and
    // then drop it; offering fewer would hide one we can already speak.
    render(<LanguageChoice value={null} onChange={vi.fn()} />);
    const offered = screen.getAllByRole("radio").map((el) => (el as HTMLInputElement).value);
    expect(offered).toEqual([...SUPPORTED_CONTACT_LOCALES]);
  });
});
