// routes/subscription.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth');
const User = require('../models/User');

// GET /api/subscription/me
// Devuelve la suscripción actual del usuario autenticado
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('suscripcion');
    if (!user || !user.suscripcion) {
      return res.status(404).json({ message: 'Suscripción no encontrada' });
    }
    res.json(user.suscripcion);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/subscription/update
// Actualiza (o crea) la suscripción para el usuario autenticado.
// Se esperan en el body los campos: plan, clubsExtra y empleadosExtra (en caso de plan personalizado)
router.post('/update', authMiddleware, async (req, res) => {
  const { plan, clubsExtra, empleadosExtra } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    
    // Si el usuario ya tiene una suscripción y se intenta solicitar de nuevo la prueba gratuita, se rechaza.
    if (plan === 'prueba' && user.suscripcion && user.suscripcion.trialUsed) {
      return res.status(400).json({ message: 'La prueba gratuita ya fue utilizada.' });
    }
    
    // Si no existe la suscripción, la inicializamos
    if (!user.suscripcion) {
      user.suscripcion = {};
    }
    
    // Actualizamos el plan y los extras (si el plan es personalizado)
    user.suscripcion.plan = plan;
    if (plan === 'personalizado') {
      user.suscripcion.clubsExtra = clubsExtra || 0;
      user.suscripcion.empleadosExtra = empleadosExtra || 0;
    }
    
    // Para el plan de prueba, marcamos que ya se utilizó y establecemos la fecha de inicio
    if (plan === 'prueba') {
      user.suscripcion.trialUsed = true;
      user.suscripcion.fechaInicio = new Date();
    } else {
      user.suscripcion.fechaInicio = new Date();
      user.suscripcion.fechaExpiracion = undefined;
    }
    
    await user.save();
    res.json({ message: 'Suscripción actualizada correctamente', suscripcion: user.suscripcion });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// POST /api/subscription/cancel
// Cancela la suscripción actual, estableciendo la fecha de expiración en el momento actual.
router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user || !user.suscripcion) {
      return res.status(404).json({ message: 'Suscripción no encontrada' });
    }
    
    user.suscripcion.fechaExpiracion = new Date();
    await user.save();
    res.json({ message: 'Suscripción cancelada correctamente', suscripcion: user.suscripcion });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;

