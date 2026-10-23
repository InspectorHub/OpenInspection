import { useFieldDataSource } from '../context';
import { m } from '../i18n';

export interface HostActions {
  /**
   * Opens an address outside the editor (the report preview), or null when the host cannot. A null opener
   * means the preview entry points are left out: an entry that only warns when pressed is a dead control.
   */
  openPreview: ((url: string) => void) | null;
  /**
   * The address of the web report preview, or null without a tenant link. Entry points need both this and
   * `openPreview`.
   */
  previewReportUrl: string | null;
  /**
   * The template schema is frozen at mount, so a template change needs a fresh mount, not a data refresh. A host
   * that cannot restart says so afterwards (this runs after the change was saved, so it is not an entry point).
   */
  restartAfterTemplate: () => void;
}

export function useHostActions(inspectionId: string): HostActions {
  const dataSource = useFieldDataSource();
  const { tenantSlug } = dataSource.session();
  const { openUrl } = dataSource;
  return {
    openPreview: openUrl ? (url) => openUrl.call(dataSource, url) : null,
    previewReportUrl: tenantSlug ? dataSource.urls.reportPreview(tenantSlug, inspectionId) : null,
    restartAfterTemplate: () => {
      if (dataSource.restartSession) dataSource.restartSession();
      else dataSource.notify(m.editor_template_applied_reopen(), 'warning');
    },
  };
}
