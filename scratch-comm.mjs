import Database from 'better-sqlite3';
const db = new Database('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248.sqlite');
const T = '00000000-0000-0000-0000-000000000000';
const INSP = 'a0f2eced-1f00-4f73-b855-8b20cd2b0a06';
const now = Date.now();

// role profiles present?
const crp = db.prepare("select id, key, kind from contact_role_profiles where tenant_id = ?").all(T);
console.log('profiles:', crp.map(r => r.key).join(','));
const clientProfile = crp.find(r => r.key === 'client');
const coProfile = crp.find(r => r.key === 'co_client');
const agentProfile = crp.find(r => r.key === 'buyer_agent');

const ins = (sql, ...args) => db.prepare(sql).run(...args);
// contacts
ins("insert or replace into contacts (id, tenant_id, type, name, email, phone, created_at) values ('ct-dana', ?, 'client', 'Dana Client', 'dana@example.com', '+15550001111', ?)", T, now);
ins("insert or replace into contacts (id, tenant_id, type, name, email, phone, created_at) values ('ct-joe', ?, 'client', 'Joe Spouse', 'joe@example.com', null, ?)", T, now);
ins("insert or replace into contacts (id, tenant_id, type, name, email, phone, created_at) values ('ct-amy', ?, 'agent', 'Amy Agent', 'amy@realty.com', '+15550002222', ?)", T, now);
// seats
ins("insert or replace into inspection_people (id, tenant_id, inspection_id, contact_id, role_profile_id, created_at) values ('ip-1', ?, ?, 'ct-dana', ?, ?)", T, INSP, clientProfile.id, now);
if (coProfile) ins("insert or replace into inspection_people (id, tenant_id, inspection_id, contact_id, role_profile_id, created_at) values ('ip-2', ?, ?, 'ct-joe', ?, ?)", T, INSP, coProfile.id, now);
if (agentProfile) ins("insert or replace into inspection_people (id, tenant_id, inspection_id, contact_id, role_profile_id, created_at) values ('ip-3', ?, ?, 'ct-amy', ?, ?)", T, INSP, agentProfile.id, now);
// messages: a small conversation across two days + a co-client thread
const H = 3600_000;
const rows = [
  ['msg-1', 'ct-dana', 'client', 'Dana Client', 'Hi — is the roof issue you flagged urgent, or can it wait until spring?', now - 30*H, null],
  ['msg-2', 'ct-dana', 'inspector', 'Automation Test Admin', 'Good question — the flashing should be resealed before the rainy season, but it is not an emergency.', now - 29*H, null],
  ['msg-3', 'ct-dana', 'client', 'Dana Client', 'Great, thank you! One more: was the water heater age readable?', now - 2*H, null],
  ['msg-4', 'ct-joe', 'client', 'Joe Spouse', 'Adding to what Dana asked — do you have a contractor you recommend for the roof?', now - 1*H, null],
];
for (const [id, cid, role, name, body, ts, read] of rows) {
  ins("insert or replace into inspection_messages (id, tenant_id, inspection_id, contact_id, from_role, from_user_id, from_name, body, attachments, read_at, created_at) values (?,?,?,?,?,null,?,?,null,?,?)", id, T, INSP, cid, role, name, body, read, ts);
}
// automation + logs: one firing, 3 recipients × email + sms with a consent skip
ins("insert or replace into automations (id, tenant_id, name, trigger, is_active, created_at) values ('auto-report', ?, 'Report ready', 'report.published', 1, ?)", T, now);
const fire = now - 5*H;
const logs = [
  ['log-1', 'email', 'dana@example.com', 'client', 'ct-dana', 'sent', null],
  ['log-2', 'email', 'joe@example.com', 'co_client', 'ct-joe', 'sent', null],
  ['log-3', 'email', 'amy@realty.com', 'buyer_agent', 'ct-amy', 'sent', null],
  ['log-4', 'sms', '+15550001111', 'client', 'ct-dana', 'sent', null],
  ['log-5', 'sms', '+15550002222', 'buyer_agent', 'ct-amy', 'skipped', 'no sms consent'],
];
for (const [id, ch, rcpt, role, cid, status, err] of logs) {
  ins("insert or replace into automation_logs (id, tenant_id, automation_id, inspection_id, recipient, recipient_role_key, channel, send_at, delivered_at, status, error, event_id, recipient_contact_id) values (?,?,?,?,?,?,?,?,?,?,?,null,?)",
    id, T, 'auto-report', INSP, rcpt, role, ch, fire, status === 'sent' ? fire + 60000 : null, status, err, cid);
}
console.log('seeded messages:', db.prepare('select count(*) c from inspection_messages').get().c, 'logs:', db.prepare('select count(*) c from automation_logs where inspection_id = ?').get(INSP).c);
