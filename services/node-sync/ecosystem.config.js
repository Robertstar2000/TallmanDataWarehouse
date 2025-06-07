export default {
  apps: [
    {
      name: 'node-sync-service',
      script: 'index.js',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      merge_logs: true,
    },
  ],
};
