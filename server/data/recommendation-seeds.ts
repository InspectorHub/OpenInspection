// Default recommendations seeded per tenant. Estimates are USD cents.
// Sources: 2024-2026 InterNACHI / IRC / NFPA convention text + median US contractor pricing.
//
// 80 entries across 9 categories:
//   Roof (10): 3 sat / 3 mon / 4 def
//   Electrical (10): 3 sat / 3 mon / 4 def
//   Plumbing (10): 3 sat / 3 mon / 4 def
//   HVAC (10): 3 sat / 3 mon / 4 def
//   Foundation (8): 2 sat / 3 mon / 3 def
//   Bathroom (8): 2 sat / 3 mon / 3 def
//   Kitchen (8): 2 sat / 3 mon / 3 def
//   Safety (8): 2 sat / 3 mon / 3 def
//   Mold (8): 2 sat / 3 mon / 3 def
// Total = 80

export type SeedSeverity = 'satisfactory' | 'monitor' | 'defect';

export interface SeedRecommendation {
    category:             string;
    name:                 string;
    severity:             SeedSeverity;
    defaultEstimateMin:   number | null;
    defaultEstimateMax:   number | null;
    defaultRepairSummary: string;
}

export const RECOMMENDATION_SEEDS: SeedRecommendation[] = [
    // ──────────────── Roof (10) ────────────────
    { category: 'Roof', name: 'Roof covering serviceable', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Roof covering appears serviceable. Continue routine annual inspection.' },
    { category: 'Roof', name: 'Gutters clean and intact', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Gutters and downspouts are properly secured. No action required.' },
    { category: 'Roof', name: 'Adequate ventilation', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Soffit and ridge ventilation appears adequate per IRC R806.' },
    { category: 'Roof', name: 'Granule loss — monitor', severity: 'monitor', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Asphalt shingles show granule loss consistent with age. Plan for replacement within 3-5 years.' },
    { category: 'Roof', name: 'Moss/algae growth', severity: 'monitor', defaultEstimateMin: 30000, defaultEstimateMax: 80000,
      defaultRepairSummary: 'Treat with zinc or copper strips to prevent moisture retention. Cost is per-job rather than per-foot.' },
    { category: 'Roof', name: 'Minor flashing wear', severity: 'monitor', defaultEstimateMin: 20000, defaultEstimateMax: 50000,
      defaultRepairSummary: 'Re-seal exposed flashing nail heads and minor surface rust. Recommend follow-up in 1-2 years.' },
    { category: 'Roof', name: 'Active roof leak', severity: 'defect', defaultEstimateMin: 80000, defaultEstimateMax: 250000,
      defaultRepairSummary: 'Active water intrusion observed. Recommend evaluation and repair by a licensed roofer immediately.' },
    { category: 'Roof', name: 'Missing/damaged shingles', severity: 'defect', defaultEstimateMin: 50000, defaultEstimateMax: 200000,
      defaultRepairSummary: 'Multiple shingles are missing or damaged. Repair by licensed roofer to prevent water intrusion.' },
    { category: 'Roof', name: 'Chimney flashing failure', severity: 'defect', defaultEstimateMin: 60000, defaultEstimateMax: 180000,
      defaultRepairSummary: 'Chimney flashing is open or improperly sealed. Repair by licensed roofer.' },
    { category: 'Roof', name: 'Sagging roof deck', severity: 'defect', defaultEstimateMin: 200000, defaultEstimateMax: 1500000,
      defaultRepairSummary: 'Visible sagging or soft spots on roof deck indicate potential structural compromise. Recommend evaluation by licensed structural engineer.' },

    // ──────────────── Electrical (10) ────────────────
    { category: 'Electrical', name: 'Panel labeled and clear', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Electrical panel is properly labeled and accessible per NEC 110.26.' },
    { category: 'Electrical', name: 'GFCI protection adequate', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'GFCI protection is present and functional at all required locations tested.' },
    { category: 'Electrical', name: 'Smoke detectors functional', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Smoke detectors present and functional in required locations per NFPA 72.' },
    { category: 'Electrical', name: 'Double-tapped breakers', severity: 'monitor', defaultEstimateMin: 20000, defaultEstimateMax: 60000,
      defaultRepairSummary: 'Panel contains double-tapped breakers. Recommend evaluation by licensed electrician.' },
    { category: 'Electrical', name: 'Two-prong outlets in older areas', severity: 'monitor', defaultEstimateMin: 30000, defaultEstimateMax: 100000,
      defaultRepairSummary: 'Two-prong ungrounded outlets observed. Consider upgrading to three-prong GFCI outlets.' },
    { category: 'Electrical', name: 'Missing junction box covers', severity: 'monitor', defaultEstimateMin: 5000, defaultEstimateMax: 20000,
      defaultRepairSummary: 'Junction boxes observed without covers per NEC 314.25. Install covers to all junction boxes.' },
    { category: 'Electrical', name: 'Open neutral / hot reverse', severity: 'defect', defaultEstimateMin: 30000, defaultEstimateMax: 80000,
      defaultRepairSummary: 'Open neutral or reversed polarity detected at outlets. Repair by licensed electrician immediately.' },
    { category: 'Electrical', name: 'Federal Pacific / Zinsco panel', severity: 'defect', defaultEstimateMin: 250000, defaultEstimateMax: 500000,
      defaultRepairSummary: 'Federal Pacific or Zinsco panel observed — known fire hazard. Replace with modern panel by licensed electrician.' },
    { category: 'Electrical', name: 'Missing AFCI protection', severity: 'defect', defaultEstimateMin: 40000, defaultEstimateMax: 120000,
      defaultRepairSummary: 'AFCI protection missing on required circuits per NEC 210.12. Upgrade by licensed electrician.' },
    { category: 'Electrical', name: 'Knob-and-tube wiring active', severity: 'defect', defaultEstimateMin: 800000, defaultEstimateMax: 2500000,
      defaultRepairSummary: 'Active knob-and-tube wiring observed. Replace with modern wiring by licensed electrician; insurer disclosure required.' },

    // ──────────────── Plumbing (10) ────────────────
    { category: 'Plumbing', name: 'Water pressure adequate', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Static water pressure within normal range (40-80 psi).' },
    { category: 'Plumbing', name: 'No active leaks', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'No active leaks observed at visible plumbing fixtures and supply lines.' },
    { category: 'Plumbing', name: 'Water heater serviceable', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Water heater appears serviceable; T&P valve and discharge piping properly installed.' },
    { category: 'Plumbing', name: 'Mineral buildup at fixtures', severity: 'monitor', defaultEstimateMin: 10000, defaultEstimateMax: 50000,
      defaultRepairSummary: 'Mineral deposits observed; consider water softener or fixture cleaning.' },
    { category: 'Plumbing', name: 'Slow drain at sink', severity: 'monitor', defaultEstimateMin: 15000, defaultEstimateMax: 40000,
      defaultRepairSummary: 'Slow drainage observed. Consider professional drain cleaning if persistent.' },
    { category: 'Plumbing', name: 'Aged water heater (10+ yrs)', severity: 'monitor', defaultEstimateMin: 100000, defaultEstimateMax: 250000,
      defaultRepairSummary: 'Water heater is at or beyond expected service life. Plan replacement within 2-3 years.' },
    { category: 'Plumbing', name: 'Active supply leak', severity: 'defect', defaultEstimateMin: 30000, defaultEstimateMax: 150000,
      defaultRepairSummary: 'Active leak observed at supply line or fitting. Repair by licensed plumber to prevent water damage.' },
    { category: 'Plumbing', name: 'Polybutylene supply piping', severity: 'defect', defaultEstimateMin: 600000, defaultEstimateMax: 2000000,
      defaultRepairSummary: 'Polybutylene supply piping observed — known failure history. Replace with PEX or copper by licensed plumber.' },
    { category: 'Plumbing', name: 'Cross-connection / no backflow', severity: 'defect', defaultEstimateMin: 25000, defaultEstimateMax: 80000,
      defaultRepairSummary: 'Cross-connection observed without backflow prevention per IPC 608. Install backflow preventer.' },
    { category: 'Plumbing', name: 'Sewer line backup observed', severity: 'defect', defaultEstimateMin: 40000, defaultEstimateMax: 1500000,
      defaultRepairSummary: 'Sewer backup or root intrusion suspected. Recommend camera scope by licensed plumber prior to closing.' },

    // ──────────────── HVAC (10) ────────────────
    { category: 'HVAC', name: 'System cools/heats normally', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'HVAC system produced expected temperature differential at supply registers during testing.' },
    { category: 'HVAC', name: 'Clean filter installed', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Air filter is clean. Continue replacement on 1-3 month cycle.' },
    { category: 'HVAC', name: 'Condenser pad level', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Outdoor condenser unit is properly mounted, level, and clear of obstructions.' },
    { category: 'HVAC', name: 'Aged equipment (12+ yrs)', severity: 'monitor', defaultEstimateMin: 350000, defaultEstimateMax: 800000,
      defaultRepairSummary: 'HVAC equipment is at or beyond expected service life. Plan for replacement within 2-3 years.' },
    { category: 'HVAC', name: 'Refrigerant lines exposed', severity: 'monitor', defaultEstimateMin: 15000, defaultEstimateMax: 50000,
      defaultRepairSummary: 'Refrigerant line insulation is degraded. Recommend re-insulation to maintain efficiency.' },
    { category: 'HVAC', name: 'Dirty/clogged condensate line', severity: 'monitor', defaultEstimateMin: 10000, defaultEstimateMax: 30000,
      defaultRepairSummary: 'Condensate drain shows mineral buildup. Clean to prevent overflow.' },
    { category: 'HVAC', name: 'Cracked heat exchanger', severity: 'defect', defaultEstimateMin: 250000, defaultEstimateMax: 800000,
      defaultRepairSummary: 'Visible signs consistent with heat exchanger failure — carbon monoxide risk. Recommend immediate evaluation by licensed HVAC contractor; do not operate until cleared.' },
    { category: 'HVAC', name: 'Inadequate cooling output', severity: 'defect', defaultEstimateMin: 30000, defaultEstimateMax: 200000,
      defaultRepairSummary: 'Insufficient temperature differential observed. Recommend evaluation by licensed HVAC contractor for refrigerant charge or compressor issue.' },
    { category: 'HVAC', name: 'Improper venting', severity: 'defect', defaultEstimateMin: 80000, defaultEstimateMax: 300000,
      defaultRepairSummary: 'Combustion appliance vent does not meet IRC G2427 / IFGC. Repair by licensed HVAC contractor.' },
    { category: 'HVAC', name: 'No CO detector near combustion', severity: 'defect', defaultEstimateMin: 5000, defaultEstimateMax: 15000,
      defaultRepairSummary: 'No carbon monoxide detector installed near combustion appliances per NFPA 720. Install immediately.' },

    // ──────────────── Foundation (8) ────────────────
    { category: 'Foundation', name: 'Foundation appears sound', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Foundation walls and slab show no significant defects at time of inspection.' },
    { category: 'Foundation', name: 'Drainage adequate', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Site grading directs water away from foundation; gutters discharge clear of structure.' },
    { category: 'Foundation', name: 'Hairline cracks', severity: 'monitor', defaultEstimateMin: 5000, defaultEstimateMax: 30000,
      defaultRepairSummary: 'Minor hairline cracks observed in foundation; consistent with normal curing/settling. Monitor for change.' },
    { category: 'Foundation', name: 'Efflorescence on walls', severity: 'monitor', defaultEstimateMin: 0, defaultEstimateMax: 50000,
      defaultRepairSummary: 'Efflorescence indicates past moisture migration. Improve drainage and monitor for active moisture.' },
    { category: 'Foundation', name: 'Minor settlement cracks', severity: 'monitor', defaultEstimateMin: 30000, defaultEstimateMax: 150000,
      defaultRepairSummary: 'Settlement cracks observed but appear stable. Monitor; consider epoxy injection if growth resumes.' },
    { category: 'Foundation', name: 'Active water intrusion', severity: 'defect', defaultEstimateMin: 80000, defaultEstimateMax: 800000,
      defaultRepairSummary: 'Active water intrusion observed in basement/crawlspace. Recommend waterproofing evaluation.' },
    { category: 'Foundation', name: 'Significant cracking/displacement', severity: 'defect', defaultEstimateMin: 500000, defaultEstimateMax: 5000000,
      defaultRepairSummary: 'Significant foundation cracking with horizontal/vertical displacement observed. Recommend evaluation by licensed structural engineer.' },
    { category: 'Foundation', name: 'Crawlspace standing water', severity: 'defect', defaultEstimateMin: 200000, defaultEstimateMax: 1500000,
      defaultRepairSummary: 'Standing water in crawlspace. Recommend sump system, vapor barrier, and waterproofing by licensed contractor.' },

    // ──────────────── Bathroom (8) ────────────────
    { category: 'Bathroom', name: 'Fixtures functional', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'All bathroom fixtures (toilet, sink, tub/shower) are functional with no visible defects.' },
    { category: 'Bathroom', name: 'Adequate ventilation', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Mechanical exhaust fan vents to exterior per IRC M1505.' },
    { category: 'Bathroom', name: 'Caulking aged', severity: 'monitor', defaultEstimateMin: 10000, defaultEstimateMax: 30000,
      defaultRepairSummary: 'Caulking around tub/shower is aged or cracked. Re-caulk to prevent moisture intrusion.' },
    { category: 'Bathroom', name: 'Toilet wobble', severity: 'monitor', defaultEstimateMin: 15000, defaultEstimateMax: 50000,
      defaultRepairSummary: 'Toilet shows minor wobble. Reset wax seal to prevent floor damage.' },
    { category: 'Bathroom', name: 'Slow tub drain', severity: 'monitor', defaultEstimateMin: 10000, defaultEstimateMax: 30000,
      defaultRepairSummary: 'Slow drainage at tub/shower. Clean drain to restore flow.' },
    { category: 'Bathroom', name: 'Active leak under vanity', severity: 'defect', defaultEstimateMin: 30000, defaultEstimateMax: 100000,
      defaultRepairSummary: 'Active leak observed at vanity supply or drain line. Repair by licensed plumber.' },
    { category: 'Bathroom', name: 'Soft floor near toilet', severity: 'defect', defaultEstimateMin: 50000, defaultEstimateMax: 300000,
      defaultRepairSummary: 'Soft/spongy subfloor around toilet indicates moisture damage. Recommend repair to expose extent.' },
    { category: 'Bathroom', name: 'No GFCI at sink', severity: 'defect', defaultEstimateMin: 15000, defaultEstimateMax: 40000,
      defaultRepairSummary: 'GFCI protection missing at bathroom outlet per NEC 210.8. Install GFCI immediately.' },

    // ──────────────── Kitchen (8) ────────────────
    { category: 'Kitchen', name: 'Appliances operational', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Built-in kitchen appliances tested operational at time of inspection.' },
    { category: 'Kitchen', name: 'GFCI protection at counters', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Counter outlets have GFCI protection per NEC 210.8.' },
    { category: 'Kitchen', name: 'Garbage disposal noisy', severity: 'monitor', defaultEstimateMin: 15000, defaultEstimateMax: 40000,
      defaultRepairSummary: 'Garbage disposal operates with abnormal noise. Plan replacement within 1-2 years.' },
    { category: 'Kitchen', name: 'Cabinet/drawer alignment', severity: 'monitor', defaultEstimateMin: 5000, defaultEstimateMax: 30000,
      defaultRepairSummary: 'Minor cabinet door/drawer alignment issues. Adjust hinges or slides.' },
    { category: 'Kitchen', name: 'Range hood low CFM', severity: 'monitor', defaultEstimateMin: 30000, defaultEstimateMax: 100000,
      defaultRepairSummary: 'Range hood ventilation appears inadequate. Consider upgrade for grease/odor control.' },
    { category: 'Kitchen', name: 'Active under-sink leak', severity: 'defect', defaultEstimateMin: 25000, defaultEstimateMax: 80000,
      defaultRepairSummary: 'Active leak under kitchen sink. Repair by licensed plumber and check cabinet for moisture damage.' },
    { category: 'Kitchen', name: 'Improper dishwasher air gap', severity: 'defect', defaultEstimateMin: 15000, defaultEstimateMax: 50000,
      defaultRepairSummary: 'Dishwasher drain lacks proper air gap or high loop per IPC. Install to prevent backflow.' },
    { category: 'Kitchen', name: 'Range gas line leak', severity: 'defect', defaultEstimateMin: 20000, defaultEstimateMax: 100000,
      defaultRepairSummary: 'Gas leak detected at range connection. Shut off and repair by licensed plumber/HVAC immediately.' },

    // ──────────────── Safety (8) ────────────────
    { category: 'Safety', name: 'Smoke detectors present', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Smoke detectors present in required locations per NFPA 72.' },
    { category: 'Safety', name: 'Stair railings secure', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Handrails and guardrails meet IRC R311.7 / R312 requirements.' },
    { category: 'Safety', name: 'Detector batteries old', severity: 'monitor', defaultEstimateMin: 1000, defaultEstimateMax: 5000,
      defaultRepairSummary: 'Replace smoke/CO detector batteries; recommend annually.' },
    { category: 'Safety', name: 'Loose deck baluster', severity: 'monitor', defaultEstimateMin: 5000, defaultEstimateMax: 30000,
      defaultRepairSummary: 'Deck baluster loose. Tighten or replace; do not allow children to lean.' },
    { category: 'Safety', name: 'Slick walkway', severity: 'monitor', defaultEstimateMin: 0, defaultEstimateMax: 30000,
      defaultRepairSummary: 'Walkway shows algae growth — slip hazard. Treat or pressure-wash.' },
    { category: 'Safety', name: 'No CO detector', severity: 'defect', defaultEstimateMin: 5000, defaultEstimateMax: 15000,
      defaultRepairSummary: 'No CO detector installed despite combustion appliances present. Install immediately per NFPA 720.' },
    { category: 'Safety', name: 'Stair rail loose/missing', severity: 'defect', defaultEstimateMin: 20000, defaultEstimateMax: 80000,
      defaultRepairSummary: 'Handrail is loose or missing per IRC R311.7. Repair immediately.' },
    { category: 'Safety', name: 'Garage opener missing safety reverse', severity: 'defect', defaultEstimateMin: 15000, defaultEstimateMax: 50000,
      defaultRepairSummary: 'Garage door opener safety reverse failed test. Repair or replace per UL 325.' },

    // ──────────────── Mold (8) ────────────────
    { category: 'Mold', name: 'No visible biological growth', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'No visible mold or biological growth observed at accessible surfaces.' },
    { category: 'Mold', name: 'Crawlspace dry', severity: 'satisfactory', defaultEstimateMin: null, defaultEstimateMax: null,
      defaultRepairSummary: 'Crawlspace is dry with vapor barrier intact.' },
    { category: 'Mold', name: 'Surface staining (suspected)', severity: 'monitor', defaultEstimateMin: 30000, defaultEstimateMax: 150000,
      defaultRepairSummary: 'Surface staining suggestive of past moisture; recommend testing if growth or odor present.' },
    { category: 'Mold', name: 'Bathroom condensation pattern', severity: 'monitor', defaultEstimateMin: 10000, defaultEstimateMax: 50000,
      defaultRepairSummary: 'Bathroom shows condensation patterns. Improve ventilation to prevent biological growth.' },
    { category: 'Mold', name: 'Damp basement odor', severity: 'monitor', defaultEstimateMin: 30000, defaultEstimateMax: 200000,
      defaultRepairSummary: 'Musty odor in basement. Recommend dehumidifier and moisture source investigation.' },
    { category: 'Mold', name: 'Visible black mold growth', severity: 'defect', defaultEstimateMin: 200000, defaultEstimateMax: 1500000,
      defaultRepairSummary: 'Visible mold growth observed. Recommend remediation by licensed mold contractor and air quality testing.' },
    { category: 'Mold', name: 'Active water damage with growth', severity: 'defect', defaultEstimateMin: 300000, defaultEstimateMax: 2500000,
      defaultRepairSummary: 'Active water damage with biological growth present. Remediation required before occupancy.' },
    { category: 'Mold', name: 'Hidden growth in HVAC', severity: 'defect', defaultEstimateMin: 150000, defaultEstimateMax: 800000,
      defaultRepairSummary: 'Suspected biological growth in HVAC plenum/coils. Recommend duct cleaning and HVAC evaluation.' },
];
