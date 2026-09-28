import { spawnSync } from 'node:child_process';

const quote = value => `'${value.replaceAll("'", "''")}'`;

function zipCommand(command) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; ${command}`],
  { windowsHide: true, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Windows ZIP failed: ${result.stderr}`);
}

export function createWindowsArchive(directory, archive) {
  zipCommand(`[IO.Compression.ZipFile]::CreateFromDirectory(${quote(directory)}, ${quote(archive)}, [IO.Compression.CompressionLevel]::Optimal, $true, [Text.Encoding]::UTF8)`);
}

export function extractWindowsArchive(archive, directory) {
  zipCommand(`[IO.Compression.ZipFile]::ExtractToDirectory(${quote(archive)}, ${quote(directory)}, [Text.Encoding]::UTF8)`);
}
