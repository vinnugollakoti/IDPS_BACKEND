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
        `<td style="width:44px;height:52px;background-color:#f0fdf4;border:2px solid #bbf7d0;border-radius:10px;text-align:center;vertical-align:middle;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:28px;font-weight:700;color:#166534;letter-spacing:0;">${d}</td>`
    )
    .join(`<td style="width:8px;"></td>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>IDPS Login OTP</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!--
    The OTP code for autofill / notification copy:
    Your IDPS verification code is ${otp}
  -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #004b23 0%, #006400 50%, #38b000 100%);padding:32px 24px 28px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <div style="width:56px;height:56px;background-color:rgba(255,255,255,0.2);border-radius:50%;display:inline-block;line-height:56px;text-align:center;">
                      <span style="font-size:28px;color:#ffffff;">🔐</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:16px;">
                    <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">Verify Your Identity</h1>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:6px;">
                    <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.85);font-weight:400;">IDPS Teacher Portal — One-Time Password</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 24px 24px;">
              <p style="margin:0 0 6px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
                Use the code below to complete your login.
              </p>
              <p style="margin:0 0 24px;font-size:13px;color:#94a3b8;text-align:center;">
                This code expires in <strong style="color:#475569;">5 minutes</strong>.
              </p>

              <!-- OTP Digits -->
              <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                <tr>
                  ${digitBoxes}
                </tr>
              </table>

              <!-- Hidden machine-readable OTP for phone autofill -->
              <div style="height:0;overflow:hidden;max-height:0;font-size:0;line-height:0;">
                <code>${otp}</code>
                Your IDPS verification code is ${otp}
              </div>

              <!-- Copy hint -->
              <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center;">
                On your phone? Tap the code from the notification to copy it.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 24px;">
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;" />
            </td>
          </tr>

          <!-- Security notice -->
          <tr>
            <td style="padding:20px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="width:36px;vertical-align:top;">
                    <div style="width:28px;height:28px;background-color:#fef3c7;border-radius:50%;text-align:center;line-height:28px;">
                      <span style="font-size:14px;">⚠</span>
                    </div>
                  </td>
                  <td style="vertical-align:top;padding-left:10px;">
                    <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">
                      <strong style="color:#475569;">Security Notice:</strong> Never share this code with anyone. IDPS staff will never ask for your OTP. If you didn't request this code, please ignore this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:20px 24px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#334155;">IDPS — Intelligent Data Processing System</p>
              <p style="margin:0;font-size:11px;color:#94a3b8;">© ${year} IDPS Team · Automated message — do not reply</p>
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
