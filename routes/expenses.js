// routes/expenses.js
const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');
const Inventory = require('../models/Inventory');
const Movement = require('../models/Movement');
const authMiddleware = require('../middlewares/auth');
const mongoose = require('mongoose');
//
// Este endpoint registra un gasto. En el caso de gastos por compra de productos,
// se actualizará el inventario y se generarán movimientos de inventario. Se espera recibir en el body:
//
// {
//   clubId: <club id>,
//   category: 'purchase'  // o 'operational'
//   productId: <product id>,        // solo para gastos de compra de producto
//   type: 'compra',                 // siempre "compra" en el caso de gastos de compra
//   quantity: <número>,
//   unit: 'sealed' o 'portion',      // según corresponda
//   expenseAmount: <monto total del gasto>,
//   description: <texto>
// }
//
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { clubId, category, productId, type, quantity, unit, expenseAmount, description } = req.body;
    if (!clubId || !category || !expenseAmount) {
      return res.status(400).json({ message: 'Faltan datos requeridos en el gasto' });
    }
    // Si el gasto es de compra de producto se requiere productId, type, quantity y unit
    if (category === 'purchase') {
      if (!productId || !type || !quantity || !unit) {
        return res.status(400).json({ message: 'Faltan datos requeridos para el gasto de compra de producto' });
      }
      if (quantity <= 0) {
        return res.status(400).json({ message: 'La cantidad debe ser mayor a 0' });
      }
      // Registrar el movimiento de inventario
      const movement = new Movement({
        product: productId,
        clubId,
        type, // "compra" en este caso
        quantity,
        unit,
        description: description ? `${description} - Gasto: $${expenseAmount}` : `Gasto de compra: $${expenseAmount}`,
        user: req.userId,
      });
      await movement.save();

      // Actualizar inventario
      let inventory = await Inventory.findOne({ product: productId, clubId });
      if (!inventory) {
        inventory = new Inventory({ product: productId, clubId });
        if (!inventory.preparation) {
          inventory.preparation = { units: 0, portionsPerUnit: 0, currentPortions: 0 };
        }
      }
      if (type === 'compra') {
        if (unit === 'sealed') {
          inventory.sealed = (inventory.sealed || 0) + quantity;
        } else if (unit === 'portion') {
          inventory.preparation.units = (inventory.preparation.units || 0) + quantity;
          const portionsPerUnit = inventory.preparation.portionsPerUnit || 1;
          const portionsToAdd = quantity * portionsPerUnit;
          inventory.preparation.currentPortions = (inventory.preparation.currentPortions || 0) + portionsToAdd;
        }
      }
      inventory.updatedAt = new Date();
      await inventory.save();
    }

    // Registrar el gasto en Expense
    const expense = new Expense({
      clubId,
      product: productId || undefined,
      category,
      amount: expenseAmount,
      description,
      user: req.userId,
      date: new Date(),
    });
    await expense.save();

    res.status(201).json({ message: 'Gasto registrado correctamente', expense });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || 'Error al registrar gasto' });
  }
});

router.get('/', authMiddleware, async (req, res) => {
    try {
      const { clubId, start, end } = req.query;
      if (!clubId) {
        return res.status(400).json({ message: 'El clubId es requerido' });
      }
      // Armar el filtro base
      const filter = { clubId };
      // Si se reciben fechas, se agregan al filtro
      if (start && end) {
        filter.date = { $gte: new Date(start), $lte: new Date(end) };
      }
      const expenses = await Expense.find(filter).sort({ date: -1 });
      res.status(200).json(expenses);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: error.message || 'Error al obtener la lista de gastos' });
    }
  });

router.get('/kpis', authMiddleware, async (req, res) => {
    try {
      const { clubId } = req.query;
      if (!clubId) {
        return res.status(400).json({ message: 'El clubId es requerido' });
      }
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      // Mes anterior
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const startOfPrevMonth = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1);
      const endOfPrevMonth = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0, 23, 59, 59);
  
      // Obtener gastos del mes actual y del mes anterior
      const currentExpenses = await Expense.find({
        clubId,
        date: { $gte: startOfMonth, $lte: endOfMonth }
      });
      const previousExpenses = await Expense.find({
        clubId,
        date: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
      });
  
      const totalExpenses = currentExpenses.reduce((sum, expense) => sum + expense.amount, 0);
      const previousMonthExpenses = previousExpenses.reduce((sum, expense) => sum + expense.amount, 0);
      const countCurrentExpenses = currentExpenses.length;
      const averageExpense = countCurrentExpenses > 0 ? totalExpenses / countCurrentExpenses : 0;
  
      // Agrupar gastos por categoría para determinar la categoría con mayor gasto
      const categoryTotals = {};
      currentExpenses.forEach(expense => {
        const cat = expense.category;
        if (!categoryTotals[cat]) {
          categoryTotals[cat] = 0;
        }
        categoryTotals[cat] += expense.amount;
      });
      let topCategory = { name: "N/A", percentage: 0 };
      if (totalExpenses > 0) {
        const topCatKey = Object.keys(categoryTotals).reduce((a, b) =>
          categoryTotals[a] > categoryTotals[b] ? a : b
        );
        topCategory.name = topCatKey;
        topCategory.percentage = Number(((categoryTotals[topCatKey] / totalExpenses) * 100).toFixed(1));
      }
  
      res.json({
        totalExpenses,
        previousMonthExpenses,
        averageExpense,
        topCategory,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: error.message || 'Error al obtener KPIs' });
    }
});
  
  // Endpoint GET para datos del gráfico de distribución de gastos
  // Agrupa los gastos del mes actual por categoría
router.get('/chart', authMiddleware, async (req, res) => {
    try {
      const { clubId } = req.query;
      if (!clubId) {
        return res.status(400).json({ message: 'El clubId es requerido' });
      }
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  
      const chartData = await Expense.aggregate([
        { $match: { clubId: new mongoose.Types.ObjectId(clubId), date: { $gte: startOfMonth, $lte: endOfMonth } } },
        { $group: { _id: "$category", total: { $sum: "$amount" } } },
        { $project: { category: "$_id", total: 1, _id: 0 } }
      ]);

      console.log('chartData:', chartData);
      // Calcular el total de gastos para cada categoría
  
      res.json(chartData);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: error.message || 'Error al obtener datos del gráfico' });
    }
});
  


module.exports = router;
