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

/**
 * Build a professional HTML email for the OTP.
 *
 * Design choices:
 * - Inline CSS only (email clients strip <style> blocks).
 * - OTP digits are rendered as individual boxes for easy readability.
 * - Subject line includes the OTP so mobile notification banners show it
 *   and phones can offer a "Copy OTP" button automatically.
 * - A hidden <code> tag with the raw OTP helps mail-based autofill on
 *   Android (Google Messages) and iOS (Mail autofill).
 */
function buildOtpEmailHtml(otp: string): string {
  const digits = otp.split("");
  const year = new Date().getFullYear();

  const digitBoxes = digits
    .map(
      (d) =>
        `<td style="width:46px;height:52px;background-color:#ffffff;border:2px solid #16a34a;border-radius:8px;text-align:center;vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:26px;font-weight:700;color:#15803d;letter-spacing:0;">${d}</td>`
    )
    .join(`<td style="width:8px;"></td>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>IDPS Login Code</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!--
    The OTP code for autofill / notification copy:
    Your IDPS verification code is ${otp}
  -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#ffffff;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <!-- Clean Card Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:440px;background-color:#ffffff;border:1px solid #e5e7eb;border-top:4px solid #16a34a;border-radius:12px;overflow:hidden;">
          
          <!-- Header -->
          <tr>
            <td style="padding:32px 28px 0;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                <tr>
                  <td align="center">
                    <span style="display:inline-block;padding:4px 14px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:20px;font-size:12px;font-weight:800;color:#15803d;letter-spacing:1px;">
                      IDPS
                    </span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:12px;">
                    <h1 style="margin:0;font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
                      Login Verification Code
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:4px;">
                    <p style="margin:0;font-size:13px;color:#64748b;">
                      International Delhi Public School
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding:24px 28px 20px;text-align:center;">
              <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.5;">
                Use the following code to sign in to your account. This code is valid for <strong>5 minutes</strong>.
              </p>

              <!-- OTP Code Digits -->
              <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
                <tr>
                  ${digitBoxes}
                </tr>
              </table>

              <!-- Hidden machine-readable OTP for phone autofill -->
              <div style="height:0;overflow:hidden;max-height:0;font-size:0;line-height:0;">
                <code>${otp}</code>
                Your IDPS verification code is ${otp}
              </div>

              <!-- Security notice -->
              <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
                Never share this code with anyone. If you did not request this code, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 28px;">
              <hr style="border:none;border-top:1px solid #f1f5f9;margin:0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 28px 24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.4;">
                © ${year} International Delhi Public School · Automated message, please do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendMOtpail(email: string, otp: string) {
  try {
    // Subject includes the OTP so phone notification banners show it
    // and mobile OS can offer a "Copy Code" / autofill action.
    const subject = `${otp} is your IDPS login code`;
    const html = buildOtpEmailHtml(otp);

    await sendMail(email, subject, html);
  } catch (err) {
    console.error("Failed to send OTP email safely:", err);
  }
}
