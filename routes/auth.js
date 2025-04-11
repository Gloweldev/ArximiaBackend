// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const PasswordResetToken = require('../models/PasswordResetToken');
const authMiddleware = require('../middlewares/auth');



// Utilidad para validar contraseña (mínimo 8 caracteres, al menos 1 número y 1 símbolo)
const isValidPassword = (password) => {
  const regex = /^(?=.*[0-9])(?=.*[!@#$%^&*])/;
  return password.length >= 8 && regex.test(password);
};

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    // Retornamos la suscripción y la cantidad de clubes actuales.
    res.json({ 
      id: user._id,
      name: user.name,
      email: user.email,
      subscription: user.suscripcion, 
      clubsCount: user.clubs ? user.clubs.length : 0,
      onboardingCompleted: user.onboardingCompleted || false
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

// Registro con prueba gratuita y validaciones minimalistas
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, password, termsAccepted } = req.body;

    // Validaciones mínimas
    if (!fullName || !Array.isArray(fullName) || fullName.length !== 2 || fullName.some(name => !name || name.length < 2)) {
      return res.status(400).json({ message: 'El nombre y apellido deben tener al menos 2 caracteres cada uno' });
    }
    const nombre = fullName[0];
    const apellido = fullName[1];

    // Validar formato de email (se puede usar una librería, aquí es simple)
    const emailRegex = /\S+@\S+\.\S+/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ message: 'El email debe ser válido' });
    }
    if (!password || !isValidPassword(password)) {
      return res.status(400).json({ message: 'La contraseña debe tener mínimo 8 caracteres, incluir al menos un número y un símbolo' });
    }
    if (!termsAccepted) {
      return res.status(400).json({ message: 'Debe aceptar los términos y condiciones' });
    }

    // Verificar si el usuario ya existe
    const existingUser = await User.findOne({ email });
    if(existingUser) return res.status(400).json({ message: 'El email ya está registrado' });

    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);
    // Crear el usuario con suscripción de prueba (por ejemplo, 7 días)
    const user = new User({
      nombre: `${nombre} ${apellido}`, // Puedes guardar el nombre completo así
      email,
      password: hashedPassword,
      suscripcion: {
        plan: 'prueba',
        fechaInicio: new Date(),
        fechaExpiracion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        clubsMax: 1,
        empleadosMax: 2
      }
    });
    await user.save();

    // Generar token JWT para el usuario recién registrado
    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Retornar el token junto con la respuesta
    res.status(201).json({ message: 'Usuario registrado correctamente', userId: user._id, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // Buscar usuario
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Credenciales inválidas' });
    // Comparar contraseña
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Credenciales inválidas' });
    // Generar token JWT
    const token = jwt.sign(
      { userId: user._id, role: user.role, clubPrincipal: user.clubPrincipal, displayName: user.displayName, clubs: user.clubs },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    // Retornamos el token y la información del club principal (si existe)
    res.json({ token, clubPrincipal: user.clubPrincipal });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

// Solicitud para recuperación de contraseña
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Email no encontrado' });
    // Generar token de reseteo
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hora de expiración
    const resetToken = new PasswordResetToken({
      userId: user._id,
      token,
      expiresAt
    });
    await resetToken.save();
    // Aquí se debería enviar el email al usuario. Para pruebas, devolvemos el token.
    res.json({ message: 'Token de recuperación generado', token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

// Reseteo de contraseña
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    // Buscar el token
    const resetTokenDoc = await PasswordResetToken.findOne({ token });
    if (!resetTokenDoc || resetTokenDoc.expiresAt < new Date()) {
      return res.status(400).json({ message: 'Token inválido o expirado' });
    }
    // Hashear la nueva contraseña y actualizar el usuario
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(resetTokenDoc.userId, { password: hashedPassword, updatedAt: new Date() });
    // Eliminar el token usado
    await PasswordResetToken.deleteOne({ _id: resetTokenDoc._id });
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

module.exports = router;

