const express = require('express');
const router = express.Router();
const Inventory = require('../models/Inventory');
const Movement = require('../models/Movement');
const Product = require('../models/Product');
const authMiddleware = require('../middlewares/auth');
const User = require('../models/User');

// Obtener inventario por club
router.get('/club/:clubId', authMiddleware, async (req, res) => {
  try {
    const { clubId } = req.params;
    const { userId } = req;

    const user = await User.findById(userId);
    const idealStock = user?.inventarioIdeal || 5;

    const inventory = await Inventory.find({ clubId }).populate('product');
    
    const updatedInventory = inventory.map(item => {
      // Calcular estado para stock sellado
      const sealedStatus = calculateStatus(item.sealed || 0, idealStock);
      
      // Calcular estado para preparaciones (usando unidades, no porciones)
      const prepStatus = calculateStatus(item.preparation?.units || 0, idealStock);
      
      // Para productos de tipo "both", mantenemos ambos estados
      let status;
      if (item.product.type === 'both') {
        status = {
          sealed: sealedStatus,
          preparation: prepStatus
        };
      } else if (item.product.type === 'sealed') {
        status = sealedStatus;
      } else {
        status = prepStatus;
      }

      return {
        ...item.toObject(),
        product: {
          ...item.product.toObject(),
          status
        }
      };
    });

    res.json(updatedInventory);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al obtener inventario' });
  }
});

// Función auxiliar para calcular el estado
function calculateStatus(currentStock, idealStock) {
  if (currentStock <= 0) {
    return 'critical';
  } else if (currentStock < idealStock) {
    return 'low';
  } else {
    return 'normal';
  }
}

// Registrar un movimiento de inventario
router.post('/movement', authMiddleware, async (req, res) => {
  try {
    const { productId, clubId, type, quantity, unit, description, purchasePrice } = req.body;
    if (!productId || !clubId || !type || !quantity || !unit) {
      return res.status(400).json({ message: 'Faltan datos requeridos' });
    }

    if (quantity <= 0) {
      return res.status(400).json({ message: 'La cantidad debe ser mayor a 0' });
    }

    const movement = new Movement({
      product: productId,
      clubId,
      type,
      quantity,
      unit,
      description,
      user: req.userId,
    });
    await movement.save();

    let inventory = await Inventory.findOne({ product: productId, clubId });
    if (!inventory) {
      inventory = new Inventory({ product: productId, clubId });
      if (!inventory.preparation) {
        inventory.preparation = { units: 0, portionsPerUnit: 0, currentPortions: 0 };
      }
    }

    // Asegurarnos de que el tipo de movimiento 'compra' actualice el stock correctamente
    if (type === 'compra') {
      if (unit === 'sealed') {
        inventory.sealed = (inventory.sealed || 0) + quantity;
      } else if (unit === 'portion') {
        inventory.preparation.units = (inventory.preparation.units || 0) + quantity;
        const portionsPerUnit = inventory.preparation.portionsPerUnit || 1;
        const portionsToAdd = quantity * portionsPerUnit;
        inventory.preparation.currentPortions = (inventory.preparation.currentPortions || 0) + portionsToAdd;
      }
      
      // Si viene de un gasto, registramos el gasto
      if (purchasePrice) {
        const totalAmount = quantity * parseFloat(purchasePrice);
        const Expense = require('../models/Expense');
        const expense = new Expense({
          clubId,
          product: productId,
          category: 'producto',
          amount: totalAmount,
          description: `Compra de inventario: ${description}`, // La descripción viene ya formateada del frontend
          user: req.userId
        });
        await expense.save();
      }
    } else if (type === 'venta') {
      if (unit === 'sealed') {
        inventory.sealed = (inventory.sealed || 0) - quantity;
        if (inventory.sealed < 0) throw new Error('Stock insuficiente');
      }
      // Si fuera venta de porciones, se resta directamente de currentPortions
      else if (unit === 'portion') {
        inventory.preparation.currentPortions = (inventory.preparation.currentPortions || 0) - quantity;
        if (inventory.preparation.currentPortions < 0) throw new Error('Porciones insuficientes');
      }
    } else if (type === 'uso' && unit === 'portion') {
      // Se resta de currentPortions en caso de uso
      inventory.preparation.currentPortions = (inventory.preparation.currentPortions || 0) - quantity;
      if (inventory.preparation.currentPortions < 0) throw new Error('Porciones insuficientes');
    } else if (type === 'ajuste') {
      if (unit === 'sealed') {
        inventory.sealed = (inventory.sealed || 0) + quantity;
      } else if (unit === 'portion') {
        // En ajustes se actualiza tanto el número de unidades como las porciones
        inventory.preparation.units = (inventory.preparation.units || 0) + quantity;
        const portionsPerUnit = inventory.preparation.portionsPerUnit || 1;
        const portionsToAdd = quantity * portionsPerUnit;
        inventory.preparation.currentPortions = (inventory.preparation.currentPortions || 0) + portionsToAdd;
      }
    }
    inventory.updatedAt = new Date();
    await inventory.save();

    res.json({ message: 'Movimiento registrado correctamente', movement });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || 'Error al registrar movimiento' });
  }
});

