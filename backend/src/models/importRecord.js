import mongoose from 'mongoose';
import { CRM_STATUS_VALUES, DATA_SOURCE_VALUES } from '../schemas/crmRecordSchema.js';

const importRecordSchema = new mongoose.Schema(
    {
        job: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ImportJob',
            required: true,
        },
        // the original row exactly as it came from the CSV, before any AI
        // touched it — kept for debugging / auditing what the source data was
        rawRow: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        status: {
            type: String,
            enum: ['imported', 'skipped'],
            required: true,
        },
        skipReason: {
            type: String,
            default: null,
        },
        // only populated when status === 'imported'
        crmRecord: {
            created_at: String,
            name: String,
            email: String,
            country_code: String,
            mobile_without_country_code: String,
            company: String,
            city: String,
            state: String,
            country: String,
            lead_owner: String,
            crm_status: { type: String, enum: [...CRM_STATUS_VALUES, null] },
            crm_note: String,
            data_source: { type: String, enum: [...DATA_SOURCE_VALUES, '', null] },
            possession_time: String,
            description: String,
        },
    },
    { timestamps: true }
);

// records are always queried "give me everything for this job" —
// this index makes that lookup fast even with thousands of records per job
importRecordSchema.index({ job: 1 });

export const ImportRecord = mongoose.model('ImportRecord', importRecordSchema);
