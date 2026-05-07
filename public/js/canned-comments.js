/* eslint-disable */
/**
 * Spec 5G M2 — Standard Residential Inspection Comments Library.
 *
 * 248 pre-written inspection comments covering the major US residential
 * inspection sections, written in industry-standard plain-language style.
 *
 * NOT affiliated with, endorsed by, or copied from any inspector trade
 * organization (ASHI, InterNACHI, etc.). Wording is original; inspectors
 * affiliated with such organizations should review for compliance with
 * their own organization's Standards of Practice.
 *
 * Override mechanism: this file sets window.__OI_COMMENT_LIBRARY before
 * inspection-edit.js reads it. The library auto-loads at page render.
 *
 * Disclaimer: these are templates. The inspector is responsible for
 * accuracy and applicability to each property; review and customize
 * each comment before publishing the report.
 *
 * Distribution by section (approx, totals 248):
 *   Roof 30 · Exterior 28 · Foundation 24 · Plumbing 28 · Electrical 30
 *   HVAC 22 · Interior 20 · Kitchen 14 · Bath 14 · Attic 14 · Garage 10
 *   General 14
 *
 * Each entry: { rating, text, section }
 *   rating: 'satisfactory' | 'monitor' | 'defect' | 'all'
 *   text:   the canned comment string
 *   section: section name (for future per-section filter; current drawer
 *           filters by rating only)
 */

