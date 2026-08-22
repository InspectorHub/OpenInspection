// @vitest-environment happy-dom
/**
 * The upload that refuses a file, and the wording it refuses it in.
 *
 * ── Why the copy is asserted rather than eyeballed ──────────────────────────
 * Three sentences on this screen are settled and must not be "tightened" by a
 * later edit that reads them as verbose:
 *
 *  1. A clean scan never says the file IS clean. It says what was detected,
 *     and it carries its own limitation in the same breath. "Nothing found" on
 *     its own was ruled insufficient, because a person reading it concludes
 *     the file was checked and passed — and this check is a pattern match over
 *     text, which is not that.
 *  2. A hit reports a PAGE and a KIND. Never the matched text. Echoing it
 *     copies the personal information into the interface, the logs and any
 *     error report — while refusing the file for containing it.
 *  3. The blank template comes FIRST, before the upload control, because the
 *     whole failure this screen exists to prevent is somebody sending a
 *     finished report.
 *
 * ── Why every query is `findBy` ─────────────────────────────────────────────
 * A synchronous `getBy` against a tree that has not rendered yet queries an
 * empty container and passes for whatever the component does. These are async
 * on purpose so the assertion is made against something that exists.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { PdfInferenceUpload } from "./PdfInferenceUpload";

afterEach(cleanup);

describe("PdfInferenceUpload: a clean scan", () => {
    it("never says the file is confirmed clean", async () => {
        render(<PdfInferenceUpload scanResult={{ hits: [] }} />);
        const text = (await screen.findByTestId("scan-result")).textContent ?? "";
        expect(text).toMatch(/detected by our checks/i);
        expect(text).not.toMatch(/confirmed|guarantee(?!s? that)|PII-free|no personal information\.$/i);
    });

    it("carries the limitation sentence beside the result", async () => {
        render(<PdfInferenceUpload scanResult={{ hits: [] }} />);
        const el = await screen.findByTestId("scan-result");
        expect(el.textContent).toMatch(/not a guarantee.*responsible for removing/is);
    });
});

describe("PdfInferenceUpload: a hit", () => {
    it("reports a hit by page and category, never by content", async () => {
        render(<PdfInferenceUpload scanResult={{ hits: [{ page: 2, category: "address" }] }} />);
        const text = (await screen.findByTestId("scan-result")).textContent ?? "";
        expect(text).toMatch(/page 3/i);
        expect(text).toMatch(/address/i);
        expect(text).not.toMatch(/\d+\s+\w+\s+Street/i);
    });

    it("POSITIVE CONTROL — a different category says something different", async () => {
        // Otherwise the assertion above passes for a component that prints one
        // fixed sentence, and every refusal would name an address whatever was
        // actually found.
        render(<PdfInferenceUpload scanResult={{ hits: [{ page: 0, category: "signature" }] }} />);
        const text = (await screen.findByTestId("scan-result")).textContent ?? "";
        expect(text).toMatch(/page 1/i);
        expect(text).toMatch(/signature/i);
        expect(text).not.toMatch(/address/i);
    });

    it("lists every page that was hit, not just the first", async () => {
        render(
            <PdfInferenceUpload
                scanResult={{
                    hits: [
                        { page: 0, category: "email" },
                        { page: 4, category: "name" },
                    ],
                }}
            />,
        );
        const text = (await screen.findByTestId("scan-result")).textContent ?? "";
        expect(text).toMatch(/page 1/i);
        expect(text).toMatch(/page 5/i);
    });

    it("says that the matched text is deliberately not shown", async () => {
        // Without this the omission looks like an oversight, and the next
        // person to touch this screen adds the excerpt back as an improvement.
        render(<PdfInferenceUpload scanResult={{ hits: [{ page: 1, category: "name" }] }} />);
        const text = (await screen.findByTestId("scan-result")).textContent ?? "";
        expect(text).toMatch(/not shown/i);
    });
});

describe("PdfInferenceUpload: the blank template", () => {
    it("pushes the blank template first", async () => {
        render(<PdfInferenceUpload scanResult={null} />);
        expect(await screen.findByText(/blank template/i)).toBeTruthy();
    });

    it("puts it ahead of the upload control in the document", async () => {
        // "First" is the whole point of the section — an instruction below the
        // file picker is an instruction read after the file was chosen.
        render(<PdfInferenceUpload scanResult={null} />);
        const guidance = await screen.findByText(/blank template/i);
        const upload = await screen.findByTestId("pdf-upload");
        expect(guidance.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });

    it("says how to produce one", async () => {
        render(<PdfInferenceUpload scanResult={null} />);
        expect((await screen.findByTestId("blank-template-guidance")).textContent)
            .toMatch(/print|export/i);
    });

    it("shows no scan result before anything has been scanned", async () => {
        render(<PdfInferenceUpload scanResult={null} />);
        await screen.findByTestId("pdf-upload");
        expect(screen.queryByTestId("scan-result")).toBeNull();
    });
});

describe("PdfInferenceUpload: the statement", () => {
    it("is a statement about what the operator did, not an acceptance of risk", async () => {
        // The field name is load-bearing. Called an attestation, the next
        // engineer reads it as "the customer accepted the risk", which is not
        // what this control is or what it was asked for.
        render(<PdfInferenceUpload scanResult={null} />);
        const box = await screen.findByTestId("user-processing-statement");
        expect(box.getAttribute("name")).toBe("userProcessingStatement");
        expect(box.getAttribute("name")).not.toMatch(/attest/i);
    });

    it("has a label that points at it", async () => {
        // A `label` with no `htmlFor` target is a label for nothing: the text
        // renders, the click does nothing, and no unit test can see it.
        render(<PdfInferenceUpload scanResult={null} />);
        const box = await screen.findByTestId("user-processing-statement");
        const id = box.getAttribute("id");
        expect(id).toBeTruthy();
        expect(document.querySelector(`label[for="${id}"]`)).toBeTruthy();
    });

    it("reports the statement being made", async () => {
        const onStatementChange = vi.fn();
        render(
            <PdfInferenceUpload scanResult={null} onStatementChange={onStatementChange} />,
        );
        fireEvent.click(await screen.findByTestId("user-processing-statement"));
        expect(onStatementChange).toHaveBeenCalledWith(true);
    });
});
