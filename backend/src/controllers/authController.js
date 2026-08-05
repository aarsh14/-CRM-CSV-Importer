import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

import { User } from "../models/user.js"

const COOKIE_NAME = 'token'
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'producton', // HTTPS-only in production
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000  //7 days

}


function signToken(userId) {
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' })
}

export async function signup(req, res, next) {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "email and password are required" })
        }

        if (password.length < 8) {
            return res.status(400).json({ error: "password must be atleast 8 characters" })

        }

        const existing = await User.findOne({ email: email.toLowerCase() });
        if (existing) {
            return res.status(409).json({ error: "An account with this email already exists" })

        }

        const passwordHash = await bcrypt.hash(password, 10)
        const user = await User.create({ email, passwordHash })

        const token = signToken(user._id)
        res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
        console.log(`user created with id:${user._id}`)
        res.status(201).json({ id: user._id, email: user.email });


    } catch (error) {
        console.log(error)
        next(error) //passed to errorHandler

    }
}


export async function login(req, res, next) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            // deliberately vague — don't reveal whether the email exists
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = signToken(user._id);
        res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

        res.json({ message: "logged in", id: user._id, email: user.email });
    } catch (err) {
        next(err);
    }
}

export function logout(req, res) {
    res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
    res.json({ message: 'Logged out' });
}

export async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('email');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ id: user._id, email: user.email });
  } catch (err) {
    next(err);
  }
}
