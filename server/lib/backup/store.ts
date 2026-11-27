import type { DatabaseSync } from "node:sqlite";
import { chmodSync, readFileSync, realpathSync, mkdirSync, unlinkSync, statfsSync } from "node:fs";
import path from "node:path";

export type Backup = { id:string; target:"server"|"local"; status:string; requestedBy:number; startedAt:string; finishedAt:string|null; bytes:number; checksum:string|null; error:string|null };
export class BackupStorageError extends Error {}
let state: {db:DatabaseSync; dir:string} | undefined;
export function store() {
  if (state) return state;
  const mount = process.env.BACKUP_MOUNT;
  if (!mount || !path.isAbsolute(mount)) throw new BackupStorageError("Set BACKUP_MOUNT to the absolute backup mount point in the backend environment.");

  const root = realpathSync(mount);
  if (root === "/") throw new BackupStorageError("Use a dedicated mount point for BACKUP_MOUNT.");
  if (process.platform === "linux" && !readFileSync("/proc/self/mountinfo","utf8").split("\n").some(line=>line.split(" ")[4]?.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))) === root))
    throw new BackupStorageError("The directory configured in BACKUP_MOUNT is not mounted. Check it with mountpoint on the backend host.");
  if (process.platform !== "linux" && process.env.NODE_ENV === "production") throw new BackupStorageError("Production backups require a verified Linux mount.");
  const dir = path.join(root,"idps-backups");
  mkdirSync(dir,{recursive:true,mode:0o700});
  const sqlite:typeof import("node:sqlite") = require("node:sqlite");
  const db = new sqlite.DatabaseSync(path.join(dir,"history.sqlite"));
  chmodSync(path.join(dir,"history.sqlite"),0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,target TEXT,status TEXT,requestedBy INTEGER,startedAt TEXT,finishedAt TEXT,bytes INTEGER DEFAULT 0,checksum TEXT,error TEXT);
    CREATE TABLE IF NOT EXISTS retirements(jobId TEXT PRIMARY KEY, actor INTEGER, retiredAt TEXT);
    CREATE TABLE IF NOT EXISTS downloads(id INTEGER PRIMARY KEY,jobId TEXT,actor INTEGER,startedAt TEXT,finishedAt TEXT,status TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_backup ON jobs(status) WHERE status='running';`);
  // One Node process owns this mounted volume. Recover after a service restart.
  for (const row of db.prepare("SELECT id FROM jobs WHERE status='running'").all()) {
    for (const suffix of [".partial",".dump.age"]) removeFile(path.join(dir,String(row.id)+suffix));
  }
  db.prepare("UPDATE jobs SET status='failed', finishedAt=?, error='Service restarted during backup' WHERE status='running'").run(new Date().toISOString());
  db.exec("UPDATE downloads SET status='interrupted' WHERE status='sending'");
  for(const row of db.prepare("SELECT id FROM jobs WHERE status='retiring'").all()){
    removeFile(path.join(dir,String(row.id)+".dump.age"));
    db.prepare("UPDATE jobs SET status='retired' WHERE id=?").run(row.id);
  }
  state={db,dir};
  return state;
}
export function removeFile(file:string) {
  try { unlinkSync(file); } catch(e:any) { if(e.code!=="ENOENT") throw e; }
}
export function freeBytes() {
  const fs=statfsSync(store().dir);
  return fs.bavail*fs.bsize;
}
export function archive(id:string) { return path.join(store().dir,id+".dump.age"); }
export function history(id:string) { return store().db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Backup|undefined; }
