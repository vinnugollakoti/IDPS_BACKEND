import dotenv from "dotenv";
dotenv.config()

const MAIL_API = process.env.MAIL_API || "none";

async function sendMail(to: string, subject: string, html: string) {
  try {
    const response = await fetch(MAIL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to,
        subject,
        html,
        config: {
          email: process.env.MAIL_ID,
          pass: process.env.MAIL_PASSWORD,
          from: `'EEE Team' <${process.env.MAIL_ID}>`,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText);
    }

    return await response.json();
  } catch (err) {
    console.log("Mail Error:", err);
    throw err;
  }
}



export async function sendMOtpail(email: string, otp: string) {
    sendMail(
        email,
        "Your OTP for IDPS Login",
        `
        <h2>OTP</h2>
        <p><b>${otp}</b></p>
        <p>Valid for 5 minutes.</p>
        <p>Built by Gollakoti's</p>
        `
    )
}