// Actualizar el endpoint de movements
router.get('/movements/:inventoryId', authMiddleware, async (req, res) => {
  try {
    const { inventoryId } = req.params;
    const { from, to } = req.query;

    // Obtener el documento de inventario usando el ID del inventario
    const invDoc = await Inventory.findById(inventoryId);
    if (!invDoc) {
      return res.status(404).json({ message: 'Inventario no encontrado' });
    }

    // Construir el query base
    const query = { 
      product: invDoc.product,
      date: {}
    };

    // Añadir filtros de fecha si existen
    if (from) {
      query.date.$gte = new Date(from);
    }
    if (to) {
      query.date.$lte = new Date(to);
    }

    // Si no hay filtros de fecha, eliminar el objeto date vacío
    if (Object.keys(query.date).length === 0) {
      delete query.date;
    }

    // Consultar movimientos usando el query construido
    const movements = await Movement.find(query)
      .populate('user', 'nombre email')
      .sort({ date: -1 });

    res.json(movements);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al obtener el historial' });
  }
});

// Actualizar estados basados en inventario ideal
router.post('/update-states/:clubId', authMiddleware, async (req, res) => {
  try {
    const { clubId } = req.params;
    const { userId } = req;

    // Obtener el inventario ideal del usuario
    const user = await User.findById(userId);
    if (!user || !user.inventarioIdeal) {
      return res.status(400).json({ message: 'No se encontró el inventario ideal del usuario' });
    }

    const idealStock = user.inventarioIdeal;
    console.log('Inventario ideal:', idealStock);
    const inventory = await Inventory.find({ clubId }).populate('product');

    const updatedItems = [];
    
    for (const item of inventory) {
      let currentStock = 0;

      // Calcular stock total (sellado + porciones)
      if (item.sealed) {
        currentStock += item.sealed;
      }
      if (item.preparation && item.preparation.currentPortions) {
        currentStock += item.preparation.currentPortions;
      }

      // Determinar nuevo estado
      let status;
      if (currentStock <= 0) {
        status = 'critical';
      } else if (currentStock < idealStock) {
        status = 'low';
      } else {
        status = 'normal';
      }

      // Actualizar el estado en el producto
      await Product.findByIdAndUpdate(item.product._id, { status });
      updatedItems.push({
        productId: item.product._id,
        name: item.product.name,
        currentStock,
        status
      });
    }

    res.json({
      message: 'Estados actualizados correctamente',
      updatedItems,
      idealStock
    });

  } catch (error) {
    console.error('Error al actualizar estados:', error);
    res.status(500).json({ message: 'Error al actualizar estados del inventario' });
  }
});

module.exports = router;