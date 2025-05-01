const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Tienda = require('../models/Tienda');
const authMiddleware = require('../middlewares/auth');
// Middleware para validar JWT (espera el formato "Bearer <token>")



// Endpoint de Onboarding (se espera recibir un payload con step1, step2 y step3)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { step1, step2, step3 } = req.body;
    if (!step1 || !step1.tiendaNombre) {
      return res.status(400).json({ message: 'El nombre de la tienda es requerido' });
    }
    
    // Actualizar información del usuario con preferencias y metas
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    
    user.preferenciasOperativas = {
      moneda: step2?.moneda || 'MXN',
      horario: step2?.horario || '09:00-18:00',
      notificaciones: step2?.notificaciones || [],
      tema: step2?.tema || 'Claro'
    };
    user.metas = {
      metaVentasMensual: step3?.metaVentasMensual
    };
    // Establecer inventarioIdeal directamente en el usuario
    user.inventarioIdeal = step3?.diasInventario || 5; // Valor por defecto de 5
    user.tieneColaboradores = step1?.tienesColaboradores || false;
    user.displayName = step2.displayName || user.displayName;
    
    // Se inicializa el arreglo de clubs si aún no existe
    if (!user.clubs) user.clubs = [];
    
    // Crear la tienda principal según la selección:
    // Si el usuario elige "principal", se usa el step1.tiendaNombre y step1.direccion.
    // Si elige "adicional", se usa la información enviada en step1.adicional.
    let tiendaPrincipal;
    if (step1.clubPrincipal === "principal") {
      tiendaPrincipal = new Tienda({
        duenoId: user._id,
        nombre: step1.tiendaNombre,
        direccion: step1.direccion || '',
        horarioApertura: step1.horarioApertura || "",
        metaMensual: step3?.metaVentasMensual || 0
      });
    } else if (step1.clubPrincipal === "adicional" && step1.adicional) {
      tiendaPrincipal = new Tienda({
        duenoId: user._id,
        nombre: step1.adicional.clubNombre,
        direccion: step1.adicional.direccion || '',
        horarioApertura: step1.adicional.horarioApertura || "",
        metaMensual: step3?.metaVentasMensual || 0
      });
    }
    
    if (!tiendaPrincipal) {
      return res.status(400).json({ message: 'No se pudo definir el club principal' });
    }
    
    await tiendaPrincipal.save();
    
    // Actualizar el usuario: asignar clubPrincipal y agregarlo al arreglo de clubs
    user.clubPrincipal = tiendaPrincipal._id;
    user.clubs.push(tiendaPrincipal._id);
    
    // Verificar y crear club adicional si se envió en step1.adicional
    // Se valida que la suscripción permita más de un club (clubsMax > 1)
    if (step1.adicional) {
      if (user.suscripcion && user.suscripcion.clubsMax > 1) {
        const tiendaAdicional = new Tienda({
          duenoId: user._id,
          nombre: step1.adicional.clubNombre,
          direccion: step1.adicional.direccion || '',
          horarioApertura: step1.adicional.horarioApertura || "",
          metaMensual: step3?.metaVentasMensual || 0
        });
        await tiendaAdicional.save();
        user.clubs.push(tiendaAdicional._id);
      } else {
        return res.status(400).json({ message: 'Tu suscripción actual no permite agregar más clubes' });
      }
    }
    user.onboardingCompleted = true; // Marcar el onboarding como completado
    await user.save();

    const token = jwt.sign(
      { 
        userId: user._id, 
        role: user.role, 
        clubPrincipal: user.clubPrincipal,
        displayName: user.displayName,
        clubs: user.clubs 
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    res.json({ message: 'Onboarding completado exitosamente', token ,tiendaPrincipalId: tiendaPrincipal._id, clubs: user.clubs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

module.exports = router;


