# Changelog

## [0.10.0](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.9.0...field-ui-v0.10.0) (2026-11-10)


### Features

* **field-ui:** put a finished video on the item it was added to ([2c86a4d](https://github.com/InspectorHub/OpenInspection/commit/2c86a4dc10aea5cdd057a60a4beab08f6cd646b6))
* **payments:** let a company collect a deposit or the full fee at booking, and always ask the client for what is still owed ([4683ada](https://github.com/InspectorHub/OpenInspection/commit/4683ada6b93518abb4260b11af9968df6c638c54))
* **quota:** monthly plan allowance, video on items and collab fixes ([17d98b9](https://github.com/InspectorHub/OpenInspection/commit/17d98b9db7763b2043cf94a01b097c5cf9775f11))
* show R2 videos on the item strip and keep every clip when results are merged, loaded or reordered ([a9869fc](https://github.com/InspectorHub/OpenInspection/commit/a9869fc186917378f7958f3dadca2291cfe89562))


### Bug Fixes

* **collab:** lineage guard so a stale offline copy cannot merge into a rebuilt results document ([7bf0ea7](https://github.com/InspectorHub/OpenInspection/commit/7bf0ea7de5c4d8e7d4ba78e1522885ff58109136))
* **collab:** the server also checks the generation a client reports, and a second tab keeps the lineage its own document belongs to ([d4a8fa0](https://github.com/InspectorHub/OpenInspection/commit/d4a8fa007f58a03d0636aede21d89fe3a4c41de0))
* **field-ui:** open the photo studio with the photo's key, not the photo entry ([758c52a](https://github.com/InspectorHub/OpenInspection/commit/758c52a51767c61fabfd1d2dc46f216927a5db53))
* **field-ui:** photo studio follows the viewed photo; cover label, hidden actions and delete confirm ([7836e86](https://github.com/InspectorHub/OpenInspection/commit/7836e864a7bed1b815eed2948a8eb3fd35854472))
* **field-ui:** the media viewer follows a clip by its media id, not by its empty key ([b333b45](https://github.com/InspectorHub/OpenInspection/commit/b333b45b128b5faab51822fae6418d0801ad2f78))
* **prefs:** one default for agent repair-list access, and an unrelated preference save no longer widens it ([4f947ce](https://github.com/InspectorHub/OpenInspection/commit/4f947cee7969e12edb530b09ea4019016af1bdcc))
* **prefs:** the report-link expiry default is two years in every layer, not never on the settings page ([9dbe155](https://github.com/InspectorHub/OpenInspection/commit/9dbe155b3e5771b3ef06ba47cfe4a121fbff8286))
* **prefs:** use one default for agent repair-list access and report-link expiry in every layer ([5d7f910](https://github.com/InspectorHub/OpenInspection/commit/5d7f91049d1c604b055d52d348e5f84ee20d6f33))
* **security:** clear the two CodeQL findings on the release PR ([ca5ef16](https://github.com/InspectorHub/OpenInspection/commit/ca5ef1634a5cd99f64a9a7c1a397b38bff86cc07))

## [0.9.0](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.8.0...field-ui-v0.9.0) (2026-11-07)


### Features

* **field-ui:** name the tag button, head the tag row, and link to the tag library when there are no tags ([962c590](https://github.com/InspectorHub/OpenInspection/commit/962c590adfaf7ba6416860514fb831574e654d49))
* **field-ui:** open the editor on an item and add previous/next item on touch layouts ([e93cbf4](https://github.com/InspectorHub/OpenInspection/commit/e93cbf4c879b93587918dd84c753c544de307c13))
* **field-ui:** open the editor on an item, previous/next item, and a worded way out of every sheet ([9be67d6](https://github.com/InspectorHub/OpenInspection/commit/9be67d621ffaf9fd910a6303c3007e0c7a220e15))


### Bug Fixes

* **field-ui:** bring the bottom bars back only after the keyboard is gone ([99e1631](https://github.com/InspectorHub/OpenInspection/commit/99e163149ab899094efcf2fdc05d51fcf90bcce6))
* **field-ui:** every sheet and dialog has a worded way out, and the close targets reach 44px ([a519794](https://github.com/InspectorHub/OpenInspection/commit/a519794904fb76723b33d87ba08ca727c0b0b09c))
* **field-ui:** hide the bottom bars while a text field has focus on a phone ([4ca4a3b](https://github.com/InspectorHub/OpenInspection/commit/4ca4a3b6d236d7c56a3d61e30298457b0001525f))
* **field-ui:** keep the version history Save button on one line on a phone ([2565318](https://github.com/InspectorHub/OpenInspection/commit/2565318b316a3fe2da12ed9e7e97040ec483f6d4))
* **field-ui:** review fixes for the editor's opening place and Previous / Next ([fc4edbd](https://github.com/InspectorHub/OpenInspection/commit/fc4edbda39a77dfb54368502adb184fed3dc0e20))
* **field-ui:** the item stepper sits on the bottom bar for a short item, and a closed bottom sheet casts no shadow ([96ee76a](https://github.com/InspectorHub/OpenInspection/commit/96ee76a616b8b1d63e38d8a8b5a21c80e062c778))
* **ui:** a bottom sheet or dialog never reaches up under the status bar while the keyboard is open ([de3f19c](https://github.com/InspectorHub/OpenInspection/commit/de3f19cc023f59c13487fb644e43fb95e61b3866))
* **ui:** bottom bars fade instead of popping, bottom sheets end at the keyboard, and text fields ask for the right keyboard ([c250543](https://github.com/InspectorHub/OpenInspection/commit/c2505431599f317bc9feecfd8e8700e08d0655f4))
* **ui:** buttons grow with their label instead of overflowing; use the shared Button ([9b1e0e1](https://github.com/InspectorHub/OpenInspection/commit/9b1e0e10d876122959671d8a35bea37d7ec14e2d))
* **ui:** dialogs stay above the soft keyboard; rating tiles and the item stepper fit a phone ([39e5264](https://github.com/InspectorHub/OpenInspection/commit/39e52640561969e6b387b1f8f4277070970eb198))
* **ui:** iOS web view pins the page behind a layer when the host asks; the photo studio ends at the keyboard and clears the status bar ([4512467](https://github.com/InspectorHub/OpenInspection/commit/45124671264da42228d35adc73afe293a7ea35cd))
* **ui:** number fields without a minimum keep the default keyboard; the item stepper only hides for a soft keyboard ([6400b6e](https://github.com/InspectorHub/OpenInspection/commit/6400b6e8aef812639f2b0aa614f974de830248b7))

## [0.8.0](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.7.0...field-ui-v0.8.0) (2026-11-05)


### Features

* **editor:** open published reports read-only and add edit-and-republish ([12e687f](https://github.com/InspectorHub/OpenInspection/commit/12e687f3037d2c96a1653450d919359967cfa074))
* **publish:** let the inspector choose whether to send the report-updated notices on republish ([867c836](https://github.com/InspectorHub/OpenInspection/commit/867c83685c74983b3ea4174ff9af5c467c50aefd))
* **reports:** refuse content writes to a published report and add edit-again ([df6f5c8](https://github.com/InspectorHub/OpenInspection/commit/df6f5c8a4b073cfbc14fdafbece9fc93bc39275a))


### Bug Fixes

* **api:** whole-branch review follow-ups ([5c451d5](https://github.com/InspectorHub/OpenInspection/commit/5c451d5cf551a93fa9452f3902a459ebe73b5664))
* **editor:** do not advance to the next item after the editor has unmounted ([2d097d3](https://github.com/InspectorHub/OpenInspection/commit/2d097d3e700f6b41a7e42b3bcd47abb4990a9330))
* **inspections:** one property type vocabulary, and document the captured item value ([64bf256](https://github.com/InspectorHub/OpenInspection/commit/64bf256535555718ad3e1650a75cbc8bfd4a3db0))
* **publish:** make the notice choice and receipt match what the server does, and freeze category colours and time zone ([d27222b](https://github.com/InspectorHub/OpenInspection/commit/d27222befd92f5aa0b66c92a5e072db1b2083360))
* **publish:** make the unchanged-publish receipt honest, and compare snapshots without key order ([50a46ce](https://github.com/InspectorHub/OpenInspection/commit/50a46ce6350fd9168d45662e47746902ce26c8bc))
* **reports:** freeze published reports and build public responses from field lists ([654cf74](https://github.com/InspectorHub/OpenInspection/commit/654cf749ecbeb3dba3174d2814f95108a8991a8f))

## [0.7.0](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.6.2...field-ui-v0.7.0) (2026-11-02)


### Features

* **field-ui:** show a small spinner on the defect add-photo chip while photos upload ([cac4177](https://github.com/InspectorHub/OpenInspection/commit/cac41772624b4c3a0ea3b1b9132ae34907c247ad))
* **field-ui:** tell the host where a photo came from, and keep add-photo tappable while uploading ([a8f8edb](https://github.com/InspectorHub/OpenInspection/commit/a8f8edb0f4722f570e291297ea4a1fd090c15a13))


### Bug Fixes

* **field-ui:** draw the phone navigation icons as one set of line icons ([9339631](https://github.com/InspectorHub/OpenInspection/commit/93396316b59b9977c3edb5bb06fcdea9a541b908))
* **field-ui:** fix the problems found testing the editor on phones ([bc474e5](https://github.com/InspectorHub/OpenInspection/commit/bc474e5dc1a994128507701761450cba22c4c631))
* **field-ui:** keep the add-photo tile usable while photos are uploading ([7c78339](https://github.com/InspectorHub/OpenInspection/commit/7c78339a599f7752c273821da83a535aa1e0f1ed))
* **field-ui:** keep the photo viewer toolbar clear of the notch and status bar ([24a75b2](https://github.com/InspectorHub/OpenInspection/commit/24a75b2386d289c8f5c40264cf400bbe5de3536f))

## [0.6.2](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.6.1...field-ui-v0.6.2) (2026-10-31)


### Bug Fixes

* **field-ui:** order the pending photos of a batch where every file was kept ([1b8d8cb](https://github.com/InspectorHub/OpenInspection/commit/1b8d8cbdbedc60647ea947aaf58af48bd0dbc90c))
* **field-ui:** order the pending photos of a batch where every file was kept ([b406061](https://github.com/InspectorHub/OpenInspection/commit/b406061cf08e367a25a65255292f083878c4867c))

## [0.6.1](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.6.0...field-ui-v0.6.1) (2026-10-31)


### Bug Fixes

* **field-ui:** keep a photo batch in selection order when the host keeps some files as pending ([10f5ac5](https://github.com/InspectorHub/OpenInspection/commit/10f5ac5b8520fefca7519278c22496325e14386d))
* **field-ui:** keep a photo batch in selection order; neutral wording for the mobile begin hint ([d001c8d](https://github.com/InspectorHub/OpenInspection/commit/d001c8d845a370b6415fcc67c9dca86134e42cc2))

## [0.6.0](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.5.0...field-ui-v0.6.0) (2026-10-31)


### Features

* **field-ui:** add a photo size hint and a header status slot, allow blob: media in the CSP, and close three gaps found in review ([738c995](https://github.com/InspectorHub/OpenInspection/commit/738c9954a43d9d6e2f5fb4a884227512d1cde723))
* **field-ui:** check every image before it is sent or queued, and keep a refused edit from hanging around ([34d1d67](https://github.com/InspectorHub/OpenInspection/commit/34d1d670edd8312d7e49b0b670823a63dd12eb6c))
* **field-ui:** check every image before it is sent, keep refused edits open, and add a photo size hint and a header status slot ([5db8237](https://github.com/InspectorHub/OpenInspection/commit/5db8237662b0a23357d494b8c2d1a4b828c97df0))


### Bug Fixes

* **field-ui:** explain oversized photo upload failures ([e96b9ca](https://github.com/InspectorHub/OpenInspection/commit/e96b9caab44989ada8ab9827473bd89eabcef385))
* **field-ui:** handle permanent photo rejections end to end on the web ([77dc8c0](https://github.com/InspectorHub/OpenInspection/commit/77dc8c022280b5dcf1a2aec546519d5759ea6c56))
* **field-ui:** keep the crop and studio dialogs open when a save is refused, and make a save one cancellable attempt ([075110d](https://github.com/InspectorHub/OpenInspection/commit/075110d6e17805521580d164bb5c683032b251ec))
* **field-ui:** only a coded refusal drops a queued photo, and a throwing host callback no longer wedges the drain ([f6ec706](https://github.com/InspectorHub/OpenInspection/commit/f6ec706ab8d49aa56656c416abb39e68bc3110f7))
* **field-ui:** report rejected photos accurately and keep the added count ([e0ac7d0](https://github.com/InspectorHub/OpenInspection/commit/e0ac7d0a4388291cb43ed8ef7bf6ba6502995863))
* **field-ui:** update fixtures for the new pending-store check, and stop a late presence close from touching state ([7879ab4](https://github.com/InspectorHub/OpenInspection/commit/7879ab43e6c6fc58054e2a1eeffdb0e9d60ad535))

## [0.5.0](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.4.0...field-ui-v0.5.0) (2026-10-28)


### Features

* **field-ui:** fixes found on a phone and tablet, and an optional photo URL subscription ([d9c37c9](https://github.com/InspectorHub/OpenInspection/commit/d9c37c96e6aa6defa1e7b28d204e00a2f27c6e6e))
* **field-ui:** keep item tags across a reload, and name the starter rating systems neutrally ([651ef71](https://github.com/InspectorHub/OpenInspection/commit/651ef713910e69f01cc73e3528ab9c042dcfe22f))
* **field-ui:** phone and tablet fixes, notes kept on switch, safe data colours, offline cleanup after delete, page security headers ([9ec4b3f](https://github.com/InspectorHub/OpenInspection/commit/9ec4b3f8f203e7e98bf9ed7cfc34bac7de9a8176))
* **web:** keep item tags across a reload, confirm completing fieldwork, draw seeded tag colours, and fix narrow-screen layout ([45a432b](https://github.com/InspectorHub/OpenInspection/commit/45a432b333066ac98cb549dcd581784317c6059f))


### Bug Fixes

* **editor:** encode the ids the item-tags relay passes on, and stop offering tags no host can store ([219e997](https://github.com/InspectorHub/OpenInspection/commit/219e997e3bb00cbd9ad9ed4aa5cf4d2e1268aad2))
* **field-ui:** draw the seeded tag colours amber, slate, rose and emerald ([d318066](https://github.com/InspectorHub/OpenInspection/commit/d3180665cb261aafcf8a56669907d5032a188fe5))
* **field-ui:** keep typed notes with their item, and draw only colours that are safe ([d06b228](https://github.com/InspectorHub/OpenInspection/commit/d06b22884e94075ff38d9008caf3634ca24ced87))
* **field-ui:** let a phone reach the tag list, and make the tag chips finger-sized ([6839298](https://github.com/InspectorHub/OpenInspection/commit/683929816322c1fd1a23431beb5459f31315c116))
* **web:** narrow-screen layout, tag pinning, completion feedback and neutral wording ([9681101](https://github.com/InspectorHub/OpenInspection/commit/9681101a0f10a301b81fec04b139784aa331e641))

## [0.4.0](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.3.0...field-ui-v0.4.0) (2026-10-27)


### Features

* **field-ui:** add a read-only mode and fix the desktop header and item navigation ([09f6d5e](https://github.com/InspectorHub/OpenInspection/commit/09f6d5e61e9191e4f37c282b9e26f48f28028c59))
* **field-ui:** read-only mode, phone drawers, header layout and photo fixes ([6ff50bb](https://github.com/InspectorHub/OpenInspection/commit/6ff50bbc85e334d5a80ec969a3c75505e14e125c))


### Bug Fixes

* **field-ui:** escape backslashes in the placeholder test's selector helper ([74ce920](https://github.com/InspectorHub/OpenInspection/commit/74ce92043e8c15e3d0e6bf906b0412e8b048e8f3))
* **field-ui:** give input placeholders a readable colour ([d698526](https://github.com/InspectorHub/OpenInspection/commit/d69852604ec1f9698bfbff84745482d844e4feb5))
* **field-ui:** label the compliance sign-off inputs and clear them after a sign-off ([0eacee4](https://github.com/InspectorHub/OpenInspection/commit/0eacee481d541a7cf5907c55bda2284ac4507d45))
* **field-ui:** make the Sections and Preview drawers usable on a phone ([1db954e](https://github.com/InspectorHub/OpenInspection/commit/1db954ef68ed1b3c94728a0898017168aa9b806e))

## [0.3.0](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.2.1...field-ui-v0.3.0) (2026-10-26)


### Features

* **field-ui:** export the field editor and host helpers, make costExport optional ([9f5514e](https://github.com/InspectorHub/OpenInspection/commit/9f5514e4c9d86eafe7c195d9947169ae74a07c13))
* **field-ui:** let an uploader report a photo kept on the device, and export appendPendingPhoto ([ba7a482](https://github.com/InspectorHub/OpenInspection/commit/ba7a4829c5b96b434abb2122a99e212ff9348031))
* **field-ui:** optional decodeImage host capability for HEIC photos ([8e46835](https://github.com/InspectorHub/OpenInspection/commit/8e46835bbe4fdfa92f82e3359c83e78aa32e0812))


### Bug Fixes

* **field-ui:** keep the rest of an offline photo batch when the host store rejects a file ([d708917](https://github.com/InspectorHub/OpenInspection/commit/d708917fb43f3d9fdcdb8ee19ab7a30d0959583d))
* **field-ui:** say why a compliance sign-off was not recorded ([192da83](https://github.com/InspectorHub/OpenInspection/commit/192da832b1e43bf832ee6a6208eb264f4a7b06f6))
* **native:** behaviour fixes from the contract review ([a3db14b](https://github.com/InspectorHub/OpenInspection/commit/a3db14b8c044d6a7f24707ebe05a5ac6ed3e9700))

## [0.2.1](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.2.0...field-ui-v0.2.1) (2026-10-24)


### Bug Fixes

* **ci:** read the version after the last @ in the publish tag check ([9a1168c](https://github.com/InspectorHub/OpenInspection/commit/9a1168c0cdb3b550b6c891b531dd11826a3a960d))
* **field-ui:** use the normalised git repository url ([abd18c8](https://github.com/InspectorHub/OpenInspection/commit/abd18c8aaad6c4459aecf485fa71a713723fa941))

## [0.2.0](https://github.com/InspectorHub/OpenInspection/compare/field-ui-v0.1.0...field-ui-v0.2.0) (2026-10-24)


### Features

* **field-ui:** complete the phone editor and make the layout hook hydration-safe (9a) ([3f8f80b](https://github.com/InspectorHub/OpenInspection/commit/3f8f80b5905a9325246bca43cd3798dbaf1e4d0e))
* **field-ui:** data-source contract additions, provider and guarded command hook (batch B0c-2) ([44d03c2](https://github.com/InspectorHub/OpenInspection/commit/44d03c2a35e33df1956f9c3039b6288850c448da))
* **field-ui:** extract the field editor into @inspectorhub/field-ui with phone and tablet layouts ([b0e0d33](https://github.com/InspectorHub/OpenInspection/commit/b0e0d331e068c7a29a787d8829d5fe10b044c9fb))
* **field-ui:** extract the shared design tokens into theme.css (Task 10) ([4383b68](https://github.com/InspectorHub/OpenInspection/commit/4383b685938275a41a839610b0809e2f7df6e8f5))
* **field-ui:** hide the entry points of capabilities a host does not provide (Task 8) ([f40bcec](https://github.com/InspectorHub/OpenInspection/commit/f40bcec698b53a7c67b3ec44fbfcf2f1e5fd588e))
* **field-ui:** in-package i18n with a host-bound locale (batch B0b) ([ead7dcc](https://github.com/InspectorHub/OpenInspection/commit/ead7dccbc72ee5aa3aa81c06a8c32f9051874d20))
* **field-ui:** package skeleton, npm workspaces and the import-boundary gate ([65e99cd](https://github.com/InspectorHub/OpenInspection/commit/65e99cd0e07dc06589742234560ec7c81921e3fb))
* **field-ui:** publish pipeline for @inspectorhub/field-ui (Task 11) ([68125d5](https://github.com/InspectorHub/OpenInspection/commit/68125d54c59373f652813fbdfcd748d17ac07647))
* **field-ui:** tablet two-pane editor, speed mode on touch, platform-aware app bar (9b) ([658df2e](https://github.com/InspectorHub/OpenInspection/commit/658df2e1f7a6a8fb501cc025f15ef15d6a734fca))
* **field-ui:** the FieldDataSource contract and an in-memory fake ([8635dec](https://github.com/InspectorHub/OpenInspection/commit/8635decfbca5b1bb31a557eb9d86f6e04d13cca4))


### Bug Fixes

* **deps:** clear the npm audit findings and publish field-ui under the plain AGPL notice ([526dc5e](https://github.com/InspectorHub/OpenInspection/commit/526dc5efd7eafa18fba31c5d9f79ca4d0053c374))
* **field-ui:** fix defects that already existed in the old editor code ([23a6ac6](https://github.com/InspectorHub/OpenInspection/commit/23a6ac64d8a461f14a805a5599a95ec434bbfe4f))
* **field-ui:** focus, identity, layout memory and gate hardening (review follow-ups) ([09e87ae](https://github.com/InspectorHub/OpenInspection/commit/09e87ae447a146ffe23f0e46a338a0c685237181))
* **field-ui:** import siblings relatively inside the package; name the new paths in comments ([50cee0d](https://github.com/InspectorHub/OpenInspection/commit/50cee0d254e7a3fe462d5688fdb3e59bfe2293bd))
* **field-ui:** make the data source contract match what the loader and actions really do ([7b0e116](https://github.com/InspectorHub/OpenInspection/commit/7b0e116ac11c743d4fde5b15cf1000293cb201fe))
* **field-ui:** review fixes before the upstream PR (idempotency, rotation, touch targets, publish pipeline) ([388197c](https://github.com/InspectorHub/OpenInspection/commit/388197cfe9c731185e354443b0b12f0958c32f83))
