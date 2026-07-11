import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { InlineRename } from "~/components/editor-shared/InlineRename";

function setup(value = "Roof") {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(<InlineRename value={value} onCommit={onCommit} onCancel={onCancel} ariaLabel="Section name" />);
  const input = screen.getByLabelText("Section name") as HTMLInputElement;
  return { input, onCommit, onCancel };
}

test("mounts focused with the text selected so a rename overwrites", () => {
  const { input } = setup("Roof");
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe("Roof".length);
});

test("Enter commits a changed value", () => {
  const { input, onCommit, onCancel } = setup("Roof");
  fireEvent.change(input, { target: { value: "Roof Covering" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onCommit).toHaveBeenCalledWith("Roof Covering");
  expect(onCancel).not.toHaveBeenCalled();
});

test("Enter with an unchanged value cancels (no rename)", () => {
  const { input, onCommit, onCancel } = setup("Roof");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onCommit).not.toHaveBeenCalled();
  expect(onCancel).toHaveBeenCalled();
});

test("Escape cancels without committing", () => {
  const { input, onCommit, onCancel } = setup("Roof");
  fireEvent.change(input, { target: { value: "Something else" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onCommit).not.toHaveBeenCalled();
  expect(onCancel).toHaveBeenCalled();
});

test("blur commits a changed value", () => {
  const { input, onCommit } = setup("Roof");
  fireEvent.change(input, { target: { value: "Attic" } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledWith("Attic");
});

test("an empty value reverts instead of committing", () => {
  const { input, onCommit, onCancel } = setup("Roof");
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onCommit).not.toHaveBeenCalled();
  expect(onCancel).toHaveBeenCalled();
});

test("Enter then blur commits only once", () => {
  const { input, onCommit } = setup("Roof");
  fireEvent.change(input, { target: { value: "Garage" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledTimes(1);
});
