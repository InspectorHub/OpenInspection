import { describe, expect, it } from 'vitest';
import type { NoticeRow } from '../../../server/services/notice-inbox';
import { PORTAL_NOTICE_VIEW_FIELDS, projectPortalNotice } from '../../../server/lib/notice-portal-view';

const ROW: NoticeRow = {
    id: 'n1', tenantId: 't1', type: 'report.published', title: 'Your report is ready', body: null, inspectionId: 'i1', createdAt: 1, readAt: null,
    contactId: 'c1', companyName: 'Acme Inspections',
    channels: [{ channel: 'email', status: 'sent', reasonCode: null, recipient: 'reader@example.test', deliveredAt: 2, sendAt: 1 }],
};

describe('a notice in the client portal inbox', () => {
    it('carries the fields the list reads, with its delivery attempts, and not the company or the contact it is addressed to', () => {
        const view = projectPortalNotice(ROW);
        expect(Object.keys(view).sort()).toEqual([...PORTAL_NOTICE_VIEW_FIELDS].sort());
        for (const key of ['tenantId', 'contactId', 'companyName']) expect(view).not.toHaveProperty(key);
        expect(view.channels).toEqual(ROW.channels);
        // Control: the row did hold them.
        expect(ROW).toMatchObject({ tenantId: 't1', contactId: 'c1', companyName: 'Acme Inspections' });
    });
});
