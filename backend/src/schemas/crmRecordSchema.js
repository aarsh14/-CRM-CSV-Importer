import { z } from "zod"

// These two enum lists are the actual business rules from the assignment.
// Defined once here, imported everywhere else that needs them, so the
// Mongoose schema and the AI-output validator (Phase 4) can never drift
// out of sync with each other.
export const CRM_STATUS_VALUES = [
    'GOOD_LEAD_FOLLOW_UP',
    'DID_NOT_CONNECT',
    'BAD_LEAD',
    'SALE_DONE',
];

export const DATA_SOURCE_VALUES = [
    'leads_on_demand',
    'meridian_tower',
    'eden_park',
    'varah_swamy',
    'sarjapur_plots',
];


export const crmRecordSchema = z.object({
    created_at: z
        .string()
        .refine((v) => !isNaN(Date.parse(v)), { message: 'created_at must be a valid date' })
        .nullable()
        .optional(),
    name: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    country_code: z.string().nullable().optional(),
    mobile_without_country_code: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    lead_owner: z.string().nullable().optional(),
    crm_status: z.enum(CRM_STATUS_VALUES).nullable().optional(),
    crm_note: z.string().nullable().optional(),
    data_source: z.enum([...DATA_SOURCE_VALUES, '']).nullable().optional(),
    possession_time: z.string().nullable().optional(),
    description: z.string().nullable().optional(),

})