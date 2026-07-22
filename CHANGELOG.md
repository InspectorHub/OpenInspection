# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0](https://github.com/InspectorHub/OpenInspection/compare/openinspection-v1.0.0-rc.1...openinspection-v1.0.0) (2026-07-22)


### Features

* **#181:** collaborative editing Phases 4–6 + offline media (version history, default-on, legacy retirement, offline upload) ([#194](https://github.com/InspectorHub/OpenInspection/issues/194)) ([c293821](https://github.com/InspectorHub/OpenInspection/commit/c293821a7e4d6e643b00b18c1166000d8a1e5f87))
* **#181:** collaborative inspection editing — Yjs + Durable Objects (Phases 1–3, flag default-off) ([#191](https://github.com/InspectorHub/OpenInspection/issues/191)) ([6d6ce46](https://github.com/InspectorHub/OpenInspection/commit/6d6ce46b02cd70cd79b7c0711365a2e40263c7c3))
* agent CRM directory, seat-invite cancel/resend, M20 removal, eslint hardening ([#261](https://github.com/InspectorHub/OpenInspection/issues/261)) ([1209425](https://github.com/InspectorHub/OpenInspection/commit/1209425976472aadb6f8d2330f652bd1f1c7d4d2))
* agent report-access program (people/role profiles, role-aware sending, agent unified link) + viewer timezones ([#258](https://github.com/InspectorHub/OpenInspection/issues/258)) ([622c64a](https://github.com/InspectorHub/OpenInspection/commit/622c64a33008a6ca6bb9b69a7e8179ccc59a9df1))
* **agent:** ⌘K palette + clickable referral rows (UC-A-6 + UC-A-4) ([bc1d408](https://github.com/InspectorHub/OpenInspection/commit/bc1d408bc7a8e063fae9b972c5da61faa80ac647))
* **agent:** recommendations export view (UC-A-5) ([a561413](https://github.com/InspectorHub/OpenInspection/commit/a561413a6119b9b6059f6f1546759926b1756e54))
* **api:** POST /api/inspections/templates/import-spectora ([#59](https://github.com/InspectorHub/OpenInspection/issues/59)) ([f7e3dd4](https://github.com/InspectorHub/OpenInspection/commit/f7e3dd4bf897fbd316e8d8079f5cb32214bc7daf))
* booking IA restructure + inspection editor gaps + seed templates ([#92](https://github.com/InspectorHub/OpenInspection/issues/92)) ([86b7f88](https://github.com/InspectorHub/OpenInspection/commit/86b7f88749513ba7a738c87d3811a2477dcfe027))
* BreadcrumbDropdown for multi-unit navigation ([#81](https://github.com/InspectorHub/OpenInspection/issues/81)) ([29224f5](https://github.com/InspectorHub/OpenInspection/commit/29224f58f7467138e1e75c5d9df0d06c2f510a5b))
* **calendar:** multiprovider connections with encrypted credentials ([#199](https://github.com/InspectorHub/OpenInspection/issues/199)) ([#251](https://github.com/InspectorHub/OpenInspection/issues/251)) ([6a9d24d](https://github.com/InspectorHub/OpenInspection/commit/6a9d24d523fb085158e0e4aa3aa8f37208d4d9f2))
* cascade delete triggers for tenant purge ([#77](https://github.com/InspectorHub/OpenInspection/issues/77)) ([d6ea711](https://github.com/InspectorHub/OpenInspection/commit/d6ea7117957c0231c68d28ca3742c7d5ab813132))
* client documents — per-inspection shared document area (portal Hub + inspector hub) ([#158](https://github.com/InspectorHub/OpenInspection/issues/158)) ([72776cb](https://github.com/InspectorHub/OpenInspection/commit/72776cb548cf75eaa3fc2196b797f81ba873a857))
* close deferred Commercial PCA report items (property facts, docx stress, gated Paged.js TOC) ([#239](https://github.com/InspectorHub/OpenInspection/issues/239)) ([e24c2e2](https://github.com/InspectorHub/OpenInspection/commit/e24c2e2adb40e2437ee707179cd78331457e0b37))
* complete commercial PCA report + self-hoster release contract ([#237](https://github.com/InspectorHub/OpenInspection/issues/237)) ([aa5107f](https://github.com/InspectorHub/OpenInspection/commit/aa5107f8697b7e2e3b27b4b0011f123ef1dd1359))
* **core:** implement secure multi-tenant sync and integration signature verification ([6ff8456](https://github.com/InspectorHub/OpenInspection/commit/6ff845635b4c39c8ec9e6f648d70b78bae460e6e))
* **core:** modernize saas backup/restore and harden infrastructure setup ([3c9f1c8](https://github.com/InspectorHub/OpenInspection/commit/3c9f1c87f03b60da8968459064f62df4c8ca2d66))
* **core:** QuickBooks Online integration + complete dark mode ([#42](https://github.com/InspectorHub/OpenInspection/issues/42)) ([37160d3](https://github.com/InspectorHub/OpenInspection/commit/37160d39cef55935492d6c59e29137629667cde0))
* **core:** settings page for UI-managed env vars with AES-256-GCM encryption ([84328dc](https://github.com/InspectorHub/OpenInspection/commit/84328dc3137e84187f277a5ead66048048d754f9))
* **core:** warn before changing an existing booking slug ([ed46ca7](https://github.com/InspectorHub/OpenInspection/commit/ed46ca7d94786cb5bda5b03f12aab8dbfc3968cd))
* **dashboard:** M2 visual alignment — Good-morning header + closing urgency + row typography ([#46](https://github.com/InspectorHub/OpenInspection/issues/46)) ([3633315](https://github.com/InspectorHub/OpenInspection/commit/3633315b923085302e721194f1097f119b9156cd))
* **deploy:** rename resources with standalone prefix ([37142f6](https://github.com/InspectorHub/OpenInspection/commit/37142f6840d2059c0da523a6a69012a18265a2d3))
* **deploy:** rename resources with standalone prefix ([366e6c1](https://github.com/InspectorHub/OpenInspection/commit/366e6c1e8c96a0f6c0e504e247b48bf7b64dabdd))
* **deploy:** standalone resource naming and simplified wrangler.toml vars ([167100f](https://github.com/InspectorHub/OpenInspection/commit/167100f0b64e750189600503ac64c01cfddb4926))
* **deploy:** use standalone resource naming ([898f2bc](https://github.com/InspectorHub/OpenInspection/commit/898f2bcead552b559b98123b2bc1bce6d2bbcad8))
* **deploy:** use standalone resource naming and remove unnecessary preview R2 bucket ([d87412b](https://github.com/InspectorHub/OpenInspection/commit/d87412b4a5fa15227b7d3696fc349ceebc1740c6))
* **email:** pluggable email providers + BYO provider choice (Resend/SendGrid/Postmark/Mailgun) ([#195](https://github.com/InspectorHub/OpenInspection/issues/195)) ([#206](https://github.com/InspectorHub/OpenInspection/issues/206)) ([16ca2e7](https://github.com/InspectorHub/OpenInspection/commit/16ca2e7eaa5e43e2e71f2e0156e36e886a7d935e))
* FIELD placeholder system + publish gate ([#82](https://github.com/InspectorHub/OpenInspection/issues/82)) ([849c7e6](https://github.com/InspectorHub/OpenInspection/commit/849c7e6bd48ad915ab48596b6a1960c1086c4699))
* Foundation layer + editor 4-column + visual compaction ([#79](https://github.com/InspectorHub/OpenInspection/issues/79)) ([2c945e5](https://github.com/InspectorHub/OpenInspection/commit/2c945e556f3ff0bb9fbb5397b30a1b4e173054b2))
* free-tier usage quotas (5 inspections / 50 platform SMS / 50 platform emails) ([#217](https://github.com/InspectorHub/OpenInspection/issues/217)) ([a68c66d](https://github.com/InspectorHub/OpenInspection/commit/a68c66da8cfa333d9b5f97b0394b9d49bc749dcb))
* Gap 16 completion + Settings + Comments filter ([#88](https://github.com/InspectorHub/OpenInspection/issues/88)) ([1212ed7](https://github.com/InspectorHub/OpenInspection/commit/1212ed73766da9e9263857238e9a910de50c7cc2))
* **husky:** add 1MB bundle size limit check in pre-commit hook ([8705ceb](https://github.com/InspectorHub/OpenInspection/commit/8705ceb4de632d7f0244ba4123d445f24b8c599e))
* i18n foundation — tz-aware + locale/currency formatting + Paraglide language framework ([#253](https://github.com/InspectorHub/OpenInspection/issues/253)) ([1506009](https://github.com/InspectorHub/OpenInspection/commit/1506009e4ee71e796a1a45fb97d8363c126386dc))
* **import:** Spectora converter handles rating_levels, disclaimer, description ([#61](https://github.com/InspectorHub/OpenInspection/issues/61)) ([f5584f5](https://github.com/InspectorHub/OpenInspection/commit/f5584f5377688e550c04c8cf5a9c23b7ad6fb2d3))
* **import:** Spectora export → v2 schema converter (+ tests) ([#58](https://github.com/InspectorHub/OpenInspection/issues/58)) ([c383876](https://github.com/InspectorHub/OpenInspection/commit/c383876f1945628d1ba83aa982ac093f60971443))
* initial open-source release of OpenInspection core ([7509d2c](https://github.com/InspectorHub/OpenInspection/commit/7509d2cde5495a6595cb3731d45d5e32e09f544c))
* inspection detail hub + Reports retirement + contact detail ([#111](https://github.com/InspectorHub/OpenInspection/issues/111)) ([#129](https://github.com/InspectorHub/OpenInspection/issues/129)) ([8017561](https://github.com/InspectorHub/OpenInspection/commit/80175615e3eee4effb429fd2dd94c5bc7932de81))
* **inspection-edit:** delete section / item + save-back / save-as new template ([1d2bd6e](https://github.com/InspectorHub/OpenInspection/commit/1d2bd6ecebf985a83594928c35a627ee9bc4347c))
* **inspection-edit:** gate rating buttons to rich items, surface non-rich types ([#54](https://github.com/InspectorHub/OpenInspection/issues/54)) ([907c47e](https://github.com/InspectorHub/OpenInspection/commit/907c47eece658b2bfcd1ec696d0807b903881962))
* **inspection-edit:** inline + Add item button + type-picker modal ([5e506e2](https://github.com/InspectorHub/OpenInspection/commit/5e506e25868ee5f8f491e033ea5c05b435f01ae4))
* **inspection-edit:** inline + Add section button + prompt modal ([964eb3f](https://github.com/InspectorHub/OpenInspection/commit/964eb3fae584080901c96d00d6ae55fe2eba5755))
* **inspection-edit:** M11 keyboard ergonomics — R repeat, J/K nav ([#47](https://github.com/InspectorHub/OpenInspection/issues/47)) ([8bb9a3a](https://github.com/InspectorHub/OpenInspection/commit/8bb9a3aa5997dafd44cf026c75f57f1e8b192d75))
* **inspection-edit:** real input controls for boolean / number / text / textarea / date items ([#55](https://github.com/InspectorHub/OpenInspection/issues/55)) ([f7f49eb](https://github.com/InspectorHub/OpenInspection/commit/f7f49ebca9f7fe90fe3d258faa50e98ae5a007cc))
* **inspection-edit:** select / multi_select / photo_only controls ([#56](https://github.com/InspectorHub/OpenInspection/issues/56)) ([adb140a](https://github.com/InspectorHub/OpenInspection/commit/adb140ae3267d89fbd4c05ea1a572087ccdccce8))
* **inspection:** PATCH /:id/template-snapshot — phase 1 of inline-edit ([60603be](https://github.com/InspectorHub/OpenInspection/commit/60603bef8d1af8205db712e5d57875c03c120cd7))
* **inspection:** rating-system swap endpoint + snapshot-first report-data ([1476f91](https://github.com/InspectorHub/OpenInspection/commit/1476f919702334eae551f11d5b847448c6f0f775))
* **integration:** tenants by-email lookup for cross-tenant client magic-links (P4) ([#188](https://github.com/InspectorHub/OpenInspection/issues/188)) ([bc1e80b](https://github.com/InspectorHub/OpenInspection/commit/bc1e80bdfb6d3126e1d8f38a4608da483ff66210))
* **isolation:** implement ScopedDB and multi-tenant security hardening ([38b3fc1](https://github.com/InspectorHub/OpenInspection/commit/38b3fc1e57a08721c342fe90ed2e9cea559401dc))
* **mcp:** Phase E — Resources, Prompts, extended-tier + UI polish ([#211](https://github.com/InspectorHub/OpenInspection/issues/211)) ([45fcc74](https://github.com/InspectorHub/OpenInspection/commit/45fcc74494d55fc006dabdc7abf632a20b08b811))
* **mcp:** remote MCP server + OAuth 2.1 (flag-gated, default off) ([#210](https://github.com/InspectorHub/OpenInspection/issues/210)) ([2f7e6de](https://github.com/InspectorHub/OpenInspection/commit/2f7e6de9431beaf1edcc2d09bc5e7d8169ad412a))
* merge open-source and SaaS branches into unified deployable build ([c7af25d](https://github.com/InspectorHub/OpenInspection/commit/c7af25d3bd2365cb57456604dec0ede1ca4ec77d))
* messaging-compliance provider abstraction, webhooks, template library, settings connection-test history ([#208](https://github.com/InspectorHub/OpenInspection/issues/208)) ([a12e7af](https://github.com/InspectorHub/OpenInspection/commit/a12e7af7d1b3c999d3dcc18b1ca1f8997a4ddbba))
* multi-workspace identity sync + shared-SaaS login UX + Sign Out fix ([#76](https://github.com/InspectorHub/OpenInspection/issues/76)) ([f727658](https://github.com/InspectorHub/OpenInspection/commit/f7276580a4a66248c40f8a1336e55bdcb6597b2c))
* P1 enhancements — Icon system + Card view + Batch rating ([#84](https://github.com/InspectorHub/OpenInspection/issues/84)) ([a7db1aa](https://github.com/InspectorHub/OpenInspection/commit/a7db1aa905917cfbce64659ddf0dc7a9804582f9))
* P2 advanced features — Subtypes + SpeedMode + ConflictResolver ([#85](https://github.com/InspectorHub/OpenInspection/issues/85)) ([72b4c13](https://github.com/InspectorHub/OpenInspection/commit/72b4c1358a047bf931fe60d6be80fc5e6fdf32c0))
* P3 — Resolvers + Comments tagging + Report D7 + InviteSeatModal ([#86](https://github.com/InspectorHub/OpenInspection/issues/86)) ([0e4318d](https://github.com/InspectorHub/OpenInspection/commit/0e4318d16b5d0f0ee8026662e1d28269cd88de23))
* **pca:** persist commercial subtype-preset property facts (Building Profile editing) ([#243](https://github.com/InspectorHub/OpenInspection/issues/243)) ([5e900d2](https://github.com/InspectorHub/OpenInspection/commit/5e900d2761af2da56cb15686008556bdc5cee3a7))
* per-tenant usage metering + self-service usage view ([#139](https://github.com/InspectorHub/OpenInspection/issues/139)) ([d22b0de](https://github.com/InspectorHub/OpenInspection/commit/d22b0de170cb67a41f0c10a215d10455c8e1878c))
* **pwa:** register /sw.js on every page load ([f14fb04](https://github.com/InspectorHub/OpenInspection/commit/f14fb04b424c7307df6ff68660de5e1bc60c1bcf))
* Remix frontend migration + dual Worker architecture ([#91](https://github.com/InspectorHub/OpenInspection/issues/91)) ([cba21ae](https://github.com/InspectorHub/OpenInspection/commit/cba21ae572b63a93b882ee3320974a126dbdd02e))
* remove per-tenant Google Analytics (GA4) tracking ([#100](https://github.com/InspectorHub/OpenInspection/issues/100)) ([68ae463](https://github.com/InspectorHub/OpenInspection/commit/68ae4630e30733a7a73e943a2bece660e7507c25))
* remove Tailwind CSS build result styles and utility classes file from git ([8d13df1](https://github.com/InspectorHub/OpenInspection/commit/8d13df1c34be5f22fca5677eaaec33c09dd14ce5))
* report style presets, inspector credentials, email attachment fix ([#260](https://github.com/InspectorHub/OpenInspection/issues/260)) ([a5c19b8](https://github.com/InspectorHub/OpenInspection/commit/a5c19b84522be3dc023bfa5cd9dd9a1207d0e4ef))
* **report-gate:** contact rows + amount on CTA + display font (BUG [#22](https://github.com/InspectorHub/OpenInspection/issues/22)) ([37d4efb](https://github.com/InspectorHub/OpenInspection/commit/37d4efbbfcf1c124e169547c465bc13a7585a1f4))
* **report-print:** paginated PDF layout + tenant PDF settings + editor Preview PDF ([#164](https://github.com/InspectorHub/OpenInspection/issues/164)) ([b6165c8](https://github.com/InspectorHub/OpenInspection/commit/b6165c8be6b24664adb560117c2052002cdb0704))
* **report:** Commercial PCA Phase C — dual-table Cost Engine (Opinion of Cost + Reserve Schedule) ([#232](https://github.com/InspectorHub/OpenInspection/issues/232)) ([908c85e](https://github.com/InspectorHub/OpenInspection/commit/908c85ee7b5ed2f304c54c42fd8d91e99b6bb927))
* **report:** customer Reply + Share entry points (UC-C-6, UC-C-7) ([c87a408](https://github.com/InspectorHub/OpenInspection/commit/c87a408866fc16638145723fdb79f193656d1dc5))
* **report:** expose enableRepairList + enableCustomerRepairExport in report data ([#156](https://github.com/InspectorHub/OpenInspection/issues/156)) ([9177d86](https://github.com/InspectorHub/OpenInspection/commit/9177d860af7c0dbf9e11acecdb3e3a19b380dfe5))
* **report:** show non-rich item values on the customer-facing report ([#63](https://github.com/InspectorHub/OpenInspection/issues/63)) ([32d3c3e](https://github.com/InspectorHub/OpenInspection/commit/32d3c3e97e5758c832699ccf365d1d35e97a3fd2))
* **reports:** make Workers Paid PDF pipeline opt-in (default OFF) ([a74d9e0](https://github.com/InspectorHub/OpenInspection/commit/a74d9e050f74ab97d43ee3545f4eb9d9c65554c9))
* **reports:** support per-inspection and per-tenant report theme override ([eb0be29](https://github.com/InspectorHub/OpenInspection/commit/eb0be29f821676a288ca2bc8b44b29b05a4679bb))
* **saas:** enforce strict multi-tenant isolation and persistent id sync ([6ba2f13](https://github.com/InspectorHub/OpenInspection/commit/6ba2f13129f973a5bdc32f882d2f3adcb5cb6c81))
* **saas:** implement portal integration and background synchronization architecture ([cb38936](https://github.com/InspectorHub/OpenInspection/commit/cb389364d7a5b41062c10b487a4e5063af6b824c))
* **scheduling:** Phase A-core — My Schedule, blocks, holidays, slot engine ([#252](https://github.com/InspectorHub/OpenInspection/issues/252)) ([fe720af](https://github.com/InspectorHub/OpenInspection/commit/fe720afa19148bc8d53a493c50cd3f1c0a9cd183))
* security hardening, safeISODate, unified login page ([#16](https://github.com/InspectorHub/OpenInspection/issues/16)) ([0fef86f](https://github.com/InspectorHub/OpenInspection/commit/0fef86f06506d9d153c8b76911bfed488765a822))
* seed template ID unification + findings key migration ([#87](https://github.com/InspectorHub/OpenInspection/issues/87)) ([4a25079](https://github.com/InspectorHub/OpenInspection/commit/4a25079f06bbc5ab945342c24b21b60a2a07c987))
* **seed:** default automations, agreement, and services for new tenants ([8123f00](https://github.com/InspectorHub/OpenInspection/commit/8123f0019ce16c22a48b8a62ea03546daed5965e))
* settings section-nav + selection-control unification ([#250](https://github.com/InspectorHub/OpenInspection/issues/250)) and Google Places address autocomplete + property auto-fill ([#198](https://github.com/InspectorHub/OpenInspection/issues/198), [#200](https://github.com/InspectorHub/OpenInspection/issues/200)) ([#259](https://github.com/InspectorHub/OpenInspection/issues/259)) ([63bb997](https://github.com/InspectorHub/OpenInspection/commit/63bb997bbac1b9f8e277bc330d345cb2c7f6f55b))
* **settings-sheet:** rating-system dropdown with severity-bucket remap warning ([fe001d2](https://github.com/InspectorHub/OpenInspection/commit/fe001d282a389c21229439c8defb08800138aa92))
* **settings-sheet:** replace window.confirm with custom 3-option modal ([e1f97bb](https://github.com/InspectorHub/OpenInspection/commit/e1f97bb80061374f8590e0a7bdd8428fd260b388))
* **settings:** toggle to enable client Repair Request Builder (enableCustomerRepairExport) ([#151](https://github.com/InspectorHub/OpenInspection/issues/151)) ([4591bc3](https://github.com/InspectorHub/OpenInspection/commit/4591bc3eca0186887d1d1ba059b98060f57f8fbd))
* **settings:** UTC-offset timezone pickers + pin Node 22 ([#248](https://github.com/InspectorHub/OpenInspection/issues/248)) ([981dfd8](https://github.com/InspectorHub/OpenInspection/commit/981dfd88adcffaa5513eaa1c7c7bc67ed39ea878))
* Shortcuts popover (Gap 9) ([#83](https://github.com/InspectorHub/OpenInspection/issues/83)) ([fdedf5f](https://github.com/InspectorHub/OpenInspection/commit/fdedf5fc62edfcc3c789e48ef46608ac57b61b6d))
* **sms:** MessagingProvider abstraction + BYO Twilio/Telnyx provider choice ([#205](https://github.com/InspectorHub/OpenInspection/issues/205)) ([b3e23d0](https://github.com/InspectorHub/OpenInspection/commit/b3e23d0866b58bd7a613e10e07dfe1745725eb1e))
* **template-editor:** per-item canned-comment editor UI ([#57](https://github.com/InspectorHub/OpenInspection/issues/57)) ([b330fcc](https://github.com/InspectorHub/OpenInspection/commit/b330fcc18e8bf1fa3332348854c1ed7a3c4e310a))
* **template-schema:** accept full ratingSystem shape ([#52](https://github.com/InspectorHub/OpenInspection/issues/52)) ([4c64482](https://github.com/InspectorHub/OpenInspection/commit/4c6448247b7d6e47d9bfc082df22ce8a2a0ac3d2))
* **template-schema:** accept section.source for Spectora-style imports ([#53](https://github.com/InspectorHub/OpenInspection/issues/53)) ([c872a07](https://github.com/InspectorHub/OpenInspection/commit/c872a07db2fb9daf42dc19d08933618ab88d6cf0))
* **template-schema:** expand v2 to keep editor's full feature set ([#51](https://github.com/InspectorHub/OpenInspection/issues/51)) ([76c95aa](https://github.com/InspectorHub/OpenInspection/commit/76c95aa9bbbf8b942bb6f7e58182b3106d9b885a))
* **templates:** "Import from Spectora" button + paste-JSON modal ([#60](https://github.com/InspectorHub/OpenInspection/issues/60)) ([c1e90b3](https://github.com/InspectorHub/OpenInspection/commit/c1e90b3b711b1583a89acc6d6a6b32e4f46a477b))
* **templates:** "Try with sample" link in the Spectora import modal ([#62](https://github.com/InspectorHub/OpenInspection/issues/62)) ([db746f2](https://github.com/InspectorHub/OpenInspection/commit/db746f289d2adbb77b8ad18714cda4d92eb01282))
* tenant suspension middleware + amber banner ([#78](https://github.com/InspectorHub/OpenInspection/issues/78)) ([a71380f](https://github.com/InspectorHub/OpenInspection/commit/a71380f3e4bcb7037b3fd52a9d64fccb779c1565))
* timezone configuration (tenant default + per-user override) ([#247](https://github.com/InspectorHub/OpenInspection/issues/247)) ([3a2f830](https://github.com/InspectorHub/OpenInspection/commit/3a2f8302156b68ef29d1629dc5b25cc8414c99e8))
* **uc-a-1:** thread referredByAgentId through multi-service bookings ([38fe8b8](https://github.com/InspectorHub/OpenInspection/commit/38fe8b80559c06d08ee9395a8f1d16a037c20abf))
* **uc-a-1:** wire ?ref=&lt;agentSlug&gt; through public booking endpoint ([3941dd7](https://github.com/InspectorHub/OpenInspection/commit/3941dd7a686a1d418bf45a972ec654dca526a73f))
* **ui:** dark mode with FOUC prevention and system preference sync ([#37](https://github.com/InspectorHub/OpenInspection/issues/37)) ([3dc251a](https://github.com/InspectorHub/OpenInspection/commit/3dc251ac6c0f6c951ba0f74b8cccb9707f510acb))
* **ui:** PDF download button + 3-way color scheme toggle (auto/dark/light) ([#38](https://github.com/InspectorHub/OpenInspection/issues/38)) ([263bbfa](https://github.com/InspectorHub/OpenInspection/commit/263bbfaa5d62bcd20e4757247d8c2ac24dc2da09))
* **ui:** theme dropdown menu + fix Inspections sidebar icon ([#41](https://github.com/InspectorHub/OpenInspection/issues/41)) ([0de3511](https://github.com/InspectorHub/OpenInspection/commit/0de3511ff1ecb165c4108b25404a18847f383413))
* unified client portal foundation (magic-link + My Inspections + Hub + report-email repoint) ([#157](https://github.com/InspectorHub/OpenInspection/issues/157)) ([bea61cf](https://github.com/InspectorHub/OpenInspection/commit/bea61cf0f6524398476b3a2a2c0e1101480b8bdd))
* **ux:** eliminate SSR page-transition lag + loading states ([#202](https://github.com/InspectorHub/OpenInspection/issues/202)) ([#209](https://github.com/InspectorHub/OpenInspection/issues/209)) ([e25621f](https://github.com/InspectorHub/OpenInspection/commit/e25621fae8d7397dfb7ee931f0aabc190ca372c7))


### Bug Fixes

* **a2+a1:** inviter resolution + standalone booking-link host ([0481c97](https://github.com/InspectorHub/OpenInspection/commit/0481c9748e08f0c9f3cdc100bd42087aad6d7e2a))
* add test-results/ to .gitignore ([c6d552f](https://github.com/InspectorHub/OpenInspection/commit/c6d552f77b74f8978fa65ba4d03616b21fa227f1))
* **agent-dashboard:** correct escaped quote syntax error in leaderboard template ([f7e6a74](https://github.com/InspectorHub/OpenInspection/commit/f7e6a743acb861166e4e07d5c236a9ee64c2ceb8))
* AI Suggest binding + ? shortcut bleed-over (BUG [#26](https://github.com/InspectorHub/OpenInspection/issues/26) + [#27](https://github.com/InspectorHub/OpenInspection/issues/27)) ([2632241](https://github.com/InspectorHub/OpenInspection/commit/263224190202cc7503ad7924fb36e84746225824))
* **auth+ui:** unblock browser-auth admin routes + sync Property Info widget on async load ([38a63a0](https://github.com/InspectorHub/OpenInspection/commit/38a63a0f7a412ed3538ebe8b23963b02993ae024))
* **auth:** expose /setup POST at root and issue JWT on initialization ([a4fb316](https://github.com/InspectorHub/OpenInspection/commit/a4fb3163ed375cb06db298c3f66c01481725ea43))
* **auth:** remove SETUP_CODE env var dependency, rely solely on KV for verification ([58deadf](https://github.com/InspectorHub/OpenInspection/commit/58deadfac5349404aa233e91fd939a3b3a0c5efc))
* **auth:** strictly require setup code and improve /setup page guidance ([3a47cfd](https://github.com/InspectorHub/OpenInspection/commit/3a47cfd93f9cd813e83c0793c006b27bd2dddbf4))
* **automation:** keep cron flush query under D1 100-column result-set cap ([#229](https://github.com/InspectorHub/OpenInspection/issues/229)) ([bb2b598](https://github.com/InspectorHub/OpenInspection/commit/bb2b59800f4a3350e7f62701d2a096955cd7af46))
* **automations:** await fireAutomation so the trigger actually runs ([5022131](https://github.com/InspectorHub/OpenInspection/commit/5022131e2f0fb689e387a39190953258e8d94d34))
* **calendar:** subtitle no longer dissonant when current week empty but month grid full (BUG [#23](https://github.com/InspectorHub/OpenInspection/issues/23)) ([27a4be8](https://github.com/InspectorHub/OpenInspection/commit/27a4be8679c4f8cc266a49b1524cd17d5ca3ead4))
* **cheatsheet:** drop stale "(coming soon)" on ⌘K row (BUG [#25](https://github.com/InspectorHub/OpenInspection/issues/25)) ([c902e31](https://github.com/InspectorHub/OpenInspection/commit/c902e31d9cbde22a75ccd36bb2815a42ec0abe27))
* **concierge:** redirect to /report/&lt;id&gt; instead of nonexistent /r/&lt;id&gt; ([b6b596b](https://github.com/InspectorHub/OpenInspection/commit/b6b596bdf183ae6afb31d83fbdd213b8d8d514a5))
* **conflict-modal:** dark mode pre sections + continuous empty-conflict cleanup ([#45](https://github.com/InspectorHub/OpenInspection/issues/45)) ([17ba254](https://github.com/InspectorHub/OpenInspection/commit/17ba254d73f483d59a87898cb12800f0cf8c971c))
* **core:** add missing route imports and optimize deployment script ([42dd8d3](https://github.com/InspectorHub/OpenInspection/commit/42dd8d3e717206e3edebc32074a0f73a86a30aba))
* **core:** remove Tailwind CDN, rely on CLI-built styles.css ([6f17691](https://github.com/InspectorHub/OpenInspection/commit/6f176918cff3a2fdb8baf819e8d6ccbebb1134bb))
* **core:** sync route import refinements from saas ([319cbff](https://github.com/InspectorHub/OpenInspection/commit/319cbff1ceec54a40d689d386f39561dea25169c))
* **core:** wire scheduled handler + chunk D1 seed insert + harden trigger ([4746942](https://github.com/InspectorHub/OpenInspection/commit/47469420b6a89cd4cba6236076c3d4eb64510890))
* count client inspections by email in ContactService ([bdfbc42](https://github.com/InspectorHub/OpenInspection/commit/bdfbc4212235c37aa1f911204079d8c1fb7ed575))
* **deploy:** cleanup orphaned KV and extend setup code TTL ([c7819e5](https://github.com/InspectorHub/OpenInspection/commit/c7819e5ae3e38b3ae2b8c5241e24f817cd383c86))
* **deploy:** cleanup orphaned KV and extend setup code TTL ([33d4e3b](https://github.com/InspectorHub/OpenInspection/commit/33d4e3b1f8b4ee9815ede2184bbfaff17d0878e9))
* **deploy:** downgrade eslint to v9 for compatibility with eslint-plugin-import ([545fb0a](https://github.com/InspectorHub/OpenInspection/commit/545fb0aa88b11814e7c257aeab1d03c199a75afb))
* **deploy:** downgrade eslint to v9 for deploy button compatibility ([7f17543](https://github.com/InspectorHub/OpenInspection/commit/7f17543e2f7244f2ed3b0c1bb5d6f2b6ce03d9f5))
* **deploy:** downgrade eslint v10 to v9 with synced lock file ([67de7fe](https://github.com/InspectorHub/OpenInspection/commit/67de7fedf4c01e23606aae1be74d85371bc46db0))
* **deploy:** fix setup code not being written to KV ([60669c4](https://github.com/InspectorHub/OpenInspection/commit/60669c46bcf45321ee5594695d997e7b834c51c7))
* **deploy:** replace --batch with --yes for wrangler d1 migrations ([62a884d](https://github.com/InspectorHub/OpenInspection/commit/62a884dbb80c26dbeef64dfe25bf1c2cdb28b08f))
* **deploy:** replace --batch with --yes for wrangler d1 migrations in CI/CD ([b749adc](https://github.com/InspectorHub/OpenInspection/commit/b749adcac52d9d4a135cf012592179bbbf302531))
* **deploy:** sync package-lock.json with eslint v9 ([bd5bf7e](https://github.com/InspectorHub/OpenInspection/commit/bd5bf7ea30c2ebe527e7a2a04e9aa81ab484d1e6))
* **deploy:** sync package-lock.json with eslint v9 downgrade ([71b08b3](https://github.com/InspectorHub/OpenInspection/commit/71b08b3d7e6c68425722c83717450ef1df66447f))
* **deploy:** use setup-cloudflare script and add placeholder IDs ([f883d7d](https://github.com/InspectorHub/OpenInspection/commit/f883d7d2c8881714042930ef14b1325cf6ab815b))
* **deploy:** use setup-cloudflare script and add placeholder IDs to wrangler.toml ([5d01279](https://github.com/InspectorHub/OpenInspection/commit/5d01279789fccf4713162cf02a433b2d7528dd39))
* **deps:** bump hono to ^4.12.21 and uuid to ^11.1.1 (Dependabot [#8](https://github.com/InspectorHub/OpenInspection/issues/8)-12) ([b035802](https://github.com/InspectorHub/OpenInspection/commit/b0358028462f04b91910a60753ecbb18063de5e4))
* **deps:** bump hono to 4.12.24 and uuid to 11.1.1 (Dependabot [#8](https://github.com/InspectorHub/OpenInspection/issues/8)-12) ([6b152ed](https://github.com/InspectorHub/OpenInspection/commit/6b152edc18ea922fa515183c0ecd9d938fc1bd6d))
* downgrade ESLint v10 to v9 with synced lock file ([68d2827](https://github.com/InspectorHub/OpenInspection/commit/68d2827bf093f8f2f6ecce925630de13e7128fbc))
* **e2e:** resolve E2E test infrastructure and missing auth middleware ([e3df02f](https://github.com/InspectorHub/OpenInspection/commit/e3df02f5ee632f00c1eb2e4f4b95052e9e71acab))
* editor field-readiness + DB schema batch + offline queue + wizard People step ([#107](https://github.com/InspectorHub/OpenInspection/issues/107)) ([558710c](https://github.com/InspectorHub/OpenInspection/commit/558710c5952cd6c3432b4e599d7629b5e2133447))
* harden agent report-access program (post-merge review of [#258](https://github.com/InspectorHub/OpenInspection/issues/258)) ([#262](https://github.com/InspectorHub/OpenInspection/issues/262)) ([e1ff2fc](https://github.com/InspectorHub/OpenInspection/commit/e1ff2fcf5274e6409b0746e9749adcf411c598c6))
* **husky:** check bundle gzip size against 1MiB limit ([99a80bc](https://github.com/InspectorHub/OpenInspection/commit/99a80bc1fc3a57cd4948ff2a917c9fcbc7f530e1))
* **husky:** cross-platform pre-commit hook (Windows/macOS/Linux) ([4ff32f7](https://github.com/InspectorHub/OpenInspection/commit/4ff32f7aa7d8cface7e2bb5e8b45e5971351b78f))
* **husky:** simplify bundle check to only validate gzip size ([3d4d184](https://github.com/InspectorHub/OpenInspection/commit/3d4d184c113ea438aed38e1df3fa20952bf678f9))
* **inspection-edit:** count non-rich item values toward completion % ([#67](https://github.com/InspectorHub/OpenInspection/issues/67)) ([275cfe1](https://github.com/InspectorHub/OpenInspection/commit/275cfe1acce88294d20dbfb9e50010d535bffcec))
* **lint:** resolve all ESLint and TypeScript errors for pre-commit compliance ([1041efe](https://github.com/InspectorHub/OpenInspection/commit/1041efe7d576ae0225a5e311e034652f50130344))
* **m2m:** key tenant upsert on stable id, self-heal slug ([#104](https://github.com/InspectorHub/OpenInspection/issues/104)) ([05efd83](https://github.com/InspectorHub/OpenInspection/commit/05efd83b0b756257b72ac6fac2c7a7b756bf905c))
* **merge:** resolve type errors and lint warning after saas/opensource merge ([78fd1e8](https://github.com/InspectorHub/OpenInspection/commit/78fd1e855e5c54603e340b6c3567bd01c0418aa7))
* **migration:** defer_foreign_keys in 0055 users rebuild for D1 prod ([54a4f30](https://github.com/InspectorHub/OpenInspection/commit/54a4f30479fb05482461b02ffa6acd384b4c388b))
* **offline:** MemoryQueueStorage.putWrite/coalesce now shallow-copies the ([a0dc813](https://github.com/InspectorHub/OpenInspection/commit/a0dc813bb8b80f3fcedb956417b6a581670d6fa7))
* **offline:** MemoryQueueStorage.putWrite/coalesce now shallow-copies the ([de968a9](https://github.com/InspectorHub/OpenInspection/commit/de968a97832dfc55f5472a825b2909f4ac36058f))
* **offline:** MemoryQueueStorage.putWrite/coalesce now shallow-copies the ([ccb13f5](https://github.com/InspectorHub/OpenInspection/commit/ccb13f5d5922326ad0950e5858046cdd5cef2723))
* **offline:** MemoryQueueStorage.putWrite/coalesce now shallow-copies the ([558710c](https://github.com/InspectorHub/OpenInspection/commit/558710c5952cd6c3432b4e599d7629b5e2133447))
* **oi:** point "Switch workspace" links at /company/switch ([#212](https://github.com/InspectorHub/OpenInspection/issues/212)) ([cda88bc](https://github.com/InspectorHub/OpenInspection/commit/cda88bcb0f346ca0cbd8d51dbc606318b1a44d6f))
* **pca:** harden report export on constrained Browser Rendering / Images (PDF TOC degrade + Word-export memory) ([#242](https://github.com/InspectorHub/OpenInspection/issues/242)) ([df6f808](https://github.com/InspectorHub/OpenInspection/commit/df6f8082cc79c4239a682287543cda045fa360db))
* **publish-modal:** bump label contrast so the form does not read disabled (BUG [#24](https://github.com/InspectorHub/OpenInspection/issues/24)) ([2e083c4](https://github.com/InspectorHub/OpenInspection/commit/2e083c424a863d6d2b3632daa1230595dbcc34d7))
* **report-card-stack:** actually surface non-rich item values on /report/:id ([#64](https://github.com/InspectorHub/OpenInspection/issues/64)) ([a65f22e](https://github.com/InspectorHub/OpenInspection/commit/a65f22e1d87933a8098d31e7cc0aea6baacca6ca))
* **report-utils:** completionPercent counts non-rich item values ([#68](https://github.com/InspectorHub/OpenInspection/issues/68)) ([86c0175](https://github.com/InspectorHub/OpenInspection/commit/86c017513b42c3e8497e0dde585c825e673cf5f7))
* **report-viewer:** 8-tier rating labels + JSX parse for x-on:click.stop ([b82bf59](https://github.com/InspectorHub/OpenInspection/commit/b82bf59ed9f914da85cf54179be128b2a98b4267))
* **report-viewer:** also use templateSnapshot in the published view ([ee88f64](https://github.com/InspectorHub/OpenInspection/commit/ee88f6449b64a7d2ac3aa8be832d4fc2f2199597))
* **report-viewer:** drop jarring REDACTED fallback + surface inspector name ([c2352cc](https://github.com/InspectorHub/OpenInspection/commit/c2352ccac5306f509276a7110ea4879840dcd3ae))
* **report-viewer:** isolate from global dark-mode color scheme ([5217d5a](https://github.com/InspectorHub/OpenInspection/commit/5217d5a270f4da51a698c4a688bbeb2c0399ebcd))
* **report-viewer:** wire data-theme variables to actual rendered surfaces ([828d413](https://github.com/InspectorHub/OpenInspection/commit/828d41368b453be08b16f846a182300002d0e6f6))
* **report-viewer:** wire display font + accent through the cover hero ([f030ce4](https://github.com/InspectorHub/OpenInspection/commit/f030ce4132611bd21310d1450d0c1fdcc2612a96))
* **report.template:** keep non-rich items that have only a captured value ([#66](https://github.com/InspectorHub/OpenInspection/issues/66)) ([b585549](https://github.com/InspectorHub/OpenInspection/commit/b5855494030c27d96ea30f93916ff705d4481ea0))
* **report:** honor agent-view token on public /report/:id route (BUG [#21](https://github.com/InspectorHub/OpenInspection/issues/21)) ([85dff9e](https://github.com/InspectorHub/OpenInspection/commit/85dff9e76da8d02eb47bdd469a8fc318e3d9f70b))
* resolve 6 code scanning alerts + 1 dependabot vulnerability ([#93](https://github.com/InspectorHub/OpenInspection/issues/93)) ([d307d7e](https://github.com/InspectorHub/OpenInspection/commit/d307d7e0b841ef34ea2fbbffa66b044b54106dc9))
* resolve Wrangler config parsing error for Cloudflare Deploy button ([5b64ca6](https://github.com/InspectorHub/OpenInspection/commit/5b64ca6b64c52279e2136f3a71a6fb2ae9e42d4b))
* **routing:** role-aware redirects + agent-aware setup gate + tenant-router public allowlist ([80ae81d](https://github.com/InspectorHub/OpenInspection/commit/80ae81d9036b01fc27d05bed0c78ad411148a70f))
* **security:** enforce Turnstile verification and fix dashboard.js syntax error ([48f0d07](https://github.com/InspectorHub/OpenInspection/commit/48f0d07b11979d36ef2d81952627fa7856ba56ab))
* **security:** enforce Turnstile verification on booking endpoint ([d3d0376](https://github.com/InspectorHub/OpenInspection/commit/d3d0376169f8c1df7f248c8d64f6d383607e8b83))
* **security:** harden tenant isolation and add missing schema indexes ([aa0697c](https://github.com/InspectorHub/OpenInspection/commit/aa0697c54896a8613ce59fba5c007da2e659917c))
* **seed:** log silently-swallowed seedDefaultComments failures ([e34fd87](https://github.com/InspectorHub/OpenInspection/commit/e34fd87e497df02f9da451cdee069bd421bd26fb))
* **seed:** per-row INSERT loop for automations (D1 compound-SELECT cap) ([71d71f9](https://github.com/InspectorHub/OpenInspection/commit/71d71f9de462080c349a62ededa08768520f18c2))
* **settings:** conform-native checkboxes for report-feature flags so they save+round-trip ([#155](https://github.com/InspectorHub/OpenInspection/issues/155)) ([8a6b9c6](https://github.com/InspectorHub/OpenInspection/commit/8a6b9c6b35045bfe813700e2fb1c9e3e03d90cb4))
* **settings:** make Email/SMS delivery copy + guardrails provider-aware ([#207](https://github.com/InspectorHub/OpenInspection/issues/207)) ([0079b68](https://github.com/InspectorHub/OpenInspection/commit/0079b68d1f82722f669591363f8b189285a4c9a4))
* **settings:** remove boolean flags from workspace conform schema so checkbox saves persist ([#153](https://github.com/InspectorHub/OpenInspection/issues/153)) ([097a544](https://github.com/InspectorHub/OpenInspection/commit/097a544e3828b7767fb49b97490afc674425ac3d))
* **settings:** unwrap nested branding GET so workspace fields read back correctly ([#154](https://github.com/InspectorHub/OpenInspection/issues/154)) ([4becea9](https://github.com/InspectorHub/OpenInspection/commit/4becea96a3d1bbdfcc7ea4629365d0b60b60069c))
* **settings:** use literal name attrs for repair-feature checkboxes so they persist ([#152](https://github.com/InspectorHub/OpenInspection/issues/152)) ([be88f8d](https://github.com/InspectorHub/OpenInspection/commit/be88f8d73d110bfe34cb6b86df4b7b290361a28d))
* **setup+display:** require admin name + drop email-as-fallback on public surfaces ([5be91a6](https://github.com/InspectorHub/OpenInspection/commit/5be91a647dd41b7b5b316ac90ab03d8f4401a6e2))
* sidebar FOUC + page header consistency + merge create buttons ([#89](https://github.com/InspectorHub/OpenInspection/issues/89)) ([614a6ae](https://github.com/InspectorHub/OpenInspection/commit/614a6aec3fb0daa761131483490cec3d8261dd1c))
* **sms:** brand booking opt-in with company name + add OPTOUT/REVOKE stop keywords ([#193](https://github.com/InspectorHub/OpenInspection/issues/193)) ([78d93e1](https://github.com/InspectorHub/OpenInspection/commit/78d93e1d02320da605cf9fa2fdb8d008fc0c27f5))
* **sms:** toll-free verification compliance — HELP reply, opt-in legal links, message frequency ([#192](https://github.com/InspectorHub/OpenInspection/issues/192)) ([5ced75f](https://github.com/InspectorHub/OpenInspection/commit/5ced75f15a3d80b19d9da846a02087a502168a81))
* **tags:** add dark mode variants to tag color pills ([#44](https://github.com/InspectorHub/OpenInspection/issues/44)) ([26a8bbc](https://github.com/InspectorHub/OpenInspection/commit/26a8bbc61b0c2364fd931c6b397455e4e092fbe5))
* **template-editor:** create + edit work end-to-end; v2 schema only ([#48](https://github.com/InspectorHub/OpenInspection/issues/48)) ([6aeb582](https://github.com/InspectorHub/OpenInspection/commit/6aeb58294de42778751c250c7464a88a2616ae12))
* **template-editor:** save normalizer + collision-proof IDs ([#49](https://github.com/InspectorHub/OpenInspection/issues/49)) ([ee89a4a](https://github.com/InspectorHub/OpenInspection/commit/ee89a4a13f324e0b5fb5ffce9f295d6421950395))
* UI/endpoint bug batch (B-1, B-4–B-10) + nav-skeleton anti-flicker ([#102](https://github.com/InspectorHub/OpenInspection/issues/102)) ([fe9c3d6](https://github.com/InspectorHub/OpenInspection/commit/fe9c3d6b61f3d7ee03978926f9852f7d123b96f5))
* **ui:** dark mode — library pages, marketplace, 404, table rows, FullCalendar ([#43](https://github.com/InspectorHub/OpenInspection/issues/43)) ([ad42d6e](https://github.com/InspectorHub/OpenInspection/commit/ad42d6ecc1e587b72ac86effa3fdc6ae79594644))
* **ui:** dark mode overrides for bg-surface-50/100/200 palette ([#39](https://github.com/InspectorHub/OpenInspection/issues/39)) ([003b49e](https://github.com/InspectorHub/OpenInspection/commit/003b49efed029a17078e5f57156f1e1d91f0da81))
* **ui:** dark mode overrides for ink-* text and bg palette ([#40](https://github.com/InspectorHub/OpenInspection/issues/40)) ([594a652](https://github.com/InspectorHub/OpenInspection/commit/594a65209dba8592f4315b8e1acce1f6488f5ef4))


### Reverts

* **husky:** restore shell-based pre-commit hook, fix wrangler dry-run hang ([b451b4c](https://github.com/InspectorHub/OpenInspection/commit/b451b4c82c12cc4da7142974c666ec69dba49bd2))

## [1.0.0] - 2026-07-12

First stable release. Consolidates the work landed since `1.0.0-rc.1`;
grouped by theme rather than one entry per commit.

### Added
- **Commercial PCA reports** — an ASTM E2018-style Property Condition
  Assessment surface: dual-table Cost Engine (Opinion of Cost + Capital
  Replacement Reserve Schedule), tiered light/full reports, per-unit
  inspection, ASTM compliance module (dual sign-off, PSQ, document review),
  editable narrative and reliance text, photo appendix, clickable TOC, and a
  Word (`.docx`) export with a full reserve-schedule year grid.
- **Collaborative inspection editing** — real-time co-editing on Yjs +
  Durable Objects, with version history and offline media upload.
- **Remote MCP server + OAuth 2.1** — a flag-gated Model Context Protocol
  endpoint (tools, resources, prompts) for AI clients.
- **Client portal** — magic-link "My Inspections" + inspection hub, a
  per-inspection shared client documents area, and a client Repair Request
  Builder.
- **Pluggable communications** — bring-your-own email providers (Resend,
  SendGrid, Postmark, Mailgun) and SMS providers (Twilio, Telnyx) behind a
  provider abstraction, with compliance webhooks, a template library,
  connection-test history, and toll-free-verification opt-in handling
  (HELP/OPTOUT/REVOKE, legal links).
- **Report PDF** — paginated print layout, per-tenant PDF settings, and an
  in-editor Preview PDF.
- **Usage metering** — per-tenant metering with a self-service usage view and
  free-tier usage quotas.
- **Inspection detail hub** — consolidated inspection + contact detail views.

### Changed
- Eliminated SSR page-transition lag and added consistent loading states.
- Removed the built-in per-tenant Google Analytics (GA4) tracking.
- MCP extended tier: Resources, Prompts, and UI polish.

### Fixed
- Editor field-readiness, offline queue, and new-inspection wizard fixes.
- Settings persistence: conform-native checkboxes for report/repair-feature
  flags, provider-aware Email/SMS copy, and correct branding read-back.
- M2M tenant upsert keyed on a stable id with slug self-heal.
- Kept the automation cron flush query under D1's 100-column result-set cap.
- Pointed "Switch workspace" links at `/company/switch`.
- UI/endpoint bug batch with nav-skeleton anti-flicker.
- Resolved code-scanning alerts and dependency vulnerabilities (Hono, uuid).

## [1.0.0-rc.1] - 2026-04-09

### Added
- **High-Fidelity Testing**: Introduced `vitest` and `better-sqlite3` for in-memory, deterministic unit testing of the service layer.
- **Service Mocks**: Created robust simulations for Cloudflare D1 and KV to enable developer-friendly, portable testing.
- **CI/CD Automation**: Integrated unit tests, type-checking, and security audits into GitHub Actions.
- **Structured Logging**: Implemented a JSON-based `Logger` utility for professional observability in production.
- **Governorance Documents**: Added `SECURITY.md` and updated `README.md` with status badges.
- **Multi-Tenant Branding**: Propagated CSS-variable based themeing across all UI components.

### Changed
- Refactored `AuthService` and `AdminService` into standalone, unit-testable classes.
- Migrated testing infrastructure from edge runtime to high-fidelity Node.js environment for improved portability on Windows/macOS.
- Standardized error handling with structured JSON responses.

### Fixed
- Resolved module resolution issues between Cloudflare types and standard Node.js types.
- Fixed logic errors in team-joining and password reset workflows via unit test verification.

---

## [0.9.0] - 2026-04-08

### Added
- Multi-tenancy support via subdomain routing.
- SQLite (D1) integration with Drizzle ORM.
- Manual tenant approval workflow.
- Responsive dashboard and inspector field form.
- Branding system with logo uploads and custom color support.
