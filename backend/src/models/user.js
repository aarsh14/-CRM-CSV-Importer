import mongoose from "mongoose";
import { lowercase, string, trim } from "zod";

const userSchema = new mongoose.Schema(
    {
        email: {
            type: string,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        passwordHash: {
            type: string,
            required: true,
        },
    },
    { timestamps: true }
);

export const User = mongoose.model('User', userSchema)