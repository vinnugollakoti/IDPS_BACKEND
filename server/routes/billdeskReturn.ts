import express from "express";

const router = express.Router();

function paymentReturnPage(_req: express.Request, res: express.Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payment verification | IDPS Kovvur</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f8f5; color: #173526; font-family: system-ui, sans-serif; }
    main { max-width: 440px; margin: 20px; padding: 32px; background: white; border: 1px solid #dfe8e0; border-radius: 18px; text-align: center; }
    h1 { font-size: 23px; }
    p { line-height: 1.6; }
  </style>
</head>
<body><main><h1>Payment is being verified</h1><p>Return to the parent app and refresh School fees to see the confirmed payment status.</p></main></body>
</html>`);
}

router.get("/", paymentReturnPage);
router.post("/", paymentReturnPage);

export default router;
