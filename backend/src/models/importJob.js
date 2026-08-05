import mongoose from "mongoose";

const importJobSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    originalFileName: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    totalRows: {
      type: Number,
      default: 0,
    },
    processedRows: {
      type: Number,
      default: 0,
    },
    importedCount: {
      type: Number,
      default: 0,
    },
    skippedCount: {
      type: Number,
      default: 0,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    // Saved once, before the streaming pass begins — kept for debugging
    // ("why did 'Contact' end up mapped to email?") rather than
    // discarded after the mapping AI call returns.
    columnMapping: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    sourceValueLookup: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true },
);

export const ImportJob = mongoose.model("ImportJob", importJobSchema);
