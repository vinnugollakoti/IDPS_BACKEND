import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const SECRET = process.env.JWT_SECRET;   // add this

const roles = [
  "PRINCIPAL",
  "RECEPTIONIST",
  "TEACHER",
  "PARENT"
];

roles.forEach((role, i) => {
  const token = jwt.sign(
    { userId: i + 1, role },
    SECRET,
    { expiresIn: "30d" }
  );

  console.log(role, "TOKEN:");
  console.log(token);
  console.log("---------------");
});