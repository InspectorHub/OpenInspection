#!/usr/bin/env node
/**
 * Seeds 120 pre-written inspection comments into the comments table.
 * Run: npm run seed:comments
 * Idempotent: skips if comments already exist for this tenant.
 */
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TENANT_ID = process.env.TENANT_ID || 'standalone';
const DB_NAME = process.env.DB_NAME || 'DB';
const LOCAL = process.argv.includes('--local');

const flag = LOCAL ? '--local' : '--remote';

const COMMENTS = [
  // ROOF — 18 total (5 sat, 6 mon, 7 def)
  { category: 'Roof', severity: 'satisfactory', text: 'Roof covering appears serviceable with no visible defects at time of inspection.' },
  { category: 'Roof', severity: 'satisfactory', text: 'Gutters and downspouts are properly secured and free of significant debris.' },
  { category: 'Roof', severity: 'satisfactory', text: 'Roof ventilation appears adequate; soffit and ridge vents observed.' },
  { category: 'Roof', severity: 'satisfactory', text: 'Flashing at chimney and roof penetrations appears properly installed and sealed.' },
  { category: 'Roof', severity: 'satisfactory', text: 'No active leaks or moisture intrusion detected at roof surface.' },
  { category: 'Roof', severity: 'monitor', text: 'Roof covering shows signs of age and granule loss; monitor and plan for replacement within 3–5 years.' },
  { category: 'Roof', severity: 'monitor', text: 'Minor moss or algae growth observed; recommend treatment to prevent moisture retention.' },
  { category: 'Roof', severity: 'monitor', text: 'One or more shingles show curling or cupping at edges; monitor for further deterioration.' },
  { category: 'Roof', severity: 'monitor', text: 'Gutters exhibit minor rust or separation at seams; monitor and seal as needed.' },
  { category: 'Roof', severity: 'monitor', text: 'Flashing shows minor surface rust; monitor and apply sealant when accessible.' },
  { category: 'Roof', severity: 'monitor', text: 'Downspout discharge terminates near foundation; recommend extending to divert water away from structure.' },
  { category: 'Roof', severity: 'defect', text: 'Active leak staining at roof ridge — recommend evaluation and repair by licensed roofer immediately.' },
  { category: 'Roof', severity: 'defect', text: 'Multiple missing or damaged shingles observed — recommend prompt repair by licensed roofer to prevent water intrusion.' },
  { category: 'Roof', severity: 'defect', text: 'Flashing at chimney is open or improperly sealed, allowing potential water entry — recommend repair by licensed roofer.' },
  { category: 'Roof', severity: 'defect', text: 'Roof decking exhibits visible sagging or soft spots, indicating potential structural compromise — recommend evaluation by licensed structural engineer.' },
  { category: 'Roof', severity: 'defect', text: 'Significant debris accumulation in gutters causing overflow; recommend cleaning and repair to prevent fascia rot.' },
  { category: 'Roof', severity: 'defect', text: 'Downspout disconnected or missing — recommend immediate repair to prevent foundation water intrusion.' },
  { category: 'Roof', severity: 'defect', text: 'Visible daylight at roof-to-wall junction indicates open gap — recommend sealing by licensed roofer.' },

  // ELECTRICAL — 18 total (5 sat, 6 mon, 7 def)
  { category: 'Electrical', severity: 'satisfactory', text: 'Electrical panel is properly labeled, accessible, and shows no visible signs of overheating or corrosion.' },
  { category: 'Electrical', severity: 'satisfactory', text: 'GFCI protection is present and functional at all required locations tested.' },
  { category: 'Electrical', severity: 'satisfactory', text: 'Visible wiring is properly secured and appears in serviceable condition.' },
  { category: 'Electrical', severity: 'satisfactory', text: 'All tested outlets are properly grounded and functional.' },
  { category: 'Electrical', severity: 'satisfactory', text: 'Smoke detectors present and functional in required locations.' },
  { category: 'Electrical', severity: 'monitor', text: 'Panel contains double-tapped breakers (two wires on one breaker); recommend evaluation by licensed electrician.' },
  { category: 'Electrical', severity: 'monitor', text: 'Some outlets in older areas of home are two-prong ungrounded; consider upgrading to three-prong GFCI outlets.' },
  { category: 'Electrical', severity: 'monitor', text: 'Panel capacity is at or near full; recommend evaluation before adding new circuits.' },
  { category: 'Electrical', severity: 'monitor', text: 'Junction boxes observed without covers; recommend securing covers to all junction boxes.' },
  { category: 'Electrical', severity: 'monitor', text: 'Exterior outlets lack in-use covers; recommend installation of weatherproof in-use covers.' },
  { category: 'Electrical', severity: 'monitor', text: 'Smoke detectors are older than 10 years; recommend replacement per manufacturer guidelines.' },
  { category: 'Electrical', severity: 'defect', text: 'Exposed wiring observed at electrical panel — recommend immediate evaluation and repair by licensed electrician.' },
  { category: 'Electrical', severity: 'defect', text: 'Double-tapped main breaker observed — a fire and shock hazard; recommend repair by licensed electrician.' },
  { category: 'Electrical', severity: 'defect', text: 'GFCI outlet(s) failed to trip during testing — recommend replacement by licensed electrician.' },
  { category: 'Electrical', severity: 'defect', text: 'Reversed polarity at multiple outlets; recommend correction by licensed electrician.' },
  { category: 'Electrical', severity: 'defect', text: 'Aluminum wiring observed throughout home; recommend evaluation by licensed electrician for proper connections and arc fault protection.' },
  { category: 'Electrical', severity: 'defect', text: 'Evidence of amateur or unpermitted wiring; recommend evaluation by licensed electrician before purchase.' },
  { category: 'Electrical', severity: 'defect', text: 'Carbon monoxide detector absent; recommend installation on each level and outside sleeping areas per code.' },

  // PLUMBING — 18 total (5 sat, 6 mon, 7 def)
  { category: 'Plumbing', severity: 'satisfactory', text: 'Water supply pressure tested within acceptable range (40–80 psi) at time of inspection.' },
  { category: 'Plumbing', severity: 'satisfactory', text: 'No active leaks observed at visible supply or drain lines.' },
  { category: 'Plumbing', severity: 'satisfactory', text: 'Water heater is properly installed with temperature-pressure relief valve and discharge pipe in place.' },
  { category: 'Plumbing', severity: 'satisfactory', text: 'All fixtures drain properly with no signs of slow drainage or backflow.' },
  { category: 'Plumbing', severity: 'satisfactory', text: 'Accessible shut-off valves are operable.' },
  { category: 'Plumbing', severity: 'monitor', text: 'Water heater is approaching end of expected service life (typically 8–12 years); plan for replacement.' },
  { category: 'Plumbing', severity: 'monitor', text: 'Minor drip observed at faucet; recommend repair to conserve water and prevent fixture damage.' },
  { category: 'Plumbing', severity: 'monitor', text: 'Drain pipes show minor corrosion; monitor and replace as needed.' },
  { category: 'Plumbing', severity: 'monitor', text: 'Low water pressure at one or more fixtures; recommend evaluation to determine cause.' },
  { category: 'Plumbing', severity: 'monitor', text: 'Evidence of past repair at drain line; monitor for leaks.' },
  { category: 'Plumbing', severity: 'monitor', text: 'Toilet runs intermittently; recommend replacement of internal tank components.' },
  { category: 'Plumbing', severity: 'defect', text: 'Active leak at water supply line — recommend immediate repair by licensed plumber to prevent property damage.' },
  { category: 'Plumbing', severity: 'defect', text: 'Significant rust and corrosion at water heater — recommend replacement by licensed plumber.' },
  { category: 'Plumbing', severity: 'defect', text: 'Water heater lacks temperature-pressure relief valve discharge pipe — a safety hazard; recommend repair by licensed plumber.' },
  { category: 'Plumbing', severity: 'defect', text: 'Sewage odor detected inside home; recommend evaluation by licensed plumber for potential trap or sewer gas issue.' },
  { category: 'Plumbing', severity: 'defect', text: 'Supply lines are polybutylene (PB) pipe; known for premature failure — recommend evaluation and replacement by licensed plumber.' },
  { category: 'Plumbing', severity: 'defect', text: 'Drain line shows significant blockage or back-pitch; recommend clearing and repair by licensed plumber.' },
  { category: 'Plumbing', severity: 'defect', text: 'Water heater is installed in a non-compliant location (e.g., bedroom closet without proper enclosure); recommend evaluation by licensed plumber.' },

  // HVAC — 16 total (5 sat, 5 mon, 6 def)
  { category: 'HVAC', severity: 'satisfactory', text: 'Heating and cooling system operational and responding to thermostat at time of inspection.' },
  { category: 'HVAC', severity: 'satisfactory', text: 'Air filter is clean and properly installed.' },
  { category: 'HVAC', severity: 'satisfactory', text: 'Visible ductwork appears properly secured and insulated.' },
  { category: 'HVAC', severity: 'satisfactory', text: 'Condensate drain is clear and functional.' },
  { category: 'HVAC', severity: 'satisfactory', text: 'Exterior condenser unit is level, properly cleared of vegetation, and shows no obvious damage.' },
  { category: 'HVAC', severity: 'monitor', text: 'HVAC system is approaching end of typical service life (furnace 15–20 yr, AC 10–15 yr); plan for replacement.' },
  { category: 'HVAC', severity: 'monitor', text: 'Air filter is dirty; recommend replacement and scheduling regular maintenance.' },
  { category: 'HVAC', severity: 'monitor', text: 'Minor rust observed at furnace heat exchanger exterior; recommend professional evaluation at next service.' },
  { category: 'HVAC', severity: 'monitor', text: 'Condenser coils show debris accumulation; recommend professional cleaning to maintain efficiency.' },
  { category: 'HVAC', severity: 'monitor', text: 'Thermostat is an older model; consider upgrading to programmable or smart thermostat for efficiency.' },
  { category: 'HVAC', severity: 'defect', text: 'HVAC system failed to operate during inspection — recommend evaluation and repair by licensed HVAC technician.' },
  { category: 'HVAC', severity: 'defect', text: 'Cracked heat exchanger suspected based on visible rust and odor; a safety hazard — recommend evaluation by licensed HVAC technician before use.' },
  { category: 'HVAC', severity: 'defect', text: 'Condensate drain is clogged or overflowing — recommend clearing by licensed HVAC technician to prevent water damage.' },
  { category: 'HVAC', severity: 'defect', text: 'Refrigerant lines show ice buildup, indicating low refrigerant or airflow issue — recommend evaluation by licensed HVAC technician.' },
  { category: 'HVAC', severity: 'defect', text: 'Ductwork shows significant disconnection or air leakage; recommend repair by licensed HVAC technician.' },
  { category: 'HVAC', severity: 'defect', text: 'Carbon monoxide levels elevated near furnace — recommend immediate evaluation by licensed HVAC technician; do not operate system until cleared.' },

  // INTERIOR — 14 total (4 sat, 5 mon, 5 def)
  { category: 'Interior', severity: 'satisfactory', text: 'Ceilings, walls, and floors appear in serviceable condition with no significant defects observed.' },
  { category: 'Interior', severity: 'satisfactory', text: 'Windows and doors operate properly and latch securely.' },
  { category: 'Interior', severity: 'satisfactory', text: 'Stairway handrails are properly secured and meet height requirements.' },
  { category: 'Interior', severity: 'satisfactory', text: 'No evidence of moisture intrusion or active leaks at interior surfaces.' },
  { category: 'Interior', severity: 'monitor', text: 'Minor hairline cracks at drywall corners; typical of settling — monitor for widening.' },
  { category: 'Interior', severity: 'monitor', text: 'One or more windows are difficult to open or fail to stay open; recommend repair.' },
  { category: 'Interior', severity: 'monitor', text: 'Interior doors do not latch properly; recommend adjustment.' },
  { category: 'Interior', severity: 'monitor', text: 'Minor floor squeaking noted; cosmetic and common in older construction.' },
  { category: 'Interior', severity: 'monitor', text: 'Bathroom exhaust fan is noisy or underperforming; recommend replacement to prevent moisture buildup.' },
  { category: 'Interior', severity: 'defect', text: 'Significant staining on ceiling consistent with past or active roof or plumbing leak — recommend evaluation to determine source and repair.' },
  { category: 'Interior', severity: 'defect', text: 'Visible mold or mildew at bathroom walls; recommend remediation and correction of moisture source.' },
  { category: 'Interior', severity: 'defect', text: 'Stairway handrail is loose or absent — a safety hazard; recommend securing or installation.' },
  { category: 'Interior', severity: 'defect', text: 'Window fails to lock or seal properly; recommend repair or replacement for security and energy efficiency.' },
  { category: 'Interior', severity: 'defect', text: 'Evidence of pest damage (termites, rodents) at interior surfaces; recommend evaluation by licensed pest control professional.' },

  // EXTERIOR — 14 total (4 sat, 5 mon, 5 def)
  { category: 'Exterior', severity: 'satisfactory', text: 'Exterior siding appears in serviceable condition with no significant gaps or damage.' },
  { category: 'Exterior', severity: 'satisfactory', text: 'Grading slopes away from foundation, reducing risk of water intrusion.' },
  { category: 'Exterior', severity: 'satisfactory', text: 'Exterior doors seal properly and all hardware is functional.' },
  { category: 'Exterior', severity: 'satisfactory', text: 'Driveway and walkways are in serviceable condition with minor surface cracking only.' },
  { category: 'Exterior', severity: 'monitor', text: 'Caulking at window and door frames is cracking or missing in areas; recommend re-caulking to prevent moisture infiltration.' },
  { category: 'Exterior', severity: 'monitor', text: 'Wood trim shows minor paint peeling or weathering; recommend repainting to protect against rot.' },
  { category: 'Exterior', severity: 'monitor', text: 'Grading is relatively flat near foundation; recommend improving slope to direct water away.' },
  { category: 'Exterior', severity: 'monitor', text: 'Deck or porch boards show surface weathering; recommend cleaning, sealing, or painting.' },
  { category: 'Exterior', severity: 'monitor', text: 'Driveway shows moderate cracking; monitor and seal to prevent further deterioration.' },
  { category: 'Exterior', severity: 'defect', text: 'Siding has significant gaps or damage allowing water and pest entry — recommend repair by qualified contractor.' },
  { category: 'Exterior', severity: 'defect', text: 'Negative grading directs water toward foundation — recommend regrading to prevent basement or crawlspace moisture intrusion.' },
  { category: 'Exterior', severity: 'defect', text: 'Deck ledger is improperly attached or missing flashing — a structural and water intrusion concern; recommend evaluation by licensed contractor.' },
  { category: 'Exterior', severity: 'defect', text: 'Significant rot observed at wood trim or structural members — recommend repair by licensed contractor.' },
  { category: 'Exterior', severity: 'defect', text: 'Foundation crack wider than 1/4 inch observed — recommend evaluation by licensed structural engineer.' },

  // KITCHEN — 11 total (3 sat, 4 mon, 4 def)
  { category: 'Kitchen', severity: 'satisfactory', text: 'Kitchen appliances operated as intended at time of inspection.' },
  { category: 'Kitchen', severity: 'satisfactory', text: 'Exhaust fan operates and vents to exterior.' },
  { category: 'Kitchen', severity: 'satisfactory', text: 'Sink drains properly; no leaks observed at supply or drain connections.' },
  { category: 'Kitchen', severity: 'monitor', text: 'Dishwasher shows minor water staining at base; monitor for active leak.' },
  { category: 'Kitchen', severity: 'monitor', text: 'Exhaust fan does not vent to exterior; recirculating type noted — recommend upgrade if code requires exterior venting.' },
  { category: 'Kitchen', severity: 'monitor', text: 'Refrigerator ice maker supply line is plastic; recommend upgrade to braided stainless supply line to reduce leak risk.' },
  { category: 'Kitchen', severity: 'monitor', text: 'Cabinet hardware is loose or missing; recommend tightening or replacement.' },
  { category: 'Kitchen', severity: 'defect', text: 'Active leak observed under kitchen sink — recommend repair by licensed plumber.' },
  { category: 'Kitchen', severity: 'defect', text: 'Range hood does not operate; recommend repair or replacement.' },
  { category: 'Kitchen', severity: 'defect', text: 'Dishwasher drain hose lacks high-loop or air gap, risking contamination — recommend correction by licensed plumber.' },
  { category: 'Kitchen', severity: 'defect', text: 'Evidence of water damage or mold inside cabinets below sink — recommend repair and mold remediation.' },

  // GARAGE — 11 total (3 sat, 4 mon, 4 def)
  { category: 'Garage', severity: 'satisfactory', text: 'Garage door opener operates properly; auto-reverse safety feature functional.' },
  { category: 'Garage', severity: 'satisfactory', text: 'Fire-rated door between garage and living space self-closes and latches properly.' },
  { category: 'Garage', severity: 'satisfactory', text: 'Garage floor is in serviceable condition with minor surface cracking only.' },
  { category: 'Garage', severity: 'monitor', text: 'Garage door weatherstripping is worn; recommend replacement to improve energy efficiency and pest exclusion.' },
  { category: 'Garage', severity: 'monitor', text: 'Garage door springs show signs of wear; recommend evaluation by garage door professional.' },
  { category: 'Garage', severity: 'monitor', text: 'Concrete floor exhibits moderate cracking; monitor and seal to prevent further deterioration.' },
  { category: 'Garage', severity: 'monitor', text: 'Garage is not drywalled or has incomplete drywall; consider completing for fire separation per code.' },
  { category: 'Garage', severity: 'defect', text: 'Garage door auto-reverse safety feature failed to activate — a safety hazard; recommend repair by garage door professional immediately.' },
  { category: 'Garage', severity: 'defect', text: 'Fire-rated door between garage and living space does not self-close or latch — a fire hazard; recommend repair.' },
  { category: 'Garage', severity: 'defect', text: 'Carbon monoxide detector absent in attached garage area; recommend installation per code.' },
  { category: 'Garage', severity: 'defect', text: 'Vehicle exhaust system or fuel storage observed in garage creates fire or CO hazard — recommend proper ventilation and storage practices.' },
];

