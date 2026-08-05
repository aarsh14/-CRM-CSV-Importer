import jwt from "jsonwebtoken"

export function requireAuth(req, res, next) {
    const token = req.cookies?.token

    if (!token) {
        console.log("Unauthorised: token not present")
        return res.status(401).json({ error: 'Not authenticated : token not present' })

    }
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET)
        req.userId = payload.userId;
        next()
    } catch (error) {
        return res.status(401).json({ error: "Invalid or expired session" })
    }
}
