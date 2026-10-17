// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { render, cleanup } from "@testing-library/react";
import { useTimezoneOptions } from "~/hooks/useTimezoneOptions";

afterEach(cleanup);

function Probe({ current }: { current: string | null }) {
    const options = useTimezoneOptions(current);
    return <ul>{options.map((o) => <li key={o.value}>{o.label}</li>)}</ul>;
}

describe("useTimezoneOptions", () => {
    it("the server markup carries only the stored zone, with no runtime-dependent offset", () => {
        const html = renderToString(<Probe current="Asia/Ho_Chi_Minh" />);
        expect(html.match(/<li>/g)).toHaveLength(1);
        expect(html).toContain("Asia/Ho Chi Minh");
        expect(html).not.toContain("UTC");
    });

    it("the server markup is empty when nothing is stored", () => {
        expect(renderToString(<Probe current={null} />)).not.toContain("<li>");
    });

    it("control: once the client renders, the whole list is there, labelled with offsets, including the stored zone", () => {
        const { container } = render(<Probe current="Asia/Tokyo" />);
        const labels = [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");
        expect(labels.length).toBeGreaterThan(50);
        expect(labels.some((l) => /^\(UTC[+-]\d\d:\d\d\) Asia\/Tokyo$/.test(l))).toBe(true);
    });
});
