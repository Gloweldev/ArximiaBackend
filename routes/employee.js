// routes/employee.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Employee = require('../models/Employee');
const User = require('../models/User');
const middleware = require('../middlewares/auth'); // Asegúrate de tener un middleware para autenticar al usuario
const Tienda = require('../models/Tienda'); // Asegúrate de tener el modelo correcto para Tienda
const authMiddleware = require('../middlewares/auth');
const Sale = require('../models/Sale'); // Asegúrate de tener el modelo correcto para Sale

// Función auxiliar para generar una contraseña temporal
function generateTempPassword(length = 8) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

/**
 * POST /api/employees
 * 
 * Se espera que el request body contenga:
 * - name: string
 * - email: string
 * - phone: string (opcional)
 * - role: string (puede ser un rol existente o "nuevo" en caso de crear uno)
 * - newRole: string (requerido si role === "nuevo")
 * - clubId: string (ID del club asignado)
 * - avatar: string (imagen en base64 o URL, opcional)
 * 
 * Se utiliza `req.user` para obtener el dueño autenticado.
 */
router.get('/clubs', middleware, async (req, res) => {
  try {
    // Obtener el usuario usando el ID inyectado en req.userId
    const owner = await User.findById(req.userId);

    if (!owner) {
      return res.status(401).json({ message: "No autorizado" });
    }
    
    // Verificar si el dueño tiene clubs registrados
    if (!owner.clubs || owner.clubs.length === 0) {
      return res.status(404).json({ message: "No se encontraron clubs registrados para este usuario" });
    }
    
    // Consultar la colección Tienda usando los clubs registrados del dueño
    const clubs = await Tienda.find({
      _id: { $in: owner.clubs },
      duenoId: owner._id
    }).select('_id nombre');
    
    return res.json({ clubs });
  } catch (error) {
    console.error("Error al obtener los clubs: ", error);
    return res.status(500).json({ message: "Error al obtener clubs" });
  }
});



router.get('/check-limit', middleware, async (req, res) => {
  try {
    // Obtener el usuario usando el ID inyectado en req.userId
    const owner = await User.findById(req.userId);

    if (!owner) {
      return res.status(401).json({ message: "No autorizado" });
    }
    
    // Calcular el máximo de empleados permitidos según la suscripción del dueño
    const maxEmployees = owner.suscripcion.empleadosMax + (owner.suscripcion.empleadosExtra || 0);
    
    // Verificar si excede el límite
    const exceedsLimit = owner.employees.length >= maxEmployees;
    
    return res.json({ 
      exceedsLimit,
      currentCount: owner.employees.length,
      maxAllowed: maxEmployees
    });
  } catch (error) {
    console.error("Error al verificar límite de empleados: ", error);
    return res.status(500).json({ message: "Error al verificar disponibilidad de empleados" });
  }
});

