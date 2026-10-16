/**
 * ecosystem.config.cjs
 * PM2 Proses Yöneticisi Konfigürasyonu
 */
module.exports = {
  apps: [
    {
      name: "financial-dashboard",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3000",
      cwd: "./",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "127.0.0.1",
      },
    },
    {
      name: "bot-cron-worker",
      script: "scripts/vps-cron-runner.cjs",
      cwd: "./",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
}