// Check existing count
const countResult = execSync(
  `npx wrangler d1 execute ${DB_NAME} ${flag} --json --command "SELECT COUNT(*) as c FROM comments WHERE tenant_id = '${TENANT_ID}'"`,
  { encoding: 'utf8' }
);
let count = 0;
try {
  const jsonStart = countResult.indexOf('[');
  if (jsonStart >= 0) {
    count = JSON.parse(countResult.slice(jsonStart))?.[0]?.results?.[0]?.c ?? 0;
  }
} catch { /* fallback to 0 — seed will proceed */ }

if (count >= COMMENTS.length) {
  console.log(`Seed skipped: ${count} comments already exist for tenant '${TENANT_ID}'.`);
  process.exit(0);
}

const values = COMMENTS.map(c => {
  const id = randomUUID();
  return `('${id}', '${TENANT_ID}', '${c.category}', '${c.text.replace(/'/g, "''")}', '${c.severity}', ${Date.now()})`;
}).join(',\n');

const sql = `INSERT INTO comments (id, tenant_id, category, text, severity, created_at) VALUES\n${values};`;

const tmpDir = join(tmpdir(), 'oi-seed-comments');
mkdirSync(tmpDir, { recursive: true });
const sqlFile = join(tmpDir, 'comments.sql');
writeFileSync(sqlFile, sql, 'utf8');

try {
  execSync(
    `npx wrangler d1 execute ${DB_NAME} ${flag} --file "${sqlFile}"`,
    { encoding: 'utf8', stdio: 'inherit' }
  );
} finally {
  try { unlinkSync(sqlFile); } catch { /* ignore */ }
}

console.log(`Seeded ${COMMENTS.length} comments for tenant '${TENANT_ID}'.`);
