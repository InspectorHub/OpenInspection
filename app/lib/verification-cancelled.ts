/** Thrown by a caller that gave up because the person closed the human check. */
export class VerificationCancelledError extends Error {
  constructor() {
    super("verification cancelled");
    this.name = "VerificationCancelledError";
  }
}
