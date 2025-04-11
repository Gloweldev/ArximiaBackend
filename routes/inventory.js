const express = require('express');
const router = express.Router();
const Inventory = require('../models/Inventory');
const Movement = require('../models/Movement');
const Product = require('../models/Product');
const authMiddleware = require('../middlewares/auth');

// Obtener inventario por club
router.get('/club/:clubId', authMiddleware, async (req, res) => {
  try {
    const { clubId } = req.params;
    // Se obtienen los registros de inventory con la información del producto
    const inventory = await Inventory.find({ clubId }).populate('product');
    res.json(inventory);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al obtener inventario' });
  }
});
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
      // Se crea el inventario inicial si no existe
      inventory = new Inventory({ product: productId, clubId });
      // En productos para preparación se debe inicializar el objeto preparation
      if (!inventory.preparation) {
        inventory.preparation = { units: 0, portionsPerUnit: 0, currentPortions: 0 };
      }
    }

    if (type === 'compra' && purchasePrice ) {
      const totalAmount = quantity * parseFloat(purchasePrice);
      const Expense = require('../models/Expense');
      const expense = new Expense({
        clubId,
        product: productId,
        category: 'producto',
        amount: totalAmount,
        description: `Compra de inventario: ${description}`,
        user: req.userId
      });
      await expense.save();
      if (unit === 'sealed') {
        inventory.sealed = (inventory.sealed || 0) + quantity;
      } else if (unit === 'portion') {
        // Para productos de preparación (o mixtos) se incrementan las unidades compradas...
        inventory.preparation.units = (inventory.preparation.units || 0) + quantity;
        // ...y se calculan las nuevas porciones según el valor de portionsPerUnit.
        const portionsPerUnit = inventory.preparation.portionsPerUnit || 1;
        const portionsToAdd = quantity * portionsPerUnit;
        inventory.preparation.currentPortions = (inventory.preparation.currentPortions || 0) + portionsToAdd;
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

// Obtener historial de movimientos para un producto
router.get('/movements/:inventoryId', authMiddleware, async (req, res) => {
  try {
    const { inventoryId } = req.params;
    // Obtener el documento de inventario usando el ID del inventario
    const invDoc = await Inventory.findById(inventoryId);
    if (!invDoc) {
      return res.status(404).json({ message: 'Inventario no encontrado' });
    }
    // Extraer el product ID del inventario
    const productId = invDoc.product;
    // Consultar movimientos usando el productId del catálogo
    const movements = await Movement.find({ product: productId }).populate('user', 'nombre email');
    res.json(movements);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al obtener el historial' });
  }
});

module.exports = router;