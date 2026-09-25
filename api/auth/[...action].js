const {login, me, logout, studentLogin, studentMe, studentLogout} = require('../../lib/auth');

function getAction(req) {
  const raw = req.query?.action;
  if (Array.isArray(raw) && raw.length) return raw[raw.length - 1];
  if (typeof raw === 'string' && raw) return raw;

  const path = String(req.url || '').split('?')[0];
  const match = path.match(/^\/api\/auth\/([^/]+)\/?$/);
  return match ? match[1] : '';
}

module.exports = async function(req, res) {
  const action = getAction(req);
  const routes = {
    login: {method: 'POST', handler: login},
    me: {method: 'GET', handler: me},
    logout: {method: 'POST', handler: logout},
    'student-login': {method: 'POST', handler: studentLogin},
    'student-me': {method: 'GET', handler: studentMe},
    'student-logout': {method: 'POST', handler: studentLogout}
  };

  const route = routes[action];
  if (!route) return res.status(404).json({error: 'Auth route not found'});
  if (req.method !== route.method) return res.status(405).json({error: 'Method not allowed'});

  try {
    return await route.handler(req, res);
  } catch (e) {
    console.error('Auth error:',e);
    return res.status(500).json({error: e?.message || 'Authentication service error'});
  }
};
