import { detectPlatform, downloads } from './download-platform.js';

const platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
const recommended = document.getElementById('recommended');
const detected = document.getElementById('detected');
if (platform !== 'other') {
  recommended.href = downloads[platform].url;
  recommended.textContent = downloads[platform].label;
  detected.textContent = platform === 'windows'
    ? '已为你推荐 Windows 版，Windows 10 与 11 通用。'
    : '已为你推荐 macOS 版，自动选择 Apple 芯片或 Intel 运行环境。';
} else {
  recommended.href = '#versions';
  recommended.textContent = '选择电脑系统';
  detected.textContent = '请在下方选择你的电脑系统。';
}
