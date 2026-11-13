import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OutputPanel } from "../src/components/OutputPanel";
import { ApiClientError } from "../src/lib/api/client";
import { useExecutionStore } from "../src/stores/executionStore";

/**
 * Phase 8 web tests: execution-disabled deployments. When the API has no
 * execution service configured it answers 503 EXECUTION_DISABLED; the
 * Output panel must show that as a calm notice (not an error), and other
 * API errors must keep the error treatment.
 */

const execApiMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), cancel: vi.fn() }));
vi.mock("../src/lib/api/executions", () => ({ executionsApi: execApiMock }));

beforeEach(() => {
  vi.clearAllMocks();
  useExecutionStore.getState().clear();
});

describe("execution-disabled handling (Phase 8)", () => {
  it("a 503 EXECUTION_DISABLED from the API puts the store in the disabled state", async () => {
    execApiMock.create.mockRejectedValue(
      new ApiClientError(503, "EXECUTION_DISABLED", "Code execution is not enabled on this deployment"),
    );
    await useExecutionStore
      .getState()
      .run({ projectId: "proj-1", entryFileId: "file-1", entryFileName: "main.py", files: [{ fileId: "file-1" }] });
    const s = useExecutionStore.getState();
    expect(s.phase).toBe("disabled");
    expect(s.error).toBe("Code execution is not enabled on this deployment");
    expect(s.execution).toBeNull();
  });

  it("the Output panel renders the disabled state as a calm notice, not an error", async () => {
    execApiMock.create.mockRejectedValue(
      new ApiClientError(503, "EXECUTION_DISABLED", "Code execution is not enabled on this deployment"),
    );
    await useExecutionStore
      .getState()
      .run({ projectId: "proj-1", entryFileId: "file-1", entryFileName: "main.py", files: [] });
    render(<OutputPanel />);
    const notice = screen.getByTestId("execution-disabled");
    expect(notice).toHaveTextContent("Code execution is not enabled on this deployment");
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("execution-error")).not.toBeInTheDocument();
  });

  it("other API errors still land in the error state (disabled is code-specific)", async () => {
    execApiMock.create.mockRejectedValue(new ApiClientError(503, "SERVICE_UNAVAILABLE", "Execution service unavailable: fetch failed"));
    await useExecutionStore
      .getState()
      .run({ projectId: "proj-1", entryFileId: "file-1", entryFileName: "main.py", files: [] });
    expect(useExecutionStore.getState().phase).toBe("error");
    render(<OutputPanel />);
    expect(screen.getByTestId("execution-error")).toBeInTheDocument();
    expect(screen.queryByTestId("execution-disabled")).not.toBeInTheDocument();
  });
});
