const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const ip = req.ip;
  const url = req.originalUrl;

  if (!authHeader) {
    console.warn(`[Auth] → Rechazado: no Authorization header | IP: ${ip} | URL: ${url}`);
    return res.status(401).json({ 
      message: 'No se proporcionó token',
      code: 'NO_TOKEN' 
    });
  }
  
  try {
    // Extraer el token si viene en formato "Bearer <token>"
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verificar si el usuario existe
    const user = await User.findById(decoded.userId);
    if (!user) {
      console.warn(`[Auth] → Rechazado: usuario no encontrado | IP: ${ip} | URL: ${url}`);
      return res.status(401).json({ 
        message: 'Usuario no encontrado',
        code: 'USER_NOT_FOUND' 
      });
    }

    // Agregar información del usuario al request
    req.userId = decoded.userId;
    req.user = {
      id: user._id,
      email: user.email,
      role: user.role
    };

    console.log(`[Auth] → Token verificado | Usuario: ${user.email} | IP: ${ip}`);
    next();
    
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      console.warn(`[Auth] → Rechazado: token expirado | IP: ${ip} | URL: ${url}`);
      return res.status(401).json({ 
        message: 'La sesión ha expirado',
        code: 'TOKEN_EXPIRED' 
      });
    }
    
    console.warn(`[Auth] → Rechazado: token inválido | IP: ${ip} | URL: ${url}`);
    return res.status(401).json({ 
      message: 'Token inválido',
      code: 'INVALID_TOKEN' 
    });
  }
};

module.exports = authMiddleware;
