/**
 * A notice as the client portal inbox receives it: a field list, not the row (server/lib/response-projection.ts).
 *
 * The row also names the company (the portal is one company, and its slug is in the address) and the contact the notice is
 * addressed to, and carries the sending company's display name that only the agent inbox, which spans companies, renders.
 * The portal list reads none of those, so they are not carried.
 */
import type { NoticeRow } from '../services/notice-inbox';
import { projectFields } from './response-projection';

const PORTAL_NOTICE_FIELDS = ['id', 'type', 'title', 'body', 'inspectionId', 'createdAt', 'readAt', 'channels'] as const;

export const projectPortalNotice = (row: NoticeRow): Pick<NoticeRow, (typeof PORTAL_NOTICE_FIELDS)[number]> => projectFields(row, PORTAL_NOTICE_FIELDS);

/** The field list, for the spec that holds it to the shared row. */
export const PORTAL_NOTICE_VIEW_FIELDS = PORTAL_NOTICE_FIELDS;
