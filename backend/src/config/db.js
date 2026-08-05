import mongoose from "mongoose"

const connectDB = async (req, res) => {
    const uri = process.env.MONGO_URL;
    if (!uri) {
        throw new Error('MONGO_URI is not set in environment variables');
    }

    try {
        const db = await mongoose.connect(uri)
        console.log(`MongoDB Connected: ${db.connection.host}`);


    } catch (error) {
        console.log("MongoDb connection failed")
        console.log(error)

    }


}

export default connectDB