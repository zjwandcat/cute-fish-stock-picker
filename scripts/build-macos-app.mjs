import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const macAppName = '可爱鱼儿选股指南.app';

export async function buildMacApp(stage, version) {
  const app = join(stage, macAppName);
  const contents = join(app, 'Contents');
  const binary = join(contents, 'MacOS', 'CuteFish');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  const run = (command, args) => {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed: ${result.status}`);
  };
  run('xcrun', ['clang', '-fobjc-arc', '-framework', 'Cocoa', '-arch', 'arm64', '-arch', 'x86_64',
    '-mmacosx-version-min=11.0', '-O2', 'scripts/macos/main.m', '-o', binary]);
  await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>CuteFish</string>
<key>CFBundleIdentifier</key><string>com.zjwandcat.cute-fish-stock-picker</string>
<key>CFBundleName</key><string>可爱鱼儿选股指南</string>
<key>CFBundleDisplayName</key><string>可爱鱼儿选股指南</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
  // An ad-hoc signature provides bundle integrity, not Developer ID trust or notarization.
  run('codesign', ['--force', '--sign', '-', app]);
  run('codesign', ['--verify', '--strict', app]);
  run('lipo', ['-verify_arch', 'arm64', 'x86_64', binary]);
}
