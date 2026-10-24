/** A stand-in overlay for `FieldEditor.overlays.test.tsx`: it only records that it was mounted. Not a test file. */
export function stub(name: string) {
  return function OverlayStub() {
    return <div data-testid="overlay" data-overlay={name} />;
  };
}
