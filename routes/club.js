const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const authMiddleware = require('../middlewares/auth');
const Tienda = require('../models/Tienda');
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const User = require('../models/User');
const multer = require("multer");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/clubs/"); // Carpeta destino
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    // Opcional: puedes personalizar el nombre del archivo
    cb(null, `${Date.now()}-${file.fieldname}${ext}`);
  }
});
const upload = multer({ storage });

router.post("/", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId).populate('clubs');

    // ¿Cuántos clubs ya tiene?
    const currentCount = (user.clubs || []).length;
    const maxAllowed = user.suscripcion.clubsMax + (user.suscripcion.tiendasExtra || 0);

    if (currentCount >= maxAllowed) {
      return res.status(403).json({
        error: "Límite de clubes alcanzado",
        message: "Tu suscripción no permite agregar más clubes."
      });
    }

    // Crear nueva Tienda
    const { name, address, contact, schedule, paymentMethods } = req.body;
    const nueva = new Tienda({
      duenoId: userId,
      nombre: name,
      direccion: address,
      contact: JSON.parse(contact),
      schedule: JSON.parse(schedule),
      paymentMethods: JSON.parse(paymentMethods),
      image: req.file ? `/uploads/clubs/${req.file.filename}` : ""
    });
    const saved = await nueva.save();

    // Agregar al array de clubs del usuario
    user.clubs.push(saved._id);
    // Si no tiene clubPrincipal, lo ponemos
    if (!user.clubPrincipal) user.clubPrincipal = saved._id;
    await user.save();

    res.json({ message: "Club creado", club: saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    // Traemos suscripción y clubs (solo _id y nombre para no sobrecargar)
    const user = await User.findById(userId)
      .select('suscripcion clubs')
      .populate({ path: 'clubs', select: 'nombre' });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json(user);
  } catch (err) {
    console.error('Error en /clubs/me:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get("/", authMiddleware, async (req, res) => {
  try {
    // Filtrar por el duenoId que viene del token (req.userId)
    const clubs = await Tienda.find({ duenoId: req.userId });
    
    // Mapeamos la estructura para que el frontend obtenga los campos esperados.
    const clubsFormatted = clubs.map((club) => ({
      id: club._id,
      name: club.nombre,
      address: club.direccion,
      image: club.image || "https://via.placeholder.com/800x400?text=Club",
      status: club.status || "active",
      employeesCount: club.employeesCount || 0,
      monthlyStats: {
        sales: 0, // Se actualizará luego con el resumen
        expenses: 0,
        salesGoal: club.metaMensual
      },
      // Otros campos adicionales: contact, schedule, paymentMethods, etc.
      contact: club.contact || {},
      schedule: club.schedule || {},
      paymentMethods: club.paymentMethods || []
    }));
    res.json(clubsFormatted);
  } catch (error) {
    console.error("Error al obtener clubs:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==================================================
// GET /api/club/:id/summary
// Obtiene el resumen de ventas y gastos para un club,
// verificando que el club pertenezca al usuario autenticado.
// ==================================================
router.get("/:id/summary", authMiddleware, async (req, res) => {
  try {
    const clubId = req.params.id;
    // Verificar que el club exista y pertenezca al usuario autenticado
    const club = await Tienda.findOne({ _id: clubId, duenoId: req.userId });
    if (!club) {
      return res.status(404).json({ error: "Club no encontrado o no autorizado" });
    }

    // Agregación para sumar el total de ventas del club
    const salesResult = await Sale.aggregate([
      { $match: { clubId: new mongoose.Types.ObjectId(clubId) } },
      { $group: { _id: null, totalSales: { $sum: "$total" } } }
    ]);
    const totalSales = salesResult.length > 0 ? salesResult[0].totalSales : 0;

    // Agregación para sumar el total de gastos del club
    const expenseResult = await Expense.aggregate([
      { $match: { clubId: new mongoose.Types.ObjectId(clubId) } },
      { $group: { _id: null, totalExpenses: { $sum: "$amount" } } }
    ]);
    const totalExpenses = expenseResult.length > 0 ? expenseResult[0].totalExpenses : 0;

    const netTotal = totalSales - totalExpenses;
    res.json({ totalSales, totalExpenses, netTotal });
  } catch (error) {
    console.error("Error al obtener resumen:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==================================================
// PUT /api/club/:id
// Actualiza la información del club (incluyendo la foto)
// ==================================================
router.put("/:id", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const clubId = req.params.id;
    console.log("ClubId:", clubId);
    const userId = req.userId; // Asumiendo que authMiddleware agrega req.user

    const club = await Tienda.findOne({ 
      _id: new mongoose.Types.ObjectId(clubId), 
      duenoId: userId 
    });
    if (!club) {
      return res.status(404).json({ error: "Club no encontrado o no autorizado" });
    }

    // Campos básicos
    const { name, address, contact, schedule, paymentMethods } = req.body;
    if (name) club.nombre = name;
    if (address) club.direccion = address;

    // Contacto (esperamos objeto JSON)
    if (contact) {
      const c = typeof contact === 'string' ? JSON.parse(contact) : contact;
      club.contact = { ...club.contact, ...c };
    }

    // Horarios (objeto JSON)
    if (schedule) {
      const s = typeof schedule === 'string' ? JSON.parse(schedule) : schedule;
      for (const day of Object.keys(s)) {
        if (club.schedule[day]) {
          club.schedule[day].closed = s[day].closed || false;
          if (!s[day].closed && s[day].ranges) {
            club.schedule[day].ranges = s[day].ranges.map(range => ({
              open: range.open,
              close: range.close,
            }));
          } else {
            club.schedule[day].ranges = [];
          }
        }
      }
    }

    // Métodos de pago (array JSON)
    if (paymentMethods) {
      const pm = typeof paymentMethods === 'string' ? JSON.parse(paymentMethods) : paymentMethods;
      club.paymentMethods = pm.filter(m => ['cash', 'card', 'transfer'].includes(m));
    }

    // Imagen
    if (req.file) {
      club.image = `/uploads/clubs/${req.file.filename}`;
    }

    club.updatedAt = Date.now();
    const updated = await club.save();

    res.json({ message: "Club actualizado correctamente", club: updated });
  } catch (error) {
    console.error("Error al actualizar club:", error);
    res.status(500).json({ error: error.message });
  }
});
// GET /api/clubs/:clubId
router.get('/:clubId', authMiddleware, async (req, res) => {
  try {
    const { clubId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(clubId)) {
      return res.status(400).json({ message: "ClubId inválido" });
    }
    const club = await Tienda.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: "Club no encontrado" });
    }
    res.json(club);
  } catch (error) {
    console.error("Error en /api/clubs/:clubId:", error);
    res.status(500).json({ message: error.message || "Error al obtener el club" });
  }
});

router.get('/:clubId/goal', authMiddleware, async (req, res) => {
    try {
      const { clubId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(clubId)) {
        return res.status(400).json({ message: "ClubId inválido" });
      }
      const club = await Tienda.findById(clubId).select('metaMensual');
      if (!club) {
        return res.status(404).json({ message: "Club no encontrado" });
      }
      res.json({ metaMensual: club.metaMensual });
    } catch (error) {
      console.error("Error en /api/clubs/:clubId/goal:", error);
      res.status(500).json({ message: error.message || "Error al obtener la meta mensual" });
    }
});

router.put('/:clubId/goal', authMiddleware, async (req, res) => {
    try {
      const { clubId } = req.params;
      const { metaMensual } = req.body;
      if (!mongoose.Types.ObjectId.isValid(clubId)) {
        return res.status(400).json({ message: "ClubId inválido" });
      }
      const club = await Tienda.findByIdAndUpdate(clubId, { metaMensual }, { new: true });
      if (!club) {
        return res.status(404).json({ message: "Club no encontrado" });
      }
      res.json({ metaMensual: club.metaMensual });
    } catch (error) {
      console.error("Error updating club goal:", error);
      res.status(500).json({ message: error.message || "Error al actualizar la meta mensual" });
    }
});


module.exports = router;

