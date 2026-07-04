import { describe, it, expect } from 'vitest';
import {
  CreateMessageTemplateSchema, UpdateMessageTemplateSchema,
  PreviewMessageTemplateSchema, TestSendMessageTemplateSchema,
} from '../../../server/lib/validations/message-template.schema';

describe('message-template zod schemas', () => {
  it('CreateMessageTemplateSchema rejects an unknown channel', () => {
    expect(CreateMessageTemplateSchema.safeParse({ name: 'X', channel: 'fax', body: 'b' }).success).toBe(false);
  });
  it('CreateMessageTemplateSchema accepts a valid email template', () => {
    const r = CreateMessageTemplateSchema.safeParse({ name: 'X', channel: 'email', subject: 'S', body: '<p>b</p>', variables: ['client_name'] });
    expect(r.success).toBe(true);
  });
  it('CreateMessageTemplateSchema does NOT accept a tenantId from the body', () => {
    const r = CreateMessageTemplateSchema.safeParse({ name: 'X', channel: 'sms', body: 'b', tenantId: 'evil' });
    expect(r.success).toBe(true);
    expect((r as any).data.tenantId).toBeUndefined(); // stripped, never trusted
  });
  it('UpdateMessageTemplateSchema allows partial', () => {
    expect(UpdateMessageTemplateSchema.safeParse({ body: 'new' }).success).toBe(true);
  });
  it('PreviewMessageTemplateSchema requires channel + body', () => {
    expect(PreviewMessageTemplateSchema.safeParse({ channel: 'sms', body: 'hi' }).success).toBe(true);
    expect(PreviewMessageTemplateSchema.safeParse({ channel: 'sms' }).success).toBe(false);
  });
  it('TestSendMessageTemplateSchema requires a recipient', () => {
    expect(TestSendMessageTemplateSchema.safeParse({ channel: 'email', subject: 'S', body: 'b', to: 'a@b.com' }).success).toBe(true);
    expect(TestSendMessageTemplateSchema.safeParse({ channel: 'email', body: 'b' }).success).toBe(false);
  });
});
