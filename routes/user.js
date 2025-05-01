const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const authMiddleware = require('../middlewares/auth');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const Tienda = require('../models/Tienda');

// GET /api/users/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select('displayName nombre email role clubs clubPrincipal')
      .populate('clubs', 'nombre');
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    res.json({
      displayName: user.displayName,
      nombre: user.nombre,
      email: user.email,
      role: user.role,                       // seguirá siendo 'admin'
      clubs: user.clubs.map(c => ({ id: c._id, nombre: c.nombre })),
      clubPrincipal: user.clubPrincipal || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

router.get('/clubs', authMiddleware, async (req, res) => {
  try {
    // Se asume que authMiddleware inyecta en req.user la información del usuario, por ejemplo { _id, clubPrincipal, … }
    const userId = req.userId;

    // Se buscan todas las tiendas asociadas al usuario
    const clubs = await Tienda.find({ duenoId: userId }, { _id: 1, nombre: 1 });
    const clubsData = clubs.map((club) => ({
      id: club._id,
      name: club.nombre
    }));

    // Se devuelve sólo el array de clubs; el club principal se obtiene desde el token en el frontend
    res.json(clubsData);
  } catch (error) {
    console.error('Error al obtener los clubes del usuario:', error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});



router.put('/me/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: 'Las contraseñas nuevas no coinciden' });
  }

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const now = new Date();
    // 1) Si está bloqueado:
    if (user.passwordChangeLockUntil && user.passwordChangeLockUntil > now) {
      return res.status(429).json({
        message: 'Demasiados intentos. Vuelve a intentarlo más tarde.',
        lockUntil: user.passwordChangeLockUntil
      });
    }
    // 2) Si el bloqueo expiró, resetear contador
    if (user.passwordChangeLockUntil && user.passwordChangeLockUntil <= now) {
      user.passwordChangeAttempts = 0;
      user.passwordChangeLockUntil = null;
      await user.save();
    }

    // 3) Verificar contraseña actual
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      user.passwordChangeAttempts += 1;
      // Si alcanza 5, bloquear 5 minutos
      if (user.passwordChangeAttempts >= 5) {
        user.passwordChangeLockUntil = new Date(now.getTime() + 5 * 60 * 1000);
      }
      await user.save();

      const status = user.passwordChangeAttempts >= 5 ? 429 : 400;
      const payload = { message: 'Contraseña actual incorrecta' };
      if (status === 429) payload.lockUntil = user.passwordChangeLockUntil;
      return res.status(status).json(payload);
    }

    // 4) Si coincide: resetear y actualizar
    user.passwordChangeAttempts = 0;
    user.passwordChangeLockUntil = null;
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.updatedAt = now;
    await user.save();

    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error del servidor' });
  }
});


// PUT /api/users/me
// Actualiza nombre, email y clubPrincipal (no se toca el role ni displayName)
router.put('/me', authMiddleware, async (req, res) => {
  const { nombre, email, clubPrincipal } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    user.nombre = nombre;
    user.email = email;
    user.clubPrincipal = clubPrincipal;
    user.updatedAt = Date.now();

    await user.save();
    res.json({ message: 'Perfil actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar perfil' });
  }
});


// GET /api/users/:userId
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "UserId inválido" });
    }
    const user = await User.findById(userId).select('nombre displayName email clubPrincipal');
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    res.json(user);
  } catch (error) {
    console.error("Error en /api/users/:userId:", error);
    res.status(500).json({ message: error.message || "Error al obtener el usuario" });
  }
});

router.put('/me',  async (req, res) => {
  const { name, email, role, clubPrincipal } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    user.displayName = name;
    user.email = email;
    user.role = role;
    user.clubPrincipal = clubPrincipal || user.clubPrincipal;
    user.updatedAt = Date.now();

    await user.save();
    res.json({ message: 'Perfil actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
});

module.exports = router;