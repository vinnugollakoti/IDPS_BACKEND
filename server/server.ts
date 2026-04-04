import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import AuthRouter from "./routes/auth"
import ClassRouter from "./routes/class"
import StudentRouter from "./routes/student"
import TeacherRouter from "./routes/teacher"
import UserRouter from "./routes/user"
import GetRouter from "./routes/get"
dotenv.config();


const app = express()
app.use(cors())
app.use(express.json())

app.use("/", UserRouter);
app.use("/auth", AuthRouter);
app.use("/class", ClassRouter);
app.use("/student", StudentRouter);
app.use("/teacher", TeacherRouter);
app.use("/get", GetRouter);


app.listen(process.env.PORT, () => {
    console.log("Your server is running 🏃‍♂️", process.env.PORT);
})