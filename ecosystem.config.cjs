module.exports = {
  apps: [
    {
      name: 'hapi-hub',
      script: 'E:/dev/hapi/cli/dist-exe/bun-windows-x64/hapi.exe',
      args: 'hub',
      cwd: 'E:/dev/hapi',
      env: {
        HAPI_CLAUDE_PATH: 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\claude.cmd',
        CORS_ORIGINS: '*',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
    },
    {
      name: 'hapi-runner',
      script: 'E:/dev/hapi/cli/dist-exe/bun-windows-x64/hapi.exe',
      args: 'runner start-sync --workspace-root E:\\dev',
      cwd: 'E:/dev/hapi',
      env: {
        HAPI_CLAUDE_PATH: 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\claude.cmd',
        CORS_ORIGINS: '*',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
    },
  ],
};
