# Changelog

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
