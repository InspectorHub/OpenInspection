/**
 * The client portal receives a message as a field list, not as the row (server/lib/response-projection.ts).
 *
 * The row also holds the company id, the thread's contact id, the sending user's id and, for each attachment, the storage key
 * (which begins with the company id). The portal reads none of them: an attachment is fetched by its id through the message
 * attachment route, and the thread is the caller's own.
 */
import type { inspectionMessages } from './db/schema';
import { projectFields } from './response-projection';

type MessageRow = typeof inspectionMessages.$inferSelect;

const MESSAGE_FIELDS = ['id', 'fromRole', 'fromName', 'body', 'readAt', 'createdAt'] as const;
const ATTACHMENT_FIELDS = ['id', 'name', 'size', 'type', 'uploadedAt'] as const;

export function projectClientMessage(row: MessageRow) {
    return { ...projectFields(row, MESSAGE_FIELDS), attachments: (row.attachments ?? []).map((attachment) => projectFields(attachment, ATTACHMENT_FIELDS)) };
}

/** The field lists, for the spec that holds them to the schema. */
export const CLIENT_MESSAGE_FIELD_LISTS = { message: MESSAGE_FIELDS, attachment: ATTACHMENT_FIELDS } as const;
