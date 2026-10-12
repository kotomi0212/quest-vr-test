// Test-only Firebase boundary. Never used by the application pages in production.
window.fixture = { writes: [], listeners: new Map(), persistence: [], anonymousCalls: 0, apps: [], seq: 0 };
const fixture = window.fixture;
fixture.emit = (path, value) => { for (const callback of fixture.listeners.get(path) || []) callback({ val: () => value }); };
fixture.lastStatus = () => fixture.writes.filter(w => w.path.endsWith('/status')).at(-1)?.value;
function reference(path) {
  return {
    child: name => reference(path + '/' + name),
    on: (event, callback) => {
      if (!fixture.listeners.has(path)) fixture.listeners.set(path, []);
      fixture.listeners.get(path).push(callback);
      callback({ val: () => path === '.info/connected' ? true : path === '.info/serverTimeOffset' ? 0 : null });
    },
    off: (event, callback) => fixture.listeners.set(path, (fixture.listeners.get(path) || []).filter(c => c !== callback)),
    set: async value => {
      const resolved = structuredClone(value);
      if (resolved.at && typeof resolved.at === 'object') resolved.at = Date.now();
      if (resolved.requestedAt && typeof resolved.requestedAt === 'object') resolved.requestedAt = Date.now();
      fixture.writes.push({ path, value: resolved });
      if (fixture.holdLogs && path.includes('/logs/')) await new Promise(() => {});
      fixture.emit(path, resolved);
    },
    get: async () => ({ val: () => ({}) })
  };
}
const auth = {
  setPersistence: async value => fixture.persistence.push(value),
  signInAnonymously: async () => { fixture.anonymousCalls++; return { user: { uid: 'test-quest', isAnonymous: true } }; },
  signInWithEmailAndPassword: async () => ({ user: { uid: 'test-operator', isAnonymous: false } }),
  onAuthStateChanged: callback => callback({ uid: 'test-operator', isAnonymous: false })
};
const database = { ref: reference };
function authFunction() { return auth; }
authFunction.Auth = { Persistence: { NONE: 'none' } };
function databaseFunction() { return database; }
databaseFunction.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
window.firebase = {
  initializeApp: (config, name) => { fixture.apps.push(name || '[DEFAULT]'); return { auth: authFunction, database: databaseFunction }; },
  auth: authFunction, database: databaseFunction
};
