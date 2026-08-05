import express from "express"
import dotenv from "dotenv"
import connectDB from "./src/config/db.js"
import cors from "cors"
import cookieParser from "cookie-parser"
import { errorHandler } from "./src/middleware/errorHandler.js"
import router from "./src/routes/index.js"

dotenv.config()
const app = express()

app.use(
    cors({
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        credentials: true
    })
)

app.use(express.json())
app.use(cookieParser())

connectDB()

const port = process.env.PORT

app.use('/api', router)

app.get("/", (req, res) => {
    res.json({ message: "server is running" })
})

app.use(errorHandler)

app.listen(port, () => {

    console.log(`Server is running on PORT:${port}`);

})
