#!/usr/bin/env node
/**
 * Seeds 250 pre-written inspection comments into the comments table.
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

  // BATHROOM — 26 total (8 sat, 9 mon, 9 def)
  { category: 'Bathroom', severity: 'satisfactory', text: 'Tub and shower surrounds appear watertight with intact tile and sealed grout joints.' },
  { category: 'Bathroom', severity: 'satisfactory', text: 'Caulking at tub, shower, and vanity perimeters is continuous and free of mildew.' },
  { category: 'Bathroom', severity: 'satisfactory', text: 'All bathroom drains flow freely with no signs of slow drainage at time of inspection.' },
  { category: 'Bathroom', severity: 'satisfactory', text: 'Hot and cold faucet flow is adequate at all bathroom fixtures tested.' },
  { category: 'Bathroom', severity: 'satisfactory', text: 'GFCI protection is present and functional at all bathroom vanity receptacles tested.' },
  { category: 'Bathroom', severity: 'satisfactory', text: 'Bathroom exhaust fans operate and discharge to the building exterior.' },
  { category: 'Bathroom', severity: 'satisfactory', text: 'Toilets are securely mounted with no rocking and no visible leakage at the base.' },
  { category: 'Bathroom', severity: 'satisfactory', text: 'Tub and shower fixtures are stable, with no movement of valves or spouts during operation.' },
  { category: 'Bathroom', severity: 'monitor', text: 'Caulking at tub-to-tile joints shows minor cracking; recommend re-caulking to prevent moisture intrusion behind the surround.' },
  { category: 'Bathroom', severity: 'monitor', text: 'Grout joints in tile shower exhibit minor staining and porosity; recommend cleaning and resealing.' },
  { category: 'Bathroom', severity: 'monitor', text: 'Bathroom exhaust fan is noisy and shows reduced airflow; plan for replacement to maintain humidity control.' },
  { category: 'Bathroom', severity: 'monitor', text: 'One or more bathroom faucets exhibit reduced flow consistent with aerator buildup; recommend cleaning.' },
  { category: 'Bathroom', severity: 'monitor', text: 'Vanity supply shut-off valves are stiff or seeping; monitor and plan for replacement at next service.' },
  { category: 'Bathroom', severity: 'monitor', text: 'Tile floor shows minor surface cracking near tub apron; monitor for movement and water intrusion.' },
  { category: 'Bathroom', severity: 'monitor', text: 'Toilet flapper shows signs of wear and intermittent running; recommend replacement of tank components.' },
  { category: 'Bathroom', severity: 'monitor', text: 'Vanity drawer hardware is loose; recommend tightening and routine maintenance.' },
  { category: 'Bathroom', severity: 'monitor', text: 'Mirror backing shows minor desilvering at edges; cosmetic, monitor and replace as desired.' },
  { category: 'Bathroom', severity: 'defect', text: 'Active leak observed at bathroom sink p-trap — recommend repair by a licensed plumber to prevent cabinet and subfloor damage.' },
  { category: 'Bathroom', severity: 'defect', text: 'Bathroom exhaust fan terminates in the attic rather than the exterior — does not meet IRC M1505 venting requirements; recommend correction by a licensed contractor to route the duct to the building exterior.' },
  { category: 'Bathroom', severity: 'defect', text: 'GFCI protection absent at bathroom vanity receptacles — does not meet IRC E3902.1 requirements; recommend installation of GFCI protection by a licensed electrician.' },
  { category: 'Bathroom', severity: 'defect', text: 'Tile floor at base of toilet is soft underfoot, indicating likely subfloor rot from a prior or active wax-ring leak — recommend evaluation and repair by a licensed plumber and contractor.' },
  { category: 'Bathroom', severity: 'defect', text: 'Visible mold growth observed on bathroom ceiling drywall around exhaust fan; recommend remediation and improved ventilation by a qualified contractor.' },
  { category: 'Bathroom', severity: 'defect', text: 'Toilet rocks at the base, indicating loose closet bolts or a failed wax ring — recommend reset by a licensed plumber to prevent leakage and floor damage.' },
  { category: 'Bathroom', severity: 'defect', text: 'Tub or shower spout lacks anti-scald mixing valve protection — does not meet IRC P2708.4 / P2708.3 scald-prevention requirements; recommend installation of a temperature-limiting valve by a licensed plumber.' },
  { category: 'Bathroom', severity: 'defect', text: 'Hand-held shower wand lacks a backflow prevention device; recommend correction by a licensed plumber to prevent cross-connection of potable water.' },
  { category: 'Bathroom', severity: 'defect', text: 'Tile shower surround exhibits soft, hollow-sounding areas indicating failed substrate behind the tile — recommend evaluation and rebuild by a qualified contractor before further water damage occurs.' },

  // FOUNDATION — 26 total (8 sat, 9 mon, 9 def)
  { category: 'Foundation', severity: 'satisfactory', text: 'Foundation walls show no visible cracks greater than hairline width at time of inspection.' },
  { category: 'Foundation', severity: 'satisfactory', text: 'Basement walls and floor appear dry with no evidence of past or present water intrusion.' },
  { category: 'Foundation', severity: 'satisfactory', text: 'Grading at the perimeter slopes away from the foundation, promoting positive drainage.' },
  { category: 'Foundation', severity: 'satisfactory', text: 'Sump pump operates as intended when manually triggered; discharge line directs water away from the structure.' },
  { category: 'Foundation', severity: 'satisfactory', text: 'Crawl-space access is provided and the area appears dry with no standing water.' },
  { category: 'Foundation', severity: 'satisfactory', text: 'Foundation vents are open, screened, and appear to provide adequate cross-ventilation of the crawl space.' },
  { category: 'Foundation', severity: 'satisfactory', text: 'Lally columns in the basement appear plumb, securely seated, and free of significant corrosion.' },
  { category: 'Foundation', severity: 'satisfactory', text: 'Slab-on-grade flooring shows only minor surface cracking consistent with normal curing.' },
  { category: 'Foundation', severity: 'monitor', text: 'Hairline vertical cracks observed in the foundation wall; typical of curing shrinkage — monitor for widening or moisture passage.' },
  { category: 'Foundation', severity: 'monitor', text: 'Light efflorescence observed on basement walls indicating past moisture migration; monitor and address drainage at the exterior.' },
  { category: 'Foundation', severity: 'monitor', text: 'Faint water staining noted on the basement floor near the foundation wall; monitor during heavy rain events.' },
  { category: 'Foundation', severity: 'monitor', text: 'Several interior doors stick at the jambs, suggesting minor settlement; monitor for progressive movement.' },
  { category: 'Foundation', severity: 'monitor', text: 'Floors exhibit a mild slope in localized areas; consistent with age-related settlement — monitor for further change.' },
  { category: 'Foundation', severity: 'monitor', text: 'Sump pit lacks a sealed cover; recommend installing a cover to reduce humidity entering the basement.' },
  { category: 'Foundation', severity: 'monitor', text: 'Grading is relatively flat near a portion of the foundation; recommend improving slope to direct water away.' },
  { category: 'Foundation', severity: 'monitor', text: 'Crawl-space vapor barrier is partially displaced; recommend re-securing and overlapping seams.' },
  { category: 'Foundation', severity: 'monitor', text: 'Retaining wall exhibits minor lean and surface weathering; monitor for progression and plan for maintenance.' },
  { category: 'Foundation', severity: 'defect', text: 'Foundation crack measured wider than one-quarter inch — exceeds the InterNACHI SOP threshold for monitoring; recommend evaluation by a licensed structural engineer.' },
  { category: 'Foundation', severity: 'defect', text: 'Horizontal crack with inward bowing observed at basement wall, indicating lateral soil pressure — recommend immediate evaluation by a licensed structural engineer.' },
  { category: 'Foundation', severity: 'defect', text: 'Stair-step cracking through masonry block exceeds one-quarter inch width and indicates differential settlement — recommend evaluation by a licensed structural engineer per InterNACHI SOP guidance.' },
  { category: 'Foundation', severity: 'defect', text: 'Active water intrusion observed at basement floor-to-wall cove joint — recommend evaluation by a licensed waterproofing contractor and correction of exterior drainage.' },
  { category: 'Foundation', severity: 'defect', text: 'Sump pump failed to activate when tested; basement is at risk of flooding — recommend repair or replacement by a licensed plumber.' },
  { category: 'Foundation', severity: 'defect', text: 'Lally column shows significant corrosion and section loss at the base — a structural concern; recommend evaluation and replacement by a licensed structural contractor.' },
  { category: 'Foundation', severity: 'defect', text: 'Crawl-space contains standing water and saturated soil — recommend evaluation by a licensed waterproofing contractor and installation of drainage and a vapor barrier.' },
  { category: 'Foundation', severity: 'defect', text: 'Footing is exposed at the exterior with visible undermining from runoff — recommend evaluation by a licensed structural engineer and corrective grading.' },
  { category: 'Foundation', severity: 'defect', text: 'Retaining wall exhibits significant lean, cracking, and displacement — recommend evaluation by a licensed structural engineer prior to further loading or use.' },

  // SAFETY — 26 total (8 sat, 9 mon, 9 def)
  { category: 'Safety', severity: 'satisfactory', text: 'Smoke detectors are present on every level and inside each sleeping area, consistent with IRC R314.3 placement.' },
  { category: 'Safety', severity: 'satisfactory', text: 'Carbon monoxide detectors are present outside each sleeping area, consistent with IRC R315 placement.' },
  { category: 'Safety', severity: 'satisfactory', text: 'Bedroom egress windows meet minimum opening dimensions and are operable from the interior without tools or keys.' },
  { category: 'Safety', severity: 'satisfactory', text: 'Stair handrails are continuous, graspable, and securely anchored along required stair runs.' },
  { category: 'Safety', severity: 'satisfactory', text: 'Guardrails at elevated walking surfaces measure at least 36 inches in height and are securely anchored.' },
  { category: 'Safety', severity: 'satisfactory', text: 'GFCI protection is present at required locations including kitchen, bathrooms, garage, and exterior receptacles.' },
  { category: 'Safety', severity: 'satisfactory', text: 'Water heater temperature-pressure relief valve and discharge pipe are properly installed and terminate near the floor.' },
  { category: 'Safety', severity: 'satisfactory', text: 'Dryer vent is rigid metal and discharges to the exterior with no visible obstructions.' },
  { category: 'Safety', severity: 'monitor', text: 'Smoke detectors appear older than 10 years; recommend replacement per manufacturer service-life guidance.' },
  { category: 'Safety', severity: 'monitor', text: 'Carbon monoxide detector battery indicators show low charge; recommend battery replacement.' },
  { category: 'Safety', severity: 'monitor', text: 'Bedroom egress window operates with difficulty; recommend service to ensure free operation in an emergency.' },
  { category: 'Safety', severity: 'monitor', text: 'Stair handrail terminations are open rather than returned to the wall; recommend modification to prevent clothing snags.' },
  { category: 'Safety', severity: 'monitor', text: 'Guardrail balusters have spacing approaching the four-inch limit; monitor for flexing and recommend reinforcement.' },
  { category: 'Safety', severity: 'monitor', text: 'AFCI protection is absent at bedroom circuits typical of pre-2002 construction; recommend upgrade for improved fire-arc protection.' },
  { category: 'Safety', severity: 'monitor', text: 'Gas appliance combustion-air openings are partially obstructed by stored items; recommend clearing the area to maintain combustion air supply.' },
  { category: 'Safety', severity: 'monitor', text: 'Dryer transition duct is foil flex type behind the appliance; consider upgrade to semi-rigid metal to reduce lint accumulation and fire risk.' },
  { category: 'Safety', severity: 'monitor', text: 'Fireplace hearth extension meets minimum dimensions but shows surface damage; recommend cosmetic repair to maintain ember protection.' },
  { category: 'Safety', severity: 'defect', text: 'Smoke detector is missing on the basement level — does not meet IRC R314.3 / NFPA 72 placement requirements; recommend immediate installation by a licensed electrician.' },
  { category: 'Safety', severity: 'defect', text: 'Carbon monoxide detector is absent on a level containing fuel-burning appliances — does not meet IRC R315.3 requirements; recommend immediate installation.' },
  { category: 'Safety', severity: 'defect', text: 'Bedroom window net clear opening is below the minimum 5.7 square feet — does not meet IRC R310.2.1 egress requirements; recommend evaluation by a licensed contractor.' },
  { category: 'Safety', severity: 'defect', text: 'Stair handrail measures less than 34 inches above the stair nosing — does not meet IRC R311.7.8.1 minimum; recommend rebuild by a licensed contractor.' },
  { category: 'Safety', severity: 'defect', text: 'Guardrail at elevated deck measures less than 36 inches — does not meet IRC R312.1.2 height requirements; recommend rebuild by a licensed contractor.' },
  { category: 'Safety', severity: 'defect', text: 'Water heater temperature-pressure relief valve discharge pipe is missing or terminates at the ceiling — a safety hazard; recommend correction by a licensed plumber.' },
  { category: 'Safety', severity: 'defect', text: 'Garage-to-house door is hollow-core and does not provide the fire separation required by IRC R302.5.1; recommend replacement with a 20-minute fire-rated, self-closing assembly by a licensed contractor.' },
  { category: 'Safety', severity: 'defect', text: 'Dryer vent is constructed of vinyl flex duct — does not meet IRC M1502.4.1 material requirements and presents a fire hazard; recommend replacement with rigid metal duct by a qualified contractor.' },
  { category: 'Safety', severity: 'defect', text: 'Fireplace combustible mantel encroaches inside the required clearance from the firebox opening — does not meet IRC R1001.11; recommend correction by a qualified mason.' },

  // MOLD — 26 total (8 sat, 9 mon, 9 def)
  { category: 'Mold', severity: 'satisfactory', text: 'No visible mold growth was observed at accessible interior surfaces at time of inspection.' },
  { category: 'Mold', severity: 'satisfactory', text: 'Attic ventilation appears adequate with balanced soffit intake and ridge exhaust.' },
  { category: 'Mold', severity: 'satisfactory', text: 'Crawl-space vapor barrier is in place, continuous, and properly overlapped at seams.' },
  { category: 'Mold', severity: 'satisfactory', text: 'Basement humidity reading is within an acceptable range at time of inspection.' },
  { category: 'Mold', severity: 'satisfactory', text: 'HVAC condensate drain pan is dry and free of corrosion at time of inspection.' },
  { category: 'Mold', severity: 'satisfactory', text: 'A functioning dehumidifier is present in the basement and aids in moisture control.' },
  { category: 'Mold', severity: 'satisfactory', text: 'No staining or condensation was observed at attic sheathing or framing members.' },
  { category: 'Mold', severity: 'satisfactory', text: 'Crawl-space encapsulation system is intact and properly sealed at perimeter walls.' },
  { category: 'Mold', severity: 'monitor', text: 'Minor surface staining observed at attic sheathing near the ridge; monitor and improve ventilation if it expands.' },
  { category: 'Mold', severity: 'monitor', text: 'Light condensation patterns visible on basement supply ducts; recommend additional duct insulation to reduce sweating.' },
  { category: 'Mold', severity: 'monitor', text: 'Basement humidity reading is elevated; recommend operation of a dehumidifier during humid months.' },
  { category: 'Mold', severity: 'monitor', text: 'Crawl-space vapor barrier shows gaps at penetrations; recommend sealing to limit moisture infiltration.' },
  { category: 'Mold', severity: 'monitor', text: 'Soffit vents are partially blocked by insulation; recommend installation of baffles to maintain attic airflow.' },
  { category: 'Mold', severity: 'monitor', text: 'Evidence of past ice damming at eaves; monitor and improve attic insulation and ventilation prior to next winter.' },
  { category: 'Mold', severity: 'monitor', text: 'HVAC condensate drain pan shows minor surface rust; monitor and plan for service at next maintenance visit.' },
  { category: 'Mold', severity: 'monitor', text: 'Bathroom drywall shows light surface mildew above the shower; recommend cleaning and improved exhaust ventilation.' },
  { category: 'Mold', severity: 'monitor', text: 'Crawl-space humidity reading is elevated; recommend installation or service of a dehumidifier.' },
  { category: 'Mold', severity: 'defect', text: 'Visible mold growth observed on basement framing exceeds 10 square feet; per InterNACHI Mold SOP, recommend professional mold assessment and remediation by a certified mold remediation contractor.' },
  { category: 'Mold', severity: 'defect', text: 'Significant mold growth observed across attic sheathing consistent with ventilation deficiency; recommend remediation and ventilation correction by qualified contractors.' },
  { category: 'Mold', severity: 'defect', text: 'Active plumbing leak has saturated drywall and framing; recommend repair by a licensed plumber and moisture remediation by a qualified contractor.' },
  { category: 'Mold', severity: 'defect', text: 'HVAC condensate pan is rusted through and overflowing onto framing — recommend evaluation by a licensed HVAC technician and replacement of the pan and surrounding affected materials.' },
  { category: 'Mold', severity: 'defect', text: 'Crawl-space exhibits standing water and pervasive surface mold on joists and insulation; recommend remediation and drainage correction by a qualified contractor.' },
  { category: 'Mold', severity: 'defect', text: 'Visible mold growth on insulation in the basement covers a large area; per InterNACHI Mold SOP, recommend professional mold assessment and removal by a certified mold remediation specialist.' },
  { category: 'Mold', severity: 'defect', text: 'Bathroom subfloor is saturated and shows fungal growth from a long-term shower-pan leak — recommend repair by a licensed plumber and remediation by a certified mold remediation specialist.' },
  { category: 'Mold', severity: 'defect', text: 'Attic insulation is heavily compressed and stained from chronic roof leak; recommend roof repair by a licensed roofer and replacement of affected insulation.' },
  { category: 'Mold', severity: 'defect', text: 'Encapsulated crawl space shows torn liner and visible moisture beneath — recommend evaluation and repair by a qualified encapsulation contractor.' },

  // SEPTIC — 26 total (8 sat, 9 mon, 9 def)
  { category: 'Septic', severity: 'satisfactory', text: 'Septic tank lid and risers are present, accessible, and intact at time of inspection.' },
  { category: 'Septic', severity: 'satisfactory', text: 'No sewage odor was detected at the tank, distribution box, or drain-field area.' },
  { category: 'Septic', severity: 'satisfactory', text: 'Drain-field surface is dry, level, and shows uniform vegetation coverage.' },
  { category: 'Septic', severity: 'satisfactory', text: 'Distribution box appears intact and level when observed through the access port.' },
  { category: 'Septic', severity: 'satisfactory', text: 'Reported pumping interval is consistent with the typical 3 to 5 year service guideline.' },
  { category: 'Septic', severity: 'satisfactory', text: 'No standing water or surface seepage was observed over the drain-field area.' },
  { category: 'Septic', severity: 'satisfactory', text: 'Tank baffles appear intact when viewed through the inspection port.' },
  { category: 'Septic', severity: 'satisfactory', text: 'Scum and sludge layers are within typical service ranges based on visual inspection.' },
  { category: 'Septic', severity: 'monitor', text: 'Septic tank pumping records are unavailable; recommend pumping if more than 3 to 5 years have passed since last service.' },
  { category: 'Septic', severity: 'monitor', text: 'Septic tank riser cover is cracked but in place; recommend replacement to maintain a secure seal.' },
  { category: 'Septic', severity: 'monitor', text: 'Vegetation over the drain field is noticeably greener than surrounding lawn; monitor as this can be an early indicator of effluent surfacing.' },
  { category: 'Septic', severity: 'monitor', text: 'Distribution box access lid is buried; recommend exposing for routine inspection access.' },
  { category: 'Septic', severity: 'monitor', text: 'Septic system age exceeds 25 years; monitor performance and budget for eventual component replacement.' },
  { category: 'Septic', severity: 'monitor', text: 'Effluent filter is present but reportedly has not been cleaned recently; recommend cleaning at the next pumping.' },
  { category: 'Septic', severity: 'monitor', text: 'Surface depressions noted over the drain-field trenches; monitor for settlement and re-grade to prevent ponding.' },
  { category: 'Septic', severity: 'monitor', text: 'Heavy landscaping installed over a portion of the drain field; monitor for root intrusion and avoid further plantings in the area.' },
  { category: 'Septic', severity: 'monitor', text: 'Scum layer thickness approaches the typical pumping threshold; recommend scheduling a pump-out within the next service interval.' },
  { category: 'Septic', severity: 'defect', text: 'Sewage odor and standing effluent observed at the drain-field surface, indicating likely system failure — per InterNACHI Ancillary SOP, recommend professional septic inspection and evaluation by a licensed septic professional.' },
  { category: 'Septic', severity: 'defect', text: 'Septic tank baffle is broken and missing material at the outlet — recommend repair by a licensed septic contractor to prevent solids from entering the drain field.' },
  { category: 'Septic', severity: 'defect', text: 'Distribution box is tipped and unevenly distributing effluent — recommend evaluation and re-leveling by a licensed septic contractor.' },
  { category: 'Septic', severity: 'defect', text: 'Septic tank lid is cracked and unstable — a fall hazard; recommend immediate replacement by a licensed septic contractor.' },
  { category: 'Septic', severity: 'defect', text: 'Slow drainage and gurgling at multiple fixtures indicate a possible failed or saturated drain field; recommend a dye test and full evaluation by a licensed septic professional.' },
  { category: 'Septic', severity: 'defect', text: 'Sludge layer measured exceeds the manufacturer service threshold — recommend immediate pumping and inspection by a licensed septic contractor.' },
  { category: 'Septic', severity: 'defect', text: 'Lush, saturated grass over the drain field combined with sewage odor indicates a likely surfacing failure — per InterNACHI Ancillary SOP, recommend full evaluation by a licensed septic professional prior to closing.' },
  { category: 'Septic', severity: 'defect', text: 'Septic tank shows visible structural cracking at the wall and signs of past leakage — recommend evaluation and replacement by a licensed septic contractor.' },
  { category: 'Septic', severity: 'defect', text: 'No accessible septic tank lid or risers were located; recommend a licensed septic professional locate, expose, and inspect the tank prior to closing.' },
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

// Drizzle column `comments.created_at` is `integer({ mode: 'timestamp' })`,
// which stores Unix seconds (Drizzle multiplies by 1000 on read). Writing
// `Date.now()` (milliseconds) gives a date in year 58296 once read back.
const nowSec = Math.floor(Date.now() / 1000);
const values = COMMENTS.map(c => {
  const id = randomUUID();
  return `('${id}', '${TENANT_ID}', '${c.category}', '${c.text.replace(/'/g, "''")}', '${c.severity}', ${nowSec})`;
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
