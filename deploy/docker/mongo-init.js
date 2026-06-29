// MongoDB init script — creates the SOAR database, application user, and
// initial collections with validators. Runs once on first container boot.

db = db.getSiblingDB('soar');

// Application user (used by the SOAR web app + backend)
db.createUser({
  user: 'soar',
  pwd: 'soar_dev_password_change_me',
  roles: [
    { role: 'readWrite', db: 'soar' },
    { role: 'dbAdmin', db: 'soar' },
  ],
});

// Initial collections (validators applied by the app on connect)
db.createCollection('workflows');
db.createCollection('workflow_executions');
db.createCollection('integrations');
db.createCollection('cases');
db.createCollection('alerts');
db.createCollection('audit_logs');
db.createCollection('execution_traces');
db.createCollection('approvals');
db.createCollection('idempotency_keys');
db.createCollection('rate_limits');
db.createCollection('raw_payloads');

print('SOAR database initialized');
