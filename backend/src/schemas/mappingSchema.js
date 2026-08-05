import { z } from 'zod';

// Field descriptions used both in the AI prompt (csvMappingService.js)
// and here for validation/documentation. Note "email" and "phone_raw"
// are the RAW mapped columns before per-row parsing splits them further
// (multiple emails/phones in one cell, country code extraction) — that
// splitting happens in plain JS in csvStreamService.js, not here.
// "data_source_column" maps to whichever column holds the raw
// project/campaign string, which then gets resolved to one of the fixed
// enum values via the separate source-lookup AI call.
export const CRM_FIELD_DESCRIPTIONS = {
  name: "the lead/customer's full name",
  email: "the lead's email address (may contain more than one email in a single cell)",
  phone_raw: "the lead's phone/mobile/WhatsApp number (may contain more than one number, and may or may not include a country code)",
  company: 'the company or organisation the lead works at or represents',
  city: 'the city the lead is located in',
  state: 'the state/province the lead is located in',
  country: 'the country the lead is located in',
  lead_owner: "the internal staff member or salesperson responsible for this lead (NOT the lead's own contact info)",
  crm_note: 'free-text notes, remarks, or comments about this specific lead',
  created_at: 'the date this lead was created or the enquiry was made',
  possession_time: 'for real-estate leads, when the property will be ready/possession-ready (e.g. "Dec 2027", "Ready to Move", "Immediate")',
  description: 'any additional descriptive text about the lead not already covered by notes',
  data_source_column: 'the property, project, or marketing campaign this lead is associated with or came from (e.g. a project name like "Meridian Tower" or a campaign name) — the RAW column, not yet matched to a fixed enum value',
};

const CRM_FIELDS = Object.keys(CRM_FIELD_DESCRIPTIONS);

// One field's mapping: either a single source column, an array of
// columns to combine (e.g. First Name + Last Name -> name), or null if
// nothing in the CSV matches. Verified against real Gemini structured
// output during manual testing — the oneOf construct is supported.
const fieldMappingSchema = z.object({
  source: z.union([z.string(), z.array(z.string()), z.null()]),
  combine: z.enum(['concat_with_space', 'concat_with_comma']).nullable().optional(),
  confidence: z.number().min(0).max(1),
});

// The full column-mapping response — one fieldMappingSchema per CRM field.
export const mappingResponseSchema = z.object(
  Object.fromEntries(CRM_FIELDS.map((field) => [field, fieldMappingSchema]))
);

// JSON Schema version of the same shape, for Gemini's responseSchema
// config (which expects JSON Schema, not a Zod schema directly).
export const mappingJsonSchema = {
  type: 'object',
  properties: Object.fromEntries(
    CRM_FIELDS.map((field) => [
      field,
      {
        type: 'object',
        properties: {
          source: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
              { type: 'null' },
            ],
          },
          combine: {
            type: ['string', 'null'],
            enum: ['concat_with_space', 'concat_with_comma', null],
          },
          confidence: { type: 'number' },
        },
        required: ['source', 'confidence'],
      },
    ])
  ),
  required: CRM_FIELDS,
};

// AI Call #2's response shape: a lookup table from a raw source/campaign
// string to one of the fixed data_source enum values (or empty string
// if nothing matches confidently).
export const sourceLookupSchema = z.record(z.string(), z.string());
