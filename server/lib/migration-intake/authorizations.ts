/**
 * The two authorisations an intake run can carry, and the version of each.
 *
 * TWO constants and not one. They authorise different things, to different
 * readers, with different lifetimes: A lets a program keep a file so the run
 * can be resumed; B lets a person open it. Sharing a version number would mean
 * rewording one of them silently re-versions the other, and a stored version
 * that does not correspond to any wording is worse than no version at all.
 *
 * Bump a version when the wording of the matching copy changes in a way that
 * changes what is being agreed to. Consumers store the value verbatim on the
 * batch; nothing derives it, so an old row keeps saying what it said.
 */

/** Version of the "keep my file so I can come back to this" wording. */
export const UPLOAD_AUTHORIZATION_VERSION = '1';

/** Version of the "a person on your side may open my file" wording. */
export const STAFF_ACCESS_AUTHORIZATION_VERSION = '1';
