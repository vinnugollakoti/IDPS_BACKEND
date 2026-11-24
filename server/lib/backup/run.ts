import {openSnapshot} from "./coverage";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { open, rename } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { archive, freeBytes, removeFile, store } from "./store";

const reserve = 1024**3;
export function config() {
  const recipient=process.env.BACKUP_AGE_RECIPIENT || "";
  const connection=process.env.BACKUP_DATABASE_URL;
  if (!/^age1[a-z0-9]{58}$/.test(recipient) || !connection) throw new Error("Configure the backup database connection and age public recipient.");
  const url=new URL(connection);
  if (!["postgres:","postgresql:"].includes(url.protocol) || url.port==="6543") throw new Error("Backups require a direct or session PostgreSQL connection.");
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH,PGHOST:url.hostname,PGPORT:url.port||"5432",PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGCONNECT_TIMEOUT:"15",PGAPPNAME:"idps-backup",PGSSLMODE:"verify-full"};
  if (process.env.BACKUP_SSL_ROOT_CERT) env.PGSSLROOTCERT=process.env.BACKUP_SSL_ROOT_CERT;
  if (url.hostname==="127.0.0.1" && process.env.NODE_ENV!=="production") env.PGSSLMODE="disable";
  return {recipient,env};
}
export function start(target:"server"|"local", actor:number) {
  const settings=config();
  const {db,dir}=store();
  if(db.prepare("SELECT id FROM jobs WHERE status='running'").get()) throw new Error("A backup is already running.");
  const budget=freeBytes()-reserve;
  if(budget<1024**2) throw new Error("Disk space is low. Keep at least 1 GiB free.");
  const id=randomUUID();
  db.prepare("INSERT INTO jobs(id,target,status,requestedBy,startedAt) VALUES(?,?,'running',?,?)").run(id,target,actor,new Date().toISOString());
  void run().catch(()=>{
    db.prepare("UPDATE jobs SET status='failed', finishedAt=?,error='Could not complete backup. Check database and disk configuration.' WHERE id=? AND status='running'").run(new Date().toISOString(),id);
  });
  return id;
  async function run() {
    const partial=path.join(dir,id+".partial");
    let bytes=0;
    let checkedAt=0;
    const hash=createHash("sha256");
    let snapshot;
    try {snapshot=await openSnapshot(settings.env);}
    catch(e:any) {
      db.prepare("UPDATE jobs SET status='failed',finishedAt=?,error=? WHERE id=?").run(new Date().toISOString(),e.message.startsWith("Coverage check failed")?e.message:"Could not open database snapshot. Check TLS, credentials and session connection.",id);
      return;
    }
    snapshot.client.on("error",()=>{}); // pg_dump exits on an invalid snapshot or lost source connection.
    const dump=spawn("pg_dump",["--snapshot",snapshot.id,"--format=custom","--no-password","--lock-wait-timeout=30s"],{env:settings.env,stdio:["ignore","pipe","pipe"]});
    const age=spawn("age",["--encrypt","--recipient",settings.recipient],{env:{PATH:process.env.PATH},stdio:["pipe","pipe","pipe"]});
    const children=[dump,age];
    const failures:string[]=[];
    const done=children.map((child,i)=>new Promise<void>((resolve,reject)=>{
      child.stderr.resume(); // Never persist database credentials or row content.
      child.once("error",()=>reject(new Error((i?"age":"pg_dump")+" could not start.")));
      child.once("close",code=>{
        if(code===0) resolve();
        else { const msg=(i?"Encryption failed.":"PostgreSQL dump failed. Check client version, connection, TLS, table and RLS permissions."); failures.push(msg);reject(new Error(msg)); }
      });
    }));
    const timer=setTimeout(()=>children.forEach(c=>c.kill("SIGKILL")),2*60*60*1000);
    try {
      const limit=new Transform({transform(chunk:Buffer,_encoding,cb){
        try {
        bytes+=chunk.length;
        if(bytes>budget || (bytes-checkedAt>=4*1024**2 && freeBytes()<reserve)) return cb(new Error("Backup stopped at the disk reserve."));
        if(bytes-checkedAt>=4*1024**2) checkedAt=bytes;
        hash.update(chunk);cb(null,chunk);
        } catch { cb(new Error("Could not check backup disk capacity.")); }
      }});
      await Promise.all([...done,pipeline(dump.stdout,age.stdin),pipeline(age.stdout,limit,createWriteStream(partial,{flags:"wx",mode:0o600}))]);
      const file=await open(partial,"r");
      try {await file.sync();} finally {await file.close();}
      await rename(partial,archive(id));
      const directory=await open(dir,"r");try {await directory.sync();} finally {await directory.close();}
      db.prepare("UPDATE jobs SET status='ready',bytes=?,checksum=?,finishedAt=? WHERE id=?").run(bytes,hash.digest("hex"),new Date().toISOString(),id);
    } catch(e:any) {
      children.forEach(c=>c.kill("SIGKILL"));
      await Promise.allSettled(done);
      removeFile(partial);removeFile(archive(id));
      db.prepare("UPDATE jobs SET status='failed',error=?,finishedAt=? WHERE id=?").run(failures[0]||String(e.message).slice(0,180),new Date().toISOString(),id);
    } finally {clearTimeout(timer);await snapshot.client.end().catch(()=>{});}
  }
}
