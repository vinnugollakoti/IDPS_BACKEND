// Run only against an empty disposable local database with the webhook migration applied.
import express from "express";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { CompactEncrypt, CompactSign } from "jose";
import router from "../routes/billdesk";
import db from "../prisma/client";

async function main() {
  if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Requires disposable loopback database");
  assert.equal(await db.billDeskWebhookEvent.count(),0);
  const signing=randomBytes(32).toString("hex"), encryption=randomBytes(16).toString("hex");
  Object.assign(process.env,{BILLDESK_MERCHANT_ID:"merchant",BILLDESK_CLIENT_ID:"client",BILLDESK_SIGNING_KEY_ID:"sig",BILLDESK_SIGNING_KEY:signing,BILLDESK_ENCRYPTION_KEY_ID:"enc",BILLDESK_ENCRYPTION_KEY:encryption});
  const app=express(); app.use("/payments/billdesk/webhook",router);
  const server=app.listen(0,"127.0.0.1"); await new Promise(r=>server.once("listening",r));
  async function sign(status:string){
    const payload={objectid:"transaction",currency:"356",orderid:"one",transactionid:"txn",auth_status:status,amount:"400.50",mercid:"merchant"};
    const encrypted=await new CompactEncrypt(Buffer.from(JSON.stringify(payload))).setProtectedHeader({alg:"dir",enc:"A256GCM",kid:"enc",clientid:"client"}).encrypt(Buffer.from(encryption));
    return new CompactSign(Buffer.from(encrypted)).setProtectedHeader({alg:"HS256",kid:"sig",clientid:"client"}).sign(Buffer.from(signing));
  }
  const post=async(body:string,type="application/jose")=>(await fetch("http://127.0.0.1:"+(server.address() as import("net").AddressInfo).port+"/payments/billdesk/webhook",{method:"POST",headers:{"Content-Type":type},body})).status;
  try {
    const success=await sign("0300");
    assert.deepEqual(await Promise.all([post(success),post(success)]),[200,200]);
    assert.equal(await post(await sign("0300")),200);
    assert.equal(await post(await sign("0002")),200);
    assert.equal(await post("invalid"),401);
    assert.equal(await post("{}","application/json"),415);
    assert.equal(await db.billDeskWebhookEvent.count(),2);
    console.log("BillDesk webhook checks passed");
  } finally { server.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
