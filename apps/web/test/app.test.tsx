import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServiceStatus } from "../src/components/ServiceStatus";
import { useUiStore } from "../src/stores/uiStore";

describe("web foundation", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ apiStatus: "loading", theme: "dark" });
  });

  it("ui store toggles theme", () => {
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("light");
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("dark");
  });

  it("ServiceStatus shows down state when fetch fails (no mock success)", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch;
    render(<ServiceStatus />);
    expect(await screen.findByTestId("api-status")).toHaveTextContent(/down/);
  });

  it("ServiceStatus shows loading initially", () => {
    globalThis.fetch = (() => new Promise(() => undefined)) as unknown as typeof fetch;
    render(<ServiceStatus />);
    expect(screen.getByTestId("api-status")).toHaveTextContent(/Checking/);
  });
});
