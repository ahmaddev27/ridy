<?php

namespace App\Domain\System;

/**
 * A point-in-time snapshot of the HOST machine's resource usage — CPU, memory,
 * disk and network — for the admin System Health board.
 *
 * The backend runs inside a container, so the host's real figures are read from
 * its /proc and root filesystem mounted read-only (services.system.*). When
 * those mounts are absent (local dev) the reads fall back to the container's own
 * paths, so the endpoint always returns something usable rather than erroring.
 *
 * CPU-usage and network-throughput are rates, not instantaneous values, so they
 * are derived from two /proc samples taken a short interval apart within one
 * call. The interval is deliberately small (200 ms) to keep the request snappy.
 */
class SystemMetricsService
{
    /** Sampling gap for the two rate snapshots (CPU %, network B/s), in microseconds. */
    private const SAMPLE_GAP_US = 200_000;

    /**
     * The full metrics payload. Any single metric that cannot be read on this
     * host degrades to null rather than failing the whole response.
     *
     * @return array<string, mixed>
     */
    public function snapshot(): array
    {
        // Two samples around one short sleep feed both the CPU-usage and the
        // network-throughput rates, so we pay the interval cost only once.
        $first = $this->sampleRates();
        usleep(self::SAMPLE_GAP_US);
        $second = $this->sampleRates();

        return [
            'cpu' => $this->cpu($first, $second),
            'memory' => $this->memory(),
            'disk' => $this->disk(),
            'network' => $this->network($first, $second),
            'sampled_at' => now()->toIso8601String(),
        ];
    }

    /** The host /proc path when mounted, else the container's own. */
    private function proc(): string
    {
        $configured = (string) config('services.system.proc');

        return is_dir($configured) ? $configured : '/proc';
    }

    /** The host root path when mounted, else the container root. */
    private function diskPath(): string
    {
        $configured = (string) config('services.system.disk');

        return is_dir($configured) ? $configured : '/';
    }

    /**
     * One rate sample: cumulative CPU jiffies (total/idle) and network bytes
     * (rx/tx). Two of these a short interval apart yield the usage rates.
     *
     * @return array{cpu_total: int, cpu_idle: int, rx: int, tx: int}
     */
    private function sampleRates(): array
    {
        [$total, $idle] = $this->cpuJiffies();
        [$rx, $tx] = $this->netBytes();

        return ['cpu_total' => $total, 'cpu_idle' => $idle, 'rx' => $rx, 'tx' => $tx];
    }

    /**
     * The aggregate CPU line from /proc/stat as [total jiffies, idle jiffies].
     * idle counts both idle and iowait; total is every field summed.
     *
     * @return array{0: int, 1: int}
     */
    private function cpuJiffies(): array
    {
        $stat = @file_get_contents($this->proc().'/stat');
        if ($stat === false || ! preg_match('/^cpu\s+(.*)$/m', $stat, $m)) {
            return [0, 0];
        }
        $fields = array_map('intval', preg_split('/\s+/', trim($m[1])));
        $total = array_sum($fields);
        // Fields: user nice system idle iowait irq softirq steal ...
        $idle = ($fields[3] ?? 0) + ($fields[4] ?? 0);

        return [$total, $idle];
    }

    /**
     * Summed receive/transmit bytes across real interfaces from /proc/net/dev,
     * excluding loopback and virtual (docker/veth/br) interfaces so the figure
     * reflects genuine external traffic.
     *
     * @return array{0: int, 1: int}
     */
    private function netBytes(): array
    {
        $dev = @file_get_contents($this->proc().'/net/dev');
        if ($dev === false) {
            return [0, 0];
        }

        $rx = 0;
        $tx = 0;
        foreach (explode("\n", $dev) as $line) {
            if (! str_contains($line, ':')) {
                continue; // header rows
            }
            [$iface, $rest] = explode(':', $line, 2);
            $iface = trim($iface);
            if ($iface === 'lo' || str_starts_with($iface, 'veth') || str_starts_with($iface, 'docker') || str_starts_with($iface, 'br-')) {
                continue;
            }
            $cols = preg_split('/\s+/', trim($rest));
            $rx += (int) ($cols[0] ?? 0);  // received bytes
            $tx += (int) ($cols[8] ?? 0);  // transmitted bytes
        }

        return [$rx, $tx];
    }

