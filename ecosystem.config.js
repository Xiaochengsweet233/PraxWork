/**
 * PM2 配置（宝塔面板的 Node 项目可选用）
 *
 * 用法：
 *   pm2 start ecosystem.config.js         启动
 *   pm2 reload prax-portal                平滑重启（改完代码用这个）
 *   pm2 logs prax-portal                  看日志
 *   pm2 save && pm2 startup               开机自启
 */
module.exports = {
  apps: [
    {
      name: 'prax-portal',
      script: 'server/index.js',
      cwd: __dirname,

      // 单实例即可：本站用内置 SQLite，多进程同时写同一个库文件会互相锁等待。
      // 需要更高并发时请先换成 MySQL/PostgreSQL，再考虑 cluster 模式。
      instances: 1,
      exec_mode: 'fork',

      // 内存超限自动重启，防止异常膨胀拖垮小内存服务器
      max_memory_restart: '400M',

      env: {
        NODE_ENV: 'production',
        // 监听所有网卡，交给宝塔的 Nginx 反代
        HOST: '0.0.0.0',
        PORT: 3000,
      },

      // 崩溃后自动重拉，并做退避，避免疯狂重启刷爆日志
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '20s',

      // 日志（宝塔的 PM2 管理器也能直接查看）
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // 首次启动自动灌入种子数据（幂等，库非空时不会重复写入）
      // 已由 server/index.js 在检测到空库时自动完成，这里无需额外步骤。
    },
  ],
};