router.post('/',authMiddleware, async (req, res) => {
  try {
    // Obtener el dueño
    const owner = await User.findById(req.userId);
    if (!owner) {
      return res.status(401).json({ message: 'No autorizado' });
    }
    console.log('Dueño autenticado:', owner);

    // Verificar cantidad máxima de empleados según suscripción
    const maxEmployees = owner.suscripcion.empleadosMax + (owner.suscripcion.empleadosExtra || 0);
    if (owner.employees.length >= maxEmployees) {
      return res.status(400).json({ 
        message: 'Haz registrado la cantidad máxima de empleados, mejora tu suscripción contactanos para un plan personalizado.' 
      });
    }

    const { name, email, phone, role, newRole, clubId, avatar } = req.body;
    
    // Validar campos requeridos
    if (!name || !email || !role || !clubId) {
      return res.status(400).json({ message: 'Por favor, completa todos los campos requeridos' });
    }
    
    // Validar que el club seleccionado pertenece a los clubs del dueño
    if (!owner.clubs.map(c => c.toString()).includes(clubId)) {
      return res.status(400).json({ message: 'El club seleccionado no pertenece a su cuenta' });
    }
    
    // Determinar el rol final
    let finalRole = role;
    if (role === 'nuevo') {
      if (!newRole) {
        return res.status(400).json({ message: 'Por favor, ingresa el nuevo rol' });
      }
      finalRole = newRole;
    }
    
    // Generar la contraseña temporal en texto plano
    const plainTempPassword = generateTempPassword(8);
    
    // Crear el registro del empleado
    const newEmployee = new Employee({
      name,
      email,
      phone,
      role: finalRole,
      club: clubId,
      avatar,
      tempPassword: plainTempPassword,
      plainTempPassword, // Se guarda temporalmente para mostrarla en la UI
      owner: owner._id
      // lastAccess: null y passwordChanged: false se establecen por defecto
    });
    await newEmployee.save();

    // (Opcional) Si se desea, se puede actualizar el array de empleados del dueño
    owner.employees.push(newEmployee._id);
    await owner.save();

    return res.status(201).json({ 
      message: 'Empleado registrado correctamente', 
      // Se devuelve la contraseña en texto plano para que el dueño se la comunique
      tempPassword: plainTempPassword, 
      employee: newEmployee 
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al registrar el empleado' });
  }
});

router.get('/',authMiddleware, async (req, res) => {
  try {
    const ownerId = req.userId;
    const employees = await Employee.find({ owner: ownerId }).populate('club', 'nombre');
    
    // Mapear un campo status basado en las propiedades lastAccess y passwordChanged
    const formattedEmployees = employees.map(emp => {
      const status = (!emp.lastAccess && !emp.passwordChanged) ? "Pendiente" : "Activo";
      return { ...emp.toObject(), status };
    });

    return res.json({ employees: formattedEmployees });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error al obtener empleados" });
  }
});

router.get('/:employeeId/temp-password',authMiddleware, async (req, res) => {
  try {
    const ownerId = req.userId;
    const { employeeId } = req.params;
    const employee = await Employee.findOne({ _id: employeeId, owner: ownerId });
    
    if (!employee) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }
    
    if (employee.passwordChanged) {
      return res.status(400).json({ message: "El empleado ya cambió la contraseña; la contraseña temporal ya no es válida" });
    }
    console.log('Contraseña temporal:', employee.plainTempPassword);
    return res.json({ tempPassword: employee.plainTempPassword });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error al obtener la contraseña temporal" });
  }
});

router.get('/sales', authMiddleware, async (req, res) => {
  try {
    // Agregamos las ventas agrupadas por empleado (suma total de ventas)
    const topSellerAgg = await Sale.aggregate([
      {
        $group: {
          _id: "$employee",
          salesAmount: { $sum: "$total" }
        }
      },
      { $sort: { salesAmount: -1 } },
      { $limit: 1 }
    ]);

    // Obtenemos el último registro de venta según la fecha de creación
    const lastSale = await Sale.findOne({}).sort({ created_at: -1 }).populate("employee");

    // Obtenemos datos del empleado con más ventas
    let topSeller = { name: "N/A", salesAmount: 0 };
    if (topSellerAgg.length > 0) {
      const employeeData = await Employee.findById(topSellerAgg[0]._id);
      if (employeeData) {
        topSeller = {
          name: employeeData.name,
          salesAmount: topSellerAgg[0].salesAmount
        };
      }
    }
    
    // Último empleado que realizó una venta
    let lastSaleEmployee = { name: "N/A" };
    if (lastSale && lastSale.employee) {
      lastSaleEmployee = { name: lastSale.employee.name };
    }
    
    return res.json({
      topSeller,
      lastSaleEmployee
    });
  } catch (error) {
    console.error("Error al calcular los KPIs:", error);
    return res.status(500).json({ message: "Error al calcular los KPIs" });
  }
});

router.patch('/:employeeId', authMiddleware, async (req, res) => {
  try {
    const ownerId = req.userId;
    const { employeeId } = req.params;
    const updateData = req.body; // Se esperan campos como: name, email, phone, role, club, status, avatar

    // Buscar el empleado que pertenece al usuario autenticado
    let employee = await Employee.findOne({ _id: employeeId, owner: ownerId });
    if (!employee) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }

    // Si se actualiza el club, validar que el club se encuentre en la lista de clubs del dueño
    if (updateData.club) {
      const owner = await User.findById(ownerId);
      if (!owner.clubs.map(c => c.toString()).includes(updateData.club)) {
        return res.status(400).json({ message: "El club seleccionado no pertenece a su cuenta" });
      }
    }

    // Actualizar los campos del empleado
    Object.assign(employee, updateData);
    employee.updatedAt = Date.now();

    await employee.save();

    return res.json({ message: "Empleado actualizado correctamente", employee });
  } catch (error) {
    console.error("Error al actualizar el empleado:", error);
    return res.status(500).json({ message: "Error al actualizar el empleado" });
  }
});

router.get('/:employeeId/performance', authMiddleware, async (req, res) => {
  try {
    const ownerId = req.userId;
    const { employeeId } = req.params;

    // Verificar que el empleado pertenezca al dueño autenticado
    const employee = await Employee.findOne({ _id: employeeId, owner: ownerId });
    if (!employee) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }

    // Agregar el campo salesGoal al empleado (se asume que existe)
    const goal = employee.salesGoal || 10000; // valor por defecto si no se ha establecido

    // Agregar las ventas agrupadas por mes para el empleado:
    // Se considera ventas con status "completed"
    const performanceData = await Sale.aggregate([
      { 
        $match: { 
          employee: employeeId,
          status: "completed"
        } 
      },
      {
        $group: {
          _id: { $dateToString: { format: "%b", date: "$created_at" } },
          sales: { $sum: "$total" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Calcular el total de ventas realizadas
    const totalSales = performanceData.reduce((acc, cur) => acc + cur.sales, 0);

    // Convertir la data agrupada al formato esperado por el frontend.
    // Aquí se asigna un rating simulado ya que la información de satisfacción no se obtiene de las ventas.
    const performanceDataFormatted = performanceData.map(item => ({
      month: item._id,
      sales: item.sales,
      rating: 4.8 // valor simulado; podrías calcular un promedio si tuvieras esos datos
    }));

    return res.json({
      performanceData: performanceDataFormatted,
      totalSales,
      goal
    });
  } catch (error) {
    console.error("Error al obtener el rendimiento del empleado:", error);
    return res.status(500).json({ message: "Error al obtener el rendimiento del empleado" });
  }
});

// Endpoint para actualizar la meta de ventas de un empleado
router.patch('/:employeeId/goal', authMiddleware, async (req, res) => {
  try {
    const ownerId = req.userId;
    const { employeeId } = req.params;
    const { goal } = req.body;  // Se espera recibir un valor numérico en goal

    // Verifica que el empleado pertenezca al dueño autenticado
    const employee = await Employee.findOne({ _id: employeeId, owner: ownerId });
    if (!employee) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }

    // Actualiza la meta de ventas
    employee.salesGoal = goal;
    await employee.save();

    return res.json({ message: "Meta actualizada correctamente", goal });
  } catch (error) {
    console.error("Error al actualizar la meta del empleado:", error);
    return res.status(500).json({ message: "Error al actualizar la meta del empleado" });
  }
});



module.exports = router;

