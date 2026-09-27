<?php

/*
 * Stand-in for mysqldump in DbBackupTest. Usage (argv[1] is the scenario, the
 * rest are mysqldump's own arguments):
 *   complete  — writes a dump ending with mysqldump's completion trailer, exit 0
 *   truncated — writes a partial dump without the trailer, exit 0
 *   fail      — writes a partial dump and exits 2 (lost connection)
 */

$mode = $argv[1] ?? 'complete';
$resultFile = null;
foreach (array_slice($argv, 2) as $arg) {
    if (str_starts_with($arg, '--result-file=')) {
        $resultFile = substr($arg, strlen('--result-file='));
    }
}

if ($resultFile === null) {
    fwrite(STDERR, "fake-mysqldump: --result-file missing\n");
    exit(1);
}

$body = "-- MySQL dump\nCREATE TABLE `users` (`id` int);\nINSERT INTO `users` VALUES (1);\n";
$body .= '-- args: '.implode(' ', array_slice($argv, 2))."\n";

if ($mode === 'complete') {
    file_put_contents($resultFile, $body."-- Dump completed on 2026-09-27  3:00:01\n");
    exit(0);
}

file_put_contents($resultFile, $body);

if ($mode === 'fail') {
    fwrite(STDERR, "mysqldump: Error 2013: Lost connection to MySQL server during query\n");
    exit(2);
}

exit(0);