    /**
     * CPU load averages (1/5/15 min), core count, and the usage percentage
     * derived from the two jiffy samples.
     *
     * @param  array{cpu_total: int, cpu_idle: int, rx: int, tx: int}  $a
     * @param  array{cpu_total: int, cpu_idle: int, rx: int, tx: int}  $b
     * @return array<string, mixed>
     */
    private function cpu(array $a, array $b): array
    {
        $totalDelta = $b['cpu_total'] - $a['cpu_total'];
        $idleDelta = $b['cpu_idle'] - $a['cpu_idle'];
        $usage = $totalDelta > 0 ? (1 - $idleDelta / $totalDelta) * 100 : null;

        $load = @file_get_contents($this->proc().'/loadavg');
        $avg = $load !== false ? array_slice(preg_split('/\s+/', trim($load)), 0, 3) : [];

        return [
            'usage_percent' => $usage !== null ? round(max(0, min(100, $usage)), 1) : null,
            'cores' => $this->cores(),
            'load' => array_map('floatval', $avg) ?: null,
        ];
    }

    /** Logical CPU count from /proc/cpuinfo (falls back to 1). */
    private function cores(): int
    {
        $info = @file_get_contents($this->proc().'/cpuinfo');

        return $info !== false ? max(1, substr_count($info, 'processor')) : 1;
    }

    /**
     * Host memory: total/used/available bytes and the used percentage, from
     * /proc/meminfo (MemAvailable is the kernel's own "free for apps" figure).
     *
     * @return array<string, mixed>
     */
    private function memory(): array
    {
        $info = @file_get_contents($this->proc().'/meminfo');
        if ($info === false) {
            return ['total_bytes' => null, 'used_bytes' => null, 'available_bytes' => null, 'used_percent' => null];
        }

        $kb = function (string $key) use ($info): ?int {
            return preg_match('/^'.preg_quote($key, '/').':\s+(\d+)\s*kB/m', $info, $m) ? (int) $m[1] * 1024 : null;
        };
        $total = $kb('MemTotal');
        $available = $kb('MemAvailable');
        $used = ($total !== null && $available !== null) ? $total - $available : null;

        return [
            'total_bytes' => $total,
            'used_bytes' => $used,
            'available_bytes' => $available,
            'used_percent' => ($total && $used !== null) ? round($used / $total * 100, 1) : null,
        ];
    }

    /**
     * Host disk: total/used/free bytes and the used percentage for the root
     * filesystem.
     *
     * @return array<string, mixed>
     */
    private function disk(): array
    {
        $path = $this->diskPath();
        $total = @disk_total_space($path);
        $free = @disk_free_space($path);
        if ($total === false || $free === false) {
            return ['total_bytes' => null, 'used_bytes' => null, 'free_bytes' => null, 'used_percent' => null];
        }
        $used = $total - $free;

        return [
            'total_bytes' => (int) $total,
            'used_bytes' => (int) $used,
            'free_bytes' => (int) $free,
            'used_percent' => $total > 0 ? round($used / $total * 100, 1) : null,
        ];
    }

    /**
     * Network throughput (bytes/sec, both directions) between the two samples,
     * plus the cumulative counters.
     *
     * @param  array{cpu_total: int, cpu_idle: int, rx: int, tx: int}  $a
     * @param  array{cpu_total: int, cpu_idle: int, rx: int, tx: int}  $b
     * @return array<string, mixed>
     */
    private function network(array $a, array $b): array
    {
        $seconds = self::SAMPLE_GAP_US / 1_000_000;

        return [
            'rx_bytes_per_sec' => max(0, (int) round(($b['rx'] - $a['rx']) / $seconds)),
            'tx_bytes_per_sec' => max(0, (int) round(($b['tx'] - $a['tx']) / $seconds)),
            'rx_total_bytes' => $b['rx'],
            'tx_total_bytes' => $b['tx'],
        ];
    }
}
