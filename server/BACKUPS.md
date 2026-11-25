# School database backups

The portal creates a PostgreSQL custom archive with pg_dump and streams it through age encryption. The school keeps the age private identity offline. Both buttons produce the same format. **Save to server SSD** retains an archive on the mount. **Download locally** stages the encrypted file there for 24 hours so a browser can download or retry without holding it in memory. Both are manual snapshots.

## Enable on the backend

1. Run one backup-enabled backend process on the primary AWS Lightsail instance. Use the instance SSD as described below. Install Node 24, age and PostgreSQL client 17 (upgrade with the source major version), or use the provided server Dockerfile. Leave the backup environment variables unset on the Render and Railway standby services. The portal uses its existing backend origin for backup requests. The production route is `https://api.idpskovvur.com/admin/backups`.
2. On an offline recovery machine run `age-keygen -o school-recovery.key`. Keep a recoverable copy of this **private** file outside the server. Use `age-keygen -y school-recovery.key` to obtain the public recipient. A lost private key makes both PC and SSD archives unreadable.
3. Set BACKUP_MOUNT to the actual mount point and BACKUP_AGE_RECIPIENT to the public age1… recipient. Receptionists, directors, principals and chairmen can manage backups. The API verifies the current database role on every operation, including download ticket redemption, and excludes the configured Play review account.
4. Put the backup PostgreSQL URL into BACKUP_DATABASE_URL. Use the full source database via direct connection or Supabase session pooler, with a role able to read all application and managed schemas without RLS filtering. Use the Supabase database CA file path in BACKUP_SSL_ROOT_CERT for TLS verification. The password is passed to the child via environment, never argv. After validating on staging, request the first real archive in the portal.
5. Keep 1 GiB free. Only one job runs at a time. PC downloads remain until the administrator removes them; temporary server staging files are removed hourly after 24 hours. Server archives are kept until explicitly retired. If the volume fills, first make and verify a separate recovery copy, then use **Remove older server copy** in the dashboard. The newest server archive is protected. Preserve history.sqlite and its WAL files. Production requires a Linux mount visible in /proc/self/mountinfo; an ordinary ephemeral folder is rejected.

## Use the Lightsail instance SSD

Create a private directory on the persistent host filesystem, for example `/var/lib/idps/backup-storage`, owned by the backend service account with mode `0700`. The example mount point seen by the backend is `/mnt/idps-backup`. Choose the setup that matches the deployment.

- **Docker** — Set the host directory owner to the container service UID (1000 in the provided image, adjusted if using user namespace mapping). Add `--mount type=bind,source=/var/lib/idps/backup-storage,target=/mnt/idps-backup` to the backend container configuration and set `BACKUP_MOUNT=/mnt/idps-backup` inside it.
- **Native Linux service** — Create `/mnt/idps-backup` as a mount point. Add the following entry once to the host's `/etc/fstab`, then run `sudo mount /mnt/idps-backup`. For systemd, add `RequiresMountsFor=/mnt/idps-backup` under `[Unit]` in the service override. Set `BACKUP_MOUNT=/mnt/idps-backup` in the service environment.

```fstab
/var/lib/idps/backup-storage /mnt/idps-backup none bind 0 0
```

Verify the exact mount with `mountpoint /mnt/idps-backup` in the backend's mount namespace. Check available space with `df -h /mnt/idps-backup`. The OS, logs, backup catalog and staged downloads all share the instance SSD capacity. Keep a verified encrypted copy on a separate machine for recovery if the instance is lost. Access the backup dashboard through the HTTPS API domain before sending administrator credentials.

## Recovery drill

Use an isolated database with a compatible PostgreSQL version, source roles, extensions and the Supabase platform prerequisites. Restoring over production is an operator decision. Compare SHA-256 of the encrypted archive with the dashboard. Decrypt on a trusted machine:

    age -d -i school-recovery.key -o school.dump idps-backup.dump.age
    pg_restore --list school.dump
    pg_restore --exit-on-error --single-transaction --dbname=recovery school.dump

For a fresh Supabase project, reconcile preinstalled managed schemas/extensions and ownership with its restore instructions before restoring. Check row counts, relationships, login and representative school records. Restrict and remove plaintext drill files after verification. During a source outage, an infrastructure administrator can retrieve encrypted server archives directly from the mounted idps-backups directory.

## Coverage and operations

Each archive uses one exported snapshot for the coverage check and pg_dump. No schema/table filters or row-security mode are used. This includes persisted table data, schema, sequences, constraints and database large objects as supported by pg_dump. The job refuses to mark success for unreadable, row-filtered, foreign or extension-owned tables that pg_dump cannot fully export. PostgreSQL system catalogs, cluster-wide roles/passwords, provider settings, and external Storage bucket file contents are outside a logical database dump. Storage metadata is included. Supabase Vault recovery also requires compatible platform encryption keys. A server archive alone does not protect against loss of that server and disk.

The private SQLite catalog records requests, actor IDs, start/end times, failures, archive sizes, ciphertext hashes and file transfer attempts. “Sent” means the server finished transferring the file; browsers cannot report whether a person retained it. Interrupted jobs become failed after restart. Keep the mount out of static file serving. The API returns the latest 200 jobs and transfers. Review the dashboard after each job and repeat an isolated restore drill after PostgreSQL or platform changes.

References: [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [Supabase database backups](https://supabase.com/docs/guides/platform/backups), [ERPNext backup downloads](https://docs.frappe.io/erpnext/download-backup).
