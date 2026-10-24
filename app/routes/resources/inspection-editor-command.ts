/**
 * Resource route for the field editor's write commands.
 *
 * The inspection editor's route action already owns every editor write (thirty
 * intents, chained across three modules). A fetch to the page URL is a document
 * request and answers HTML, so the web data source posts the same FormData to
 * this address instead and gets the action's JSON back. It is deliberately the
 * SAME function, not a copy: one set of intents, one behaviour.
 *
 * The action reads only `params.id`, which this route declares under the same
 * name as the page route.
 */
export { action } from "../inspection-edit/action.server";
