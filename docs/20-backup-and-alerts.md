# 20 · Backups & Ops Alerts

## ملخّص بالعربي

- **باك أب تلقائي كل ليلة** (3 صباحاً): نسخة مضغوطة من قاعدة البيانات في
  `backend/storage/app/backups/` (محفوظة على الهوست، تصمد بعد إعادة إنشاء الحاويات)،
  تُحفظ **7 أيام** ثم تُحذف الأقدم.
- **تنبيهات تشغيلية كل 5 دقائق**: إيميل لفريقك لما **جلسة أوبر تنكسر** (شركة تحتاج
  إعادة ربط) أو **بوكس ديمون يوقع** — مرّة واحدة لكل حادثة + إيميل "تم الحل" لما ترجع.
- **مطلوب منك:** ضِف سرّ GitHub `ALERT_EMAIL` (إيميل الاستقبال) — بدونه التنبيهات
  تُسجَّل فقط بلا إيميل. وانسخ الباك أب **خارج السيرفر** (Netcup Backup Space).

---

## 1. Database backups

`db:backup` (scheduled nightly at 03:00) runs `mysqldump --single-transaction`
piped through gzip to `storage/app/backups/ridy-<timestamp>.sql.gz`, then prunes
files older than 7 days (`--keep=N` to change). The backend image now ships the
mysql client so this runs inside the scheduler container.

Run one on demand:
```bash
docker compose -f docker-compose.prod.yml exec -T backend php artisan db:backup
```

### Restore
```bash
cd ~/ridy
gunzip -c backend/storage/app/backups/ridy-<timestamp>.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T mysql \
  mysql -uroot -p"$DB_ROOT_PASSWORD" ridy
docker compose -f docker-compose.prod.yml exec -T backend php artisan migrate --force
```

### ⚠️ Offsite copy (do this)
The nightly dump lives on the **same box** — a disk loss loses it too. Copy it
offsite:
- **Netcup Backup Space** (add-on) or SCP snapshots — box-level, easiest.
- Or `rclone`/`scp` the newest `.sql.gz` to object storage / another box on a cron.

A backup you haven't restore-tested isn't a backup — do one trial restore.

## 2. Ops alerts

`alerts:check` (every 5 min) raises a **single** email per incident and an
all-clear when it resolves (de-duplicated via the `alert_incidents` table):

| Alert | Trigger | Why it matters |
|---|---|---|
| **Uber session broken** | a fleet session is `expired` / `needs_relink` | that company gets **no offers** until a manager reconnects |
| **Daemon shard down** | an active shard stopped heartbeating (>180s) | its box is down; companies fail over to live shards but the box needs attention |

### Configure the recipient
Add a GitHub Actions secret **`ALERT_EMAIL`** (e.g. `ops@reidey.de`). The deploy
writes it into `.env`; empty = alerts are only logged (`RidyLog` `alert.opened` /
`alert.resolved`), never emailed. Email goes through the same mailer as the rest
of the app (Resend in production).

### Tuning / extending
- Staleness window: `DaemonShard::STALE_SECONDS` (180s).
- Add checks in `CheckAlerts` (e.g. offer-flow stalled per tenant) using
  `AlertService::open()/resolve()` with a new stable `key` prefix.

### References
- `App\Console\Commands\DbBackup`, `App\Console\Commands\CheckAlerts`
- `App\Domain\Ops\AlertService` + `alert_incidents` table
- Sharding: `docs/18-daemon-sharding.md` · Scale-out: `docs/19-scale-out-runbook.md`
