import express, { ErrorRequestHandler } from "express";
import { createHash } from "node:crypto";
import { compactDecrypt, compactVerify } from "jose";
import prisma from "../prisma/client";

const router = express.Router();
const joseType = "application/jose";
const text = express.text({ type: joseType, limit: "64kb", inflate: false });
const reference = (value: unknown): value is string =>
  typeof value === "string" && /^[!-~]{1,128}$/.test(value);

router.post("/", text, async (req, res) => {
  if (!req.is(joseType)) return res.sendStatus(415);
  const {
    BILLDESK_MERCHANT_ID: merchantId, BILLDESK_CLIENT_ID: clientId,
    BILLDESK_SIGNING_KEY: signing, BILLDESK_SIGNING_KEY_ID: signingId,
    BILLDESK_ENCRYPTION_KEY: encryption, BILLDESK_ENCRYPTION_KEY_ID: encryptionId,
  } = process.env;
  if (!merchantId || !clientId || !signingId || !encryptionId || !signing || !encryption ||
      Buffer.byteLength(signing) < 32 || Buffer.byteLength(encryption) !== 32 || signing === encryption)
    return res.sendStatus(503);

  let event;
  try {
    const verified = await compactVerify(req.body, Buffer.from(signing), { algorithms: ["HS256"] });
    if (verified.protectedHeader.clientid !== clientId || verified.protectedHeader.kid !== signingId)
      return res.sendStatus(401);
    const decrypted = await compactDecrypt(verified.payload, Buffer.from(encryption), {
      keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"],
    });
    if (decrypted.protectedHeader.clientid !== clientId || decrypted.protectedHeader.kid !== encryptionId)
      return res.sendStatus(401);
    event = JSON.parse(new TextDecoder().decode(decrypted.plaintext));
  } catch { return res.sendStatus(401); }

  if (event?.mercid !== merchantId) return res.sendStatus(401);
  const { objectid, orderid: orderId, transactionid: transactionId, auth_status: authStatus, amount, currency } = event;
  if (objectid !== "transaction" || currency !== "356" || !reference(orderId) || !reference(transactionId) ||
      typeof authStatus !== "string" || !/^\d{4}$/.test(authStatus) ||
      typeof amount !== "string" || !/^\d{1,16}(\.\d{1,2})?$/.test(amount) || !/[1-9]/.test(amount))
    return res.sendStatus(422);

  const [whole, fraction = ""] = amount.split(".");
  const normalizedAmount = BigInt(whole).toString() + "." + fraction.padEnd(2, "0");
  const eventKey = createHash("sha256").update(JSON.stringify([
    merchantId, orderId, transactionId, authStatus, normalizedAmount, currency,
  ])).digest("hex");
  try {
    // A retry and a concurrent delivery converge on the same database row.
    // Different statuses remain separate evidence for order reconciliation.
    await prisma.billDeskWebhookEvent.createMany({
      data: [{ eventKey, merchantId, orderId, transactionId, authStatus, amount: normalizedAmount, currency }],
      skipDuplicates: true,
    });
    return res.status(200).end();
  } catch {
    console.error("BillDesk webhook inbox write failed");
    return res.sendStatus(503);
  }
});

const parserError: ErrorRequestHandler = (err, _req, res, _next) => {
  res.sendStatus(err.status === 413 ? 413 : err.status === 415 ? 415 : 400);
};
router.use(parserError);
export default router;
