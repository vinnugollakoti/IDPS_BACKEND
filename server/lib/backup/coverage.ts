import {readFile} from "node:fs/promises";
import { Client } from "pg";

// Keep this transaction open until pg_dump finishes so the catalog check and
// the dump describe the same database snapshot.
export async function openSnapshot(env:NodeJS.ProcessEnv) {
  const client = new Client({host:env.PGHOST,port:Number(env.PGPORT),database:env.PGDATABASE,
    user:env.PGUSER,password:env.PGPASSWORD,connectionTimeoutMillis:15000,
    ssl:env.PGSSLMODE==="disable"?false:{rejectUnauthorized:true,...(env.PGSSLROOTCERT?{ca:await readFile(env.PGSSLROOTCERT,"utf8")}: {})}});
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const {rows} = await client.query(`
      SELECT count(*)::integer AS tables,
        count(*) FILTER (WHERE NOT has_table_privilege(c.oid,'SELECT')
          OR row_security_active(c.oid) OR c.relkind='f'
          OR (e.oid IS NOT NULL AND NOT EXISTS (
            SELECT FROM unnest(e.extconfig,e.extcondition) cfg(id,condition)
            WHERE cfg.id=c.oid AND coalesce(cfg.condition,'')=''
          )))::integer AS unsupported
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'
      LEFT JOIN pg_extension e ON e.oid=d.refobjid
      WHERE c.relkind IN ('r','p','f') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`);
    if(!rows[0].tables || rows[0].unsupported)throw new Error("Coverage check failed: unreadable, row-filtered, external or extension-managed tables require operator review.");
    const {rows:snapshot}=await client.query("SELECT pg_export_snapshot() AS id");
    return {client,id:String(snapshot[0].id),tables:Number(rows[0].tables)};
  } catch(e){await client.end();throw e;}
}
