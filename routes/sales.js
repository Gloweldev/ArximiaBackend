// routes/sales.js
const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const Client = require('../models/Client');
const Movement = require('../models/Movement');
const Inventory = require('../models/Inventory');
const authMiddleware = require('../middlewares/auth');

// POST /api/sales
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { itemGroups, total, client_id, clubId } = req.body;
    console.log('Datos de la venta:', req.body); // Log para verificar los datos recibidos
    if (!clubId) {
      return res.status(400).json({ message: 'El clubId es requerido.' });
    }
    // Crear la venta
    const sale = new Sale({
      itemGroups,
      total,
      client: client_id || null,
      status: 'completed',
      employee: req.userId,
      clubId,
    });
    await sale.save();

    // Registrar movimientos para cada ítem y actualizar el inventario
    for (const group of itemGroups) {
      for (const item of group.items) {
        // Determinar la unidad a afectar: 'sealed' o 'portion'
        const unit = item.type === 'sealed' ? 'sealed' : 'portion';
        await registerMovement(item.product_id, clubId, 'venta', item.quantity, unit, `Venta de ${item.quantity} ${unit === 'sealed' ? 'unidades' : 'porciones'}`, req.userId);
      }
    }

    // Actualizar información del cliente, filtrando por club (para aislar la información)
    if (client_id) {
      await Client.findOneAndUpdate(
        { _id: client_id, clubId },
        { $inc: { total_spent: total }, last_purchase: new Date() }
      );
    }

    res.status(201).json({ message: 'Venta registrada correctamente', sale });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || 'Error al registrar la venta' });
  }
});

// Función auxiliar para registrar movimiento e impactar inventario
async function registerMovement(productId, clubId, type, quantity, unit, description, userId) {
  const movement = new Movement({
    product: productId,
    clubId,
    type,
    quantity,
    unit,
    description,
    user: userId,
  });
  await movement.save();

  let inventory = await Inventory.findOne({ product: productId, clubId });
  if (!inventory) {
    // Crear registro de inventario inicial si no existe
    inventory = new Inventory({
      product: productId,
      clubId,
      sealed: 0,
      preparation: { units: 0, portionsPerUnit: 0, currentPortions: 0 },
    });
  }
  // Actualización del inventario para venta
  if (type === 'venta') {
    if (unit === 'sealed') {
      inventory.sealed = (inventory.sealed || 0) - quantity;
    } else if (unit === 'portion') {
      inventory.preparation.currentPortions = (inventory.preparation.currentPortions || 0) - quantity;
    }
  }
  inventory.updatedAt = new Date();
  await inventory.save();
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { clubId } = req.query;
    if (!clubId) {
      return res.status(400).json({ message: 'El clubId es requerido.' });
    }
    
    // Obtener las ventas filtradas por club y ordenarlas de forma descendente por fecha de creación
    let sales = await Sale.find({ clubId }).sort({ created_at: -1 }).lean();

    // Si deseas renombrar el campo 'client' a 'client_id' para que coincida con el frontend:
    sales = sales.map(sale => ({
      ...sale,
      client_id: sale.client // renombramos 'client' a 'client_id'
    }));

    // Opcional: Si deseas hacer populate para obtener datos del empleado o cliente, por ejemplo:
    // await Sale.populate(sales, { path: 'employee', select: 'name avatar' });
    // await Sale.populate(sales, { path: 'client', select: 'name' });
    
    res.json(sales);
  } catch (error) {
    console.error('Error obteniendo las ventas:', error);
    res.status(500).json({ message: error.message || 'Error al obtener las ventas' });
  }
});

router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const { clubId, start, end } = req.query;
    if (!clubId) {
      return res.status(400).json({ message: 'El clubId es requerido.' });
    }

    // Construir el filtro para la fecha si se provee el rango
    const query = { clubId };
    if (start || end) {
      query.created_at = {};
      if (start) {
        query.created_at.$gte = new Date(start);
      }
      if (end) {
        query.created_at.$lte = new Date(end);
      }
    }

    // Obtener las ventas filtradas, poblar los campos y ordenarlas por fecha descendente
    const sales = await Sale.find(query)
      .populate({
        path: 'employee',
        select: 'nombre displayName avatar' // Seleccionamos nombre, displayName y avatar
      })
      .populate({
        path: 'client',
        select: 'name' // Seleccionamos solo el nombre del cliente
      })
      .populate({
        path: 'itemGroups.items.product_id',
        select: 'name flavor' // Seleccionamos nombre y sabor del producto
      })
      .sort({ created_at: -1 })
      .lean();

    res.json(sales);
  } catch (error) {
    console.error('Error obteniendo resumen de ventas:', error);
    res.status(500).json({ message: error.message || 'Error al obtener el resumen de ventas' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  console.log('ID de venta:', req.params.id); // Log para verificar el ID recibido
  try {
    const sale = await Sale.findById(req.params.id)
      .populate({
        path: 'itemGroups.items.product_id',
        select: 'name type portionPrice salePrice', // Añadidos campos necesarios
      })
      .populate({
        path: 'employee',
        model: 'User', // Especificamos el modelo User
        select: 'nombre displayName' // Seleccionar nombre y displayName
      })
      .populate({
        path: 'client',
        select: 'name phone'
      })
      .lean();
    
    console.log('Venta encontrada:', sale); // Log para verificar la venta encontrada

    if (!sale) {
      return res.status(404).json({ message: "Venta no encontrada" });
    }

    // Transformar la estructura para que coincida con lo que espera el frontend
    const formattedSale = {
      id: sale._id.toString(),
      created_at: sale.created_at || sale.createdAt,
      total: sale.total,
      status: sale.status,
      employee: {
        id: sale.employee._id.toString(),
        name: sale.employee.displayName || sale.employee.nombre, // Usar displayName o nombre
        avatar: sale.employee.avatar || undefined
      },
      items: [] // Vamos a transformar itemGroups.items a este formato
    };

    // Si hay cliente, añadirlo al objeto formateado
    if (sale.client) {
      formattedSale.customer = {
        name: sale.client.name,
        phone: sale.client.phone || ''
      };
    }

    // Transformar los grupos de items al formato esperado por el frontend
    for (const group of sale.itemGroups) {
      for (const item of group.items) {
        const product = item.product_id;
        if (product) {
          // Determinar el tipo y precio según la estructura del backend
          const type = item.type === 'sealed' ? 'sealed' : 'preparation';
          const price = item.type === 'sealed' ? 
            (item.unit_price || product.salePrice) : 
            (item.pricePerPortion || product.portionPrice);
          
          formattedSale.items.push({
            id: item._id ? item._id.toString() : `item-${Math.random().toString(36).substring(2, 11)}`,
            name: product.name,
            type: type,
            quantity: item.quantity,
            price: price,
            portions: item.portions
          });
        }
      }
    }

    console.log('Venta formateada:', formattedSale); // Log para verificar el formato final
    res.json(formattedSale);
  } catch (error) {
    console.error('Error obteniendo la venta:', error);
    res.status(500).json({ message: error.message || "Error al obtener la venta" });
  }
});

module.exports = router;


