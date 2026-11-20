import handler from '../../api/access/vpn-check.js';

export default (request, context) => handler(request, context.ip);
