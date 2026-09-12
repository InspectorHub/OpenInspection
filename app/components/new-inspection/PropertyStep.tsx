import type { WizardTemplate } from "../NewInspectionWizard";
import { TemplateCombobox } from "./TemplateCombobox";
import { AddressAutocomplete } from "../address/AddressAutocomplete";
import { GoogleMap } from "../address/GoogleMap";
import type { AddressSelection } from "~/routes/resources/places";
import { m } from "~/paraglide/messages";
import {
  INSPECTION_PROPERTY_TYPES,
  type InspectionPropertyType,
} from "../../../server/lib/inspection-property-type";

// `label` is a thunk so each type name resolves at render inside the paraglide
// request scope, not once at module import.
//
// The VALUES come from the same constant the create API validates against, not
// from literals retyped here. They were retyped here, and the list was the only
// place they existed on the client: the selection reached the request body and
// the API dropped it, because nothing joined this list to a field the server
// would accept. A `Record` keyed on the type makes a value added to the tuple a
// compile error here rather than an untranslated button.
const PROPERTY_TYPE_LABELS: Record<InspectionPropertyType, () => string> = {
  single_family: () => m.newinsp_property_type_single_family(),
  multi_unit: () => m.newinsp_property_type_multi_unit(),
  commercial: () => m.newinsp_property_type_commercial(),
};

const PROPERTY_TYPES = INSPECTION_PROPERTY_TYPES.map((value) => ({
  value,
  label: PROPERTY_TYPE_LABELS[value],
}));

export function PropertyStep({
  propertyType,
  setPropertyType,
  address,
  setAddress,
  onAddressSelect,
  addressLat,
  addressLng,
  templates,
  templateId,
  setTemplateId,
}: {
  propertyType: string;
  setPropertyType: (v: string) => void;
  address: string;
  setAddress: (v: string) => void;
  /** Fires when a suggestion resolves to a structured, geocoded address. */
  onAddressSelect: (sel: AddressSelection) => void;
  addressLat?: number | null;
  addressLng?: number | null;
  templates: WizardTemplate[];
  templateId: string;
  setTemplateId: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_property_type_label()}</label>
        <div className="flex gap-2">
          {PROPERTY_TYPES.map((pt) => (
            <button key={pt.value} onClick={() => setPropertyType(pt.value)}
              className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${propertyType === pt.value ? "border-ih-primary bg-ih-primary-tint text-ih-primary-text" : "border-ih-border text-ih-fg-3"}`}
            >{pt.label()}</button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="property-address" className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_property_address_label()}</label>
        <AddressAutocomplete
          value={address}
          onValueChange={setAddress}
          onSelect={onAddressSelect}
          placeholder={m.newinsp_property_address_ph()}
        />
        {typeof addressLat === "number" && typeof addressLng === "number" && (
          <div className="mt-2">
            <GoogleMap lat={addressLat} lng={addressLng} className="w-full h-40 rounded-md border border-ih-border bg-ih-bg-muted overflow-hidden" />
          </div>
        )}
      </div>
      <div>
        <label htmlFor="newinsp-template" className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_property_template_label()}</label>
        {/* One combobox, not a filter box + a select + an echo line. */}
        <TemplateCombobox id="newinsp-template" templates={templates} templateId={templateId} setTemplateId={setTemplateId} />
      </div>
    </div>
  );
}
