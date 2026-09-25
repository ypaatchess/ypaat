const {login, me, logout, studentLogin, studentMe, studentLogout} = require('../../lib/auth');

module.exports = async function(req, res) {
  const rawAction = req.query?.action;
  const action = Array.isArray(rawAction) ? rawAction[rawAction.length - 1] : rawAction;

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
    console.error(e);
    return res.status(500).json({error: 'Authentication service error'});
  }
};
