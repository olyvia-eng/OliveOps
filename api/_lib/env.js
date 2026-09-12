export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    if (process.env.NODE_ENV !== 'production') {
      if (name === 'AWS_REGION') return 'us-east-1';
      if (name === 'DDB_TABLE_NAME') return 'OliveOpsAuth';
      if (name === 'JWT_SECRET') return 'dev-only-jwt-secret';
    }
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

// Which QuickBooks company environment this deployment talks to - independent of NODE_ENV.
// Defaults to 'sandbox' so a deployment never starts writing to a real QuickBooks company by
// omission; a business only reaches real books once an operator explicitly sets this to
// 'production' (and supplies matching production QUICKBOOKS_CLIENT_ID/SECRET from Intuit).
export function quickBooksEnvironment() {
  return process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
}
