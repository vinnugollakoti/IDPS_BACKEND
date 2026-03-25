import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import UserRouter from "./routes/user"
import ClassRouter from "./routes/class"
dotenv.config();


const app = express()
app.use(cors())
app.use(express.json())

app.use("/", UserRouter);
app.use("/class", ClassRouter);


app.listen(process.env.PORT, () => {
    console.log("Your server is running 🏃‍♂️");
})