(function () {
    var L = [];
    function add(section, rating, text) { L.push({ rating: rating, section: section, text: text }); }

    // ============ ROOF (30) ============
    add('Roof', 'satisfactory', 'Roof covering appears serviceable with no visible defects at the time of inspection.');
    add('Roof', 'satisfactory', 'Asphalt composition shingles in good overall condition; estimated remaining service life 10+ years.');
    add('Roof', 'satisfactory', 'Roof flashing at penetrations and chimney appears properly installed and sealed.');
    add('Roof', 'satisfactory', 'Gutters and downspouts are securely attached and free of significant debris.');
    add('Roof', 'satisfactory', 'Soffit and ridge vents present and clear of obstructions; attic ventilation appears adequate.');
    add('Roof', 'satisfactory', 'No active leaks or moisture intrusion observed at roof surface or interior ceilings below.');
    add('Roof', 'satisfactory', 'Roof valleys and rake edges are properly flashed and sealed.');
    add('Roof', 'satisfactory', 'Roof deck appears structurally sound with no visible sagging or deflection.');
    add('Roof', 'monitor', 'Asphalt shingles show signs of granule loss and weathering; monitor and budget for replacement within 3-5 years.');
    add('Roof', 'monitor', 'Minor moss or algae growth observed on north-facing slopes; recommend treatment to prevent moisture retention.');
    add('Roof', 'monitor', 'One or more shingles show curling or cupping at edges; monitor for further deterioration.');
    add('Roof', 'monitor', 'Flashing shows minor surface rust; monitor and apply sealant when accessible.');
    add('Roof', 'monitor', 'Gutters exhibit minor sagging at one or more attachment points; monitor and secure as needed.');
    add('Roof', 'monitor', 'Sealant at roof penetrations shows minor cracking; recommend renewal within 12 months.');
    add('Roof', 'monitor', 'Roof appears near end of expected service life; recommend planning for replacement within 1-3 years.');
    add('Roof', 'monitor', 'Skylight gaskets show minor weathering; monitor for active leakage and reseal if necessary.');
    add('Roof', 'defect', 'Multiple shingles are missing, broken, or lifted; recommend repair by a qualified roofing contractor.');
    add('Roof', 'defect', 'Active roof leak observed; recommend immediate professional repair to prevent further water damage.');
    add('Roof', 'defect', 'Improper or missing flashing observed at chimney/wall intersection; recommend correction to prevent leakage.');
    add('Roof', 'defect', 'Roof deck exhibits sagging or deflection indicating possible structural issue; further evaluation by a structural professional recommended.');
    add('Roof', 'defect', 'Gutters are detached or severely damaged; replacement recommended.');
    add('Roof', 'defect', 'Downspouts discharge directly against the foundation; extend at least 4-6 feet away to prevent foundation moisture issues.');
    add('Roof', 'defect', 'Multiple layers of roofing observed; full tear-off recommended at next replacement to verify deck condition.');
    add('Roof', 'defect', 'Visible holes or punctures in roof covering; recommend repair to prevent water intrusion.');
    add('Roof', 'defect', 'Improper roof slope at one or more areas causing standing water; recommend evaluation by a roofing contractor.');
    add('Roof', 'defect', 'Plumbing vent flashing shows separation from roof surface; recommend re-sealing.');
    add('Roof', 'defect', 'Exposed nail heads observed without sealant; recommend sealing to prevent rust and leakage.');
    add('Roof', 'defect', 'Chimney crown shows significant cracking; recommend repair or replacement.');
    add('Roof', 'all', 'Roof was inspected from ground level / accessible eaves only; areas not safely accessible were not inspected.');
    add('Roof', 'all', 'Recommend follow-up inspection by a licensed roofing contractor for cost estimate and warranty validation.');

    // ============ EXTERIOR (28) ============
    add('Exterior', 'satisfactory', 'Siding and trim appear in serviceable condition with no significant defects observed.');
    add('Exterior', 'satisfactory', 'Exterior paint and finishes are intact with no widespread peeling or weathering.');
    add('Exterior', 'satisfactory', 'Grading slopes away from foundation, providing positive drainage.');
    add('Exterior', 'satisfactory', 'Window frames and exterior doors operate properly and show no significant damage.');
    add('Exterior', 'satisfactory', 'Exterior caulking and sealants are intact at penetrations and joints.');
    add('Exterior', 'satisfactory', 'Driveway and walkways show no significant cracks or trip hazards.');
    add('Exterior', 'satisfactory', 'Deck/porch structure appears sound with proper railings and connections.');
    add('Exterior', 'satisfactory', 'Exterior outlets are GFCI-protected and show weather covers in place.');
    add('Exterior', 'monitor', 'Caulking at window/door perimeter shows minor cracking; monitor and renew when accessible.');
    add('Exterior', 'monitor', 'Paint shows minor weathering on south/west exposures; recommend repaint within 1-2 years.');
    add('Exterior', 'monitor', 'Wood trim shows minor deterioration at horizontal surfaces; monitor and seal as needed.');
    add('Exterior', 'monitor', 'Vegetation contact with siding observed; trim back to allow drying and prevent insect access.');
    add('Exterior', 'monitor', 'Concrete walkway shows minor cracking; monitor for displacement and seal larger cracks.');
    add('Exterior', 'monitor', 'Deck boards show minor cupping or surface checking; recommend cleaning and re-sealing within 12 months.');
    add('Exterior', 'monitor', 'Garage door weather seal shows minor wear; replace when accessible.');
    add('Exterior', 'defect', 'Negative grading observed against foundation; regrade to slope away from house at minimum 6 inches over first 10 feet.');
    add('Exterior', 'defect', 'Multiple loose siding panels observed; reattach to prevent moisture intrusion and wind damage.');
    add('Exterior', 'defect', 'Significant wood rot observed at trim and siding; replace damaged sections and identify moisture source.');
    add('Exterior', 'defect', 'Window/door seals are failed; recommend replacement to restore weather resistance and energy efficiency.');
    add('Exterior', 'defect', 'Driveway/walkway exhibits significant displacement creating trip hazard; recommend repair or replacement.');
    add('Exterior', 'defect', 'Deck ledger board shows improper attachment or missing flashing; recommend correction by a qualified contractor for safety.');
    add('Exterior', 'defect', 'Deck/stair railings are below current code height (36" minimum) or have improper baluster spacing (>4"); recommend correction for safety.');
    add('Exterior', 'defect', 'Exterior outlets lack GFCI protection or weather covers; recommend update for safety per current code.');
    add('Exterior', 'defect', 'Damaged or missing exterior light fixtures observed; recommend repair or replacement.');
    add('Exterior', 'defect', 'Significant settling of exterior concrete observed; further evaluation by a foundation specialist recommended.');
    add('Exterior', 'defect', 'Improper attachment of attached structures (deck, porch, awning) observed; recommend evaluation for safety.');
    add('Exterior', 'all', 'Areas covered by snow, vegetation, or stored items were not inspected.');
    add('Exterior', 'all', 'Recommend annual inspection of exterior caulking and sealants to maintain weather resistance.');

    // ============ FOUNDATION / STRUCTURE (24) ============
    add('Foundation', 'satisfactory', 'Foundation walls appear sound with no significant cracks, settling, or moisture intrusion observed.');
    add('Foundation', 'satisfactory', 'Crawl space appears dry with adequate ventilation and no visible structural concerns.');
    add('Foundation', 'satisfactory', 'Visible structural framing in basement/crawl space appears intact and properly supported.');
    add('Foundation', 'satisfactory', 'Foundation drainage system (where visible) appears functional.');
    add('Foundation', 'satisfactory', 'No evidence of past or present water intrusion observed in basement.');
    add('Foundation', 'satisfactory', 'Sump pump operates correctly and discharges away from foundation.');
    add('Foundation', 'monitor', 'Vertical hairline cracks observed in foundation walls; typical of normal settling, monitor for changes in width or pattern.');
    add('Foundation', 'monitor', 'Efflorescence (white mineral deposits) observed on foundation walls indicating past moisture; monitor for active intrusion.');
    add('Foundation', 'monitor', 'Crawl space vapor barrier shows minor gaps or deterioration; recommend repair to prevent moisture migration.');
    add('Foundation', 'monitor', 'Minor settling cracks observed in basement floor slab; monitor for displacement.');
    add('Foundation', 'monitor', 'Crawl space insulation shows minor deterioration or loose attachment; recommend re-securing.');
    add('Foundation', 'monitor', 'Floor framing shows minor deflection consistent with age; monitor and consult a structural engineer if it progresses.');
    add('Foundation', 'defect', 'Horizontal or step-cracking observed in foundation walls indicating possible structural movement; evaluation by a structural engineer recommended.');
    add('Foundation', 'defect', 'Active water intrusion observed in basement/crawl space; recommend identifying source and waterproofing as needed.');
    add('Foundation', 'defect', 'Significant foundation settlement observed; structural evaluation by a qualified professional recommended.');
    add('Foundation', 'defect', 'Wood-destroying organism damage observed in framing members; recommend treatment and repair by qualified specialist.');
    add('Foundation', 'defect', 'Improper or undersized support posts observed; recommend evaluation by a structural professional.');
    add('Foundation', 'defect', 'Floor joists or beams show significant sagging, splitting, or notching; structural evaluation recommended.');
    add('Foundation', 'defect', 'Standing water observed in crawl space; recommend drainage correction and moisture barrier installation.');
    add('Foundation', 'defect', 'Exposed soil in crawl space without vapor barrier; recommend installation of 6-mil polyethylene barrier per code.');
    add('Foundation', 'defect', 'Sump pump is non-functional or absent in area requiring drainage; recommend installation/repair.');
    add('Foundation', 'defect', 'Significant cracks in basement slab with displacement; recommend evaluation for cause and repair.');
    add('Foundation', 'all', 'Crawl space inspected to extent safely accessible; areas with limited clearance not fully evaluated.');
    add('Foundation', 'all', 'Hidden defects in foundation walls behind finished surfaces are beyond the scope of a visual inspection.');

    // ============ PLUMBING (28) ============
    add('Plumbing', 'satisfactory', 'Visible plumbing supply and drain lines appear functional with no active leaks observed.');
    add('Plumbing', 'satisfactory', 'Water pressure tested at representative fixtures appears adequate (40-80 psi range).');
    add('Plumbing', 'satisfactory', 'Water heater operating normally with no visible leaks or corrosion at fittings.');
    add('Plumbing', 'satisfactory', 'Toilets flush and refill properly with no visible leaks at base or supply lines.');
    add('Plumbing', 'satisfactory', 'Drains throughout home flow freely with no visible blockages.');
    add('Plumbing', 'satisfactory', 'Main shutoff valve location identified and accessible.');
    add('Plumbing', 'satisfactory', 'Hose bibs operate properly with anti-siphon protection where required.');
    add('Plumbing', 'monitor', 'Water heater nearing end of typical useful life (10-12 years); recommend planning for replacement.');
    add('Plumbing', 'monitor', 'Minor mineral deposits observed at fixture connections; monitor for active leakage.');
    add('Plumbing', 'monitor', 'Slow drain observed at one or more fixtures; recommend cleaning to prevent backup.');
    add('Plumbing', 'monitor', 'Toilet shows minor wobble at base; recommend re-shimming and re-sealing wax ring within 12 months.');
    add('Plumbing', 'monitor', 'Caulking at tub/shower perimeter shows minor cracking; renew to prevent moisture intrusion.');
    add('Plumbing', 'monitor', 'Outdoor hose bib shows minor drip when off; recommend washer replacement.');
    add('Plumbing', 'monitor', 'Water hammer (knocking sound) observed when valves close; recommend installation of arrestors.');
    add('Plumbing', 'defect', 'Active water leak observed; recommend immediate professional repair to prevent damage.');
    add('Plumbing', 'defect', 'Water heater shows signs of corrosion or improper installation (no T&P drain pipe, missing seismic strapping in seismic zones); recommend correction.');
    add('Plumbing', 'defect', 'Water heater T&P relief valve discharge pipe is missing, improperly terminated, or undersized; recommend correction per code.');
    add('Plumbing', 'defect', 'Polybutylene supply piping observed; known for premature failure, recommend evaluation for replacement.');
    add('Plumbing', 'defect', 'Galvanized supply piping observed showing corrosion/restriction; recommend replacement to restore water pressure.');
    add('Plumbing', 'defect', 'Cast iron drain piping shows significant corrosion or scale buildup; recommend evaluation by a plumbing professional.');
    add('Plumbing', 'defect', 'Improper plumbing modifications observed (incorrect slope, missing trap, improper venting); recommend correction by a licensed plumber.');
    add('Plumbing', 'defect', 'Cross-connection observed (potential for contaminated water entering supply); recommend immediate correction by a licensed plumber.');
    add('Plumbing', 'defect', 'Water pressure measured outside acceptable range (<40 or >80 psi); recommend evaluation and pressure regulator if needed.');
    add('Plumbing', 'defect', 'Toilet rocks at base or shows water stain on floor; recommend re-setting and inspection of subfloor.');
    add('Plumbing', 'defect', 'Sewer line condition unknown; recommend video inspection of main sewer line, especially in homes 25+ years old.');
    add('Plumbing', 'defect', 'Septic system was not inspected; recommend evaluation by a qualified septic professional.');
    add('Plumbing', 'all', 'Plumbing within walls, ceilings, and below grade not directly inspected; only visible portions evaluated.');
    add('Plumbing', 'all', 'Water quality testing not part of the inspection; recommend separate test if concerns exist.');

    // ============ ELECTRICAL (30) ============
    add('Electrical', 'satisfactory', 'Electrical panel appears properly installed with adequate amperage and labeled circuits.');
    add('Electrical', 'satisfactory', 'Service entrance cable and meter base appear in good condition.');
    add('Electrical', 'satisfactory', 'Tested receptacles operate properly with correct polarity and grounding.');
    add('Electrical', 'satisfactory', 'GFCI protection present in required wet/outdoor locations.');
    add('Electrical', 'satisfactory', 'Smoke detectors present and tested in main living areas; CO detectors observed where required.');
    add('Electrical', 'satisfactory', 'Light fixtures throughout home operate properly.');
    add('Electrical', 'satisfactory', 'Visible wiring methods appear appropriate for application and properly secured.');
    add('Electrical', 'satisfactory', 'Main panel labeling is clear and accurate.');
    add('Electrical', 'monitor', 'Smoke/CO detectors appear older than 10 years; recommend replacement per manufacturer guidelines.');
    add('Electrical', 'monitor', 'One or more outlets show minor face damage; recommend replacement when accessible.');
    add('Electrical', 'monitor', 'Light fixture covers show minor weathering; recommend replacement or cleaning.');
    add('Electrical', 'monitor', 'Panel labeling is incomplete or unclear at some breakers; recommend updating for safety.');
    add('Electrical', 'monitor', 'Older two-prong outlets observed; recommend upgrade to grounded three-prong, especially in kitchen/bath.');
    add('Electrical', 'defect', 'GFCI protection missing at kitchen, bathroom, garage, exterior, or other required wet locations; recommend installation per current code.');
    add('Electrical', 'defect', 'AFCI protection missing at bedroom circuits where required by current code; recommend update.');
    add('Electrical', 'defect', 'Federal Pacific Electric (FPE) Stab-Lok panel observed; known fire safety concerns, recommend evaluation/replacement by a licensed electrician.');
    add('Electrical', 'defect', 'Zinsco/Sylvania panel observed; known reliability issues, recommend evaluation by a licensed electrician.');
    add('Electrical', 'defect', 'Aluminum branch wiring observed; recommend evaluation by a qualified electrician for COPALUM/AlumiConn pigtailing.');
    add('Electrical', 'defect', 'Knob-and-tube wiring observed; recommend evaluation by an electrician — insurance and capacity concerns common.');
    add('Electrical', 'defect', 'Double-tapped breakers observed (two wires on a breaker designed for one); recommend correction by a licensed electrician.');
    add('Electrical', 'defect', 'Open electrical splices observed without junction box; recommend immediate correction for fire safety.');
    add('Electrical', 'defect', 'Reverse polarity observed at one or more outlets; recommend correction by a licensed electrician.');
    add('Electrical', 'defect', 'Open ground observed at one or more three-prong outlets; recommend correction or update to GFCI with grounding label.');
    add('Electrical', 'defect', 'Bonding/grounding deficiencies observed at panel; recommend evaluation and correction by a licensed electrician.');
    add('Electrical', 'defect', 'Service entrance cable shows damage or improper drip loop; recommend correction.');
    add('Electrical', 'defect', 'Missing or damaged knockout fillers observed at panel; recommend installation to maintain enclosure rating.');
    add('Electrical', 'defect', 'Smoke detectors absent in bedrooms or hallways; recommend installation per current code.');
    add('Electrical', 'defect', 'Carbon monoxide detectors absent in homes with attached garage or fuel-burning appliances; recommend installation.');
    add('Electrical', 'all', 'Electrical inspection limited to readily accessible components; concealed wiring not evaluated.');
    add('Electrical', 'all', 'Recommend evaluation by a licensed electrician for any cited deficiencies.');

    // ============ HVAC (22) ============
    add('HVAC', 'satisfactory', 'Heating system operated normally during inspection with appropriate temperature rise.');
    add('HVAC', 'satisfactory', 'Cooling system operated normally with appropriate temperature differential at registers.');
    add('HVAC', 'satisfactory', 'Air filter is clean and recently replaced.');
    add('HVAC', 'satisfactory', 'Ductwork visible in attic/crawl space appears properly insulated and sealed.');
    add('HVAC', 'satisfactory', 'Thermostat operates properly and is appropriately calibrated.');
    add('HVAC', 'satisfactory', 'Combustion air supply and venting appear properly configured for fuel-burning equipment.');
    add('HVAC', 'monitor', 'HVAC system appears to be approaching end of typical useful life (15-20 years); recommend planning for replacement.');
    add('HVAC', 'monitor', 'Air filter shows moderate dust accumulation; recommend replacement.');
    add('HVAC', 'monitor', 'Refrigerant lines show minor insulation damage; recommend re-insulation to maintain efficiency.');
    add('HVAC', 'monitor', 'Outdoor condenser unit needs cleaning; recommend coil cleaning to maintain efficiency.');
    add('HVAC', 'monitor', 'Ductwork shows minor disconnection at one or more joints; recommend re-sealing with mastic or UL-listed tape.');
    add('HVAC', 'monitor', 'Recommend annual professional servicing of HVAC system to maintain efficiency and warranty.');
    add('HVAC', 'defect', 'Heating system did not respond to thermostat call; recommend evaluation by a licensed HVAC professional.');
    add('HVAC', 'defect', 'Cooling system showed inadequate temperature differential; recommend evaluation for refrigerant charge or compressor performance.');
    add('HVAC', 'defect', 'Heat exchanger condition is unknown and beyond visual inspection; recommend evaluation by a qualified HVAC technician.');
    add('HVAC', 'defect', 'Improper or missing combustion air supply for fuel-burning equipment; recommend correction for safety.');
    add('HVAC', 'defect', 'Flue/vent connector shows corrosion, improper slope, or disconnection; recommend immediate evaluation for CO safety.');
    add('HVAC', 'defect', 'Condensate drain shows blockage or improper termination; recommend correction to prevent water damage.');
    add('HVAC', 'defect', 'Asbestos-containing material suspected on older ductwork or piping insulation; recommend evaluation by a qualified abatement professional.');
    add('HVAC', 'defect', 'No air filter installed at return; recommend immediate installation to protect equipment.');
    add('HVAC', 'all', 'HVAC inspection performed at ambient conditions; full performance evaluation requires technician with specialized equipment.');
    add('HVAC', 'all', 'Cooling not tested due to outdoor temperature below 65°F; manufacturer guidance prevents testing in cold conditions.');

    // ============ INTERIOR (20) ============
    add('Interior', 'satisfactory', 'Interior walls, ceilings, and floors appear in serviceable condition with no significant defects observed.');
    add('Interior', 'satisfactory', 'Doors operate properly and latch securely.');
    add('Interior', 'satisfactory', 'Windows operate properly and lock securely.');
    add('Interior', 'satisfactory', 'Stair handrails and guardrails meet code height and have appropriate baluster spacing.');
    add('Interior', 'satisfactory', 'Floor coverings appear in good condition with no significant trip hazards.');
    add('Interior', 'monitor', 'Minor cosmetic cracks observed in drywall consistent with normal settlement; monitor for active movement.');
    add('Interior', 'monitor', 'Some interior doors show minor binding or latch alignment issues; recommend adjustment.');
    add('Interior', 'monitor', 'Window operation shows minor difficulty; recommend lubrication of tracks/hinges.');
    add('Interior', 'monitor', 'Minor staining observed on ceiling indicating past moisture; verify source has been addressed.');
    add('Interior', 'monitor', 'Carpeting shows wear patterns; recommend replacement at owner discretion.');
    add('Interior', 'defect', 'Active water staining observed on ceiling/walls indicating ongoing moisture intrusion; recommend identifying source.');
    add('Interior', 'defect', 'Mold-like growth observed on interior surfaces; recommend evaluation by a qualified mold specialist.');
    add('Interior', 'defect', 'Stair handrails or guardrails are missing, loose, or below code height; recommend correction for safety.');
    add('Interior', 'defect', 'Window glass is cracked or broken in one or more locations; recommend replacement.');
    add('Interior', 'defect', 'Failed dual-pane window seals observed (condensation between panes); recommend insulated glass replacement.');
    add('Interior', 'defect', 'Floor shows significant deflection or unevenness; recommend structural evaluation.');
    add('Interior', 'defect', 'Egress windows in basement bedrooms do not meet current size requirements; recommend evaluation per code.');
    add('Interior', 'defect', 'Lead-based paint risk in homes built pre-1978; recommend testing if children present or remodeling planned.');
    add('Interior', 'all', 'Items within walls, behind appliances, or under floor coverings not inspected.');
    add('Interior', 'all', 'Cosmetic conditions noted at the inspector\'s discretion; minor cosmetic issues may not be reported.');

    // ============ KITCHEN (14) ============
    add('Kitchen', 'satisfactory', 'Kitchen appliances operated normally during inspection.');
    add('Kitchen', 'satisfactory', 'Kitchen plumbing fixtures operate properly with no leaks observed under sink.');
    add('Kitchen', 'satisfactory', 'Kitchen GFCI outlets tested and functional.');
    add('Kitchen', 'satisfactory', 'Range/oven anti-tip bracket installed.');
    add('Kitchen', 'satisfactory', 'Garbage disposal operates normally.');
    add('Kitchen', 'monitor', 'Dishwasher shows minor wear; appears functional but consider replacement at end of useful life (10-15 years).');
    add('Kitchen', 'monitor', 'Range hood vent shows accumulation; recommend cleaning for fire safety.');
    add('Kitchen', 'monitor', 'Refrigerator water line shows minor crimping; recommend re-routing to prevent failure.');
    add('Kitchen', 'monitor', 'Caulking at sink rim shows wear; recommend renewal to prevent under-counter moisture.');
    add('Kitchen', 'defect', 'Range/oven anti-tip bracket missing; recommend installation for safety per manufacturer.');
    add('Kitchen', 'defect', 'Improper dishwasher drain (no high loop or air gap) observed; recommend correction to prevent backflow.');
    add('Kitchen', 'defect', 'Garbage disposal shows leak at flange or drain connection; recommend repair.');
    add('Kitchen', 'defect', 'Range hood does not vent to exterior or recirculates inadequately; recommend evaluation for ventilation upgrade.');
    add('Kitchen', 'all', 'Built-in appliances operated through normal cycles; long-term performance not guaranteed.');

    // ============ BATHROOM (14) ============
    add('Bathroom', 'satisfactory', 'Bathroom plumbing fixtures operate properly with no active leaks.');
    add('Bathroom', 'satisfactory', 'Tub and shower drain freely; no visible defects.');
    add('Bathroom', 'satisfactory', 'Bathroom GFCI outlets tested and functional.');
    add('Bathroom', 'satisfactory', 'Exhaust fan operates and vents to exterior.');
    add('Bathroom', 'monitor', 'Caulking at tub/shower perimeter shows minor cracking; recommend renewal to prevent moisture intrusion.');
    add('Bathroom', 'monitor', 'Grout lines show minor deterioration; recommend cleaning and resealing.');
    add('Bathroom', 'monitor', 'Tub stopper or drain mechanism shows minor wear; recommend service when accessible.');
    add('Bathroom', 'monitor', 'Toilet shows minor running between flushes; recommend flapper/fill valve replacement.');
    add('Bathroom', 'defect', 'Exhaust fan does not vent to exterior or vents into attic; recommend correction to prevent moisture issues.');
    add('Bathroom', 'defect', 'Active leak observed under sink/around toilet base; recommend immediate repair.');
    add('Bathroom', 'defect', 'Water damage observed on bathroom floor or subfloor; recommend evaluation and repair.');
    add('Bathroom', 'defect', 'Failed waterproof membrane suspected at shower; recommend evaluation by a qualified contractor.');
    add('Bathroom', 'defect', 'Bathroom GFCI protection absent; recommend immediate installation per code.');
    add('Bathroom', 'all', 'Areas behind tub/shower walls not visible; concealed leakage cannot be ruled out.');

    // ============ ATTIC / INSULATION / VENTILATION (14) ============
    add('Attic', 'satisfactory', 'Attic insulation appears appropriate type and depth for the climate zone.');
    add('Attic', 'satisfactory', 'Attic ventilation appears adequate with soffit and ridge venting present.');
    add('Attic', 'satisfactory', 'No visible signs of pest activity, moisture intrusion, or structural concerns in accessible attic.');
    add('Attic', 'satisfactory', 'Bath/kitchen exhaust fans terminate to exterior, not into attic.');
    add('Attic', 'monitor', 'Attic insulation shows compression or settling in areas; recommend topping off to maintain R-value.');
    add('Attic', 'monitor', 'Minor moisture staining observed on roof sheathing; appears historical but monitor for active leakage.');
    add('Attic', 'monitor', 'Recessed light fixtures appear non-IC rated and contact insulation; recommend evaluation for fire safety.');
    add('Attic', 'monitor', 'Pest evidence (rodent droppings) observed in attic; recommend professional pest control evaluation.');
    add('Attic', 'defect', 'Insulation depth significantly below recommended R-value for climate zone; recommend supplemental insulation.');
    add('Attic', 'defect', 'Bath/kitchen exhaust fan vents directly into attic; recommend correction to prevent moisture damage.');
    add('Attic', 'defect', 'Active roof leak observed at attic decking; recommend immediate repair and replacement of damaged sheathing.');
    add('Attic', 'defect', 'Insufficient attic ventilation observed; recommend additional venting to prevent moisture and ice damming.');
    add('Attic', 'defect', 'Wood-destroying organism damage observed in attic framing; recommend specialist evaluation.');
    add('Attic', 'all', 'Attic inspected to extent safely accessible; insulation may conceal underlying defects.');

    // ============ GARAGE (10) ============
    add('Garage', 'satisfactory', 'Garage door operates properly with functional safety reverse mechanism.');
    add('Garage', 'satisfactory', 'Fire-rated separation between garage and dwelling appears intact.');
    add('Garage', 'satisfactory', 'Garage outlets are GFCI-protected.');
    add('Garage', 'satisfactory', 'Vehicle door from garage to dwelling is self-closing and self-latching.');
    add('Garage', 'monitor', 'Garage door weather seal shows wear; recommend replacement for energy efficiency.');
    add('Garage', 'monitor', 'Minor cracks observed in garage floor slab; monitor for displacement.');
    add('Garage', 'defect', 'Garage door opener safety reverse mechanism failed test; recommend immediate adjustment or replacement.');
    add('Garage', 'defect', 'Door from garage to dwelling is not self-closing or lacks proper fire rating; recommend correction for safety.');
    add('Garage', 'defect', 'Penetrations in fire-rated wall between garage and dwelling not properly sealed; recommend correction with fire-rated sealant.');
    add('Garage', 'defect', 'Garage outlets lack GFCI protection; recommend update per current code.');

    // ============ GENERAL / DISCLAIMERS (14) ============
    add('General', 'all', 'Inspection performed in accordance with the Standards of Practice of the inspector\'s certifying body.');
    add('General', 'all', 'Hidden conditions may exist that were not visible at the time of inspection; this report is not an exhaustive list of every defect.');
    add('General', 'all', 'Recommend follow-up evaluation by qualified specialists for any items requiring further investigation.');
    add('General', 'all', 'Inspector is not liable for conditions concealed by stored items, finished surfaces, or weather.');
    add('General', 'all', 'See attached photos for documentation of cited conditions.');
    add('General', 'all', 'Inspection limited to readily accessible visible components; areas not safely accessible were not inspected.');
    add('General', 'all', 'This report is prepared for the exclusive use of the named client and should not be relied upon by third parties.');
    add('General', 'all', 'Recommend obtaining all available manuals and warranties from the seller for installed equipment.');
    add('General', 'all', 'Recommend identifying location of main shutoffs (water, gas, electric) before occupancy.');
    add('General', 'all', 'Cosmetic defects, normal wear and tear, and code compliance items beyond safety concerns are not included in this report.');
    add('General', 'all', 'Recommend changing locks and access codes upon taking possession of the property.');
    add('General', 'all', 'Environmental concerns (radon, asbestos, lead, mold, etc.) require specialized testing not included in this inspection.');
    add('General', 'all', 'Sewer line, septic system, well water, and underground utilities require specialized inspection not performed here.');
    add('General', 'all', 'Recommend retention of this report for future reference; permanent record of property condition at time of inspection.');

    window.__OI_COMMENT_LIBRARY = L;
    if (typeof console !== 'undefined' && console.info) {
        console.info('[OI Comment Library] Loaded ' + L.length + ' canned comments (Standard Residential pack)');
    }
})();
