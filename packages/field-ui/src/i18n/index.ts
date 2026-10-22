// The package's own message functions.
//
// `generated/` is compiled by `paraglide-js` from `../../project.inlang`, which
// lists only the repo-root `messages/<locale>/*.json` modules the editor uses.
// It is a SECOND paraglide runtime next to the web app's: the app compiles its
// own copy into `app/paraglide`, and a package that imports that copy would no
// longer run in any other host. Two runtimes means two locale variables, and the
// host is responsible for keeping them in step - see `setFieldLocale` and
// `bindFieldLocaleSource` below.
export { m } from './generated/messages.js';
export { bindFieldLocaleSource, setFieldLocale } from './locale';
