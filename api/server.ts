/**
 * Local development server entry.
 */
import app from './app.js';
import { warmupBagholder50 } from './services/bagholder.js';

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
  // 韭菜50名单启动预热（首次全量构建约数百次API调用，之后每日增量；失败不阻塞）
  warmupBagholder50();
});

function shutdown(signal: string): void {
  console.log(`${signal} signal received`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
