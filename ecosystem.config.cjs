module.exports = {
  apps: [
    {
      name: 'careconnect',
      script: 'src/server.js',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    }
  ]
};
