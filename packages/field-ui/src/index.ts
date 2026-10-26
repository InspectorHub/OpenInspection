export type {
  AutofillReason,
  BulkCreateUnitsBody,
  CollabConnector,
  CommandData,
  CommandDataMap,
  CommandKey,
  CommandResult,
  ComplianceCommand,
  EditorData,
  FieldCommand,
  ExecuteOptions,
  FieldDataSource,
  FieldHostSlots,
  FieldResources,
  FieldUrls,
  MediaFileResult,
  MediaUploader,
  NotifyOptions,
  NotifyVariant,
  PendingMediaRecord,
  PendingMediaStore,
  PhotoAnnotateMeta,
  PhotoCropMeta,
  PhotoUploadMeta,
  ResultsDocHandle,
  SaveStructureTemplateCommand,
  SessionInfo,
  UnitCommand,
} from './data-source';
export type {
  AiAssistInput,
  AiAssistResult,
  AutoAdvanceMode,
  CommercialPresets,
  CommentsLibraryEntry,
  CommentsLibraryQuery,
  CommentsLibraryRow,
  CompliancePanelData,
  CostItemsListing,
  CostItemView,
  CostItemWrite,
  DefectCategory,
  DocumentReviewItemView,
  EditorInspection,
  InspectionPrefs,
  InspectionUnit,
  MediaPoolListing,
  OutboundCoolingWindow,
  PcaNarrative,
  PcaNarrativeData,
  PhotoCropTransform,
  PropertyMetaField,
  PsqView,
  RatingLevel,
  RelianceText,
  RepairItemOption,
  ReportLinkTtl,
  ReportSignoffView,
  ResultMap,
  RevisionStatus,
  SchemaItem,
  SchemaSection,
  SettingsSheetData,
  StatutoryCoverage,
  StatutoryDetails,
  TagLibraryEntry,
  TemplateItemBody,
  TemplateSchema,
  TemplateSearchResult,
  TemplateSnapshot,
  TemplateSummary,
  UnitProgress,
  VersionSnapshotContent,
  VersionSnapshotEntry,
  VideoFinalizeInput,
  VideoUploadRef,
  VideoUploadTicket,
} from './data-source-types';
export { FieldDataSourceProvider, isIgnored, useFieldCommand, useFieldDataSource, useFieldEnsureHuman, useFieldSlots } from './context';
export type { FieldCommandRunner, FieldDataSourceProviderProps, FieldRunResult, IgnoredRun } from './context';
export type { DateFormat, TimeFormat } from './shared/display-prefs';
// The editor page component. Render it inside a FieldDataSourceProvider; `data` must follow the host's revalidation.
export { FieldEditor } from './editor/FieldEditor';
// Pure logic a host needs to stay in step with the editor. `findingKey` is the shared one (the server uses it
// too), not the narrower copy under hooks/findings.
export { findingKey, findingsForUnit, isMetaKey } from './shared/finding-key';
export { appendPendingPhoto, resolvePendingPhoto } from './collab/results-binding';
export { resolvePcaNarrative } from './shared/pca-narrative';
export { RELIANCE_TEMPLATES } from './shared/pca-reliance-text';
export { METADATA_PRESETS } from './shared/commercial-subtypes';
export { DEFAULT_INSPECTION_PREFS } from './hooks/useInspectionPrefs';
// The overlay stack lives in @core/shared-ui, which this package bundles. A host asks THIS copy whether an
// open dialog will consume the back key, because only it sees the layers the editor opened.
export { hasOpenLayer, escapeWillBeHandled } from '@core/shared-ui';
export type { GalleryPhoto } from './shared/inspection-media';
export type { CoverPhotoOption, ReportProfileOption } from './resource-types';
export type { PublishBlockingDefect, PublishReadiness } from './shared/types';
// The host keeps the package's locale in step with its own; see ./i18n.
export { bindFieldLocaleSource, setFieldLocale } from './i18n';
