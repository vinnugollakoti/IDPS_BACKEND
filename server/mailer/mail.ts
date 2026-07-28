import dotenv from "dotenv";
dotenv.config();

const MAIL_API = process.env.MAIL_API || "none";

async function sendMail(to: string, subject: string, html: string) {
  try {
    if (!MAIL_API || MAIL_API === "none") {
      console.log("MAIL_API not configured, skipping email send.");
      return { status: "skipped" };
    }

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
          from: `'IDPS Login' <${process.env.MAIL_ID}>`,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "Unknown Mail API Error");
      console.error("Mail API Error:", errText);
      return { status: "error", message: errText };
    }

    return await response.json().catch(() => ({ status: "ok" }));
  } catch (err) {
    console.error("Mail Network Error:", err);
    return { status: "error", error: err };
  }
}

export async function sendMOtpail(email: string, otp: string) {
  try {
    await sendMail(
      email,
      "Your OTP for IDPS Login",
      `
      <h2>OTP</h2>
      <p><b>${otp}</b></p>
      <p>Valid for 5 minutes.</p>
      <p>Built by IDPS Team</p>
      `
    );
  } catch (err) {
    console.error("Failed to send OTP email safely:", err);
  }
}
