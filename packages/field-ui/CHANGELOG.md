# Changelog

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
