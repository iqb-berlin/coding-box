// Synthetic infrastructure configuration for tests that compile the real AppModule.
Object.assign(process.env, {
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'test',
  POSTGRES_PASSWORD: 'synthetic-password',
  POSTGRES_DB: 'test',
  JWT_SECRET: 'synthetic-secret',
  OAUTH2_CLIENT_ID: 'test',
  OIDC_ISSUER: 'https://issuer.example.test',
  OIDC_JWKS_URI: 'https://issuer.example.test/certs'
});
