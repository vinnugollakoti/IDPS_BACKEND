import express, { Request, Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { auth, AuthRequest, isExecutiveRole } from "../middleware/auth";
import prisma from "../prisma/client";
import {archive,freeBytes,history,removeFile,store} from "../lib/backup/store";
import {start} from "../lib/backup/run";

const router=express.Router();
const tickets=new Map<string,{job:string;actor:number;expires:number}>();
const digest=(token:string)=>createHash("sha256").update(token).digest("hex");
const transfers=new Set<string>();

function expireLocalCopies(){
  const {db}=store();
  const cutoff=new Date(Date.now()-86400000).toISOString();
  for(const row of db.prepare("SELECT id FROM jobs WHERE target='local' AND status='ready' AND finishedAt<?").all(cutoff)){
    const id=String(row.id);
    if(transfers.has(id))continue;
    removeFile(archive(id));
    db.prepare("UPDATE jobs SET status='expired' WHERE id=?").run(id);
  }
}
setInterval(()=>{if(process.env.BACKUP_MOUNT)try{expireLocalCopies();}catch{console.error("Backup disk maintenance unavailable");}},3600000).unref();

async function permitted(id:number) {
  if(!(process.env.BACKUP_ADMIN_IDS||"").split(",").map(v=>v.trim()).includes(String(id)))return false;
  const user=await prisma.user.findUnique({where:{id},select:{role:true,email:true}});
  return !!user && isExecutiveRole(user.role) && user.email.toLowerCase()!==process.env.PLAY_REVIEW_EMAIL?.trim().toLowerCase();
}

// A browser navigation streams to the download manager without storing gigabytes
// in JavaScript memory. The single-use capability is posted in the request body.
router.post("/file",async(req:Request,res:Response)=>{
  const key=digest(typeof req.body?.ticket==="string"?req.body.ticket:"");
  const ticket=tickets.get(key);tickets.delete(key);
  if(!ticket || ticket.expires<=Date.now() || !(await permitted(ticket.actor)))return res.sendStatus(403);
  const job=history(ticket.job);
  if(!job || job.status!=="ready")return res.sendStatus(410);
  if(transfers.has(job.id))return res.sendStatus(409);
  const {db}=store();
  const attempt=db.prepare("INSERT INTO downloads(jobId,actor,startedAt,status) VALUES(?,?,?,'sending')").run(job.id,ticket.actor,new Date().toISOString()).lastInsertRowid;
  transfers.add(job.id);
  res.download(archive(job.id),"idps-"+job.startedAt.slice(0,10)+"-"+job.id+".dump.age",err=>{
    transfers.delete(job.id);
    db.prepare("UPDATE downloads SET status=?,finishedAt=? WHERE id=?").run(err?"interrupted":"sent",new Date().toISOString(),attempt);
    if(err && !res.headersSent)res.sendStatus(503);
    else if(err)res.destroy();
  });
});
router.use(auth,async(req:AuthRequest,res,next)=>{
  if(!isExecutiveRole(req.user.role) || !await permitted(Number(req.user.userId)))return res.sendStatus(403);
  next();
});
router.get("/",(_req,res)=>{
  expireLocalCopies();
  const {db}=store();
  res.json({freeBytes:freeBytes(),jobs:db.prepare("SELECT * FROM jobs ORDER BY startedAt DESC LIMIT 200").all(),
    downloads:db.prepare("SELECT * FROM downloads ORDER BY id DESC LIMIT 200").all()});
});
router.post("/",(req:AuthRequest,res)=>{
  const target=req.body?.target;
  if(target!=="local" && target!=="server")return res.sendStatus(400);
  try {expireLocalCopies();return res.status(202).json({id:start(target,Number(req.user.userId))});}
  catch(e:any){return res.status(409).json({message:e.code?"Backup disk unavailable. Check the persistent mount.":e.message});}
});
router.delete("/:id",(req:AuthRequest,res)=>{
  const job=history(req.params.id);
  if(!job || job.target!=="server" || job.status!=="ready")return res.sendStatus(404);
  if(transfers.has(job.id))return res.status(409).json({message:"A download is active."});
  const {db}=store();
  const newer=db.prepare("SELECT id FROM jobs WHERE target='server' AND status='ready' AND startedAt>? LIMIT 1").get(job.startedAt);
  if(!newer)return res.status(409).json({message:"Keep the most recent server archive."});
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO retirements VALUES(?,?,?)").run(job.id,Number(req.user.userId),new Date().toISOString());
    db.prepare("UPDATE jobs SET status='retiring' WHERE id=?").run(job.id);
    db.exec("COMMIT");
  } catch(e){db.exec("ROLLBACK");throw e;}
  removeFile(archive(job.id));
  db.prepare("UPDATE jobs SET status='retired' WHERE id=?").run(job.id);
  return res.sendStatus(204);
});
router.post("/:id/ticket",(req:AuthRequest,res)=>{
  expireLocalCopies();
  const job=history(req.params.id);
  if(!job || job.status!=="ready")return res.sendStatus(404);
  for(const [key,t] of tickets)if(t.expires<=Date.now())tickets.delete(key);
  const token=randomBytes(32).toString("base64url");
  tickets.set(digest(token),{job:job.id,actor:Number(req.user.userId),expires:Date.now()+60000});
  return res.json({ticket:token});
});
router.use((_err:unknown,_req:Request,res:Response,_next:express.NextFunction)=>res.status(503).json({message:"Backup service unavailable. Check the private disk and database configuration."}));
export default router;
