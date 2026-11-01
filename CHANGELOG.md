<!-- no-portal-routes-allow-file: generated from commit messages by release-please. The entries are a record of what shipped; editing them to satisfy a prose gate would falsify the history rather than fix a document. -->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Removed

* Unused API routes that no client called: `PUT /api/event-types/:id`, `DELETE /api/event-types/:id`, `POST /api/event-types/seed`, `GET /api/events/upcoming`, `GET /api/calendar/connections/:id/calendars`, `GET /api/inspections/{id}/full`, `GET /api/inspections/{id}/sign-status`, the `statusFlags` object on dashboard rows, `POST /api/auth/setup/skip` and `POST /api/auth/onboarding/flag`. Missing default event types are filled in by `POST /api/admin/data/install-bundled-content`; the signed state of an inspection is still returned as `signedByClient` by the inspection read.
* The unreachable `feature-disabled` page and its translation strings.

## [2.3.1](https://github.com/InspectorHub/OpenInspection/compare/openinspection-v2.3.0...openinspection-v2.3.1) (2026-11-01)


### Bug Fixes

* **dispatch:** do not guess an early wall-clock time on a day the clock changes ([f35110c](https://github.com/InspectorHub/OpenInspection/commit/f35110cde58d202c2aec9070c02317a0c201d327))
* **dispatch:** read and save times correctly on the days the clock changes ([991e02c](https://github.com/InspectorHub/OpenInspection/commit/991e02c514a0b36503f026a2afa3ccc34ec44361))
* **dispatch:** save a dropped time correctly on the days the clock changes ([7c769ef](https://github.com/InspectorHub/OpenInspection/commit/7c769ef3c423737b04c3e52871078948ffff9609))
* **field-ui:** keep a photo batch in selection order; neutral wording for the mobile begin hint ([d001c8d](https://github.com/InspectorHub/OpenInspection/commit/d001c8d845a370b6415fcc67c9dca86134e42cc2))
* **field-ui:** use neutral wording for the mobile "begin" hint so it reads right with a mouse ([51783db](https://github.com/InspectorHub/OpenInspection/commit/51783db089f2f931f9c3b145ae56b164d73d3985))
* **tz:** cache the zone formatters and cover east-of-Greenwich change days ([309a40d](https://github.com/InspectorHub/OpenInspection/commit/309a40deb6269d29f5226bcd60839000d8f73d19))
* **tz:** read a wall-clock time correctly just after a clock change west of Greenwich ([9fc138e](https://github.com/InspectorHub/OpenInspection/commit/9fc138e213ee8919affc04ffe9162a7099d984f0))

## [2.3.0](https://github.com/InspectorHub/OpenInspection/compare/openinspection-v2.2.0...openinspection-v2.3.0) (2026-10-31)


### Features

* **api-schema:** mount a child that is still a chain with legacyMounted ([3fc6bc8](https://github.com/InspectorHub/OpenInspection/commit/3fc6bc82659e87c154432a9737f6451b00a3ea4d))
* **api:** describe 17 more routes in OpenAPI (calendar reads, public reads, inspection types, events) ([6e12e98](https://github.com/InspectorHub/OpenInspection/commit/6e12e980800eae2fef0b79f7140c0c308b2d0489))
* **api:** describe GET /api/session/context in OpenAPI and move it into the native contract ([b958939](https://github.com/InspectorHub/OpenInspection/commit/b958939542f0d09cc239af4189e3d9e9caba20e1))
* **api:** describe the calendar read-set save, event writes, in-person sign and collab JSON routes in OpenAPI ([293983a](https://github.com/InspectorHub/OpenInspection/commit/293983aeea08664160aa2ba01a26738bea04603e))
* **api:** describe the client-portal document and message routes in OpenAPI ([e177046](https://github.com/InspectorHub/OpenInspection/commit/e177046e722b280a120d20eae08b52b3edc46266))
* **api:** describe the ten QuickBooks admin routes in OpenAPI ([6b3f4c8](https://github.com/InspectorHub/OpenInspection/commit/6b3f4c8c3954d3f40784a22a82ab4e68005b2d98))
* **api:** report the booked inspections that time off would cover ([a8613d9](https://github.com/InspectorHub/OpenInspection/commit/a8613d9bb4e7d359ceaa7939a7b7f87abf96aa99))
* **app:** command encoder, decoder and transport for the web FieldDataSource (batch B0c-3, part 2) ([464a58b](https://github.com/InspectorHub/OpenInspection/commit/464a58b6b29957b7c7e6e44ef17ceab42da1757b))
* **app:** compose the web FieldDataSource and mount its provider in both editors (batch B0c-3, part 3) ([e0b306b](https://github.com/InspectorHub/OpenInspection/commit/e0b306b95ff311798324c41e0325e7f0eee949a6))
* **app:** pure pieces of the web FieldDataSource adapter (batch B0c-3, part 1) ([7b5f8b3](https://github.com/InspectorHub/OpenInspection/commit/7b5f8b3e8bf413945cfae336da8c49ccda18b2de))
* **auth:** add the deleteInspection capability and restrict inspector deletes to their own inspections ([da01a6e](https://github.com/InspectorHub/OpenInspection/commit/da01a6edb2fd6e348ee6d4498e7c5ffeeaa267eb))
* **auth:** add the inspection visibility predicate ([61cedc6](https://github.com/InspectorHub/OpenInspection/commit/61cedc6f0c76d7873dea8378928e28bab35e36f3))
* **auth:** add the viewAllInspections capability (not yet settable) ([c77e2e4](https://github.com/InspectorHub/OpenInspection/commit/c77e2e44bcc6f318f2a52bf535578ecc089ebff9))
* **auth:** count bookings awaiting an inspector over the caller's visible inspections ([5c3416e](https://github.com/InspectorHub/OpenInspection/commit/5c3416e20023fb340f041d168a247cb24fffd005))
* **auth:** cover every place money is shown or changed with the financial capability ([e69bd75](https://github.com/InspectorHub/OpenInspection/commit/e69bd755218acec664c865ff93c30c2c66db6036))
* **auth:** cover every place money is shown or changed with the financial capability ([569ce10](https://github.com/InspectorHub/OpenInspection/commit/569ce1085b69280a8a908059bb908bc103965344))
* **auth:** hide inspections a restricted inspector is not assigned to behind a 404 ([1df4f05](https://github.com/InspectorHub/OpenInspection/commit/1df4f055075aa6e584d069eb69119b665899d739))
* **auth:** hide Pending Invites from non-managers and add the deleteInspection capability ([64a65e2](https://github.com/InspectorHub/OpenInspection/commit/64a65e2e122bfbeb621580bf51cc11492393772e))
* **auth:** inspection visibility scope - role gates, predicate, guard and scoped reads ([dff7f7d](https://github.com/InspectorHub/OpenInspection/commit/dff7f7d2089da87cbad31e3ff533f1b058c109fe))
* **auth:** keep a restricted creator on the roster of an inspection they create ([1ec5187](https://github.com/InspectorHub/OpenInspection/commit/1ec5187f27a231a9df8dd4e0f623a6cc6b2fb79d))
* **auth:** let administrators restrict an inspector to assigned inspections ([89e9963](https://github.com/InspectorHub/OpenInspection/commit/89e99631d9be5d6efe18ef4f94356dd812d4df5e))
* **auth:** let administrators restrict an inspector to assigned inspections ([58eceb0](https://github.com/InspectorHub/OpenInspection/commit/58eceb068c0992edfce93cc6020142349de592a5))
* **auth:** limit analytics and metrics to the caller's visible inspections ([98e5b08](https://github.com/InspectorHub/OpenInspection/commit/98e5b088dc3cb9ac1e854529a7491c07aa99479f))
* **auth:** limit contact reads to the caller's visible inspections ([3a9a65a](https://github.com/InspectorHub/OpenInspection/commit/3a9a65a3b170b0e2ea5c8867b430398ebaf3b936))
* **auth:** limit invoices, events, requests and the calendar to the caller's visible inspections ([62b9a7a](https://github.com/InspectorHub/OpenInspection/commit/62b9a7a88a80ce355f296d3e287aa746e0e9e59a))
* **auth:** limit message threads to the caller's visible inspections ([e6a1510](https://github.com/InspectorHub/OpenInspection/commit/e6a15108711f5a0bec2d211eb93e37f7f80e0f0a))
* **auth:** require a staff role on every per-inspection route ([096d47c](https://github.com/InspectorHub/OpenInspection/commit/096d47c5ee1f87b46e203421dc7d5d9e37ae2d83))
* **auth:** return a reduced team roster to non-administrators ([a77c0de](https://github.com/InspectorHub/OpenInspection/commit/a77c0def44f955b69ee112bbca49970d6288e214))
* **auth:** scope the inspection list, counts, stats and dashboard ([5e0f42e](https://github.com/InspectorHub/OpenInspection/commit/5e0f42e0d5314b9525337cd40ce8763bbd5b6ba8))
* **field-ui:** add a photo size hint and a header status slot, allow blob: media in the CSP, and close three gaps found in review ([738c995](https://github.com/InspectorHub/OpenInspection/commit/738c9954a43d9d6e2f5fb4a884227512d1cde723))
* **field-ui:** add a read-only mode and fix the desktop header and item navigation ([09f6d5e](https://github.com/InspectorHub/OpenInspection/commit/09f6d5e61e9191e4f37c282b9e26f48f28028c59))
* **field-ui:** add the not-converted photo notice message in both locales ([ce16c39](https://github.com/InspectorHub/OpenInspection/commit/ce16c399d953c2b6acf5aa3c44a3cb1878d8095d))
* **field-ui:** check every image before it is sent or queued, and keep a refused edit from hanging around ([34d1d67](https://github.com/InspectorHub/OpenInspection/commit/34d1d670edd8312d7e49b0b670823a63dd12eb6c))
* **field-ui:** check every image before it is sent, keep refused edits open, and add a photo size hint and a header status slot ([5db8237](https://github.com/InspectorHub/OpenInspection/commit/5db8237662b0a23357d494b8c2d1a4b828c97df0))
* **field-ui:** complete the phone editor and make the layout hook hydration-safe (9a) ([3f8f80b](https://github.com/InspectorHub/OpenInspection/commit/3f8f80b5905a9325246bca43cd3798dbaf1e4d0e))
* **field-ui:** data-source contract additions, provider and guarded command hook (batch B0c-2) ([44d03c2](https://github.com/InspectorHub/OpenInspection/commit/44d03c2a35e33df1956f9c3039b6288850c448da))
* **field-ui:** extract the field editor into @inspectorhub/field-ui with phone and tablet layouts ([b0e0d33](https://github.com/InspectorHub/OpenInspection/commit/b0e0d331e068c7a29a787d8829d5fe10b044c9fb))
* **field-ui:** extract the shared design tokens into theme.css (Task 10) ([4383b68](https://github.com/InspectorHub/OpenInspection/commit/4383b685938275a41a839610b0809e2f7df6e8f5))
* **field-ui:** fixes found on a phone and tablet, and an optional photo URL subscription ([d9c37c9](https://github.com/InspectorHub/OpenInspection/commit/d9c37c96e6aa6defa1e7b28d204e00a2f27c6e6e))
* **field-ui:** hide the entry points of capabilities a host does not provide (Task 8) ([f40bcec](https://github.com/InspectorHub/OpenInspection/commit/f40bcec698b53a7c67b3ec44fbfcf2f1e5fd588e))
* **field-ui:** in-package i18n with a host-bound locale (batch B0b) ([ead7dcc](https://github.com/InspectorHub/OpenInspection/commit/ead7dccbc72ee5aa3aa81c06a8c32f9051874d20))
* **field-ui:** keep item tags across a reload, and name the starter rating systems neutrally ([651ef71](https://github.com/InspectorHub/OpenInspection/commit/651ef713910e69f01cc73e3528ab9c042dcfe22f))
* **field-ui:** let an uploader report a photo kept on the device, and export appendPendingPhoto ([ba7a482](https://github.com/InspectorHub/OpenInspection/commit/ba7a4829c5b96b434abb2122a99e212ff9348031))
* **field-ui:** optional decodeImage host capability for HEIC photos ([8e46835](https://github.com/InspectorHub/OpenInspection/commit/8e46835bbe4fdfa92f82e3359c83e78aa32e0812))
* **field-ui:** package skeleton, npm workspaces and the import-boundary gate ([65e99cd](https://github.com/InspectorHub/OpenInspection/commit/65e99cd0e07dc06589742234560ec7c81921e3fb))
* **field-ui:** phone and tablet fixes, notes kept on switch, safe data colours, offline cleanup after delete, page security headers ([9ec4b3f](https://github.com/InspectorHub/OpenInspection/commit/9ec4b3f8f203e7e98bf9ed7cfc34bac7de9a8176))
* **field-ui:** publish pipeline for @inspectorhub/field-ui (Task 11) ([68125d5](https://github.com/InspectorHub/OpenInspection/commit/68125d54c59373f652813fbdfcd748d17ac07647))
* **field-ui:** read-only mode, phone drawers, header layout and photo fixes ([6ff50bb](https://github.com/InspectorHub/OpenInspection/commit/6ff50bbc85e334d5a80ec969a3c75505e14e125c))
* **field-ui:** scan the packed tarball before npm publish ([c981140](https://github.com/InspectorHub/OpenInspection/commit/c981140a7d320eeffb99458cd07c868dd8ece497))
* **field-ui:** tablet two-pane editor, speed mode on touch, platform-aware app bar (9b) ([658df2e](https://github.com/InspectorHub/OpenInspection/commit/658df2e1f7a6a8fb501cc025f15ef15d6a734fca))
* **field-ui:** the FieldDataSource contract and an in-memory fake ([8635dec](https://github.com/InspectorHub/OpenInspection/commit/8635decfbca5b1bb31a557eb9d86f6e04d13cca4))
* **gates:** every write route must name its guard; close three routes that had none ([ddefaff](https://github.com/InspectorHub/OpenInspection/commit/ddefaff2e79d1b1d5661f4c110af7134a9eb9e9e))
* **inspections:** let the Send report dialog hand off to adding a person ([522fff3](https://github.com/InspectorHub/OpenInspection/commit/522fff3ed8c8e086baf9c41f5314bba5e7c3b03b))
* **inspections:** let the Send report dialog hand off to adding a person ([5912019](https://github.com/InspectorHub/OpenInspection/commit/59120193ae8ac1a96e8f7f616e5dc11b2ef2f911))
* **inspections:** office staff can no longer publish or sign; the AI helpers need report-editing access ([485dea0](https://github.com/InspectorHub/OpenInspection/commit/485dea016e4ebc04aff4a8435468100e3018feb2))
* **inspections:** purge collaborative document storage when an inspection is hard-deleted ([ad2c472](https://github.com/InspectorHub/OpenInspection/commit/ad2c472de555a7e3c0d8a7127cc577cf482fdd75))
* **inspections:** split the order from the inspection for office staff (create, edit, cancel rules) ([d2e15d2](https://github.com/InspectorHub/OpenInspection/commit/d2e15d2e114ac136ee345c047bcb74bddf855a11))
* **inspections:** the hub and the inspection list follow what office staff may actually do ([d7686d8](https://github.com/InspectorHub/OpenInspection/commit/d7686d885e46afb056254ef44e4778dbe83fe0a4))
* **inspection:** the send dialogs say who was reached, who was not, and why ([75356a2](https://github.com/InspectorHub/OpenInspection/commit/75356a29304e8741ca084d3b6642238d229574f0))
* **integrations:** an overview of every outside service on the Integrations page ([9e6557f](https://github.com/InspectorHub/OpenInspection/commit/9e6557fbe721140b33e6c926d149b7c6c6818d96))
* **integrations:** email and SMS get their own pages with a Built-in / Your own choice ([b787787](https://github.com/InspectorHub/OpenInspection/commit/b7877879d74db1ab8c72b2a9d0db42f93c781a74))
* **integrations:** resolve each outside service's source in one place ([719e7da](https://github.com/InspectorHub/OpenInspection/commit/719e7da85b1cb7b462dd16b6e73c29b0113d7fd0))
* **integrations:** resolve each outside service's source in one place ([470b131](https://github.com/InspectorHub/OpenInspection/commit/470b13160215338dac75daa52f54f20ccdb42a2d))
* **lint:** ratchet placeholder descriptions toward zero ([e7862fd](https://github.com/InspectorHub/OpenInspection/commit/e7862fdcb490e405a0ab0e0e3ba6d707fdd8a8a9))
* **native:** accept loose spellings of a photo content type and store the canonical one ([5191ae4](https://github.com/InspectorHub/OpenInspection/commit/5191ae4b63d7ba32b2c1eaab80e6f5d7fcd9950f))
* **native:** add the inspection visibility reconcile endpoint ([6a9fd46](https://github.com/InspectorHub/OpenInspection/commit/6a9fd469816c817fb2d35ebd177a84b19defae14))
* **native:** chunked video upload with a ledger, recovery and an abandoned-upload sweep ([0a6b6e6](https://github.com/InspectorHub/OpenInspection/commit/0a6b6e6fb1db58b00f5273cf5f7c694dc0acd144))
* **native:** collab ack frame once a change is stored ([df1152a](https://github.com/InspectorHub/OpenInspection/commit/df1152a864ede31615e794fb14bc13aa7b7ae663))
* **native:** decide an uploaded photo or video's type from its bytes ([4804c25](https://github.com/InspectorHub/OpenInspection/commit/4804c255b50272d39869a13b147c879546315312))
* **native:** primaryReportId, accountUrl, serverNowMs and tenantName on the native client endpoints ([c94f9dc](https://github.com/InspectorHub/OpenInspection/commit/c94f9dc222e67d4728d2caa2a12e633fcc6f1e53))
* **native:** refuse to recreate an inspection id that was deleted ([f9b828a](https://github.com/InspectorHub/OpenInspection/commit/f9b828a4f4365d5e02fe2081c245f11dc14dd07c))
* **native:** register the editor write routes in the native contract, add revisionStatus, and close a cross-tenant poster hole ([6138c6f](https://github.com/InspectorHub/OpenInspection/commit/6138c6f368196fbc369c03e18055cd7916511042))
* **native:** register the inspection photo read route in the native contract ([27831a9](https://github.com/InspectorHub/OpenInspection/commit/27831a9105a0f575225d16eb862f87ded6701cde))
* **native:** say the member was removed when a re-invite retires an old session ([c543fb0](https://github.com/InspectorHub/OpenInspection/commit/c543fb0f618684cd885f284153e2f1556d4ed530))
* **native:** say why a refresh failed when the member was removed ([617bf9f](https://github.com/InspectorHub/OpenInspection/commit/617bf9f996f56c0110c63305f769bd68340af06c))
* **native:** server support for native offline clients ([0fa0a6a](https://github.com/InspectorHub/OpenInspection/commit/0fa0a6a35061f03a36ff070d1e3bd0d491939078))
* **observability:** per-route page timing ([8298e41](https://github.com/InspectorHub/OpenInspection/commit/8298e41817fd7d92ac16b16b225618cdad43eb88))
* office staff role, order/inspection split, manager grant ceiling, per-company SMS and email accounts ([cdc1e7d](https://github.com/InspectorHub/OpenInspection/commit/cdc1e7d5f22a883791a88e3e4f49ad768d4e707c))
* **offline-package:** add package summary, splitting and the import state machine ([52bf6a6](https://github.com/InspectorHub/OpenInspection/commit/52bf6a6cac2f2ed22a9dd81ec1128b89c200e14e))
* **offline-package:** add the browser transport for importing a package ([3715ef5](https://github.com/InspectorHub/OpenInspection/commit/3715ef5ccc7f9701dc8675a3e980185632245221))
* **permissions:** a refusal says who you are, what you lack and how to get past it ([c8e8ca4](https://github.com/InspectorHub/OpenInspection/commit/c8e8ca46d74da541cbc36a7d82ca33b71635d0b2))
* **permissions:** acting on an inspection you are not on needs scheduleOthers ([5e297be](https://github.com/InspectorHub/OpenInspection/commit/5e297be0b06c34035651f24bb2e5dfee9805ca06))
* **permissions:** acting on an inspection you are not on needs scheduleOthers ([ae76c11](https://github.com/InspectorHub/OpenInspection/commit/ae76c11604f004d57cc373325fae7acb36fcc3ac))
* **permissions:** an office staff role that takes no seat, report-content permission, role-change event ([9c2dfaa](https://github.com/InspectorHub/OpenInspection/commit/9c2dfaa1c4b9cdf6f09ae08b79dc28ba2dd792d8))
* **permissions:** keep the screens in step with the server, and require every write route to name its guard ([c4f3f70](https://github.com/InspectorHub/OpenInspection/commit/c4f3f701b4237fcf1d079a6767073fd3e0e4dda6))
* **permissions:** split the financial capability into inspection fees and company finances ([c3bd87c](https://github.com/InspectorHub/OpenInspection/commit/c3bd87c21b53f4190b60a4b43b25311a72f721c8))
* **plan:** the Free plan has no platform text-message allowance ([194341c](https://github.com/InspectorHub/OpenInspection/commit/194341ca5ca547540b9beafdf39cc80ef9ee0fb5))
* **qbo:** Check credentials button in the Your Intuit app section ([fbe338b](https://github.com/InspectorHub/OpenInspection/commit/fbe338bb0d3a673e061d6303d9df669de3662daa))
* **qbo:** check that the Intuit app credentials are a matching pair ([a4f57c7](https://github.com/InspectorHub/OpenInspection/commit/a4f57c7a844271f75967e21774bf8d6e317b18be))
* **qbo:** match a contact to a QuickBooks customer from the items that need attention ([5897a05](https://github.com/InspectorHub/OpenInspection/commit/5897a0565025700df43b4bc39aa8256f176bdf79))
* **qbo:** match a contact to a QuickBooks customer, undo it, and read where it stands ([bb9a336](https://github.com/InspectorHub/OpenInspection/commit/bb9a336865dc94f6d1312aa7ad24fb3dcb0da837))
* **qbo:** push again the invoices that were waiting for a QuickBooks customer once a contact is matched ([5a83857](https://github.com/InspectorHub/OpenInspection/commit/5a83857a9e5174717a7e1ab1e63e6c38518ee46d))
* **qbo:** report the environment, connection time, match counts and credential origins in the status ([2a8c758](https://github.com/InspectorHub/OpenInspection/commit/2a8c75888a20f19913d234834f6725b06a5dc829))
* **qbo:** rework the QuickBooks settings page around the connection ([2784d1c](https://github.com/InspectorHub/OpenInspection/commit/2784d1c55c24eaffe255bb5e33d41549412730c7))
* **qbo:** search QuickBooks customers and expose the contact match routes ([c84a3dc](https://github.com/InspectorHub/OpenInspection/commit/c84a3dce4e9aaeb2533e9f584d958ade7f1972e9))
* **qbo:** show and manage the QuickBooks match on the contact page ([deae121](https://github.com/InspectorHub/OpenInspection/commit/deae121989c95de2de6ef6ffd434f50f87619617))
* **roles:** staff can never write report content; agents hold no seat ([3f1580d](https://github.com/InspectorHub/OpenInspection/commit/3f1580d727ad0fae9549b421e17bbf6b40ccb75e))
* **roles:** staff can never write report content; agents hold no seat ([b0d6587](https://github.com/InspectorHub/OpenInspection/commit/b0d65872c8cd61faca22618efb1dc003bfa8af88))
* **settings:** add the offline package import page ([64f82e1](https://github.com/InspectorHub/OpenInspection/commit/64f82e197f5cdfc1562b36e5bd8cf93c5c38e4e5))
* **team:** a manager can grant at most what the manager holds ([ccf1b0c](https://github.com/InspectorHub/OpenInspection/commit/ccf1b0c52b26a404e149da556f9e7cfe4d3cd6f1))
* **team:** add a company default for whether new inspectors see all inspections ([df13fe0](https://github.com/InspectorHub/OpenInspection/commit/df13fe072d98605c0718a5b36bffc1427cf47132))
* **team:** add the permission_templates table for company-defined templates ([542e16c](https://github.com/InspectorHub/OpenInspection/commit/542e16c7329436d2fc30772ae0e0d5acfbbebafa))
* **team:** apply the new-inspector default when inviting, and audit the choices ([bcac557](https://github.com/InspectorHub/OpenInspection/commit/bcac55753d15832ff171f1a9870389c099fb5204))
* **team:** choose which inspections an inspector can see, and the default for new ones ([3f39269](https://github.com/InspectorHub/OpenInspection/commit/3f392697f63abe325c9f49ced0c0aa474958cb3d))
* **team:** permission templates for invites and member edits ([bc297fb](https://github.com/InspectorHub/OpenInspection/commit/bc297fb6aa120929d762f03ebde6d1b62f971dae))
* **team:** permission templates, built-in and company-defined, applied by copy ([d39d376](https://github.com/InspectorHub/OpenInspection/commit/d39d3765a617ddd4a7c56185504149a3d1ca1638))
* **team:** start an invite or a member edit from a permission template ([12d0e78](https://github.com/InspectorHub/OpenInspection/commit/12d0e786c1049b1a2f3819142c22dbe8690af7ef))
* **tooling:** add npm run type-check:native and document when to use it ([2a1167a](https://github.com/InspectorHub/OpenInspection/commit/2a1167a85f640bce1e385253e7fcb88e9b360947))
* **web:** ask before blocking time over booked inspections ([17cdc21](https://github.com/InspectorHub/OpenInspection/commit/17cdc210c58cc590473c79c53d7d6332628649ec))
* **web:** ask before marking fieldwork complete on the inspection detail page ([c784d61](https://github.com/InspectorHub/OpenInspection/commit/c784d61a66c0ce1e165338d50aa00c39bab538b2))
* **web:** confirm before deleting an event type ([34035f7](https://github.com/InspectorHub/OpenInspection/commit/34035f7cbb60ba822677ca46b4617a3e94bdd6f1))
* **web:** confirm before disconnecting a calendar, and disconnect only that provider ([0d72341](https://github.com/InspectorHub/OpenInspection/commit/0d72341eed2995e4bcfa318cdbab6ca277387031))
* **web:** delete an inspection from its own page ([936687e](https://github.com/InspectorHub/OpenInspection/commit/936687e6f21ae0a472a66c48f7b3bf235e68cb58))
* **web:** keep item tags across a reload, confirm completing fieldwork, draw seeded tag colours, and fix narrow-screen layout ([45a432b](https://github.com/InspectorHub/OpenInspection/commit/45a432b333066ac98cb549dcd581784317c6059f))
* **web:** remove manual date overrides from Settings -&gt; Schedule ([32808dd](https://github.com/InspectorHub/OpenInspection/commit/32808dd1ea5ec4e938e7282a51b134020e8e6425))
* **web:** security headers on HTML pages, a report-only CSP, and a report receiver ([1b5f1f3](https://github.com/InspectorHub/OpenInspection/commit/1b5f1f357ccb122ccfe6f54b6e25338a78b60c3b))


### Bug Fixes

* a batch of low-severity defects from the access review ([fae3135](https://github.com/InspectorHub/OpenInspection/commit/fae31354c8bf5768182649fee3b6226f26367565))
* a failed cache write no longer costs the user a live response; one accessible name for the collapse button ([32e4605](https://github.com/InspectorHub/OpenInspection/commit/32e4605c2066c49031cddba3823a43e6b57da1c7))
* **ai,team:** tell a company what an AI refusal needs, gate the comment library, and let a removed member's open work be handed over ([998b0a8](https://github.com/InspectorHub/OpenInspection/commit/998b0a8dfa68422a8abd35ece6b274452ffcfcee))
* **api:** answer 400 for a template or agreement that is not the company's own ([dd81005](https://github.com/InspectorHub/OpenInspection/commit/dd810055c33b5839c0d9fc6d09a9105098851c47))
* **api:** bind long id lists in chunks under D1's 100-parameter limit ([68d3ac5](https://github.com/InspectorHub/OpenInspection/commit/68d3ac536a40e1d022307dde902bb709ebaf221f))
* **api:** disconnecting a calendar removes what it synced; add a provider parameter ([00b0802](https://github.com/InspectorHub/OpenInspection/commit/00b0802e862d2e68ac8e9b362e5ff2d0f4184e78))
* **api:** drop repeated ids before chunking; cover every chunk of mayActOnContact ([8cc090f](https://github.com/InspectorHub/OpenInspection/commit/8cc090fda0ad0fa2f17f6caf8efdd53a6445e58b))
* **api:** give the two routes that shared an operationId their own ([f256dc1](https://github.com/InspectorHub/OpenInspection/commit/f256dc145beafb7d66f43578212ea600819d7043))
* **api:** keep the bulk service reads under D1's bound-parameter limit ([3c6764e](https://github.com/InspectorHub/OpenInspection/commit/3c6764ecaf9d146c965e042127c3f16a147a4c9f))
* **api:** log the number of tags a first load actually inserted ([ca3a43c](https://github.com/InspectorHub/OpenInspection/commit/ca3a43c3e1306f27f84e63d7a22a61ec44aad316))
* **api:** removing a member removes their calendar integration; hide their busy blocks ([76905ef](https://github.com/InspectorHub/OpenInspection/commit/76905ef0d92af283800746f3d5b1df679e91c7a5))
* **api:** scope, protect and audit the removal of a date override ([71eea15](https://github.com/InspectorHub/OpenInspection/commit/71eea15ffb6104f8b4dbaa29ea874055b5146762))
* **app:** pages that read the origin, the stored time zone or local columns no longer hydrate differently ([540acaf](https://github.com/InspectorHub/OpenInspection/commit/540acaf972051ce58d0b397a2a9670c7d06332d6))
* **audit:** declare the metadata the finding-key migration now records ([68c6086](https://github.com/InspectorHub/OpenInspection/commit/68c608624b710f438886cf959d41e9a1f5a1f398))
* **auth:** answer 404 for an inspection a restricted caller cannot open, in the callers the path guard does not cover ([a344b31](https://github.com/InspectorHub/OpenInspection/commit/a344b319ba4880fbbc2e3cc1a8c8983c0d5a5933))
* **auth:** chain an explicit staff sign-out to the identity service, and forward SSO failure reasons ([79b17b6](https://github.com/InspectorHub/OpenInspection/commit/79b17b60eadb29e5ad91693453375e0b0f424a44))
* **auth:** close the envelope and AI-summary reads and keep a stored restriction across member edits ([a8a4d16](https://github.com/InspectorHub/OpenInspection/commit/a8a4d16be5341b87b82cebe28ad2d2dd93b3f19c))
* **auth:** end the redirect loop between /oauth/authorize and /login for an expired session ([ba7e749](https://github.com/InspectorHub/OpenInspection/commit/ba7e749a5eec0502a42fde17ee4b6a2ea431d39c))
* **auth:** keep a restricted creator on the roster of a plain create ([e165b25](https://github.com/InspectorHub/OpenInspection/commit/e165b25dd0c2adbbf7dfb9e6f270d26f8231e697))
* **auth:** keep contact writes inside a restricted inspector's set ([3665205](https://github.com/InspectorHub/OpenInspection/commit/3665205b23d5e53ea56770ffe74852a4ac22006d))
* **auth:** keep the calendar inside the inspection list's scope ([3767707](https://github.com/InspectorHub/OpenInspection/commit/37677076a7b0ddb838ccc586b833fa36e2f33502))
* **auth:** read the caller's capabilities only when money is involved ([cb48542](https://github.com/InspectorHub/OpenInspection/commit/cb485425b89d0a76897f891d230e821b3f7b5cb6))
* **auth:** refuse anonymous API access by default and tighten send, assign and delete rules ([6336718](https://github.com/InspectorHub/OpenInspection/commit/6336718a3510da5e57d8a344df24735d6130be67))
* **auth:** refuse anonymous API access by default and tighten who may send, assign and change inspections ([c0b1026](https://github.com/InspectorHub/OpenInspection/commit/c0b1026460153d5268bbcf71846382a83aaaa76b))
* **auth:** require a role on analytics, usage, billing, integration status and the leaderboard ([a681fa2](https://github.com/InspectorHub/OpenInspection/commit/a681fa20fdd0489aa8aac94c98c9d2a102ba1b99))
* **auth:** satisfy the two CI-only gates for the delete audit record ([1fe2dff](https://github.com/InspectorHub/OpenInspection/commit/1fe2dff997d0b5fbab3d8f3acfe3b615c46f71e0))
* **auth:** stop exporting the path guard factory, nothing imports it ([ced989c](https://github.com/InspectorHub/OpenInspection/commit/ced989c50d7bf2802e41055bdf1d0a1a524d4be7))
* **auth:** withhold open-inspection ids from a restricted viewer of the presence roster ([b3b8df2](https://github.com/InspectorHub/OpenInspection/commit/b3b8df27f241cf027d83791a3b2e232eb8709b9c))
* **availability:** answer 409 for a repeated blocking override and 400 for an unknown inspector ([88fc2c6](https://github.com/InspectorHub/OpenInspection/commit/88fc2c6237749310e85e4bb4e84a75aeb3963b86))
* **booking:** catch overlapping bookings and new time off, and give back a lost booking's allowance ([185eca5](https://github.com/InspectorHub/OpenInspection/commit/185eca580501ef5187e7c28ff83c13dd0406b3b5))
* **booking:** make the public slot list explicitly uncacheable ([761f822](https://github.com/InspectorHub/OpenInspection/commit/761f822a95ab56a326236472f9f093c4512fcf90))
* **booking:** offer only the starts the arbitration will accept; write a booking's length in its insert ([0a9c155](https://github.com/InspectorHub/OpenInspection/commit/0a9c155f558b909fe4a7b28159e4b4fd5fc9c427))
* **booking:** say which time windows still have times instead of blocking the date ([7a0692c](https://github.com/InspectorHub/OpenInspection/commit/7a0692cf7b6535cff096afac4d376e1ad8d4e9a5))
* **booking:** the slot list takes the time slot the booking will carry ([fee55ed](https://github.com/InspectorHub/OpenInspection/commit/fee55ed070de5365cbc95fdce4542294f7111f74))
* **calendar:** a provider without synced rows matches no synced row ([9f26182](https://github.com/InspectorHub/OpenInspection/commit/9f2618204003fb1f1ddb905714a9b1ec59c5a250))
* **calendar:** decide a disconnect's scope inside its batch, guard in-flight syncs, audit it ([135c86b](https://github.com/InspectorHub/OpenInspection/commit/135c86b0b026183dfa54219a55f32b2577fb9343))
* checklist template count; far fewer sequential database round trips on the dashboard and shared reads ([86f1202](https://github.com/InspectorHub/OpenInspection/commit/86f1202e38ef0b5b95faa15833906e97927dbbfa))
* **ci:** clear the push-rung gates and two unit specs this branch tripped ([e10ac10](https://github.com/InspectorHub/OpenInspection/commit/e10ac10820de6240f3cfa434aad479f23fcd8c8c))
* **ci:** read the version after the last @ in the publish tag check ([9a1168c](https://github.com/InspectorHub/OpenInspection/commit/9a1168c0cdb3b550b6c891b531dd11826a3a960d))
* **ci:** read the version after the last @ in the publish tag check ([166a74f](https://github.com/InspectorHub/OpenInspection/commit/166a74fa6fbb99fdd30bc9ea19779569add69af3))
* **ci:** wait up to five minutes for a published version and warn instead of failing ([7bcecd7](https://github.com/InspectorHub/OpenInspection/commit/7bcecd78947e7af3e6376a948d30006cf8198851))
* **ci:** wait up to five minutes for a published version and warn instead of failing ([b69dcbc](https://github.com/InspectorHub/OpenInspection/commit/b69dcbcdc2f0c13d54f5b59638e0ca1a226176d7))
* close the findings of the independent code review (SMS, AI, send limits, removal, signatures, pay link) ([a16f380](https://github.com/InspectorHub/OpenInspection/commit/a16f380033bfff3de5c6ba395e633b7ee60d7fba))
* **collab:** keep the row's meta keys when the document persists ([27cc3df](https://github.com/InspectorHub/OpenInspection/commit/27cc3dfe7a3280d14284850219d529586881aceb))
* **collab:** rename legacy finding keys in the document and keep meta keys on persist ([19ebd44](https://github.com/InspectorHub/OpenInspection/commit/19ebd4488e0e9332bc5782612a85e12729893d37))
* **collab:** rename legacy finding keys inside the collaboration document ([bfdc1fa](https://github.com/InspectorHub/OpenInspection/commit/bfdc1faac57f25db01de4820818778cd1ca262e0))
* contact update defaults, report-send allowance, send dialog polish and a real wiring test ([0029593](https://github.com/InspectorHub/OpenInspection/commit/00295939552d08c2eea2fda357fd42f2a740ce24))
* **contacts:** an update that does not name the type leaves it alone ([aa3d425](https://github.com/InspectorHub/OpenInspection/commit/aa3d42563044b95cedbadefe870dad845af54310))
* **contacts:** reuse a visible same-name client when a restricted creator gives no email ([c1a7fbb](https://github.com/InspectorHub/OpenInspection/commit/c1a7fbb774dfb4e1c41bc7a9673a59913163a5c5))
* **create:** skip the pre-write look ahead when the request writes no contact ([07b427e](https://github.com/InspectorHub/OpenInspection/commit/07b427e0a339f0d12421a6dd1b0c4f84a1e242ee))
* **cron:** remove synced date overrides whose calendar is no longer connected ([a1dc24a](https://github.com/InspectorHub/OpenInspection/commit/a1dc24ae18e11ef0de50734e8d8164d0f1fad484))
* **dashboard:** count the templates with a page size the route accepts ([1931c03](https://github.com/InspectorHub/OpenInspection/commit/1931c0388926797a9c8a800e9be789407b5c27d6))
* delete from the inspection page and a refreshing list; visible failures; calendar clean-up; booking windows ([fc30856](https://github.com/InspectorHub/OpenInspection/commit/fc308568a0a10fca6fa71f46d502426a10c1e004))
* **deps:** clear the npm audit findings ([aca6781](https://github.com/InspectorHub/OpenInspection/commit/aca678135d1c7e1237581fa90e862b761ad8d2e8))
* **deps:** clear the npm audit findings and publish field-ui under the plain AGPL notice ([526dc5e](https://github.com/InspectorHub/OpenInspection/commit/526dc5efd7eafa18fba31c5d9f79ca4d0053c374))
* **deps:** update hono to 4.13.13 ([08d50e2](https://github.com/InspectorHub/OpenInspection/commit/08d50e2760c325e20f4a5f7dfda8e90e0550a558))
* **editor:** encode the ids the item-tags relay passes on, and stop offering tags no host can store ([219e997](https://github.com/InspectorHub/OpenInspection/commit/219e997e3bb00cbd9ad9ed4aa5cf4d2e1268aad2))
* **editor:** keep overlay fields out of the saved template snapshot ([889c281](https://github.com/InspectorHub/OpenInspection/commit/889c2816657a73726d8749835ca184f96d75f810))
* **editor:** keep the action error helper out of the loader await budget ([f5067b8](https://github.com/InspectorHub/OpenInspection/commit/f5067b850edf9cd2ef15d39d12558a2db5a459a2))
* **editor:** read the source template name from the template envelope ([905b52c](https://github.com/InspectorHub/OpenInspection/commit/905b52c9f180a0f1cdf5681a7c03a6fa5bca9543))
* **editor:** refuse an inspection id that is not a single path segment ([f198ef0](https://github.com/InspectorHub/OpenInspection/commit/f198ef088d9955882cc0fc70d5ea11555e98771d))
* **editor:** report a refused snapshot save and an auto-sign failure instead of success ([06f409e](https://github.com/InspectorHub/OpenInspection/commit/06f409e987116113211b5d5340a894f657ad0160))
* **events:** a visit can only be created under an inspection of the caller's own company ([3cf12e4](https://github.com/InspectorHub/OpenInspection/commit/3cf12e4aaf9227b672aee860915945f1f5f11428))
* **field-ui:** draw the seeded tag colours amber, slate, rose and emerald ([d318066](https://github.com/InspectorHub/OpenInspection/commit/d3180665cb261aafcf8a56669907d5032a188fe5))
* **field-ui:** explain oversized photo upload failures ([e96b9ca](https://github.com/InspectorHub/OpenInspection/commit/e96b9caab44989ada8ab9827473bd89eabcef385))
* **field-ui:** fix defects that already existed in the old editor code ([23a6ac6](https://github.com/InspectorHub/OpenInspection/commit/23a6ac64d8a461f14a805a5599a95ec434bbfe4f))
* **field-ui:** focus, identity, layout memory and gate hardening (review follow-ups) ([09e87ae](https://github.com/InspectorHub/OpenInspection/commit/09e87ae447a146ffe23f0e46a338a0c685237181))
* **field-ui:** handle permanent photo rejections end to end on the web ([77dc8c0](https://github.com/InspectorHub/OpenInspection/commit/77dc8c022280b5dcf1a2aec546519d5759ea6c56))
* **field-ui:** import siblings relatively inside the package; name the new paths in comments ([50cee0d](https://github.com/InspectorHub/OpenInspection/commit/50cee0d254e7a3fe462d5688fdb3e59bfe2293bd))
* **field-ui:** keep the crop and studio dialogs open when a save is refused, and make a save one cancellable attempt ([075110d](https://github.com/InspectorHub/OpenInspection/commit/075110d6e17805521580d164bb5c683032b251ec))
* **field-ui:** keep the rest of an offline photo batch when the host store rejects a file ([d708917](https://github.com/InspectorHub/OpenInspection/commit/d708917fb43f3d9fdcdb8ee19ab7a30d0959583d))
* **field-ui:** keep typed notes with their item, and draw only colours that are safe ([d06b228](https://github.com/InspectorHub/OpenInspection/commit/d06b22884e94075ff38d9008caf3634ca24ced87))
* **field-ui:** only a coded refusal drops a queued photo, and a throwing host callback no longer wedges the drain ([f6ec706](https://github.com/InspectorHub/OpenInspection/commit/f6ec706ab8d49aa56656c416abb39e68bc3110f7))
* **field-ui:** only the bundled and own [@core](https://github.com/core) aliases may cross the package boundary ([54cf3a5](https://github.com/InspectorHub/OpenInspection/commit/54cf3a591d1c0dd85b603c9dbae22b24f6e3ddf2))
* **field-ui:** point the new collab spec at the moved reinspection-status module ([1f5b242](https://github.com/InspectorHub/OpenInspection/commit/1f5b242558cb3e41852845d1e7ae459e04a498f6))
* **field-ui:** report rejected photos accurately and keep the added count ([e0ac7d0](https://github.com/InspectorHub/OpenInspection/commit/e0ac7d0a4388291cb43ed8ef7bf6ba6502995863))
* **field-ui:** review fixes before the upstream PR (idempotency, rotation, touch targets, publish pipeline) ([388197c](https://github.com/InspectorHub/OpenInspection/commit/388197cfe9c731185e354443b0b12f0958c32f83))
* **field-ui:** say why a compliance sign-off was not recorded ([192da83](https://github.com/InspectorHub/OpenInspection/commit/192da832b1e43bf832ee6a6208eb264f4a7b06f6))
* **field-ui:** update fixtures for the new pending-store check, and stop a late presence close from touching state ([7879ab4](https://github.com/InspectorHub/OpenInspection/commit/7879ab43e6c6fc58054e2a1eeffdb0e9d60ad535))
* harden the pr-readiness check after independent review ([006525d](https://github.com/InspectorHub/OpenInspection/commit/006525d9963da890b980d2d4d1e839ee1ab8fd5e))
* hosted sign-out also ends the identity service's session; explain a failed return; invitation page; remove the pr-readiness check ([4ed08b7](https://github.com/InspectorHub/OpenInspection/commit/4ed08b71f065283d2e9540212c7a1d2c308f3f4e))
* **hub:** keep HubPayLinkGap module-private (dead-code gate) ([1356ff5](https://github.com/InspectorHub/OpenInspection/commit/1356ff532918813a1487a3b2e36ac37104cd6762))
* **hub:** load the inspection hub without a pay link when one cannot be produced ([fc7ac2a](https://github.com/InspectorHub/OpenInspection/commit/fc7ac2a15d2834d1310c7629ffcab5602050ada9))
* **hub:** offer Delete only to someone the delete route will not refuse ([3311518](https://github.com/InspectorHub/OpenInspection/commit/331151887f6a6db05250236cc86046dc0acf1159))
* **i18n:** reuse the shared Back label and keep the skipped-recipient type private ([b5e3840](https://github.com/InspectorHub/OpenInspection/commit/b5e38405576c7e62eb3e952abb062322b6c160f2))
* **i18n:** use the glossary term for Settings in the Check credentials message ([e38b27d](https://github.com/InspectorHub/OpenInspection/commit/e38b27d62e7750add3e104873441396c47d5255f))
* **import:** a restricted caller cannot tell a hidden inspection from a missing one ([ca7a8e3](https://github.com/InspectorHub/OpenInspection/commit/ca7a8e392d30dc8f7fab73b15e8d924ac4b3824d))
* **inspection:** a send that reached nobody keeps its dialog open and says why ([9e7c045](https://github.com/InspectorHub/OpenInspection/commit/9e7c045acf1e7405897e2aba11b69d7f07cdf746))
* **inspections:** close the review findings on the order/inspection split ([421da77](https://github.com/InspectorHub/OpenInspection/commit/421da771aa3bfd8d859e14b69de7a2a13b4d1b7d))
* **inspections:** office staff no longer see an inspector or a Submit button they cannot use ([6edb0ec](https://github.com/InspectorHub/OpenInspection/commit/6edb0ec502739b5b8cc99ec6f4bdffb421d1f6bf))
* **join:** give an invalid invitation a way forward, and tell returning users their password stays ([cc5caff](https://github.com/InspectorHub/OpenInspection/commit/cc5caffedc1d8be4062e70914f45491027707671))
* make the pr-readiness text rules honest-friendly and mutation-resistant ([6a4341d](https://github.com/InspectorHub/OpenInspection/commit/6a4341d5b49f6f8c021ebacd63120e46256b0167))
* **mcp:** answer resources/read of a missing record with InvalidParams ([a01cb72](https://github.com/InspectorHub/OpenInspection/commit/a01cb726a7c1a59573e7c0280dfac142730744e5))
* **mcp:** stop offering multipart upload routes as MCP tools ([0e50aa1](https://github.com/InspectorHub/OpenInspection/commit/0e50aa1ce7c075e8a8f52b091e9062143a751222))
* **native:** a tombstone never blocks a still-existing inspection; deleting one cleans its video uploads ([b79ee46](https://github.com/InspectorHub/OpenInspection/commit/b79ee46e6913d8ac1f212bf0a9001d84752e4b36))
* **native:** behaviour fixes from the contract review ([a3db14b](https://github.com/InspectorHub/OpenInspection/commit/a3db14b8c044d6a7f24707ebe05a5ac6ed3e9700))
* **native:** bound archive inflation, repair half-created inspections, tighten import and credential rules ([c277223](https://github.com/InspectorHub/OpenInspection/commit/c277223444de9eb4ad265fe96f8ac9fd1876a545))
* **native:** clear the remaining import and results-document debts ([a402e9a](https://github.com/InspectorHub/OpenInspection/commit/a402e9a1c58830ddc237865418a4ebde6e2e2680))
* **native:** close the MCP surface on native-only deployments; harden grants and the version handshake ([0347fb3](https://github.com/InspectorHub/OpenInspection/commit/0347fb35e235d6e1cd106e0030358d0021f1d885))
* **native:** do not revoke a healthy grant on a transient marker read error ([8ad3eba](https://github.com/InspectorHub/OpenInspection/commit/8ad3eba036f7d3a86409e8433b7d72e2bd1cbbb4))
* **native:** finish a client-id create on replay ([8a53eba](https://github.com/InspectorHub/OpenInspection/commit/8a53eba2cf59b1158a8685a3cd50813f79400af4))
* **native:** keep the contract tooling out of the product tree; order the e2e project after two-factor ([c2db941](https://github.com/InspectorHub/OpenInspection/commit/c2db941b0afc623a2826b4b9432f828cc7185ec6))
* **native:** keep the offline import inside its subrequest budget ([43b6fc7](https://github.com/InspectorHub/OpenInspection/commit/43b6fc7591473ddbbbb2815d6e5fa86da70ecd28))
* **native:** reuse an existing contact when a client-id create names the client ([1526f2e](https://github.com/InspectorHub/OpenInspection/commit/1526f2edaa9b279747e7c2bb815ae106e8067e11))
* **observability:** keep request logs for offline-import replays; harden page-timing tests ([2802bc3](https://github.com/InspectorHub/OpenInspection/commit/2802bc3ae5d83d0995d8b69f4b2865b0b2e374d6))
* **offline-import:** count import progress in inspections, not in parts ([187a107](https://github.com/InspectorHub/OpenInspection/commit/187a1073addb9ecf2fa8bc8007b2627e93d1d267))
* **offline-package:** bound retries per part, keep named failures apart, tighten reasons ([bb97be7](https://github.com/InspectorHub/OpenInspection/commit/bb97be7cc81ed3137ff44943567150bbb7336d48))
* **offline-package:** size the upload timeout to the package ([970c87d](https://github.com/InspectorHub/OpenInspection/commit/970c87dc0cdd5d1e1720e3e14e148b6deeb8c45a))
* owner hub 500; Free plan has no platform texts; clearer permission refusals ([17fd868](https://github.com/InspectorHub/OpenInspection/commit/17fd868908fd7d29dea7eda832635f3d73cd95b0))
* **permissions:** keep the screens in step with the server's rules, and pin them with tables ([090df9c](https://github.com/InspectorHub/OpenInspection/commit/090df9c3510c745b3e1e137d1eb9a820bdef4cfd))
* **permissions:** one scheduleOthers rule for messaging and deleting, honest refusal copy, account mail exempt from the free cap ([f09a2c6](https://github.com/InspectorHub/OpenInspection/commit/f09a2c6913d4d0112108aeab7c8b5873d5d6e380))
* **permissions:** remaining refusals name the role and the way forward; staff create paths documented ([03fd187](https://github.com/InspectorHub/OpenInspection/commit/03fd187e717ea2b30e788f751d62e3be31475a51))
* **permissions:** the agent-area refusal says to sign in with an agent account ([e7fed3d](https://github.com/InspectorHub/OpenInspection/commit/e7fed3d05a0f7e7a5f8e1677f227c203b61941b3))
* **permissions:** the rest of the refusals with a request context name the role and the way forward ([263335e](https://github.com/InspectorHub/OpenInspection/commit/263335e3f0d1ceb67a2310db8c0d027c6a867b1e))
* **qbo:** accept the session token as a Bearer credential on the QuickBooks API routes ([fa79de8](https://github.com/InspectorHub/OpenInspection/commit/fa79de8c58e5e72750bd6385c31c2e0a2475a1f3))
* **qbo:** build the search literal character by character ([e9a5aba](https://github.com/InspectorHub/OpenInspection/commit/e9a5abaa22db434a92fe3deb42a22c9f537be2a0))
* **qbo:** escape the search text for LIKE in a single pass ([2a05d3d](https://github.com/InspectorHub/OpenInspection/commit/2a05d3daaa1fab526222b9355b94937d50ff7a0a))
* **qbo:** keep the re-send time budget private ([cf7a4b6](https://github.com/InspectorHub/OpenInspection/commit/cf7a4b6ce98cb63e6c94399c44bff7197e35ceaa))
* **qbo:** make Sync now report what it did, name the contact on attention rows, search without escapes Intuit ignores ([bd30362](https://github.com/InspectorHub/OpenInspection/commit/bd30362baceda9b9cc278811e799fa0d8ab01f52))
* **qbo:** send the session JWT as Bearer on the settings page's API calls ([b2d3143](https://github.com/InspectorHub/OpenInspection/commit/b2d314382a16e5dab7c69e02cebd5bb659675b0a))
* read the Chrome observation after the tokens, not after the last dash ([2558870](https://github.com/InspectorHub/OpenInspection/commit/2558870c6299b127fa11dc0b5bd5b74da06f8fa3))
* register the no-store header after the inspection path guard ([fa341b0](https://github.com/InspectorHub/OpenInspection/commit/fa341b08f20cc88b589488461fc89d8fd5f8fc32))
* replace free-text Chrome interpretation with explicit tokens ([886ea65](https://github.com/InspectorHub/OpenInspection/commit/886ea6572ca88c0ed03f75c1e09ba981123ec01f))
* **reports:** keep the allowance for recipients delivered before a batch-wide refusal, and the hour of earlier sends ([b96eaf0](https://github.com/InspectorHub/OpenInspection/commit/b96eaf084ca56fad7d82e12d616675ad7388b418))
* **reports:** note a delivery before the audit write that follows it ([8df0b82](https://github.com/InspectorHub/OpenInspection/commit/8df0b8255c3c7751d1567f2c5bab8dfb4a32bebe))
* **reports:** separate the stored count and expiry with a bar ([c175282](https://github.com/InspectorHub/OpenInspection/commit/c175282cf1a578d80902eace3d82403347cb24dd))
* **reports:** the hourly send allowance counts reports delivered, not requests ([fb2f09a](https://github.com/InspectorHub/OpenInspection/commit/fb2f09a487deaad2ba274ff2fdc5874f4e3bf8d3))
* restricted-creator contact reuse, FK 500s, drawer and send feedback, hydration errors ([5478d0b](https://github.com/InspectorHub/OpenInspection/commit/5478d0bc3558cd8fb0ee2da89e6343f5965c2eb9))
* **restricted-inspector:** atomic create, contact reuse that cannot redirect notices, scoped FK answers, agent-link scope ([932e72f](https://github.com/InspectorHub/OpenInspection/commit/932e72f4f673355dea200891379955bcda2a9787))
* review findings on role messages, restricted-inspector scope and send dialogs ([2a84181](https://github.com/InspectorHub/OpenInspection/commit/2a84181bbffcb1eb1c077a1904c1712b426abe27))
* **review:** right guidance on two denial screens; no client email in the hub warning ([f4caf92](https://github.com/InspectorHub/OpenInspection/commit/f4caf928ea5fa2a3024751fda48488d3a7eb081c))
* say so when the server cannot be reached, align QuickBooks panel tokens, tidy public docs ([5c148d8](https://github.com/InspectorHub/OpenInspection/commit/5c148d8ba1e3df7a3f80f31a67c47d6b8076ec28))
* **scope:** creating an inspection cannot reuse or link a contact the caller cannot see ([66deaa6](https://github.com/InspectorHub/OpenInspection/commit/66deaa6406b7383d661efc56fa01c79c5aff4b97))
* **scope:** ids in a request body cannot be used to probe or widen a restricted caller's view ([4a911fb](https://github.com/InspectorHub/OpenInspection/commit/4a911fbac39065557bf893ce760b2be62ed35cb1))
* **scope:** make the referrer guard's scope a required parameter ([cb4932a](https://github.com/InspectorHub/OpenInspection/commit/cb4932ae095c2e4e14ef3e24ffab2299dbb22d3b))
* **send:** a permanent status region for the result announcement, and a plainer plan-limit sentence ([9bf705d](https://github.com/InspectorHub/OpenInspection/commit/9bf705d202fad8454003c9029ed444bdb9396bd4))
* **send:** announce the result, say Back and Done are not ready, scope the plan mapping, neutral wording ([1c07eb1](https://github.com/InspectorHub/OpenInspection/commit/1c07eb13929b56c0f7124978725167409b5c487b))
* **send:** keep the server-error mapper module-private ([83fe0fb](https://github.com/InspectorHub/OpenInspection/commit/83fe0fb7bdfa6fe9e70cf9dd5bd9a62f2020d897))
* **send:** keep the settle interval module-private ([e3704e7](https://github.com/InspectorHub/OpenInspection/commit/e3704e7d553ebe16cb906b479ae4eda5991f7b8f))
* **send:** plan refusals in the viewer's language, a self-explanatory Back, and no stray click on Done ([a17f487](https://github.com/InspectorHub/OpenInspection/commit/a17f487b10d8b922781390809977e0102caafdd0))
* service worker no longer serves one user's cached data to the next user; sidebar shows who is signed in and a visible collapse button ([08265b6](https://github.com/InspectorHub/OpenInspection/commit/08265b61ae909453701cdc9a69db3ced8f997ec0))
* **settings:** keep inspections left behind and refused changes apart on the import result ([a18e72c](https://github.com/InspectorHub/OpenInspection/commit/a18e72cd6d48f10675e615fd702295312c9d46ef))
* **settings:** satisfy the dead-code, glossary and literal gates for the import page ([f16de5c](https://github.com/InspectorHub/OpenInspection/commit/f16de5c416da50fc6519c954715ad89e9bcf5b91))
* sidebar shows who is signed in, not the company again; collapse button is always visible ([bd16ea6](https://github.com/InspectorHub/OpenInspection/commit/bd16ea6eb8a613b8cf2fca1e1caebb08e516cf0d))
* **sms:** drop the shared sender, scope STOP/START to one company, align dedicated numbers and wording ([e704c2e](https://github.com/InspectorHub/OpenInspection/commit/e704c2ec8bcfddbd37d61f8545f29e780621f80f))
* strip HTML comments to a fixed point in pr-readiness ([1290e45](https://github.com/InspectorHub/OpenInspection/commit/1290e458a6d2e4f0cb67b0e2735c1173408eae31))
* **team:** choosing "all inspections" beside a permission template is saved ([06555ef](https://github.com/InspectorHub/OpenInspection/commit/06555ef89daa053d535f6b2b4e15b267765e2efd))
* **team:** close the follow-ups on the manager grant limit ([2b32631](https://github.com/InspectorHub/OpenInspection/commit/2b32631b1c39d6e4082433d7a6d5d996886017dc))
* **team:** drop three unused exports and record the template routes' API calls in the fan-out baseline ([00e1dc7](https://github.com/InspectorHub/OpenInspection/commit/00e1dc72e106bc5c15d2bfbe9be16de3fdcb62ee))
* **team:** hide the Pending Invites tab from people who cannot manage the team ([59eca31](https://github.com/InspectorHub/OpenInspection/commit/59eca31d5947cb13a42bbe95c4e6ca0449427a01))
* **team:** the "Assigned only" badge reads at 4.5:1 or better in light mode ([d97fd72](https://github.com/InspectorHub/OpenInspection/commit/d97fd72e7a642b8f06e711d83a24333c8e90fcbe))
* **team:** the invite drawer opens empty after a send or a cancel ([81459f6](https://github.com/InspectorHub/OpenInspection/commit/81459f66da52fde118207ff28aef5abc299e3ae9))
* **team:** the legacy invite route refuses templateId instead of granting the plain role ([350eeb7](https://github.com/InspectorHub/OpenInspection/commit/350eeb764a4b8485d4b11a93d184da6f91f9aa09))
* **test:** stabilise the collab import test and sync the field-ui lockfile entry ([21380fd](https://github.com/InspectorHub/OpenInspection/commit/21380fd24a80ded00710c2f3ea885b8b769dcfcb))
* the service worker no longer serves one user's cached API data to the next user ([fff3c31](https://github.com/InspectorHub/OpenInspection/commit/fff3c31a52ab46fda8a674ea3dd65a78fbde1870))
* **tooling:** keep .types-tsgo out of eslint and the tree-wide scans, and test the runner ([935e350](https://github.com/InspectorHub/OpenInspection/commit/935e3505ab2b44284c1b729e50784531254e449c))
* **tooling:** pre-commit api type-check tier covers the package trees tsconfig.api.json includes ([35741b6](https://github.com/InspectorHub/OpenInspection/commit/35741b614187787a51dcad4bb58bb564d058e715))
* **ui:** drawers and modals reopen after a successful save ([4aae6c7](https://github.com/InspectorHub/OpenInspection/commit/4aae6c787dcb79ca07be773a8c4ae0c36a516dcc))
* **ui:** send dialogs, drawers and hub explain themselves and cannot repeat a send ([68616aa](https://github.com/InspectorHub/OpenInspection/commit/68616aa48777aa6d3529674b384f8b78b6638d3f))
* **units:** scope unit writes to the inspection in the path ([c32ef0b](https://github.com/InspectorHub/OpenInspection/commit/c32ef0b59d4a7987fc4a260d8f232fb4ae5c25d8))
* **video:** scope every video and poster route to the inspection in the path ([f99f3bd](https://github.com/InspectorHub/OpenInspection/commit/f99f3bd5ede0757396d9cd212557b35392f0601f))
* **web:** allow same-origin framing of pages ([6e75424](https://github.com/InspectorHub/OpenInspection/commit/6e75424a05e86205b6cdd5a63376583222b677ad))
* **web:** attempt every credential PATCH when reordering, even if one fails ([43213d3](https://github.com/InspectorHub/OpenInspection/commit/43213d3265f934cb958d1f2b4aa07b308f5f0e67))
* **web:** clear stale failure alerts on the next attempt; report a refused resend ([f051c8c](https://github.com/InspectorHub/OpenInspection/commit/f051c8c566b3b75d9f027e08c32e63cb90619082))
* **web:** clear the inspection type error when its dialog opens ([0f6a6ee](https://github.com/InspectorHub/OpenInspection/commit/0f6a6ee4126a4faf7dcee13cb7d44c251faa8b01))
* **web:** delete a video from storage before removing its entry ([f710a88](https://github.com/InspectorHub/OpenInspection/commit/f710a88ab71645c34597724d47ae10806354ecd4))
* **web:** delete large selections in chunks of ten, and keep the run honest ([5b959a6](https://github.com/InspectorHub/OpenInspection/commit/5b959a6031349af63c79ce2d2709d2dc99a3f0ef))
* **web:** delete the selected inspections in one request; keep search pages ([121d6ad](https://github.com/InspectorHub/OpenInspection/commit/121d6ad0fddd5c2794811c070903d7657ab73d43))
* **web:** do not retry a refused bulk service read one service at a time ([9c9567c](https://github.com/InspectorHub/OpenInspection/commit/9c9567c263b2873109561002efa7ce9852fd9b90))
* **web:** draw server-provided colours only when they are plain colours ([0da6236](https://github.com/InspectorHub/OpenInspection/commit/0da623631500518b3d3dac75e9c9b8ffbd89d28f))
* **web:** drop a deleted row from the inspection list at once ([1a4f267](https://github.com/InspectorHub/OpenInspection/commit/1a4f26770063a89d6f5cf39c6c476f4d36fa6218))
* **web:** forget a deleted inspection's offline copy ([07d6a3a](https://github.com/InspectorHub/OpenInspection/commit/07d6a3a8149484f301a3ab5f75204bdd866bfb41))
* **webhooks:** register the two webhook limiters and follow the limiter's new shape in its source check ([df7541a](https://github.com/InspectorHub/OpenInspection/commit/df7541afbc0afde4fb4bd4e73ca75b125da88de7))
* **webhooks:** verify inbound webhooks with the company's own secret and bound unauthenticated ingress ([785fd87](https://github.com/InspectorHub/OpenInspection/commit/785fd877f57337e3b9cf338d6f81bc105f099160))
* **webhooks:** verify with the company's own secret and bound unauthenticated ingress ([e4307ed](https://github.com/InspectorHub/OpenInspection/commit/e4307ed0e171a814223305fd20a5c8e2a38213d8))
* **web:** keep a failed picker request from replacing the inspection page ([d6cc363](https://github.com/InspectorHub/OpenInspection/commit/d6cc363f5ab3cc41cfb466ff2c4ddeab9a470a80))
* **web:** key the removal of a deleted video, and refuse a second delete in flight ([bba5963](https://github.com/InspectorHub/OpenInspection/commit/bba596388399bd9890b3770f5184836f867f47fc))
* **web:** name a refused batch-delete row by its address ([ecef379](https://github.com/InspectorHub/OpenInspection/commit/ecef379e39da3adc4826f23f8c242a77d8f7e5a1))
* **web:** narrow-screen layout, tag pinning, completion feedback and neutral wording ([9681101](https://github.com/InspectorHub/OpenInspection/commit/9681101a0f10a301b81fec04b139784aa331e641))
* **web:** picker accessibility, a deactivated inspector, and the Intl cache key ([5901b50](https://github.com/InspectorHub/OpenInspection/commit/5901b5079e5dc271669e0915412d57724ad32768))
* **web:** put a cost item back when removing it fails ([66cbe6d](https://github.com/InspectorHub/OpenInspection/commit/66cbe6da7c6a6aa1d51055d15dac6fa172909175))
* **web:** rebase the middleware and loader-await budgets for the item-tags relay route ([19b5863](https://github.com/InspectorHub/OpenInspection/commit/19b5863a1a9030195e63b48794657d9a27674c47))
* **web:** remove a keyless video by what was freed, in the page and in the shared document ([4800e0f](https://github.com/InspectorHub/OpenInspection/commit/4800e0fbf3edd68ef061c205b04e66077c5b367d))
* **web:** remove date overrides from the schedule page, and report closed-day failures ([d444aff](https://github.com/InspectorHub/OpenInspection/commit/d444affa7b02677a0f0e0c8ea5daf5c31fefbaea))
* **web:** report a refused notice dismiss or mark-all-read ([b459773](https://github.com/InspectorHub/OpenInspection/commit/b45977318a4f1d49fa6273ec435603b8876418e6))
* **web:** restore the edited cost row on a failed removal ([08345a6](https://github.com/InspectorHub/OpenInspection/commit/08345a6474dc108fb18f445b94116edb3620f8c5))
* **web:** satisfy the unread-field and dead-code gates for the CSP report code ([8791e66](https://github.com/InspectorHub/OpenInspection/commit/8791e66cdf380d8724c13d8045223fd6814e848b))
* **web:** settle a refused batch delete, delete keyless videos, say why a removal was refused ([d448d2e](https://github.com/InspectorHub/OpenInspection/commit/d448d2e8d70d0af5623bf85032b37e88d4fc8004))
* **web:** show a failed event type delete and re-read the list ([9035dff](https://github.com/InspectorHub/OpenInspection/commit/9035dff7510dfab0effb4d6645e97a01f5178bf6))
* **web:** show a failed inspection type save or enable/disable ([70e9435](https://github.com/InspectorHub/OpenInspection/commit/70e9435e52747063656695af87196246c2cb7676))
* **web:** show an error when a delete or cancel is refused ([9d1250f](https://github.com/InspectorHub/OpenInspection/commit/9d1250f19f07874325138d41e364f73486ceed5b))
* **web:** stop offering photo drawer actions that do nothing ([4efb08f](https://github.com/InspectorHub/OpenInspection/commit/4efb08fe997cb6c23ccfef05459b836b2c82bb0f))


### Performance Improvements

* **api-schema:** ApiOf yields the plain Hono class so the client map checks it cheaply ([7f5f6eb](https://github.com/InspectorHub/OpenInspection/commit/7f5f6ebaf9d4d560e4c2fc21753860c4edd43ba0))
* **api-schema:** resolve each converted endpoint when it is read, not when the schema is folded ([bb9fc9c](https://github.com/InspectorHub/OpenInspection/commit/bb9fc9c3ddd06103b9521c90c00152262b4f87e2))
* **api:** bulk reads for per-service inspectors and pay rules ([230d0fa](https://github.com/InspectorHub/OpenInspection/commit/230d0fa0f6ce49fa1ffc5700ad0dc2c2c2966b2d))
* **api:** read the session context's secondary data in one wave ([627985a](https://github.com/InspectorHub/OpenInspection/commit/627985ab06c6fb5eb995b036f32b3af8061e3942))
* **api:** send independent D1 reads together on the dashboard and the pages' shared reads ([044a78a](https://github.com/InspectorHub/OpenInspection/commit/044a78a14436c75fab8db01c32e3028a6bb43b98))
* per-route page timing, fewer serial reads and unused loader data on first paint ([a1abd39](https://github.com/InspectorHub/OpenInspection/commit/a1abd3905b157d601ba8ce91ff79c12456070ee6))
* **templates:** count templates for the checklist without reading any template body ([f169e2f](https://github.com/InspectorHub/OpenInspection/commit/f169e2f6ecfc6a4d20d6a3f627872ddd1b92d621))
* **web:** ask the editor loader only for data the inspection can have ([1a8aa2a](https://github.com/InspectorHub/OpenInspection/commit/1a8aa2a5cfb222b2b92544192af5d0170cb20398))
* **web:** bound and overlap the per-service reads on Settings -&gt; Services ([a687114](https://github.com/InspectorHub/OpenInspection/commit/a687114c04ba658ad54ede938038d71955a5cd15))
* **web:** load the inspection page's picker lists on first use ([f7819b5](https://github.com/InspectorHub/OpenInspection/commit/f7819b563e8c19096e9a525769f64dd6df472f2d))
* **web:** read the hub page's visits and visit types together ([3680207](https://github.com/InspectorHub/OpenInspection/commit/36802078ed5b185834b56aef6c9c998895bc8148))
* **web:** reuse Intl formatters in the remaining view helpers ([051fa2d](https://github.com/InspectorHub/OpenInspection/commit/051fa2d7f2eb4000b29da70eb37cd3c89ae00bad))
* **web:** reuse Intl formatters instead of building one per formatted date ([f1357e9](https://github.com/InspectorHub/OpenInspection/commit/f1357e95b1d95d75a3c60f249fb4cd436df3fcc7))
* **web:** start the dashboard checklist reads with the first wave ([8f2bb33](https://github.com/InspectorHub/OpenInspection/commit/8f2bb33093628e71075fc40337978c20bf8f3c6d))
* **web:** start the editor's optional reads when the inspection row arrives ([8a605f2](https://github.com/InspectorHub/OpenInspection/commit/8a605f2c7e8e46517a3eeb3e76e731722869fa0b))
* **web:** stop loading the New Inspection wizard's lists on the dashboard ([368e16b](https://github.com/InspectorHub/OpenInspection/commit/368e16be9f0d7c4a654f5bf746b47e189a73a113))
* **web:** stop sending the session token and a second snapshot copy to the editor page ([6175a27](https://github.com/InspectorHub/OpenInspection/commit/6175a27f3d1435d522cf342ecfedd4fca6517bdf))

## [2.2.0](https://github.com/InspectorHub/OpenInspection/compare/openinspection-v2.1.0...openinspection-v2.2.0) (2026-09-15)


### Features

* **ui:** add cross-platform icons and sync scanner-probe middleware ([c8943d7](https://github.com/InspectorHub/OpenInspection/commit/c8943d737632889c15738a6c3ba1bdd6cca483b0))
* **ui:** add cross-platform icons, PWA manifest, and fold scanner probes ([feb4a34](https://github.com/InspectorHub/OpenInspection/commit/feb4a34441f66f50f0e4e3c02041cb55f27317c3))


### Bug Fixes

* **auth:** 2FA setup guard, TOTP rate limits, reset token tenant scope ([770e2ac](https://github.com/InspectorHub/OpenInspection/commit/770e2aca765b7391b64b27f87590bf41b5b49342))
* **auth:** a session alone cannot strip a second factor, and a reset names one tenant ([a27c07c](https://github.com/InspectorHub/OpenInspection/commit/a27c07c53707cbde48975a29d16b2684f7bd00a1))
* **pwa,scanner:** restore manifest scope/shortcuts, add maskable icon, fold scanner probes ([a5ba8c3](https://github.com/InspectorHub/OpenInspection/commit/a5ba8c36ed8980fd8a77d17d9584843ec5a2da91))

## [2.1.0](https://github.com/InspectorHub/OpenInspection/compare/openinspection-v2.0.0...openinspection-v2.1.0) (2026-09-12)


### Features

* **agent-terms:** gate the clauses, and tell operators the portal needs publishing ([216f548](https://github.com/InspectorHub/OpenInspection/commit/216f5489aa1cd0e5066734327409ed266ba9845b))
* **audit:** emit inspection.published, so the delivery funnel is observable ([7a5bd38](https://github.com/InspectorHub/OpenInspection/commit/7a5bd381db4de1ccb2f93feb23eafcca931b01c8))
* enhance InspectionDocDO to support reportId and add purge endpoint for orphaned documents ([3707e0f](https://github.com/InspectorHub/OpenInspection/commit/3707e0f16caa65bba8d7edafa2ba0449ec84b9fd))
* **gates:** enforce the rule the i18n sweep declared done and never guarded ([e9f4b6b](https://github.com/InspectorHub/OpenInspection/commit/e9f4b6b70aea87d56b6bab7e30df1f2e7110bd08))


### Bug Fixes

* **agent:** refuse non-agents at the portal, and say who is signed in ([bb518f3](https://github.com/InspectorHub/OpenInspection/commit/bb518f3969087d9dfd9ba44c74c34b57fd71af6a))
* **booking:** say the booking page is closed before offering it to share ([8c280d6](https://github.com/InspectorHub/OpenInspection/commit/8c280d6f672b64a88fcc156441135786dde06be2))
* **booking:** stop the address list covering the button, and say what the client ([ded8d2b](https://github.com/InspectorHub/OpenInspection/commit/ded8d2bc092098463c06b0b20417f3c9d339f2e5))
* **calendar:** one predicate was hiding every inspection and flattening every time ([1acd80e](https://github.com/InspectorHub/OpenInspection/commit/1acd80e8ee492860c45cafa5e193d621594dcc1b))
* **calendar:** wrap the nav row, and clear the last contrast exemption ([078fc53](https://github.com/InspectorHub/OpenInspection/commit/078fc53626c5b6f0192b6f75004bd33e502564c8))
* **collab:** persist report identity and purge orphaned inspection documents ([541eab3](https://github.com/InspectorHub/OpenInspection/commit/541eab3b1deb3a8c1efcffa7f19a4a0dec51c500))
* **collab:** stop the document DO treating a storage read-back as an edit ([b91c4db](https://github.com/InspectorHub/OpenInspection/commit/b91c4db88cca872c14a7e0405eca895de7ebd3f4))
* **contacts:** stop double-counting revenue, and make the palette's actions real ([d5ba166](https://github.com/InspectorHub/OpenInspection/commit/d5ba166b68f1b33f9177de318b827daf1b3e5906))
* **ds:** declare --ih-primary-fg, and close the four silences that hid it ([5e36d52](https://github.com/InspectorHub/OpenInspection/commit/5e36d526c6cf9942e5d0b6d2907320f070b7e593))
* **e2e:** promote 375px into VIEWPORTS, and update the agent-login link-form locator ([56ca37e](https://github.com/InspectorHub/OpenInspection/commit/56ca37e151c38d7428bef70a7a120eee97f00133))
* **e2e:** wait for lightbox to mount before counting pending placeholders ([354c834](https://github.com/InspectorHub/OpenInspection/commit/354c834f431ce88d60512e8b9683d58dc9d1d92c))
* **editor:** say what publishing does, give the empty pane a first action, and ([9ea7eea](https://github.com/InspectorHub/OpenInspection/commit/9ea7eeaa3f427d8491c8e39dc5480e7d7a7939dc))
* **gates:** clear the four CI-tier gates the last four changes tripped ([0416a1d](https://github.com/InspectorHub/OpenInspection/commit/0416a1d7fc7bcb28523c45a4a6a409ba1baf8879))
* **inspections:** give property_type a write path, at intake and afterwards ([78ec21e](https://github.com/InspectorHub/OpenInspection/commit/78ec21e6d03f84fbfbf688cadfc25add21d4f3a1))
* **inspections:** say what the money is, what the photos are, and what an empty ([2f68158](https://github.com/InspectorHub/OpenInspection/commit/2f6815837aaa542ef6ed08ed1c2410d16f3667e0))
* **intake:** read inlineStr cells, which looked exactly like an empty sheet ([6c3cfd0](https://github.com/InspectorHub/OpenInspection/commit/6c3cfd081466aa25e7531197144655e4bb1ca0c6))
* **library:** print the statutory form's own letters once, and give the ([c72ed34](https://github.com/InspectorHub/OpenInspection/commit/c72ed344827787a9dd9142f58e2ab376063af408))
* **mcp:** offer S256 only — plain PKCE was being advertised and accepted ([ec1562d](https://github.com/InspectorHub/OpenInspection/commit/ec1562dede88b999e16d5de8bb12361db20cbf78))
* **media:** tell a failed photo load apart from an empty one, and from a choice ([0b2f349](https://github.com/InspectorHub/OpenInspection/commit/0b2f349ca4010d48900573c98d67f613fc37900e))
* **metrics:** name the months, count in the singular, and let a name input be as ([753cbf1](https://github.com/InspectorHub/OpenInspection/commit/753cbf1d0f831493b4d83797c4a3365f12b0ef6d))
* **notices:** read a date to a person, and stop showing filter chips to a list of four ([41e1adb](https://github.com/InspectorHub/OpenInspection/commit/41e1adb223d62ce8222242a44e387700e0f12d07))
* **openapi:** bound the cost of GET /doc with a limiter and a cache header ([99e92f6](https://github.com/InspectorHub/OpenInspection/commit/99e92f62e33a7077d46a299c21d2c0bf42086ce8))
* **portal:** stop the client Hub claiming gates and bills that do not exist ([057c46e](https://github.com/InspectorHub/OpenInspection/commit/057c46e7e5e645657f8ad568aac46a90da2b8733))
* **publish:** stop recording who was notified, since nothing read the answer ([6fb1ba2](https://github.com/InspectorHub/OpenInspection/commit/6fb1ba2b9ba4ef952cc826c8987e276fc9a57636))
* **reinspections:** let the operator pick the date, and refuse rather than guess it ([b3d4ef0](https://github.com/InspectorHub/OpenInspection/commit/b3d4ef03dfa1d98cd7dc3a54612c04f49ed1edde))
* **repair:** stop storing and showing a live share credential, and label a role ([363e300](https://github.com/InspectorHub/OpenInspection/commit/363e300fd8513f4e7250e20823689099a4d202a4))
* **reports:** enforce the agreement and payment hold where the report is served ([f2ad257](https://github.com/InspectorHub/OpenInspection/commit/f2ad257059861c67594853aebe42ea5d215174f7))
* **reports:** gate the fifth door onto report content, which I said I had counted ([a1541b7](https://github.com/InspectorHub/OpenInspection/commit/a1541b7ff15381f2398e2ed446b6f134f840c497))
* **reports:** mark an item the inspector never answered, and stop the delivery ([ab98e4e](https://github.com/InspectorHub/OpenInspection/commit/ab98e4ec47a5838ae4a770ebd88aef955f82d718))
* **reports:** name the company in a sent report, not its URL slug ([efc96e9](https://github.com/InspectorHub/OpenInspection/commit/efc96e9fed0fbf40d9680c019617360c309584af))
* **retention:** enforce the declared window, and let a translation die with its report ([09541da](https://github.com/InspectorHub/OpenInspection/commit/09541da737b46fb3f91a7447ba72dbea0d9e07a6))
* **settings:** retire the repair-list switch, which gated nothing ([91246c5](https://github.com/InspectorHub/OpenInspection/commit/91246c5ee6ba517e449091bdd795ac06cb628e5a))
* **ui:** keep page headers inside a phone screen, and stop billing telling a ([e4a0ef3](https://github.com/InspectorHub/OpenInspection/commit/e4a0ef3dcc3fbe93b54acd51f211d2846d57e986))
* **wizard:** say how the template and the services relate, and name the setup step that leaves the agent portal dead ([b786dc6](https://github.com/InspectorHub/OpenInspection/commit/b786dc6f140f404ff8b238f54ba2a203db49cd5a))


### Performance Improvements

* **docs:** let the edge hold /ui, which renders the same bytes for everyone ([377056b](https://github.com/InspectorHub/OpenInspection/commit/377056b4a71b186a5692452397fdaee440f54a83))

## [2.0.0](https://github.com/InspectorHub/OpenInspection/compare/openinspection-v1.0.0...openinspection-v2.0.0) (2026-09-09)

### ⚠ BREAKING CHANGES

Three changes in this release alter a database that already holds data, in ways
the upgrade cannot perform for you. **Read
[`docs/operate/upgrade.md`](docs/operate/upgrade.md) before deploying this onto
an existing deployment.** A fresh install is unaffected by all three.

* **The baseline migration was rebuilt twice** — on 2026-08-13, folding in a
  69-file chain, and again on 2026-09-09, folding in the 48-file chain that grew
  after it. Both kept the filename `migrations/0000_baseline.sql`, and
  `wrangler d1 migrations apply` decides what to run by comparing **filenames**
  against your `d1_migrations` table. It never compares contents. So on an
  existing database the upgrade applies nothing, `npm run db:lag` reads "in
  sync", and the deploy proceeds against a schema that did not move. **Every
  tool reports success.** The one-time reconcile is
  [Upgrading across a rebuilt baseline](docs/operate/upgrade.md#upgrading-across-a-rebuilt-baseline);
  do it before `npm run deploy`, not after.
* **Nine columns were retired** by the 2026-08-13 rebuild, and no migration in
  this release can drop them for you, because the forward files that added them
  no longer exist. Six are dead storage and harmless to leave. Three are
  `NOT NULL` with no default, so an insert that omits them fails outright:
  `tenants.name` breaks first-run setup, and `automations.subject_template` and
  `automations.body_template` break automation seeding and every automation
  trigger. Back-fill and retirement statements are in step 5 of the same
  section. Run the back-fill before dropping `tenants.name`: for a workspace
  whose company name was never set, that column is the only name it has.
* **Client signature evidence moved between tables** —
  `agreement_requests.signature_base64` to `agreement_signers.signature_base64`.
  The envelope copy could not say whose signature it was, and is removed. In the
  one case with no recorded author — an envelope signature, several signer rows,
  none holding a signature — the migration **stops before dropping the column**
  and leaves your data as it was. You get a failed migration, not a silent loss.
  Do not resolve it by assigning the signature to a signer you believe is right;
  see the guidance in
  [This release moves signature evidence between tables](docs/operate/upgrade.md#this-release-moves-signature-evidence-between-tables).

### About the completeness of these notes

The sections below are generated by release-please from Conventional Commit
subjects. **146 of the 523 commits in this release do not have one**, so they do
not appear there: a subject like `statutory: …` or
`Capability seam, unified marketplace, … (#309)` is skipped by the parser
entirely. That is also why this release was computed as 1.1.0 and had to be
forced to 2.0.0 — the `BREAKING CHANGE:` footer for the first item above is
written correctly, on a commit the parser never reads.

The 17 largest of those 146 are listed here by hand. The remaining 129 are
summarised at the end of this entry.

### Milestones missing from the generated sections

* Agent portal convergence, and a round of repairs found by using the product ([#281](https://github.com/InspectorHub/OpenInspection/issues/281)) ([8bed7d1](https://github.com/InspectorHub/OpenInspection/commit/8bed7d1d921894cf983d521375ffe7ee8f300d0d))
* Capability seam, unified marketplace, DSAR fulfilment, and enforced AI allowances ([#309](https://github.com/InspectorHub/OpenInspection/issues/309)) ([8b3e20b](https://github.com/InspectorHub/OpenInspection/commit/8b3e20b7e23f8ca714ce5e81e21ab7c711a19515))
* Clear the fast-uri advisory, and the gates and skips that were not holding ([#297](https://github.com/InspectorHub/OpenInspection/issues/297)) ([8838b50](https://github.com/InspectorHub/OpenInspection/commit/8838b509b93535a0ae4e3039dc00fee5c2414e80))
* Close the in-report estimate path, gate AI capabilities, and declare the address family for erasure ([#301](https://github.com/InspectorHub/OpenInspection/issues/301)) ([43055ae](https://github.com/InspectorHub/OpenInspection/commit/43055ae498000a3614b3a607efa04ff11de4f273))
* Dispatch board, request idempotency, and the batch 2-5 programme ([#296](https://github.com/InspectorHub/OpenInspection/issues/296)) ([405eeef](https://github.com/InspectorHub/OpenInspection/commit/405eeefc842a3bfb1bc5251bf0f41c85e647a60e))
* Drop ten columns nothing read, and a primary key that was a placeholder ([#310](https://github.com/InspectorHub/OpenInspection/issues/310)) ([3097ca5](https://github.com/InspectorHub/OpenInspection/commit/3097ca5df551baa1d58cf2ee300ab973db57410a))
* Each surface owns its own thing: order facts on the hub, report settings in the editor ([#286](https://github.com/InspectorHub/OpenInspection/issues/286)) ([5078b4d](https://github.com/InspectorHub/OpenInspection/commit/5078b4d00b905742f1f16de169dff9f52b4cd5ef))
* IA audit milestone: surfaces that stated what they did not know ([#287](https://github.com/InspectorHub/OpenInspection/issues/287)) ([f0c328e](https://github.com/InspectorHub/OpenInspection/commit/f0c328e9eb2e0f030e9dafbb5c089568d3e4c1f6))
* IA audit remediation: decouple publish from the order lifecycle, harden public surfaces, and converge report/repair/agent UX ([#279](https://github.com/InspectorHub/OpenInspection/issues/279)) ([01e94e5](https://github.com/InspectorHub/OpenInspection/commit/01e94e539e13617838e3bfc25caa55e376e20099))
* Notification classes & preferences, credentials as first-class records, and a worker that fits ([#290](https://github.com/InspectorHub/OpenInspection/issues/290)) ([66b424f](https://github.com/InspectorHub/OpenInspection/commit/66b424ff3b9154087ff260159807ac684c22ecc0))
* Payments, scheduling and retention ([#299](https://github.com/InspectorHub/OpenInspection/issues/299)) ([1d94cde](https://github.com/InspectorHub/OpenInspection/commit/1d94cde8edfad5577616fe58df41cb6fbaea5e2e))
* Per-deliverable reports, the service catalogue, and one roster authority ([#295](https://github.com/InspectorHub/OpenInspection/issues/295)) ([6ccc1a8](https://github.com/InspectorHub/OpenInspection/commit/6ccc1a85f8649277bf701b901c2462848c955dd9))
* Repair pricing boundary, erasure manifest rebuild, AI provenance, and a type-check split ([#302](https://github.com/InspectorHub/OpenInspection/issues/302)) ([98d02a6](https://github.com/InspectorHub/OpenInspection/commit/98d02a6439df096c73d7e46878143d5d3170bbb0))
* Role model, Communication A-D, and the three roadmap prerequisites ([#289](https://github.com/InspectorHub/OpenInspection/issues/289)) ([e4399f4](https://github.com/InspectorHub/OpenInspection/commit/e4399f40d4b22c5cdfbc81fbaf5e37aa2cf01fd0))
* Signing keys become a history, so rotating one stops destroying what it signed ([#311](https://github.com/InspectorHub/OpenInspection/issues/311)) ([a519d41](https://github.com/InspectorHub/OpenInspection/commit/a519d4160f53254a1b4ae90af2961d0c40c6bea5))
* Type coverage for the test suites, gates that can fail, and the defects they found ([#306](https://github.com/InspectorHub/OpenInspection/issues/306)) ([8d86949](https://github.com/InspectorHub/OpenInspection/commit/8d869494529935e5e7f1e56b1e65d02ad32ad8d0))
* Upgrade to React Router v8 + React 19 (closes GHSA-qwww-vcr4-c8h2) ([#285](https://github.com/InspectorHub/OpenInspection/issues/285)) ([a83fa8d](https://github.com/InspectorHub/OpenInspection/commit/a83fa8d4b5c58500f36b624c964e5c2349ff6ce9))


### Features

* **#100:** name the contracting entity in audit-trail.json ([4f89432](https://github.com/InspectorHub/OpenInspection/commit/4f89432e5f47974c89405ffdad6b2d8e6548a303))
* **#106:** convert every guarded submit site, and stop the gate banning a name ([a1df2d8](https://github.com/InspectorHub/OpenInspection/commit/a1df2d84563e4c196cc73ded76e6635f07199e72))
* a correction can be asked for, and every import starts at the same door ([1b202ac](https://github.com/InspectorHub/OpenInspection/commit/1b202ac478356fb656a4799547871efc2b20f4d8))
* **admin:** who is on which revision, what a withdrawal affects, and delisting ([d2bdf14](https://github.com/InspectorHub/OpenInspection/commit/d2bdf148247446ad90f2cd15aad86c5c71e80248))
* **agent-terms:** derive the exemption list from a classification of every route ([86fd8dc](https://github.com/InspectorHub/OpenInspection/commit/86fd8dce10d6e49ce72e66035b51bddbdf3914c6))
* **agent:** keep every acceptance, and a gate that finds tests nobody runs ([5aee55e](https://github.com/InspectorHub/OpenInspection/commit/5aee55ef67f892b6bd56b4d915eedb81ab6cdd7f))
* **agent:** require an acceptance of the terms in force before an agent session ([14fe92e](https://github.com/InspectorHub/OpenInspection/commit/14fe92e6c829d5d83675881880b835c564476e00))
* **ai:** configure the provider, and test what was actually saved ([b5f4568](https://github.com/InspectorHub/OpenInspection/commit/b5f4568b14289c862d364a22e91299b4f7dea793))
* **ai:** release the translation output classification on a workspace's own key ([f78073f](https://github.com/InspectorHub/OpenInspection/commit/f78073fe7f5f5377f17b685a48aecbfb9dabee50))
* **audit:** an audit row can say the platform did it, and impersonation stops being anonymous ([29c7e2c](https://github.com/InspectorHub/OpenInspection/commit/29c7e2cd118e84d83e8954427639160fda7b9649))
* **auth:** wire two-factor authentication, sign-in half first ([c553e92](https://github.com/InspectorHub/OpenInspection/commit/c553e926ca147fc5b352301cfba0c1483f3ab826))
* **compliance:** govern report_translations.content, which no rule reached ([3cf11f4](https://github.com/InspectorHub/OpenInspection/commit/3cf11f4026c50635697c9b143cfcc2579e5e13f5))
* **compliance:** what is stored, what may be sent, and what we claim about it ([4dbf83f](https://github.com/InspectorHub/OpenInspection/commit/4dbf83f6cbf98188eafce030693fb908d14f952c))
* cron budget, multi-provider AI, and vendor imports that read real exports ([b6a0da9](https://github.com/InspectorHub/OpenInspection/commit/b6a0da9f7b4a16d073a249bfbe7dd1129320ad22))
* **cron:** sweep bundled content onto workspaces an upgrade skipped ([74480f3](https://github.com/InspectorHub/OpenInspection/commit/74480f3337ae5934eb3b15f63cfde22f5b7e185f))
* **defects:** a hand-written defect can name its trade too ([00049ce](https://github.com/InspectorHub/OpenInspection/commit/00049cecbde1d6ca1351aef586199e87d8bfe316))
* **editor:** a screen for the boxes only a statutory form asks about, and the description reaches the editor ([d956c55](https://github.com/InspectorHub/OpenInspection/commit/d956c55a60e820f8d099a7df1829dc3206e37155))
* **editor:** add sub-items, confirm a subtree delete, and pick a parent from the properties panel ([5e71d2d](https://github.com/InspectorHub/OpenInspection/commit/5e71d2db8c1355479e1160ae36493166a5a07a0e))
* **editor:** derive statutory groups from the bindings the template already has ([aa9aa0e](https://github.com/InspectorHub/OpenInspection/commit/aa9aa0e19b5bae2d88e2fcdaecf7af855d6463f7))
* **editor:** draw item nesting with a measured indent, a guide rail and an outline number ([3ccd256](https://github.com/InspectorHub/OpenInspection/commit/3ccd256be7a2f67871728cb9b84a7bdd00859231))
* **editor:** record an overflow instance, say where it goes, and show the count ([385ab28](https://github.com/InspectorHub/OpenInspection/commit/385ab28983b58bb77f360f08b2928d5bfabd8cc8))
* **editor:** render statutory groups as slots, and retire the trapdoor add ([7180832](https://github.com/InspectorHub/OpenInspection/commit/7180832b931c8d9b3086ab0ac77585199aee688d))
* **editor:** tell an inspector which revision governs this inspection ([759425e](https://github.com/InspectorHub/OpenInspection/commit/759425e4e9019e62d65b1ddcaa809e490d7103e0))
* **erasure-gate:** warn before the deadline, and print the number on green runs ([0a2d1cf](https://github.com/InspectorHub/OpenInspection/commit/0a2d1cffbed2be4e56c746c0f8056ef6c417770d))
* **gates:** a published revision may be withdrawn, never removed ([6aa3117](https://github.com/InspectorHub/OpenInspection/commit/6aa31178624f7ac8c0805aaee15a948661e24e96))
* **gates:** an answer this software accepts must have somewhere on the page to land ([86b6017](https://github.com/InspectorHub/OpenInspection/commit/86b6017750e6582568231050663dfb38251f6357))
* **gates:** every catalogue kind needs both halves, and today none has the second ([cc456e3](https://github.com/InspectorHub/OpenInspection/commit/cc456e397eaa4c6e40f40dfe5af36e2a2cac7d3c))
* **gates:** fail the commit when an agent route answers nothing ([864c344](https://github.com/InspectorHub/OpenInspection/commit/864c344c819af7421dd6e57466dbc076b3b20c74))
* **gates:** only the seeder may write what a catalogue pack contains ([dddfbce](https://github.com/InspectorHub/OpenInspection/commit/dddfbce5cb1e34f254646777795662ba30b3cf75))
* **gates:** refuse copy that says an authority approved our rendering ([e38c1fd](https://github.com/InspectorHub/OpenInspection/commit/e38c1fd06bacab65b69aefbfc30be7d807e0a037))
* **imports:** a source says whether it is read as a table ([f43e883](https://github.com/InspectorHub/OpenInspection/commit/f43e8830ae0f0c0b434fb715bc4788f6bb38ed7d))
* **imports:** name the browser-converted CSV, and pin that name to the server rule ([ad6869c](https://github.com/InspectorHub/OpenInspection/commit/ad6869cb10992410657400620f6428a5f12cf0ec))
* **imports:** one front door for template imports, and a corrected report says so ([60ee591](https://github.com/InspectorHub/OpenInspection/commit/60ee5913124b95df45e6a2b2e260659338f78f24))
* **imports:** read a PDF, refuse to clean it, and infer nothing until someone reviews it ([b30a9e1](https://github.com/InspectorHub/OpenInspection/commit/b30a9e157c17090e7fa1f5531d4e0e3f413a0f9d))
* **imports:** read an .xlsx in the browser and upload the chosen sheet as CSV ([e9cb2bf](https://github.com/InspectorHub/OpenInspection/commit/e9cb2bfc7d5388a2aff270ba69ccbf8f3304f168))
* **imports:** restore the browser entry point to the vendored spreadsheet reader ([9e2b2ed](https://github.com/InspectorHub/OpenInspection/commit/9e2b2ed06d2c915025bc7773d6e7b316d4568d79))
* **imports:** the /settings/imports list, and the entry points that start a run ([79daed0](https://github.com/InspectorHub/OpenInspection/commit/79daed008a5647f06fcb3dda89c08927cd88f7be))
* **imports:** the Mapping, Repair and Import stages ([4ddf216](https://github.com/InspectorHub/OpenInspection/commit/4ddf216050d1bc7819abfda2c5f78777919f0200))
* **imports:** the run wizard — shell, Upload stage, and the assisted branch ([bc2c5ef](https://github.com/InspectorHub/OpenInspection/commit/bc2c5ef18b46d6df5def811a11241e6bf7a3617c))
* **imports:** the submit button can say what it is waiting for about a workbook ([900c16d](https://github.com/InspectorHub/OpenInspection/commit/900c16d023c81bbc4289d0bda791cd039e2bf1ff))
* **imports:** the workbook conversion layer can address any sheet ([9cf150c](https://github.com/InspectorHub/OpenInspection/commit/9cf150c0ce452655145c73682125914f44bd4e10))
* **imports:** wire the PDF route into the upload panel, as a variant of it ([9ba5da7](https://github.com/InspectorHub/OpenInspection/commit/9ba5da775a651255e6c25f6f21682fe69aea37cf))
* **inspections:** a reschedule reports what it did to the governing revision ([5b7521a](https://github.com/InspectorHub/OpenInspection/commit/5b7521a13e8399bd73760044f32d335357d5e3f9))
* **inspections:** the three surfaces that decide, trigger and repair a translation ([404968d](https://github.com/InspectorHub/OpenInspection/commit/404968d3dbc7a901164c9327073f5412a4a68f84))
* **legal:** a register of reviewed per-language constants, empty and asserted empty ([8a09563](https://github.com/InspectorHub/OpenInspection/commit/8a0956344298c340c4ac3cab41c79b43246815e9))
* **legal:** complete the closed set of content that stays English ([c63ff5d](https://github.com/InspectorHub/OpenInspection/commit/c63ff5d469c5ba2394e09cf21d21ec30b0bc821c))
* **legal:** the acceptance ledger the seam has been describing for weeks ([ef541e4](https://github.com/InspectorHub/OpenInspection/commit/ef541e4e079f94466cc7b4076b32705dbe6e943c))
* **legal:** the acceptance rides the same write as the account, at every door that opens one ([36120c3](https://github.com/InspectorHub/OpenInspection/commit/36120c3b6039f2d5f66442b12723430d5e35e67a))
* **marketplace:** a self-hosted operator could install nothing, on a reason that was not true ([2018006](https://github.com/InspectorHub/OpenInspection/commit/20180061fb73d738d4b4a98f985185ce3a1f85e2))
* **marketplace:** a statutory kind, validated by its own schema ([7b79017](https://github.com/InspectorHub/OpenInspection/commit/7b790176c04fac04ae6aaa203b41ea7ddf025bd2))
* **marketplace:** un-import, one branch per kind and no fallthrough ([2a132e9](https://github.com/InspectorHub/OpenInspection/commit/2a132e9f96e21a704078257fae0b12023af2d792))
* **marketplace:** un-installing reaches a person, and the gate now checks that ([5662b91](https://github.com/InspectorHub/OpenInspection/commit/5662b91fb6e63c7114d779a4dca190ba2293fe5b))
* **marketplace:** updating a statutory package retires the superseded template ([0f896ed](https://github.com/InspectorHub/OpenInspection/commit/0f896ed817d320ef0ee5925fd1fa8c154f7d6239))
* **migration-intake:** /api/admin/import delivers a bundle into a waiting batch ([b87f4df](https://github.com/InspectorHub/OpenInspection/commit/b87f4df38ad5f94ca9cb75d3dcd9040cfe143fb8))
* **migration-intake:** apply the template and contact rows ([2d2a12b](https://github.com/InspectorHub/OpenInspection/commit/2d2a12b08e1351caff326cba502a49317e0437c4))
* **migration-intake:** claim the batch, and re-check the conflict before writing ([0138caf](https://github.com/InspectorHub/OpenInspection/commit/0138cafd21dbd9f19bf4e1a57bd284fa13c5abbd))
* **migration-intake:** count invites as seats, and refuse a batch before it starts ([0a43c6b](https://github.com/InspectorHub/OpenInspection/commit/0a43c6b903b8415609744006b85967ada9e534ce))
* **migration-intake:** decline, confirm receipt, four emails and two reminders — and close the owner-only gap ([45b302a](https://github.com/InspectorHub/OpenInspection/commit/45b302a326714754cccab4e9ecb8c6604796485d))
* **migration-intake:** eight audit actions, the declined status, and a route that could not be reached ([ae0f8be](https://github.com/InspectorHub/OpenInspection/commit/ae0f8be4a0b36b7467bf965a11c2db04a9c5edb1))
* **migration-intake:** repair a staged row, re-map a batch, and run the assisted clock ([8ff49a4](https://github.com/InspectorHub/OpenInspection/commit/8ff49a4598336253e0e350bf170f21ac224691c6))
* **migration-intake:** retention for the intake batches, and per-deployment import ceilings ([7d1d166](https://github.com/InspectorHub/OpenInspection/commit/7d1d166b05c15ba8c91a010f9cf2ea9bae0f388a))
* **migration-intake:** revert, and the column it must not read ([06ab3ca](https://github.com/InspectorHub/OpenInspection/commit/06ab3ca2c6a9d35614289618efad8ab7ae6ce340))
* **migration-intake:** the adapter registry, with the skip rule derived rather than written down ([8bafb5a](https://github.com/InspectorHub/OpenInspection/commit/8bafb5ad964be2d8c9ea698bdcd9708103538976))
* **migration-intake:** the assisted entry point, the row ceiling, and batch metadata ([ae03ddb](https://github.com/InspectorHub/OpenInspection/commit/ae03ddbd84cbfd2b6d27554f5a3fc4a52c7e3e6b))
* **migration-intake:** the batch lifecycle surface, and the source file in R2 ([af81f1f](https://github.com/InspectorHub/OpenInspection/commit/af81f1f271b5ca838047f9d453526e1b73b3451d))
* **migration-intake:** the batch report — three mutually exclusive buckets ([f636d80](https://github.com/InspectorHub/OpenInspection/commit/f636d80a955ceaff0e2af455264eac792159ba0f))
* **migration-intake:** the generic CSV adapter, and a uniqueness claim that was not true ([8346e0f](https://github.com/InspectorHub/OpenInspection/commit/8346e0fa23e4e82e4730df0d2b515b66f0f4651e))
* **migration-intake:** the HTTP surface — create a batch, list them, read a report ([7ae7261](https://github.com/InspectorHub/OpenInspection/commit/7ae7261c721eeeedd512b0549a5b3de88f6407c3))
* **migration-intake:** the intake carries bytes, and the operator names the vendor ([78155dc](https://github.com/InspectorHub/OpenInspection/commit/78155dce20d9a779dc6773c2c34ee4249cfaca8d))
* **migration-intake:** the lifecycle routes — remap, repair, apply, revert, assist, abandon ([445f5e7](https://github.com/InspectorHub/OpenInspection/commit/445f5e78a2a8d0b0e2a95c146504910d3d5d96a8))
* **migration-intake:** the report carries the file's columns, its mapping and the undo deadline ([e2857c6](https://github.com/InspectorHub/OpenInspection/commit/e2857c680288f55b03b4d8716ea1deb5eedfb02d))
* **migration-intake:** the stage service, and an expiry term the index does not have ([7e28b7d](https://github.com/InspectorHub/OpenInspection/commit/7e28b7d83301a2221ff2fcc695496d06e9a8c986))
* **migration-intake:** the wizard stage model, derived from adapter shape ([dde7dc0](https://github.com/InspectorHub/OpenInspection/commit/dde7dc0c673dd79eae57866120632a4de8d89da6))
* **notifications:** a way out of an email, for someone with no account ([efd9dfa](https://github.com/InspectorHub/OpenInspection/commit/efd9dfa0fb7ad0971aa26b61d8e7671bdd87f5c4))
* **perf:** add per-request memo primitive for the in-process API fan-out ([77faeb7](https://github.com/InspectorHub/OpenInspection/commit/77faeb7a7fa0f459afb890a3470986a5844f223e))
* **perf:** thread a per-request scope into the in-process API seam ([b3d61ee](https://github.com/InspectorHub/OpenInspection/commit/b3d61eeb1ddfae780924f500708902b3e570ef64))
* **report:** a language toggle and a notice that cannot be dismissed ([a3cf162](https://github.com/InspectorHub/OpenInspection/commit/a3cf1621adc5bdcd22ff55120cac3f44f30dff1f))
* **report:** print a translated report as one file, English first ([bae0c62](https://github.com/InspectorHub/OpenInspection/commit/bae0c62862ae89758076af1c1f9d08ed70c741e6)), closes [#23](https://github.com/InspectorHub/OpenInspection/issues/23)
* **reports:** print a sub-item inside its parent's card, and pin the seventh item-key mirror ([b738d44](https://github.com/InspectorHub/OpenInspection/commit/b738d44ed6cc74d088a1cb2998f784483de37832))
* **reports:** render one REPORT, not one inspection, and key the PDF cache to it ([b7251d0](https://github.com/InspectorHub/OpenInspection/commit/b7251d008a16ef2db4c305ee9ea94050c8cecb09))
* **reports:** serve the courtesy translation to a reader, or withhold it ([b848f10](https://github.com/InspectorHub/OpenInspection/commit/b848f10eb79787886d6868c95eb4068561df3455))
* **statutory:** a form's Comments box can read the section's whole narrative ([51f3965](https://github.com/InspectorHub/OpenInspection/commit/51f3965688d282578d545147972f981c5a543da8))
* **statutory:** a multi-select answer may tick more than one box ([33c28ad](https://github.com/InspectorHub/OpenInspection/commit/33c28ad597162e0f0beb61a35330103452658024))
* **statutory:** a question the form never asked is not a question left blank ([412905f](https://github.com/InspectorHub/OpenInspection/commit/412905f8246f8c25d3be657ca9e35f06da693f0d))
* **statutory:** a question with several boxes can now have several of them ticked ([d20da39](https://github.com/InspectorHub/OpenInspection/commit/d20da39d071664e90bf7c896de57ca7d9660a0bb))
* **statutory:** a real checkbox widget can be SET, not only drawn over ([16a691b](https://github.com/InspectorHub/OpenInspection/commit/16a691bbec41d7f84589039943481e0f15aa2f07))
* **statutory:** a third roof goes where the Citizens forms say it goes ([d973f0c](https://github.com/InspectorHub/OpenInspection/commit/d973f0c4f2925b6eec43dc25a85176c46b2b0df5))
* **statutory:** a withdrawn revision says WHY, because the two reasons ask for opposite things ([9b2ed97](https://github.com/InspectorHub/OpenInspection/commit/9b2ed977c67e22061c9c9282f9f14d58a1aab40d))
* **statutory:** add scoped signature mapping kind, refused at render ([851d9a8](https://github.com/InspectorHub/OpenInspection/commit/851d9a8e920d358495ae6aa70895085fffee0cf1))
* **statutory:** add statutory_form_entries table ([c86b349](https://github.com/InspectorHub/OpenInspection/commit/c86b349005c850c383e0236025ea47d3ed5fccfe))
* **statutory:** an operator supplies the authority's PDF, checked by hash ([08376d5](https://github.com/InspectorHub/OpenInspection/commit/08376d5b47f76896a899bb217c689b3d522293d1))
* **statutory:** an option carries the wording the form prints, and still stores the token ([804450e](https://github.com/InspectorHub/OpenInspection/commit/804450e0bddaac541d90ac402483ee888ea2db71))
* **statutory:** answer "what is this form still missing" before publishing ([2c0240f](https://github.com/InspectorHub/OpenInspection/commit/2c0240f98dab0c5752bda0ca7c7115e231d87db5))
* **statutory:** apply dependency rules in order, and refuse a ring by name ([d9db17e](https://github.com/InspectorHub/OpenInspection/commit/d9db17e2f5a472d11107a0de00266cc88c6cae28))
* **statutory:** bind company identity and resolve it from real sources ([347771f](https://github.com/InspectorHub/OpenInspection/commit/347771f097d5d0b2c440218515ea6a93e475b14f))
* **statutory:** declare repeatable field groups with named slots ([d2c1009](https://github.com/InspectorHub/OpenInspection/commit/d2c1009d32e66ccbfe197db2703407eb71b42db3))
* **statutory:** declare the 1802's two remaining conditional questions ([c401e79](https://github.com/InspectorHub/OpenInspection/commit/c401e7902c2da550cffc48bfab74ffc81dbb6f2e))
* **statutory:** endpoint for recording an instance the form has no slot for ([69e5d10](https://github.com/InspectorHub/OpenInspection/commit/69e5d10253d4a28ba38a51d296f10112ebb5065d))
* **statutory:** expand repeatable groups and refuse over-capacity ([3f4031a](https://github.com/InspectorHub/OpenInspection/commit/3f4031a5d80de89b774f8f9281d3502cbf6e9a16))
* **statutory:** expand repeatable groups through the value collector ([4ba2242](https://github.com/InspectorHub/OpenInspection/commit/4ba2242b918ad2eba858504a0582f645a25b88a7))
* **statutory:** fit overlay text, shrink to a floor, then refuse ([af339aa](https://github.com/InspectorHub/OpenInspection/commit/af339aa995731ffa1f4de0dff6cba8bdf7a418eb))
* **statutory:** narrow signature formats, place them without stretching ([1d0edfe](https://github.com/InspectorHub/OpenInspection/commit/1d0edfe56967c8a9a21ec883917b179501d42a0b))
* **statutory:** one function answers whether this template still fits this inspection ([623686f](https://github.com/InspectorHub/OpenInspection/commit/623686fec6164840fb46c34cf5d9838e530dd4bf))
* **statutory:** one screen that answers whether a job booked today could produce the form ([85b3f95](https://github.com/InspectorHub/OpenInspection/commit/85b3f955a8b41281fd3c498a01b93638b65bfe4d))
* **statutory:** preview the form in the editor, before anything is published ([ec299ee](https://github.com/InspectorHub/OpenInspection/commit/ec299ee8c5d32a419aba49fbed4e6e3006158f57))
* **statutory:** publish TX TREC REI 7-6, the first form this software carries ([1dbde6b](https://github.com/InspectorHub/OpenInspection/commit/1dbde6b503600e0cdb9353c5c1d04933fbd6609d))
* **statutory:** read the overflow store when producing a form ([e6eb29f](https://github.com/InspectorHub/OpenInspection/commit/e6eb29f65c76589dc60f93e1a293207bbeaac5c8))
* **statutory:** record which revision produced each form ([89cc277](https://github.com/InspectorHub/OpenInspection/commit/89cc277b2e9c391c6b1b394f8497e816fb5430f8))
* **statutory:** refuse an install nobody in the workspace could ever use ([bb46485](https://github.com/InspectorHub/OpenInspection/commit/bb46485d22884871d302510bf32bdad6a7a5c25e))
* **statutory:** refuse an overflow write aimed at a slot the page prints ([f7b00c7](https://github.com/InspectorHub/OpenInspection/commit/f7b00c76a4bbd026e6a6a742412e712cd58af9f6))
* **statutory:** refuse personal data bound outside safe routes ([6749b09](https://github.com/InspectorHub/OpenInspection/commit/6749b092a56a93bed997bf2b397917efa0f5e9bd))
* **statutory:** render every field map onto the authority's own PDF and read it back ([a1fd385](https://github.com/InspectorHub/OpenInspection/commit/a1fd3851c97d16f58747110073615f7bd41d44c2))
* **statutory:** resolve signatures by reference, never through values ([ce6f0fd](https://github.com/InspectorHub/OpenInspection/commit/ce6f0fd05919053442dfba699ee8efddfcbad7f0))
* **statutory:** route over-capacity instances into the form's own comments box ([1f02a03](https://github.com/InspectorHub/OpenInspection/commit/1f02a03c01136bbc2490eaf47355d1d9f4e1d9fc))
* **statutory:** show what the form still needs, in the editor ([f9a49ca](https://github.com/InspectorHub/OpenInspection/commit/f9a49cae97129c4cb4da657fa89bb0ca0a6e2ba8))
* **statutory:** store the instances the form has no slot to print ([68355f8](https://github.com/InspectorHub/OpenInspection/commit/68355f8bc566a2a9eeeac35a12e05f294898845e))
* **statutory:** ten boxes an authority prints now read a column somebody fills in ([f7bf023](https://github.com/InspectorHub/OpenInspection/commit/f7bf023123ea6f0c58360117dc716e6f116148ab))
* **statutory:** the Citizens four-point form gets a template that asks its questions ([9d7d2d2](https://github.com/InspectorHub/OpenInspection/commit/9d7d2d27863fa068444b21bc62e992c2bb23aa42))
* **statutory:** the endpoint that takes the authority's PDF had no door ([b9f623f](https://github.com/InspectorHub/OpenInspection/commit/b9f623f8df25b6beecf28c403ab4d358e04740ab))
* **statutory:** the Florida wind mitigation form gets a template that asks its questions ([7d95936](https://github.com/InspectorHub/OpenInspection/commit/7d95936c6dc8763cb2ffde766053572318f6aead))
* **statutory:** the four-point form's two "other" answers get the blanks the page prints for them ([9ba535a](https://github.com/InspectorHub/OpenInspection/commit/9ba535a8e2e9b889389a3f21c66ae487c7b64b70))
* **statutory:** which revision of an authority's form was in force, and when ([91dde22](https://github.com/InspectorHub/OpenInspection/commit/91dde224e68b3e34a4034b547af27a8198971c84))
* **templates:** a template can be retired from selection without being deleted ([e98c223](https://github.com/InspectorHub/OpenInspection/commit/e98c2234994020a6c6206f6af53c5cd7eec6cab8))
* **templates:** accept a parentId on template items, bounded at three levels ([dd613f9](https://github.com/InspectorHub/OpenInspection/commit/dd613f99adb34a5a33d1a054ab45a0acdcac31f4))
* **templates:** add the one module that knows items form a tree ([6b3fb0b](https://github.com/InspectorHub/OpenInspection/commit/6b3fb0b08372ab498e1e1307b6fa0d119b3adaa3))
* **templates:** pin the seven item-key declarations to one another ([29c1109](https://github.com/InspectorHub/OpenInspection/commit/29c1109fce029049528ebd5ad61985ee9683c606))
* the import wizard asks who made the file, and translations get a home ([ad59ea7](https://github.com/InspectorHub/OpenInspection/commit/ad59ea7844f9d680ba82226ebd0a0e91db40b4b7))
* **translation:** the segmenter, the one place a report span becomes eligible ([0960369](https://github.com/InspectorHub/OpenInspection/commit/09603690f053ffbe4179fc8708b31a3aa8a98310))
* **translation:** wire the storage that had no callers, and give a person a way to reach it ([563fcc0](https://github.com/InspectorHub/OpenInspection/commit/563fcc0b916d519784372a17403515fe9b7fc92f))
* **ui:** a retired template leaves with its reason, and an update states its cost ([eb5440a](https://github.com/InspectorHub/OpenInspection/commit/eb5440a03b37b34bdca74573f41438d8420e8606))


### Bug Fixes

* a rating level with no abbreviation crashed the report render ([c79b8fe](https://github.com/InspectorHub/OpenInspection/commit/c79b8fe4e4e6a876c65f8039db1f571618daef88))
* **a11y,layout:** attribute labels failed 4.5:1 in both themes; a refusal URL scrolled the page sideways ([09751ff](https://github.com/InspectorHub/OpenInspection/commit/09751ffb0d379f00b7ceba5d2ec91023afb2153a))
* **agent-terms:** let a gated agent read their own acceptance history ([3ceddc6](https://github.com/InspectorHub/OpenInspection/commit/3ceddc6495f5a5b27dec0eb219c98bb43e5dd882))
* **ai:** validate the saved base URL the way the tested one already was ([def1b70](https://github.com/InspectorHub/OpenInspection/commit/def1b70c45a589932525282a0243cf520f3fc14f))
* bound the last-active debounce map, and stop spawning the audit gate three times ([999451f](https://github.com/InspectorHub/OpenInspection/commit/999451f9a33fcf5e278316eaec3541eeda127e04))
* **branding:** stamp the deployment flags on every path, not just the D1 one ([0f64223](https://github.com/InspectorHub/OpenInspection/commit/0f64223be3c75702e6c47c9b0c21e2c62364fc73))
* **ci:** hold wrangler below 4.125, where `wrangler dev` started dying mid-run ([1368580](https://github.com/InspectorHub/OpenInspection/commit/13685806f28f2d5cda0a68cfb544b70d51b67ca4))
* **ci:** patch wrangler's fatal-error classifier instead of retreating to 4.102 ([9f15cc7](https://github.com/InspectorHub/OpenInspection/commit/9f15cc7134ae5c35496cb691f90b3915bd722451))
* clear 34 dead assignments the new eslint recommended set found ([e355a73](https://github.com/InspectorHub/OpenInspection/commit/e355a732c7bf4b7fc2eb8351a933864cb660309b))
* **compliance:** a legal hold blocks erasure, and says so instead of deleting ([396da9a](https://github.com/InspectorHub/OpenInspection/commit/396da9adffcf75ea57b5d222b04a39e4f0da3e91))
* **contacts:** the form accepted two of the three kinds its select offers ([bc3014c](https://github.com/InspectorHub/OpenInspection/commit/bc3014ca4d344cabe3c8f60f847061a0146cf94a))
* **contractor-types:** backfill trade_slug for existing workspaces ([03e9250](https://github.com/InspectorHub/OpenInspection/commit/03e9250968b2f76a1d34b504c60a1b93281d5277))
* **deps:** override qs and @humanfs/node past this week's advisories ([f42d6c7](https://github.com/InspectorHub/OpenInspection/commit/f42d6c7e8563ac4f59fa2c5d6b8471fe42b48045))
* **deps:** override qs and @humanfs/node past this week's advisories ([3b6ec18](https://github.com/InspectorHub/OpenInspection/commit/3b6ec18d9ed14457b7f44741a988a04fa9a2c55b))
* **deps:** raise the fast-uri override past GHSA-5jgf-p345-68v8 ([bbf1aae](https://github.com/InspectorHub/OpenInspection/commit/bbf1aae4b3248e2d6e18b86780573a8c08e8d11a))
* **docs:** the schema reference stops attributing enums to the wrong column ([5cd7732](https://github.com/InspectorHub/OpenInspection/commit/5cd77324a5f6774c02bc68c4b226b97fec34c3ee))
* **editor:** a transcribed option list collapsed into one paragraph ([d74cb76](https://github.com/InspectorHub/OpenInspection/commit/d74cb76931ed0716a4bbe6abb7f464a14f3ba8b9))
* **editor:** item attributes reach the editor, and answering one persists ([4ace9a1](https://github.com/InspectorHub/OpenInspection/commit/4ace9a132ed3a00a4ce395e293610869ed2cdb03))
* **editor:** make the best-effort comment true for the case that broke it ([ffd31f5](https://github.com/InspectorHub/OpenInspection/commit/ffd31f52fa40f7979b09494134bb89960dda4c70))
* **editor:** stop offering structural edits a statutory inspection will refuse ([34ca786](https://github.com/InspectorHub/OpenInspection/commit/34ca7867a1fb4cae0aecc441b024e4c4ecc6207d))
* **editor:** structural item edits move whole subtrees, and a duplicated section re-points its clones ([f9ca253](https://github.com/InspectorHub/OpenInspection/commit/f9ca253c09210b5dd7510ad5e3f41f4096f0523a))
* **editor:** the Inspection Details overview rendered nothing on a phone ([3cfe124](https://github.com/InspectorHub/OpenInspection/commit/3cfe124da9b861c90188167450329854631a4867))
* five gaps a role-by-role read found, and one lockout with no way out ([95d7952](https://github.com/InspectorHub/OpenInspection/commit/95d79529796b05238f9ff638d68aecf41abbfd9b))
* five gaps a role-by-role read of the product found, and one lockout with no way out ([70a7b3d](https://github.com/InspectorHub/OpenInspection/commit/70a7b3d3687b2b8ae454926bf480f712ae4f8ade))
* four automation events could silently never fire in production ([c53c65a](https://github.com/InspectorHub/OpenInspection/commit/c53c65a43181a1a5b6a725b50c2f3d914664c7c9))
* **gate:** hash bundled content with line endings normalised ([f3dd256](https://github.com/InspectorHub/OpenInspection/commit/f3dd256e711832b548765e211df5bf68bcd122cc))
* **gates:** key the adapter-construction rule on the directory, not a deleted class ([e2d1e30](https://github.com/InspectorHub/OpenInspection/commit/e2d1e30ecb5a24f7e9155a437498da7247ef6411))
* **gates:** the answerable gate enumerated kinds, and missed one added the same day ([da9a60c](https://github.com/InspectorHub/OpenInspection/commit/da9a60ca88ba6fb1a10d8c63c2e598b193d2ad7f))
* **gates:** the catalogue gate could not see a shorthand property ([6c481c8](https://github.com/InspectorHub/OpenInspection/commit/6c481c8bd456c7e7af439ba13c79d3eaa9111309))
* **gates:** the statutory date check could not read a date, and said so as a pass ([f3b7d63](https://github.com/InspectorHub/OpenInspection/commit/f3b7d635476f01bb586bc06fe0f8ed1764dafcb4))
* **gates:** the submit-guard escape hatch was invisible on a CRLF worktree ([399daa8](https://github.com/InspectorHub/OpenInspection/commit/399daa8fc05227e259dfdcfe2c509463b1a9904f))
* **gates:** the tenant-scope gate was calling the platform catalogue tenant-scoped by borrowing the next table's column ([f2ff2ce](https://github.com/InspectorHub/OpenInspection/commit/f2ff2cedc66f2e6d6c0ae6d77b2e45b95c9061b7))
* **hub:** stop calling them blockers, and say so on the screen that publishes ([d685a45](https://github.com/InspectorHub/OpenInspection/commit/d685a45907280c7153fa4d920681cd33d8728aed))
* **hub:** stop offering to collect nothing ([8857a05](https://github.com/InspectorHub/OpenInspection/commit/8857a05e21d0886356638ef0f62964366d1d08aa))
* **i18n:** "statutory" was translated as "oficial" in es-419, which is the one word the endorsement policy rules out ([99cecaa](https://github.com/InspectorHub/OpenInspection/commit/99cecaa86e73d269c177bafd4128f7f4957a3ce7))
* **inspector-portal:** make the statutory read best-effort in fact, not only in the comment ([8acdb27](https://github.com/InspectorHub/OpenInspection/commit/8acdb2765e64ecdf69a87e22050b5ee626d71d9c))
* **intake:** say so when a Home Inspector Pro template loses a level of nesting ([3d6e507](https://github.com/InspectorHub/OpenInspection/commit/3d6e50749aaa75447c83194a5c73f018c1678bac))
* **legal:** joining a team stopped working, and the refusal that broke it was inconsistent ([0891bf8](https://github.com/InspectorHub/OpenInspection/commit/0891bf8bd983b6f150728cbfb206ee59d7be4e58))
* **lint:** make the session-secret salt module-private ([2be7bf3](https://github.com/InspectorHub/OpenInspection/commit/2be7bf39baebab0901d3ac4a02d9c218bb0ff059))
* **marketplace:** a pack can come back, and a statutory one needs its PDF first ([6e3159a](https://github.com/InspectorHub/OpenInspection/commit/6e3159a0ffbc4ef49379767722e660dad7d19278))
* **marketplace:** seed a catalogue row that moved, instead of skipping it ([e163f5e](https://github.com/InspectorHub/OpenInspection/commit/e163f5e3203d61a9b2bf8f54d4698599ac9e1c37))
* **marketplace:** the browse filter can name every kind the catalogue holds ([ce33a31](https://github.com/InspectorHub/OpenInspection/commit/ce33a31c9eded1fb372640d3e3928c137115c757))
* **marketplace:** the kind tabs filter, and one of them names a kind that exists ([e2dfcfd](https://github.com/InspectorHub/OpenInspection/commit/e2dfcfd885ecfeb58e72649db26eb349ae242651))
* **migration-intake:** a bad row fails the row, not the upload ([00bffbc](https://github.com/InspectorHub/OpenInspection/commit/00bffbc42d3eb8bcb9f1b06454a1ebf51713dc58))
* **migration-lag:** name the unresolved account behind a 7403 ([fca6341](https://github.com/InspectorHub/OpenInspection/commit/fca6341f6d8aa6f58a4f96e676b34eecc4dc727c))
* **perf:** bound the last-active debounce map, and stop spawning the audit gate three times ([34dfccb](https://github.com/InspectorHub/OpenInspection/commit/34dfccb13394328779086bd87e048758a31c5014))
* **perf:** five findings from review of this branch ([a57e374](https://github.com/InspectorHub/OpenInspection/commit/a57e37404e4b21668143d4f3ee1e597432345620))
* **portal:** stop the report tile claiming Published while the client is locked out ([69a30c7](https://github.com/InspectorHub/OpenInspection/commit/69a30c732a2a071f87851b8a96786707e13f0b6e))
* **qbo:** one QuickBooks company binds to one workspace, and the webhook says so ([d9ed18d](https://github.com/InspectorHub/OpenInspection/commit/d9ed18d12a1f978d15a0409e162eb46d14f2d2ea))
* **seats:** check the cap where the seat is taken, and count it once ([db9ef3e](https://github.com/InspectorHub/OpenInspection/commit/db9ef3ebacb73fe8928f5ec074b9b3b6491b5ce0))
* **security:** classify an artefact key by segments, not by a regex built from filenames ([b55bb9b](https://github.com/InspectorHub/OpenInspection/commit/b55bb9bd98198299482cc8d039d7f3b14e077718))
* **settings:** a signature must be a format a PDF can carry ([36196cf](https://github.com/InspectorHub/OpenInspection/commit/36196cfd9f9bb2e9624784e7be6431bff9df2140))
* **shared-ui:** a segmented control's options were 27x25 where a finger uses them ([e010d63](https://github.com/InspectorHub/OpenInspection/commit/e010d630dcb5c2935bafa14f075d4906fe12336a))
* **sms:** a staff STOP is recorded, and recorded as staff ([ea8c9da](https://github.com/InspectorHub/OpenInspection/commit/ea8c9da2831f3f5a9edd85f3fdf54f7bb49759ee))
* **statutory:** a group slot's list answer was flattened to "a,b" and ticked no box ([5035cd0](https://github.com/InspectorHub/OpenInspection/commit/5035cd002c159ef6f20b924346aee682099ad2e3))
* **statutory:** a key on the type and on no schema is a seam no compiler spans ([b90418f](https://github.com/InspectorHub/OpenInspection/commit/b90418f34fab66e3a2a4835fa6382ffcc419aa31))
* **statutory:** a maxWidth with no maxHeight is documentation, not a bound ([477003d](https://github.com/InspectorHub/OpenInspection/commit/477003ddc14f173784b172689f33e371c9d556c5))
* **statutory:** a required box answered with nothing is refused, not printed blank ([252cff8](https://github.com/InspectorHub/OpenInspection/commit/252cff8283dd7acc7baa5c51ad102baeb3a2a246))
* **statutory:** a signature can be produced, and a refusal reaches the reader ([3389f70](https://github.com/InspectorHub/OpenInspection/commit/3389f70f5e844656aade022dacb8b89a0f67bbd3))
* **statutory:** a Texas form was printing an ISO date ([672930d](https://github.com/InspectorHub/OpenInspection/commit/672930d433e07e486a2e78b1bf1dfadea9c7351c))
* **statutory:** four defects between pressing Download and getting a document ([0ae4f7d](https://github.com/InspectorHub/OpenInspection/commit/0ae4f7d39352be7ade7628e7ec0a50279e21dee6))
* **statutory:** key the duplicate rule on the target, not the field ([d2d43e3](https://github.com/InspectorHub/OpenInspection/commit/d2d43e3510e52d1a0e1db7b2c66e755d2bcee9c6))
* **statutory:** let a binding own a printed slot, and stop refusing the normal case ([8517937](https://github.com/InspectorHub/OpenInspection/commit/85179378d7c17efdceacacfc27de07693f5532b5))
* **statutory:** read the calendar day off a column that holds two shapes ([65f5189](https://github.com/InspectorHub/OpenInspection/commit/65f5189e75e15dc23f7ba01ae13ebdfb5933b262))
* **statutory:** six printed categories were answered by a free-text box that taught a value the form cannot tick ([8d0a4eb](https://github.com/InspectorHub/OpenInspection/commit/8d0a4eb80841ed61348139618ee0e6fbf73a83c5))
* **statutory:** the clipping guard budgeted 20% too little and let the page cut the text ([bff475d](https://github.com/InspectorHub/OpenInspection/commit/bff475d14f48d7584e087b2d051726258eb2bdcc))
* **statutory:** the download is the button you press, and the form is named the way the form names itself ([c9bd0fe](https://github.com/InspectorHub/OpenInspection/commit/c9bd0feda73aa12c34a0cf3b0fc72f79a7b385ec))
* **statutory:** the form rendered blank, because answers are not keyed by item id ([c6569ca](https://github.com/InspectorHub/OpenInspection/commit/c6569cae24a40aaa790f46c09cd32cdba74c08c3))
* **statutory:** the four-point aluminum-wiring value was printed over the form's own text ([aea3359](https://github.com/InspectorHub/OpenInspection/commit/aea33594c882964b5f7038a7668277cfdad72552))
* **statutory:** the personal-data gate knew the word "address", not the parts of one ([16965ce](https://github.com/InspectorHub/OpenInspection/commit/16965ced8139d7590e920967b3fe06640d4e2373))
* **statutory:** the produce path now refuses the one state it was built to refuse ([fbc2483](https://github.com/InspectorHub/OpenInspection/commit/fbc248333d05b6a4a5c7ff4429dd175a5a281678))
* **statutory:** the readiness card says it could not check, and links the one gap the reader can close ([00ad346](https://github.com/InspectorHub/OpenInspection/commit/00ad3462d572f16ff4f0fd642f5d4911c9d6e3ee))
* **statutory:** the TREC form id names the form, not one of its revisions ([34e4a58](https://github.com/InspectorHub/OpenInspection/commit/34e4a58a2131688a9e435944274790f63187499d))
* **statutory:** three refusals that reached the inspector as "Internal server error" ([3b1e0b3](https://github.com/InspectorHub/OpenInspection/commit/3b1e0b3e19ec619972a7f6d8045adc450706b94f))
* **team:** drop the exported type nothing consumes ([3b55a58](https://github.com/InspectorHub/OpenInspection/commit/3b55a5835e7ea8e689757e363c170dd769fc7a62))
* **team:** make the invite link reachable, and give it one producer ([b69ff0e](https://github.com/InspectorHub/OpenInspection/commit/b69ff0e38e2c06ad95ffa72b9f2e0a3327dae017))
* **templates:** the TREC template was not the TREC form; rebuild it from the form ([13aba88](https://github.com/InspectorHub/OpenInspection/commit/13aba88692d35db68e9912c14fa6aac11d644e85))
* **tests:** one source for the tenants DDL, and an assertion over it ([960ab4d](https://github.com/InspectorHub/OpenInspection/commit/960ab4dd54e8ee77e4c983d38e7678ce529f4cac))
* **tests:** type the loader stub against the real loader ([3dfbd97](https://github.com/InspectorHub/OpenInspection/commit/3dfbd9768fe25b374150d8b251ae86a49171320e))
* **test:** the editor loader's api mock never got the statutory-details stub, and all five tests in the file died on it ([9cb606b](https://github.com/InspectorHub/OpenInspection/commit/9cb606be64f1d155649032637fbc52262bd9f642))
* three gates the pre-commit tier cannot see ([10f67e0](https://github.com/InspectorHub/OpenInspection/commit/10f67e029a0598466313218d59c27c5a357e6eb7))
* three source files were binary to every text tool because a separator was a raw NUL byte ([4ce3693](https://github.com/InspectorHub/OpenInspection/commit/4ce3693dd707e644550a9b57426cf73b9c457fd0))
* **translation:** stop exporting the publish hook's internals ([f5ae47a](https://github.com/InspectorHub/OpenInspection/commit/f5ae47ac7cceac89d0b9bda8355f394ee0f07350))
* two things only the full run could see ([fb8b83d](https://github.com/InspectorHub/OpenInspection/commit/fb8b83d40df24766cc7e41fa127ac5f04c11bd7a))
* **ui:** Card silently dropped data-testid, so a declared test handle rendered nothing ([fa6c65b](https://github.com/InspectorHub/OpenInspection/commit/fa6c65bc81bcf42d4a5f4b0c4f1df81066fe4185))
* **ui:** the last six controls that were on screen and did nothing ([36af93b](https://github.com/InspectorHub/OpenInspection/commit/36af93b0de9a1171b89ad2f2720490d2faa19ab5))


### Performance Improvements

* **auth:** build the JWT keyring once per request, not once per in-process call ([00ef8f5](https://github.com/InspectorHub/OpenInspection/commit/00ef8f53f2771f96188018ca15452a2886dd5b61))
* **auth:** verify a token and read its revocation marker once per request ([47d766d](https://github.com/InspectorHub/OpenInspection/commit/47d766d9dc34c5b8d86e83592c34cb546efff479))
* **caps:** read the acting user's overrides once per request, and measure the rest ([56a85e3](https://github.com/InspectorHub/OpenInspection/commit/56a85e34c3a2b084f05d899c27ab3e6aa6f8839e))
* **cron:** dispatch the tick without importing the API graph ([f8c42ab](https://github.com/InspectorHub/OpenInspection/commit/f8c42ab46396e73a1114f5412a14fcb356dd32a4))
* cut round-trip depth in the render, and CPU on the paths production actually uses ([c5d86fd](https://github.com/InspectorHub/OpenInspection/commit/c5d86fd59f2674d6c25804d8e72c7ae62c868178))
* **hub:** issue the aggregate's independent reads in one wave, not eleven ([56e743a](https://github.com/InspectorHub/OpenInspection/commit/56e743add64b904c617cad9c59b9aa88613803ab))
* **hub:** remove the render's last duplicate reads, and fix the gate that mis-counted them ([b7b7a3a](https://github.com/InspectorHub/OpenInspection/commit/b7b7a3af17e3dc72052b62d39edfe867f685c8e4))
* **hub:** remove the render's last duplicate reads, and fix the gate that mis-counted them ([15743d0](https://github.com/InspectorHub/OpenInspection/commit/15743d08a12cbe23845a6dbb793860208b5de18b))
* **mcp:** load the 900 KB OpenAPI snapshot only when a session needs it ([7d3e73e](https://github.com/InspectorHub/OpenInspection/commit/7d3e73ef7da97b8b8dbf68615a598a7f19b2ec49))
* measure duplicate reads across five renders, and take them to zero ([ac02ba3](https://github.com/InspectorHub/OpenInspection/commit/ac02ba3e9ba5bea5edbfb22cc372733ba7583aa0))
* **openapi:** generate the OpenAPI document once per isolate, not once per request ([158753b](https://github.com/InspectorHub/OpenInspection/commit/158753b52cfad7f14020f5ea3b0bcc7bc1e3eff5))
* **portal:** fan the inspection loader out in two waves instead of fifteen ([3d5eb93](https://github.com/InspectorHub/OpenInspection/commit/3d5eb93e9d30b5deb7f3b840487a8172545f6139))
* **queue:** dispatch the four consumers without importing the API graph ([44aee8b](https://github.com/InspectorHub/OpenInspection/commit/44aee8b21dfc0572560699fb124ef7d9dfa45026))
* **session-context:** one wave, and one less read of tenant_configs ([4c23c2c](https://github.com/InspectorHub/OpenInspection/commit/4c23c2c661cfa31e96127dc0015e609514261a44))
* **session:** let SESSION_SECRET be provisioned without logging anyone out ([24e4914](https://github.com/InspectorHub/OpenInspection/commit/24e4914bbd7e415077061d770db8ba2c87437cd3))
* **settings:** share the tenant_configs row within a render, taking the last duplicates to zero ([2e69982](https://github.com/InspectorHub/OpenInspection/commit/2e699824c85b0ab3a97dd8e57c6aaa2d727ee07d))
* share middleware work across the in-process API fan-out (140 -&gt; 56 D1 statements per render) ([b57329e](https://github.com/InspectorHub/OpenInspection/commit/b57329e089e1cc49c6bdc83a3c8109ec86c38caa))
* split the queue consumer out of the API graph, and measure the render's duplicate reads ([9917d5b](https://github.com/InspectorHub/OpenInspection/commit/9917d5b81e5a806b1d9e6f703e0c5854c020442c))
* **status:** answer the health check without importing the API graph ([c386cf8](https://github.com/InspectorHub/OpenInspection/commit/c386cf89cabee1bb2c403902867c31ae74d773c0))
* **statutory:** parse the authority PDF at ParseSpeeds.Fastest ([125cbf0](https://github.com/InspectorHub/OpenInspection/commit/125cbf0443b3720f152e3b519b22399460e59aa0))
* **statutory:** parse the authority PDF once per document, not three times ([a3a5890](https://github.com/InspectorHub/OpenInspection/commit/a3a58904b19f5b4f8adb6bfaafc3cd2a3fd08aff))
* **tenancy:** decrypt tenant secrets once per request instead of twice per call ([e0fedd5](https://github.com/InspectorHub/OpenInspection/commit/e0fedd532544e91df6ad00e466f6643d07f452f3))
* **tenancy:** resolve palette slugs once per request ([a116231](https://github.com/InspectorHub/OpenInspection/commit/a11623116ad72b9fc5232f23c1bcf897bb96d99b))
* **tenancy:** resolve tenant branding and the tenant row once per request ([b18475e](https://github.com/InspectorHub/OpenInspection/commit/b18475e50f67172c98acb2fee6516674fcc3900e))
* **worker:** answer scanner probes with a cheap 404 instead of an SSR render ([639f2a9](https://github.com/InspectorHub/OpenInspection/commit/639f2a9307d4af757f35c52ce04a1a7e82777728))


### Miscellaneous Chores

* release openinspection 2.0.0 ([82f148a](https://github.com/InspectorHub/OpenInspection/commit/82f148ad825fcbbdf3cef80fb88e1990cf51e00b))

### Also in this release

The remaining 129 commits that the generated sections cannot see, by theme:

* **Statutory forms** (17) — read-only declared templates, UTC-midnight calendar
  days, narrowed signature formats placed without stretching, signatures
  resolved by reference rather than by value, and ten authority-printed boxes
  that now read a column somebody fills in.
* **Import and data exchange** (21, across `migration-intake`, `intake`,
  `imports` and `data-exchange`) — one interchange vocabulary owned outside the
  intake registry, contact notes and types carried end to end, a starter
  contacts spreadsheet derived from the importer itself, and a declined run that
  no longer claims to be ready for review.
* **Field census** (9) — classifying the compliance cluster, and replacing four
  recorded reasons that the code contradicted.
* **Retention, legal holds and compliance** (10) — a legal hold now outranks
  every scheduled deletion, the last two undecided tables closed, and the
  manifest's column names bound to the schema so an executor cannot drift from
  what it declares.
* **Conformance gates** (12+) — one registry with a rung that three consumers
  read, every `lint:*` script either on a rung or saying why not, a gate that
  refuses a selection matching nothing, and the rule that a signature may be a
  picture but never a biometric template.
* **AI** (5 + schema) — a managed credential that refreshes itself for
  short-lived-token backends, provenance recording where each call went, and the
  AI subsystem moved off `tenant_configs`, which had no room left.
* **Security** (2) — two publish-gate sanitizer fixes, including one CodeQL was
  right about: a single pass is not a sanitizer, and HTML has two comment
  terminators.
* **Privacy** (1) — the data-portability export was handing back a live second
  factor.
* Plus single fixes across booking, collab, dashboard, hub, media, messages,
  reports, settings and sync. The full list is the commit history between the
  1.0.0 and 2.0.0 tags.

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
