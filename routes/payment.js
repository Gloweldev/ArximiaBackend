// routes/payment.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth');
const Payment = require('../models/Payment');
const User = require('../models/User');

// POST /api/payment/create
// Registra un pago del usuario y, si el pago es exitoso (status "paid"), actualiza la fecha de renovación.
router.post('/create', authMiddleware, async (req, res) => {
  const { invoiceId, amount, status } = req.body;
  
  try {
    // Crear registro del pago
    const payment = new Payment({
      user: req.userId,
      invoiceId,
      amount,
      status: status || 'paid'
    });
    
    await payment.save();
    
    // Si el pago se realizó con éxito, actualizamos la fecha de renovación de la suscripción.
    if (payment.status === 'paid') {
      const user = await User.findById(req.userId);
      if (user && user.suscripcion) {
        const now = new Date();
        let currentExpiration = user.suscripcion.fechaExpiracion;
        
        // Si no existe una fecha de expiración o ya expiró, se empieza desde ahora.
        if (!currentExpiration || currentExpiration < now) {
          currentExpiration = now;
        }
        
        // Extender la suscripción por 30 días (puedes ajustar este cálculo si lo requieres).
        const newExpiration = new Date(currentExpiration.getTime() + 30 * 24 * 60 * 60 * 1000);
        user.suscripcion.fechaExpiracion = newExpiration;
        
        await user.save();
      }
    }
    
    res.json({ message: 'Pago registrado correctamente', payment });
  } catch (error) {
    console.error('Error al registrar el pago:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// GET /api/payment
// Obtiene el historial de pagos del usuario autenticado.
router.get('/', authMiddleware, async (req, res) => {
  try {
    const payments = await Payment.find({ user: req.userId }).sort({ date: -1 });
    res.json(payments);
  } catch (error) {
    console.error('Error al obtener el historial de pagos:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;
