import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const SECRET = process.env.JWT_SECRET;

if (!SECRET || SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters');
}

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
    { expiresIn: "240d" }
  );

  console.log(role, "TOKEN:");
  console.log(token);
  console.log("---------------");
});
