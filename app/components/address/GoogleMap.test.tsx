import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Prevent the real SDK loader from injecting a <script> / touching the network:
// importLibrary never resolves, so the component only ever renders its
// placeholder div (which is all these tests assert).
vi.mock("@googlemaps/js-api-loader", () => ({
  Loader: class {
    importLibrary() {
      return new Promise(() => {});
    }
  },
}));

vi.mock("react-router", () => ({ useRouteLoaderData: vi.fn() }));

import { GoogleMap } from "./GoogleMap";
import { useRouteLoaderData } from "react-router";

const mockRootData = vi.mocked(useRouteLoaderData);

describe("GoogleMap (fail-closed)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when the Maps key is unset", () => {
    mockRootData.mockReturnValue({ mapsApiKey: null });
    const { container } = render(<GoogleMap lat={30.26} lng={-97.74} />);
    expect(container.querySelector("[data-map]")).toBeNull();
  });

  it("renders nothing when coordinates are missing even with a key", () => {
    mockRootData.mockReturnValue({ mapsApiKey: "k" });
    const { container } = render(<GoogleMap />);
    expect(container.querySelector("[data-map]")).toBeNull();
  });

  it("renders the map container when a key and coordinates are present", () => {
    mockRootData.mockReturnValue({ mapsApiKey: "k" });
    const { container } = render(<GoogleMap lat={30.26} lng={-97.74} />);
    expect(container.querySelector("[data-map]")).not.toBeNull();
  });
});
